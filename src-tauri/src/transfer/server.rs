use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use super::session::{IncomingFile, SessionState, TransferSession};
use super::TransferService;

// ── Static upload page ───────────────────────────────────────────────────────

const UPLOAD_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Send to Clypra</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f0f12;
    color: #e2e2e7;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    background: #1a1a20;
    border: 1px solid #2e2e38;
    border-radius: 16px;
    padding: 36px 32px;
    max-width: 420px;
    width: 100%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .logo { font-size: 40px; margin-bottom: 12px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  p { color: #888; font-size: 14px; margin-bottom: 28px; }
  .drop-area {
    border: 2px dashed #3a3a4a;
    border-radius: 12px;
    padding: 32px 16px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    margin-bottom: 20px;
    position: relative;
  }
  .drop-area:hover, .drop-area.drag-over {
    border-color: #7c5cbf;
    background: rgba(124,92,191,0.06);
  }
  .drop-area input[type=file] {
    position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
  }
  .drop-icon { font-size: 32px; margin-bottom: 10px; }
  .drop-label { font-size: 15px; color: #aaa; }
  .drop-label span { color: #7c5cbf; font-weight: 600; }
  #file-list { margin-bottom: 20px; text-align: left; }
  .file-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px;
    background: #22222a; margin-bottom: 6px;
    font-size: 13px;
  }
  .file-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-item .size { color: #888; white-space: nowrap; }
  button {
    width: 100%; padding: 14px;
    background: #7c5cbf; color: #fff;
    border: none; border-radius: 10px;
    font-size: 16px; font-weight: 600;
    cursor: pointer; transition: background 0.2s;
  }
  button:hover:not(:disabled) { background: #9470d8; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  #status {
    margin-top: 16px; font-size: 14px; min-height: 22px;
    color: #aaa;
  }
  #status.error { color: #f05656; }
  #status.success { color: #56c99a; }
  .progress-bar-wrap {
    background: #2a2a35; border-radius: 6px; height: 6px;
    margin-top: 12px; overflow: hidden; display: none;
  }
  .progress-bar { height: 100%; background: #7c5cbf; width: 0%; transition: width 0.2s; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">🎬</div>
  <h1>Send to Clypra</h1>
  <p>Transfer videos and images directly to your desktop editor.</p>
  <div class="drop-area" id="dropArea">
    <input type="file" id="fileInput" multiple accept="video/*,image/*"/>
    <div class="drop-icon">📁</div>
    <div class="drop-label">Tap to pick files or <span>drag &amp; drop</span></div>
  </div>
  <div id="file-list"></div>
  <button id="sendBtn" disabled>Send to Clypra</button>
  <div id="status"></div>
  <div class="progress-bar-wrap" id="progressWrap">
    <div class="progress-bar" id="progressBar"></div>
  </div>
</div>
<script>
  const fileInput = document.getElementById('fileInput');
  const fileList  = document.getElementById('file-list');
  const sendBtn   = document.getElementById('sendBtn');
  const status    = document.getElementById('status');
  const dropArea  = document.getElementById('dropArea');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');

  let selectedFiles = [];

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
    return (n/1073741824).toFixed(2) + ' GB';
  }

  function renderFiles() {
    fileList.innerHTML = '';
    selectedFiles.forEach(f => {
      const div = document.createElement('div');
      div.className = 'file-item';
      div.innerHTML = `<span class="name">${f.name}</span><span class="size">${fmtSize(f.size)}</span>`;
      fileList.appendChild(div);
    });
    sendBtn.disabled = selectedFiles.length === 0;
  }

  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files);
    renderFiles();
  });

  ['dragover','dragenter'].forEach(ev => dropArea.addEventListener(ev, e => {
    e.preventDefault(); dropArea.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(ev => dropArea.addEventListener(ev, e => {
    e.preventDefault(); dropArea.classList.remove('drag-over');
  }));
  dropArea.addEventListener('drop', e => {
    selectedFiles = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('image/'));
    renderFiles();
  });

  sendBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    sendBtn.disabled = true;
    status.className = '';
    status.textContent = 'Requesting transfer approval…';
    progressWrap.style.display = 'none';
    progressBar.style.width = '0%';

    const filesPayload = {};
    selectedFiles.forEach((f, i) => {
      filesPayload['file-' + i] = { id: 'file-' + i, fileName: f.name, size: f.size, fileType: f.type || 'application/octet-stream' };
    });

    let prepResp;
    try {
      prepResp = await fetch('/api/localsend/v2/prepare-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ info: { alias: 'Phone', deviceType: 'mobile', fingerprint: 'web-ui' }, files: filesPayload }),
      });
    } catch(e) {
      status.className = 'error'; status.textContent = 'Network error: ' + e.message;
      sendBtn.disabled = false; return;
    }

    if (prepResp.status === 403) {
      status.className = 'error'; status.textContent = 'Transfer was declined.';
      sendBtn.disabled = false; return;
    }
    if (!prepResp.ok) {
      status.className = 'error'; status.textContent = 'Server error ' + prepResp.status;
      sendBtn.disabled = false; return;
    }

    const { sessionId, files: tokens } = await prepResp.json();
    status.textContent = 'Uploading…';
    progressWrap.style.display = 'block';

    let uploaded = 0;
    const total = selectedFiles.reduce((s, f) => s + f.size, 0);

    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles[i];
      const fileId = 'file-' + i;
      const token = tokens[fileId];
      status.textContent = `Uploading ${f.name}…`;
      try {
        const r = await fetch(`/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${encodeURIComponent(token)}`, {
          method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Length': f.size },
        });
        if (!r.ok) throw new Error('Upload failed: ' + r.status);
      } catch(e) {
        status.className = 'error'; status.textContent = e.message;
        sendBtn.disabled = false; return;
      }
      uploaded += f.size;
      progressBar.style.width = Math.round((uploaded / total) * 100) + '%';
    }

    status.className = 'success';
    status.textContent = '✅ All files sent to Clypra!';
    selectedFiles = []; renderFiles();
  });
