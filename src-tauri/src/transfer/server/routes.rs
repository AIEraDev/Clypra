use std::collections::HashMap;
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::transfer::device::DiscoveredDevice;
use crate::transfer::session::{IncomingFile, SessionState, TransferSession};

use super::network::{get_non_colliding_path, sanitize_filename, unix_secs};
use super::template::render_upload_page;
use super::types::{
    AppState, CancelledEventPayload, CompleteEventPayload, IncomingEventPayload, IncomingFileBrief,
    PrepareUploadRequest, ProgressEventPayload, SessionQuery, StagedFileDto, StagedFileQuery,
    UploadQuery,
};

pub async fn get_upload_page(State(state): State<AppState>) -> impl IntoResponse {
    let theme = state.service.get_theme_colors();
    let html = render_upload_page(&theme);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(html))
        .unwrap()
}

/// Returns current editor theme colors as JSON for client-side live theme sync.
pub async fn get_theme(State(state): State<AppState>) -> Json<HashMap<String, String>> {
    Json(state.service.get_theme_colors())
}

/// LocalSend v2 standard device info endpoint (scanned by peers during subnet scan).
pub async fn get_localsend_info(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::to_value(&state.service.device_info).unwrap_or_else(|_| json!({})))
}

/// LocalSend v2 peer registration endpoint.
pub async fn post_register(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    if let Some(Json(val)) = body {
        if let (Some(alias), Some(fingerprint)) = (
            val.get("alias").and_then(|v| v.as_str()),
            val.get("fingerprint").and_then(|v| v.as_str()),
        ) {
            if fingerprint != state.service.device_info.fingerprint {
                // Peer IP is strictly derived from the genuine TCP socket peer address,
                // never from client-supplied proxy headers (e.g. X-Forwarded-For) to prevent SSRF.
                let sender_ip = peer_addr.ip().to_string();

                let port = val
                    .get("port")
                    .and_then(|v| v.as_u64())
                    .filter(|&p| p > 0 && p <= 65535)
                    .unwrap_or(53317) as u16;
                let device_type = val
                    .get("deviceType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.chars().take(32).collect::<String>());
                let safe_alias = alias.chars().take(64).collect::<String>();

                let now = unix_secs();
                state.service.discovered_devices.insert(
                    fingerprint.to_string(),
                    DiscoveredDevice {
                        alias: safe_alias,
                        device_type,
                        ip: sender_ip,
                        port,
                        fingerprint: fingerprint.to_string(),
                        last_seen_secs: now,
                    },
                );
            }
        }
    }
    Json(serde_json::to_value(&state.service.device_info).unwrap_or_else(|_| json!({})))
}

fn is_authorized(headers: &HeaderMap, query_token: Option<&str>, service: &crate::transfer::TransferService) -> bool {
    let token = query_token.or_else(|| {
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer ").or(Some(h)))
    });
    service.is_token_valid(token)
}

/// Returns list of files staged on laptop for mobile download (internal file paths redacted).
pub async fn get_staged_files(
    State(state): State<AppState>,
    Query(query): Query<StagedFileQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&headers, query.token.as_deref(), &state.service) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let mut files: Vec<StagedFileDto> = state
        .service
        .staged_files
        .iter()
        .map(|e| {
            let f = e.value();
            StagedFileDto {
                id: f.id.clone(),
                file_name: f.file_name.clone(),
                size: f.size,
                mime_type: f.mime_type.clone(),
                created_at: f.created_at,
            }
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.created_at));
    Json(files).into_response()
}

/// Streams a staged file to the mobile device for direct download.
pub async fn download_staged_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
    Query(query): Query<StagedFileQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&headers, query.token.as_deref(), &state.service) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let file = match state.service.staged_files.get(&file_id) {
        Some(f) => f.clone(),
        None => return (StatusCode::NOT_FOUND, "File not found in staged list").into_response(),
    };

    let path = std::path::PathBuf::from(&file.file_path);
    if !path.exists() {
        return (StatusCode::NOT_FOUND, "File missing from disk").into_response();
    }

    let opened = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) => {
            log::error!("[Transfer] Failed to open staged file {:?}: {e}", path);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot open file").into_response();
        }
    };

    let stream = ReaderStream::new(opened);
    let body = Body::from_stream(stream);

    let mime = if file.mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        file.mime_type.clone()
    };

    let filename_header = format!(
        "attachment; filename=\"{}\"",
        file.file_name.replace('"', "")
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, filename_header)
        .header(header::CONTENT_LENGTH, file.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Response construction failed",
            )
                .into_response()
        })
}

