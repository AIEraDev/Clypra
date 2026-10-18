use std::collections::HashMap;

use axum::body::Body;
use axum::extract::{Path, Query, State};
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
use crate::transfer::StagedFile;

use super::network::{get_non_colliding_path, unix_secs};
use super::template::render_upload_page;
use super::types::{
    AppState, CancelledEventPayload, CompleteEventPayload, IncomingEventPayload, IncomingFileBrief,
    PrepareUploadRequest, ProgressEventPayload, SessionQuery, UploadQuery,
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
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Json<Value> {
    if let Some(Json(val)) = body {
        if let (Some(alias), Some(fingerprint)) = (
            val.get("alias").and_then(|v| v.as_str()),
            val.get("fingerprint").and_then(|v| v.as_str()),
        ) {
            if fingerprint != state.service.device_info.fingerprint {
                let sender_ip = headers
                    .get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                let port = val.get("port").and_then(|v| v.as_u64()).unwrap_or(53317) as u16;
                let device_type = val
                    .get("deviceType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let now = unix_secs();
                state.service.discovered_devices.insert(
                    fingerprint.to_string(),
                    DiscoveredDevice {
                        alias: alias.to_string(),
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

/// Returns list of files staged on laptop for mobile download.
pub async fn get_staged_files(State(state): State<AppState>) -> Json<Vec<StagedFile>> {
    let mut files: Vec<StagedFile> = state
        .service
        .staged_files
        .iter()
        .map(|e| e.value().clone())
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.created_at));
    Json(files)
}

/// Streams a staged file to the mobile device for direct download.
pub async fn download_staged_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
) -> Response {
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
pub async fn view_staged_file(State(state): State<AppState>, Path(file_id): Path<String>) -> Response {
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
    headers: HeaderMap,
    Json(body): Json<PrepareUploadRequest>,
) -> Response {
    let sender_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let session_id = Uuid::new_v4().to_string();

    let mut files: Vec<IncomingFile> = body
        .files
        .values()
        .map(|fm| IncomingFile {
            id: fm.id.clone(),
            file_name: fm.file_name.clone(),
            size: fm.size,
            file_type: fm.file_type.clone(),
        })
        .collect();
    files.sort_by(|a, b| a.id.cmp(&b.id));

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();

    let session = TransferSession {
        session_id: session_id.clone(),
        sender_alias: body.info.alias.clone(),
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
            sender_alias: body.info.alias.clone(),
            files: brief_files,
        },
    );

    let accepted = tokio::time::timeout(std::time::Duration::from_secs(60), rx)
        .await
        .unwrap_or(Ok(false))
        .unwrap_or(false);

    state.service.consent_senders.remove(&session_id);

    if !accepted {
        if let Some(mut s) = state.service.sessions.get_mut(&session_id) {
            s.state = SessionState::Rejected;
        }
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
                if let Err(e) = file.write_all(&data).await {
                    log::error!("[Transfer] Write error: {e}");
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
                return (StatusCode::BAD_REQUEST, "Body read error").into_response();
            }
        }
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