</script>
</body>
</html>"#;

// ── Request / Response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareUploadRequest {
    info: SenderInfo,
    files: HashMap<String, FileMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SenderInfo {
    alias: String,
    #[serde(default)]
    device_type: Option<String>,
    #[serde(default)]
    fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    id: String,
    file_name: String,
    size: u64,
    #[serde(default)]
    file_type: String,
}

#[derive(Debug, Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "fileId")]
    file_id: String,
    token: String,
}

// ── Payloads emitted as Tauri events ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingEventPayload {
    session_id: String,
    sender_alias: String,
    files: Vec<IncomingFileBrief>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingFileBrief {
    id: String,
    name: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEventPayload {
    session_id: String,
    file_id: String,
    bytes_received: u64,
    total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteEventPayload {
    session_id: String,
    file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelledEventPayload {
    session_id: String,
}

// ── Axum shared state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    service: Arc<TransferService>,
    app_handle: AppHandle,
    inbox_dir: PathBuf,
}

// ── Route handlers ────────────────────────────────────────────────────────────

async fn get_upload_page() -> impl IntoResponse {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(UPLOAD_PAGE))
        .unwrap()
}

async fn post_register(State(state): State<AppState>) -> Json<Value> {
    let info = &state.service.device_info;
    Json(serde_json::to_value(info).unwrap_or_else(|_| json!({})))
}

async fn post_prepare_upload(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PrepareUploadRequest>,
) -> Response {
    // Determine sender IP from X-Forwarded-For or connection header
    let sender_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let session_id = Uuid::new_v4().to_string();

    // Build IncomingFile list
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

    // Register session in Pending state
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

    // Create consent oneshot channel
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    state.service.consent_senders.insert(session_id.clone(), tx);

    // Emit event to frontend
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

    // Wait up to 60 seconds for user consent
    let accepted = tokio::time::timeout(std::time::Duration::from_secs(60), rx)
        .await
        .unwrap_or(Ok(false))  // timeout → false
        .unwrap_or(false);     // channel closed → false

    // Remove consent sender
    state.service.consent_senders.remove(&session_id);

    if !accepted {
        // Mark rejected
        if let Some(mut s) = state.service.sessions.get_mut(&session_id) {
            s.state = SessionState::Rejected;
        }
        return (StatusCode::FORBIDDEN, Json(json!({"message": "Declined"}))).into_response();
    }

    // Generate per-file tokens
    let mut token_map: HashMap<String, String> = HashMap::new();
    for file in &files {
        token_map.insert(file.id.clone(), Uuid::new_v4().to_string());
    }

    // Store tokens and update state
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

async fn post_upload(
    State(state): State<AppState>,
    Query(params): Query<UploadQuery>,
    req: axum::extract::Request,
) -> Response {
    let session_id = &params.session_id;
    let file_id = &params.file_id;
    let provided_token = &params.token;

    // Validate token
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

    // Get file metadata from session
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

    // Mark session InProgress
    if let Some(mut s) = state.service.sessions.get_mut(session_id) {
        s.state = SessionState::InProgress;
    }

    // Prepare destination path
    let dest_dir = state.inbox_dir.join(session_id);
    if let Err(e) = tokio::fs::create_dir_all(&dest_dir).await {
        log::error!("[Transfer] Failed to create inbox dir: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot create destination directory")
            .into_response();
    }
    let dest_path = dest_dir.join(&file_name);

    let mut file = match tokio::fs::File::create(&dest_path).await {
        Ok(f) => f,
        Err(e) => {
            log::error!("[Transfer] Failed to create file {:?}: {e}", dest_path);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot create file").into_response();
        }
    };

    // Stream request body to disk, emitting progress events
    use futures_util::StreamExt;

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

                // Update session bytes_received
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

    // Record received file and check if session is complete
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

    // Remove consumed token
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

async fn post_cancel(
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
    // If there's a pending consent sender, resolve it as rejected
    if let Some((_, tx)) = state.service.consent_senders.remove(session_id) {
        let _ = tx.send(false);
    }
    StatusCode::NO_CONTENT
}

// ── Server startup ────────────────────────────────────────────────────────────

/// Build and start the Axum HTTP server.  Tries ports 53317, 53318, 53319
/// before giving up.  Returns the bound port on success.
pub async fn start(
    service: Arc<TransferService>,
    app_handle: AppHandle,
    inbox_dir: PathBuf,
) -> Result<u16, String> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState {
        service: service.clone(),
        app_handle,
        inbox_dir,
    };

    let router = Router::new()
        .route("/", get(get_upload_page))
        .route("/api/localsend/v2/register", post(post_register))
        .route("/api/localsend/v2/prepare-upload", post(post_prepare_upload))
        .route("/api/localsend/v2/upload", post(post_upload))
        .route("/api/localsend/v2/cancel", post(post_cancel))
        .layer(cors)
        .with_state(state);

    // Try up to 3 ports
    let base_port = service.server_port;
    for attempt in 0u16..3 {
        let port = base_port + attempt;
        let addr = format!("0.0.0.0:{}", port);
        match TcpListener::bind(&addr).await {
            Ok(listener) => {
                log::info!("[Transfer] HTTP server listening on {}", addr);
                let svc_running = service.server_running.clone();
                tokio::spawn(async move {
                    axum::serve(listener, router)
                        .await
                        .unwrap_or_else(|e| log::error!("[Transfer] Server error: {e}"));
                    svc_running.store(false, std::sync::atomic::Ordering::Relaxed);
                });
                return Ok(port);
            }
            Err(e) => {
                log::warn!("[Transfer] Port {port} unavailable: {e}");
            }
        }
    }

    Err(format!(
        "Could not bind to ports {base_port}–{}",
        base_port + 2
    ))
}

/// Get the local LAN IP address by probing a UDP route to 8.8.8.8.
pub fn local_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Unix timestamp helper
pub fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