/// Streams a staged file to the mobile device for inline viewing / playing in browser without download prompt.
pub async fn view_staged_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
    Query(query): Query<StagedFileQuery>,
    headers: HeaderMap,
) -> Response {
    if !is_authorized(&headers, query.token.as_deref(), &state.service) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let file = match state.service.staged_files.get(&file_id) {
        Some(f) => f.clone(),
        None => return (StatusCode::NOT_FOUND, "File not found in staged list").into_response(),
    };

    let path = std::path::PathBuf::from(&file.file_path);
    if !path.exists() {
        return (StatusCode::NOT_FOUND, "File missing from disk").into_response();
    }

    let opened = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(e) => {
            log::error!("[Transfer] Failed to open staged file {:?}: {e}", path);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot open file").into_response();
        }
    };

    let stream = ReaderStream::new(opened);
    let body = Body::from_stream(stream);

    let mime = if file.mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        file.mime_type.clone()
    };

    let filename_header = format!("inline; filename=\"{}\"", file.file_name.replace('"', ""));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, filename_header)
        .header(header::CONTENT_LENGTH, file.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Response construction failed",
            )
                .into_response()
        })
}

pub async fn post_prepare_upload(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    Json(body): Json<PrepareUploadRequest>,
) -> Response {
    if body.files.is_empty() {
        return (StatusCode::BAD_REQUEST, "File list cannot be empty").into_response();
    }
    if body.files.len() > 100 {
        return (StatusCode::BAD_REQUEST, "Too many files in transfer request (max 100)").into_response();
    }

    state.service.prune_stale_sessions();

    let pending_count = state
        .service
        .sessions
        .iter()
        .filter(|s| matches!(s.state, SessionState::Pending))
        .count();
    if pending_count >= 5 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many pending transfer requests",
        )
            .into_response();
    }

    // Peer IP is strictly derived from the genuine TCP socket peer address,
    // never from client-supplied proxy headers (e.g. X-Forwarded-For) to prevent SSRF.
    let sender_ip = peer_addr.ip().to_string();

    let session_id = Uuid::new_v4().to_string();

    let mut files: Vec<IncomingFile> = body
        .files
        .values()
        .map(|fm| {
            let truncated_id = fm.id.chars().take(64).collect::<String>();
            let safe_name = sanitize_filename(&fm.file_name);
            let truncated_name = safe_name.chars().take(255).collect::<String>();
            IncomingFile {
                id: truncated_id,
                file_name: truncated_name,
                size: fm.size,
                file_type: fm.file_type.chars().take(64).collect::<String>(),
            }
        })
        .collect();
    files.sort_by(|a, b| a.id.cmp(&b.id));

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let safe_alias = body.info.alias.chars().take(64).collect::<String>();

    let session = TransferSession {
        session_id: session_id.clone(),
        sender_alias: safe_alias.clone(),
        sender_ip: sender_ip.clone(),
        state: SessionState::Pending,
        files: files.clone(),
        received_files: vec![],
        bytes_received: 0,
        total_bytes,
    };
    state.service.sessions.insert(session_id.clone(), session);

    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    state.service.consent_senders.insert(session_id.clone(), tx);

    let brief_files: Vec<IncomingFileBrief> = files
        .iter()
        .map(|f| IncomingFileBrief {
            id: f.id.clone(),
            name: f.file_name.clone(),
            size: f.size,
        })
        .collect();
    let _ = state.app_handle.emit(
        "clypra://transfer-incoming",
        IncomingEventPayload {
            session_id: session_id.clone(),
            sender_alias: safe_alias,
            files: brief_files,
        },
    );

    let accepted = tokio::time::timeout(std::time::Duration::from_secs(60), rx)
        .await
        .unwrap_or(Ok(false))
        .unwrap_or(false);

    state.service.consent_senders.remove(&session_id);

    if !accepted {
        state.service.sessions.remove(&session_id);
        return (StatusCode::FORBIDDEN, Json(json!({"message": "Declined"}))).into_response();
    }

    let mut token_map: HashMap<String, String> = HashMap::new();
    for file in &files {
        token_map.insert(file.id.clone(), Uuid::new_v4().to_string());
    }

    if let Some(mut s) = state.service.sessions.get_mut(&session_id) {
        s.state = SessionState::Accepted;
    }
    for (file_id, token) in &token_map {
        state
            .service
            .file_tokens
            .insert(format!("{}:{}", session_id, file_id), token.clone());
    }

    (
        StatusCode::OK,
        Json(json!({ "sessionId": session_id, "files": token_map })),
    )
        .into_response()
}

pub async fn post_upload(
    State(state): State<AppState>,
    Query(params): Query<UploadQuery>,
    req: axum::extract::Request,
) -> Response {
    let session_id = &params.session_id;
    let file_id = &params.file_id;
    let provided_token = &params.token;

    let stored_token_key = format!("{}:{}", session_id, file_id);
    let valid = state
        .service
        .file_tokens
        .get(&stored_token_key)
        .map(|t| t.value().as_str() == provided_token.as_str())
        .unwrap_or(false);

    if !valid {
        return (StatusCode::FORBIDDEN, "Invalid token").into_response();
    }

    let (file_name, total_file_bytes) = {
        let session = match state.service.sessions.get(session_id) {
            Some(s) => s,
            None => return (StatusCode::NOT_FOUND, "Session not found").into_response(),
        };
        let file_info = match session.files.iter().find(|f| &f.id == file_id) {
            Some(f) => (f.file_name.clone(), f.size),
            None => return (StatusCode::NOT_FOUND, "File not found in session").into_response(),
        };
        file_info
    };

    if let Some(mut s) = state.service.sessions.get_mut(session_id) {
        s.state = SessionState::InProgress;
    }

    let dest_dir = state.service.get_inbox_dir();
    if let Err(e) = tokio::fs::create_dir_all(&dest_dir).await {
        log::error!(
            "[Transfer] Failed to create destination dir {:?}: {e}",
            dest_dir
        );
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot create destination directory",
        )
            .into_response();
    }
    let dest_path = get_non_colliding_path(&dest_dir, &file_name);
    if !dest_path.starts_with(&dest_dir) {
        log::error!(
            "[Transfer] Path traversal rejected: {:?} is not within inbox {:?}",
            dest_path,
            dest_dir
        );
        return (StatusCode::BAD_REQUEST, "Invalid file destination").into_response();
    }

    let mut file = match tokio::fs::File::create(&dest_path).await {
        Ok(f) => f,
        Err(e) => {
            log::error!("[Transfer] Failed to create file {:?}: {e}", dest_path);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot create file").into_response();
        }
    };

    let mut stream = req.into_body().into_data_stream();
    let mut bytes_received: u64 = 0;
    let app = state.app_handle.clone();
    let sid = session_id.clone();
    let fid = file_id.clone();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(data) => {
                if bytes_received + data.len() as u64 > total_file_bytes {
                    log::error!(
                        "[Transfer] Upload size exceeded declared size: {} > {}",
                        bytes_received + data.len() as u64,
                        total_file_bytes
                    );
                    drop(file);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Upload body exceeded declared file size",
                    )
                        .into_response();
                }

                if let Err(e) = file.write_all(&data).await {
                    log::error!("[Transfer] Write error: {e}");
                    drop(file);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Write failed").into_response();
                }
                bytes_received += data.len() as u64;

                if let Some(mut s) = state.service.sessions.get_mut(&sid) {
                    s.bytes_received += data.len() as u64;
                }

                let _ = app.emit(
                    "clypra://transfer-progress",
                    ProgressEventPayload {
                        session_id: sid.clone(),
                        file_id: fid.clone(),
                        bytes_received,
                        total_bytes: total_file_bytes,
                    },
                );
            }
            Err(e) => {
                log::error!("[Transfer] Body read error: {e}");
                drop(file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                return (StatusCode::BAD_REQUEST, "Body read error").into_response();
            }
        }
    }

    if bytes_received != total_file_bytes {
        log::error!(
            "[Transfer] Incomplete upload: received {} bytes, expected {}",
            bytes_received,
            total_file_bytes
        );
        drop(file);
        let _ = tokio::fs::remove_file(&dest_path).await;
        return (StatusCode::BAD_REQUEST, "Incomplete upload body").into_response();
    }

    if let Err(e) = file.flush().await {
        log::error!("[Transfer] Flush error: {e}");
    }

    let dest_str = dest_path.to_string_lossy().to_string();

    let (session_complete, all_paths) = {
        if let Some(mut s) = state.service.sessions.get_mut(&sid) {
            s.received_files.push(dest_str.clone());
            let done = s.received_files.len() >= s.files.len();
            let paths = s.received_files.clone();
            (done, paths)
        } else {
            (false, vec![])
        }
    };

    state.service.file_tokens.remove(&stored_token_key);

    if session_complete {
        if let Some(mut s) = state.service.sessions.get_mut(&sid) {
            s.state = SessionState::Complete;
        }
        state.service.prune_stale_sessions();
        let _ = state.app_handle.emit(
            "clypra://transfer-complete",
            CompleteEventPayload {
                session_id: sid.clone(),
                file_paths: all_paths,
            },
        );
    }

    StatusCode::NO_CONTENT.into_response()
}

pub async fn post_cancel(
    State(state): State<AppState>,
    Query(params): Query<SessionQuery>,
) -> StatusCode {
    let session_id = &params.session_id;
    if let Some(mut s) = state.service.sessions.get_mut(session_id) {
        s.state = SessionState::Cancelled;
    }
    let _ = state.app_handle.emit(
        "clypra://transfer-cancelled",
        CancelledEventPayload {
            session_id: session_id.clone(),
        },
    );
    if let Some((_, tx)) = state.service.consent_senders.remove(session_id) {
        let _ = tx.send(false);
    }
    StatusCode::NO_CONTENT
}
