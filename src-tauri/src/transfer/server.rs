use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use super::device::DiscoveredDevice;
use super::session::{IncomingFile, SessionState, TransferSession};
use super::{StagedFile, TransferService};

// ── Static Web Hub page (Responsive Mobile Hub) ─────────────────────────────

const UPLOAD_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<title>Clypra Local Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: {{BG}};
    --card: {{CARD}};
    --card-inner: {{CARD_INNER}};
    --border: {{BORDER}};
    --accent: {{ACCENT}};
    --accent-hover: {{ACCENT_HOVER}};
    --text: {{TEXT}};
    --text-muted: {{TEXT_MUTED}};
    --success: {{SUCCESS}};
    --danger: {{DANGER}};
    --font-family: {{FONT_FAMILY}};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
  }
  .header {
    width: 100%;
    max-width: 480px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    margin-bottom: 16px;
  }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo-icon { font-size: 24px; }
  .header-title { font-size: 16px; font-weight: 700; color: var(--text); }
  .header-subtitle { font-size: 11px; color: var(--text-muted); }
  .badge {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
    padding: 4px 10px; border-radius: 20px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

  .nav-tabs {
    width: 100%;
    max-width: 480px;
    display: flex;
    background: var(--card-inner);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 4px;
    margin-bottom: 16px;
  }
  .tab-btn {
    flex: 1;
    padding: 10px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .tab-btn.active {
    background: var(--accent);
    color: #fff;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .main-card {
    width: 100%;
    max-width: 480px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  }

  .section-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .section-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 18px; }
  .download-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .download-item {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: var(--card-inner); border: 1px solid var(--border); border-radius: 12px;
    padding: 12px 14px;
  }
  .file-icon { font-size: 24px; flex-shrink: 0; }
  .file-info { flex: 1; min-width: 0; }
  .file-name { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .btn-download {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    background: var(--accent); color: #fff; text-decoration: none;
    font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px;
    white-space: nowrap; transition: background 0.2s;
  }
  .btn-download:hover { background: var(--accent-hover); }
  .empty-box {
    text-align: center; padding: 36px 16px;
    border: 1.5px dashed var(--border); border-radius: 12px;
    background: rgba(255,255,255,0.01);
  }
  .empty-icon { font-size: 36px; margin-bottom: 10px; opacity: 0.6; }
  .empty-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .empty-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; }

  .drop-zone {
    border: 2px dashed var(--border);
    border-radius: 14px;
    padding: 28px 16px;
    text-align: center;
    cursor: pointer;
    position: relative;
    margin-bottom: 16px;
    transition: all 0.2s;
  }
  .drop-zone:hover, .drop-zone.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .drop-zone input[type=file] {
    position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer;
  }
  .drop-icon { font-size: 32px; margin-bottom: 8px; }
  .drop-text { font-size: 14px; color: var(--text-muted); }
  .drop-text span { color: var(--accent); font-weight: 600; }
  .selected-files { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .selected-item {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--card-inner); border: 1px solid var(--border); border-radius: 10px;
    padding: 8px 12px; font-size: 13px;
  }
  .remove-btn {
    background: none; border: none; color: var(--text-muted);
    font-size: 16px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
  }
  .remove-btn:hover { color: var(--danger); }
  .btn-submit {
    width: 100%; padding: 14px;
    background: var(--accent); color: #fff;
    border: none; border-radius: 10px;
    font-size: 15px; font-weight: 700;
    cursor: pointer; transition: background 0.2s;
  }
  .btn-submit:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-submit:disabled { opacity: 0.45; cursor: not-allowed; }
  .progress-wrap {
    background: var(--card-inner); border-radius: 8px; height: 8px;
    margin-top: 14px; overflow: hidden; display: none;
  }
  .progress-bar { height: 100%; background: var(--accent); width: 0%; transition: width 0.2s; }
  .status-text {
    margin-top: 14px; font-size: 13px; text-align: center; min-height: 20px;
    color: var(--text-muted);
  }
  .status-text.error { color: var(--danger); font-weight: 600; }
  .status-text.success { color: var(--success); font-weight: 600; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo-icon">🎬</div>
    <div>
      <div class="header-title">Clypra Local Hub</div>
      <div class="header-subtitle" id="peerInfo">Direct WiFi Transfer</div>
    </div>
  </div>
  <div class="badge">
    <div class="dot"></div>
    <span id="badgeText">Connected</span>
  </div>
</div>

<div class="nav-tabs">
  <button class="tab-btn active" id="tabDownloadBtn">📥 Download from Laptop</button>
  <button class="tab-btn" id="tabUploadBtn">📤 Send to Laptop</button>
</div>

<div class="main-card">
  <!-- Download Pane -->
  <div id="downloadPane">
    <div class="section-title">Files from Clypra</div>
    <div class="section-desc">Tap download to save files directly to your phone.</div>
    <div id="downloadList" class="download-list"></div>
    <div id="emptyDownload" class="empty-box" style="display: none;">
      <div class="empty-icon">📂</div>
      <div class="empty-title">No files ready for download</div>
      <div class="empty-desc">On your laptop, drop files into Clypra's "Send to Phone" tab to make them available here.</div>
    </div>
    <div id="downloadTipNote" style="display:none; margin-top:14px; padding:10px 12px; background:rgba(90, 184, 212, 0.08); border:1px solid rgba(90, 184, 212, 0.25); border-radius:10px; font-size:11px; line-height:1.5; color:var(--text-muted);">
      <strong style="color:var(--accent); display:block; margin-bottom:3px;">💡 Android / Chrome Note:</strong>
      If prompted <em>"File can't be downloaded securely"</em>, tap <strong>Keep</strong>. This standard prompt appears on Chrome for direct offline WiFi transfers because local network addresses do not use external internet SSL certificates. You can also tap <strong>View 👁️</strong> to play videos or view photos directly in your browser.
    </div>
  </div>

  <!-- Upload Pane -->
  <div id="uploadPane" style="display: none;">
    <div class="section-title">Send to Clypra</div>
    <div class="section-desc">Transfer photos and 4K videos directly into Clypra editor.</div>
    <div class="drop-zone" id="dropZone">
      <input type="file" id="fileInput" multiple accept="video/*,image/*,audio/*,*/*"/>
      <div class="drop-icon">📱</div>
      <div class="drop-text">Tap to select photos & videos or <span>browse</span></div>
    </div>
    <div id="selectedFileList" class="selected-files"></div>
    <button id="sendBtn" class="btn-submit" disabled>Send to Clypra</button>
    <div class="progress-wrap" id="progressWrap">
      <div class="progress-bar" id="progressBar"></div>
    </div>
    <div class="status-text" id="statusText"></div>
  </div>
</div>

<script>
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  // Tab switching
  const tabDownloadBtn = document.getElementById('tabDownloadBtn');
  const tabUploadBtn = document.getElementById('tabUploadBtn');
  const downloadPane = document.getElementById('downloadPane');
  const uploadPane = document.getElementById('uploadPane');

  tabDownloadBtn.onclick = () => {
    tabDownloadBtn.classList.add('active');
    tabUploadBtn.classList.remove('active');
    downloadPane.style.display = 'block';
    uploadPane.style.display = 'none';
    loadStagedFiles();
  };

  tabUploadBtn.onclick = () => {
    tabUploadBtn.classList.add('active');
    tabDownloadBtn.classList.remove('active');
    downloadPane.style.display = 'none';
    uploadPane.style.display = 'block';
  };

  // Download logic
  const downloadList = document.getElementById('downloadList');
  const emptyDownload = document.getElementById('emptyDownload');
  const downloadTipNote = document.getElementById('downloadTipNote');

  async function loadStagedFiles() {
    try {
      const res = await fetch('/api/transfer/files');
      if (!res.ok) return;
      const files = await res.json();
      if (!Array.isArray(files) || files.length === 0) {
        downloadList.innerHTML = '';
        emptyDownload.style.display = 'block';
        if (downloadTipNote) downloadTipNote.style.display = 'none';
        return;
      }
      emptyDownload.style.display = 'none';
      if (downloadTipNote) downloadTipNote.style.display = 'block';
      downloadList.innerHTML = files.map(f => {
        const isVideo = f.mimeType && f.mimeType.startsWith('video/');
        const isImg = f.mimeType && f.mimeType.startsWith('image/');
        const icon = isVideo ? '🎬' : (isImg ? '🖼️' : '📄');
        return `
          <div class="download-item">
            <div class="file-icon">${icon}</div>
            <div class="file-info">
              <div class="file-name" title="${f.fileName}">${f.fileName}</div>
              <div class="file-meta">${fmtSize(f.size)}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              ${(isVideo || isImg) ? `
                <a href="/api/transfer/view/${encodeURIComponent(f.id)}" target="_blank" class="btn-download" style="background:var(--card-inner); border:1px solid var(--border); color:var(--text); text-decoration:none; padding:7px 10px;">
                  View 👁️
                </a>
              ` : ''}
              <a href="/api/transfer/download/${encodeURIComponent(f.id)}" download="${f.fileName}" class="btn-download" style="text-decoration:none; padding:7px 10px;">
                Save ⬇️
              </a>
            </div>
          </div>
        `;
      }).join('');
    } catch(e) {
      console.warn('Failed to load files:', e);
    }
  }

  loadStagedFiles();
  setInterval(loadStagedFiles, 3500);

  // Upload logic
  const fileInput = document.getElementById('fileInput');
  const selectedFileList = document.getElementById('selectedFileList');
  const sendBtn = document.getElementById('sendBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('statusText');
  const dropZone = document.getElementById('dropZone');

  let selectedFiles = [];

  function renderSelectedFiles() {
    selectedFileList.innerHTML = '';
    selectedFiles.forEach((f, idx) => {
      const div = document.createElement('div');
      div.className = 'selected-item';
      div.innerHTML = `
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${f.name} (${fmtSize(f.size)})</span>
        <button class="remove-btn" data-idx="${idx}">&times;</button>
      `;
      selectedFileList.appendChild(div);
    });

    selectedFileList.querySelectorAll('.remove-btn').forEach(b => {
      b.onclick = (e) => {
        const i = parseInt(e.target.dataset.idx);
        selectedFiles.splice(i, 1);
        renderSelectedFiles();
      };
    });

    sendBtn.disabled = selectedFiles.length === 0;
  }

  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files);
    renderSelectedFiles();
  });

  ['dragover', 'dragenter'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); dropZone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
  }));
  dropZone.addEventListener('drop', e => {
    selectedFiles = Array.from(e.dataTransfer.files);
    renderSelectedFiles();
  });

  sendBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) return;
    sendBtn.disabled = true;
    statusText.className = 'status-text';
    statusText.textContent = 'Asking Clypra on your laptop for permission…';
    progressWrap.style.display = 'none';
    progressBar.style.width = '0%';

    const filesPayload = {};
    selectedFiles.forEach((f, i) => {
      filesPayload['file-' + i] = {
        id: 'file-' + i,
        fileName: f.name,
        size: f.size,
        fileType: f.type || 'application/octet-stream'
      };
    });

    let prepResp;
    try {
      prepResp = await fetch('/api/localsend/v2/prepare-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          info: { alias: 'Mobile Phone', deviceType: 'mobile', fingerprint: 'mobile-web' },
          files: filesPayload
        })
      });
    } catch(e) {
      statusText.className = 'status-text error';
      statusText.textContent = 'Connection error: ' + e.message;
      sendBtn.disabled = false;
      return;
    }

    if (prepResp.status === 403) {
      statusText.className = 'status-text error';
      statusText.textContent = 'Transfer was declined on laptop.';
      sendBtn.disabled = false;
      return;
    }
    if (!prepResp.ok) {
      statusText.className = 'status-text error';
      statusText.textContent = 'Server returned error ' + prepResp.status;
      sendBtn.disabled = false;
      return;
    }

    const { sessionId, files: tokens } = await prepResp.json();
    progressWrap.style.display = 'block';

    let totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
    let uploadedBytes = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles[i];
      const fileId = 'file-' + i;
      const token = tokens[fileId];
      statusText.textContent = `Uploading ${f.name}… (${i + 1}/${selectedFiles.length})`;

      try {
        const upResp = await fetch(`/api/localsend/v2/upload?sessionId=${sessionId}&fileId=${fileId}&token=${encodeURIComponent(token)}`, {
          method: 'POST',
          body: f,
          headers: {
            'Content-Type': f.type || 'application/octet-stream',
            'Content-Length': f.size
          }
        });
        if (!upResp.ok) throw new Error('Upload error: ' + upResp.status);
      } catch(e) {
        statusText.className = 'status-text error';
        statusText.textContent = 'Failed: ' + e.message;
        sendBtn.disabled = false;
        return;
      }

      uploadedBytes += f.size;
      const pct = Math.round((uploadedBytes / totalBytes) * 100);
      progressBar.style.width = pct + '%';
    }

    statusText.className = 'status-text success';
    statusText.textContent = '✅ All files transferred to Clypra successfully!';
    selectedFiles = [];
    renderSelectedFiles();
  });

  // Dynamic Theme Synchronization with Clypra Editor
  async function syncTheme() {
    try {
      const res = await fetch('/api/transfer/theme');
      if (!res.ok) return;
      const theme = await res.json();
      const r = document.documentElement.style;
      if (theme.bg) r.setProperty('--bg', theme.bg);
      if (theme.card) r.setProperty('--card', theme.card);
      if (theme.cardInner) r.setProperty('--card-inner', theme.cardInner);
      if (theme.border) r.setProperty('--border', theme.border);
      if (theme.accent) r.setProperty('--accent', theme.accent);
      if (theme.accentHover) r.setProperty('--accent-hover', theme.accentHover);
      if (theme.text) r.setProperty('--text', theme.text);
      if (theme.textMuted) r.setProperty('--text-muted', theme.textMuted);
      if (theme.success) r.setProperty('--success', theme.success);
      if (theme.danger) r.setProperty('--danger', theme.danger);
      if (theme.fontFamily) {
        r.setProperty('--font-family', theme.fontFamily);
        document.body.style.fontFamily = theme.fontFamily;
      }
    } catch(e) {}
  }
  syncTheme();
  setInterval(syncTheme, 3000);
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
#[allow(dead_code)]
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
}

// ── Route handlers ────────────────────────────────────────────────────────────

fn render_upload_page(theme: &HashMap<String, String>) -> String {
    let get_val = |k: &str, default: &str| -> String {
        theme.get(k).cloned().unwrap_or_else(|| default.to_string())
    };

    UPLOAD_PAGE
        .replace("{{BG}}", &get_val("bg", "#0d0d11"))
        .replace("{{CARD}}", &get_val("card", "#181820"))
        .replace("{{CARD_INNER}}", &get_val("cardInner", "#121217"))
        .replace("{{BORDER}}", &get_val("border", "#2c2c38"))
        .replace("{{ACCENT}}", &get_val("accent", "#7c5cbf"))
        .replace("{{ACCENT_HOVER}}", &get_val("accentHover", "#9470d8"))
        .replace("{{TEXT}}", &get_val("text", "#f0f0f5"))
        .replace("{{TEXT_MUTED}}", &get_val("textMuted", "#8e8e9e"))
        .replace("{{SUCCESS}}", &get_val("success", "#34d399"))
        .replace("{{DANGER}}", &get_val("danger", "#f87171"))
        .replace(
            "{{FONT_FAMILY}}",
            &get_val(
                "fontFamily",
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            ),
        )
}

async fn get_upload_page(State(state): State<AppState>) -> impl IntoResponse {
    let theme = state.service.get_theme_colors();
    let html = render_upload_page(&theme);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(html))
        .unwrap()
}

/// Returns current editor theme colors as JSON for client-side live theme sync.
async fn get_theme(State(state): State<AppState>) -> Json<HashMap<String, String>> {
    Json(state.service.get_theme_colors())
}

/// LocalSend v2 standard device info endpoint (scanned by peers during subnet scan).
async fn get_localsend_info(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::to_value(&state.service.device_info).unwrap_or_else(|_| json!({})))
}

/// LocalSend v2 peer registration endpoint.
async fn post_register(
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
                let device_type = val.get("deviceType").and_then(|v| v.as_str()).map(|s| s.to_string());

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
async fn get_staged_files(State(state): State<AppState>) -> Json<Vec<StagedFile>> {
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
async fn download_staged_file(
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

    let filename_header = format!("attachment; filename=\"{}\"", file.file_name.replace('"', ""));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, filename_header)
        .header(header::CONTENT_LENGTH, file.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Response construction failed").into_response())
}

/// Streams a staged file to the mobile device for inline viewing / playing in browser without download prompt.
async fn view_staged_file(
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

    let filename_header = format!("inline; filename=\"{}\"", file.file_name.replace('"', ""));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, filename_header)
        .header(header::CONTENT_LENGTH, file.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Response construction failed").into_response())
}

async fn post_prepare_upload(
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

async fn post_upload(
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
        log::error!("[Transfer] Failed to create destination dir {:?}: {e}", dest_dir);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot create destination directory")
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
    if let Some((_, tx)) = state.service.consent_senders.remove(session_id) {
        let _ = tx.send(false);
    }
    StatusCode::NO_CONTENT
}

// ── Server startup ────────────────────────────────────────────────────────────

/// Build and start the Axum HTTP server. Tries ports 53317, 53318, 53319
/// before giving up. Returns the bound port on success.
pub async fn start(
    service: Arc<TransferService>,
    app_handle: AppHandle,
) -> Result<u16, String> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState {
        service: service.clone(),
        app_handle,
    };

    let router = Router::new()
        .route("/", get(get_upload_page))
        // Dynamic theme endpoint for mobile hub
        .route("/api/transfer/theme", get(get_theme))
        // LocalSend v2 endpoints
        .route("/api/localsend/v2/info", get(get_localsend_info))
        .route("/api/localsend/v2/register", post(post_register))
        .route("/api/localsend/v2/prepare-upload", post(post_prepare_upload))
        .route("/api/localsend/v2/upload", post(post_upload))
        .route("/api/localsend/v2/cancel", post(post_cancel))
        // Web Hub file download endpoints (Laptop -> Phone)
        .route("/api/transfer/files", get(get_staged_files))
        .route("/api/transfer/download/:file_id", get(download_staged_file))
        .route("/api/transfer/view/:file_id", get(view_staged_file))
        .layer(cors)
        .with_state(state);

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

// ── Multi-interface IP Discovery ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip: String,
    pub is_default: bool,
}

/// Enumerate all active IPv4 network interfaces on the system.
pub fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    let mut results = Vec::new();

    #[cfg(unix)]
    unsafe {
        let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut ifap) == 0 && !ifap.is_null() {
            let mut cur = ifap;
            while !cur.is_null() {
                let ifa = *cur;
                let flags = ifa.ifa_flags as i32;
                let is_up = (flags & libc::IFF_UP) != 0;
                let is_loopback = (flags & libc::IFF_LOOPBACK) != 0;
                let is_running = (flags & libc::IFF_RUNNING) != 0;

                if is_up && is_running && !is_loopback && !ifa.ifa_addr.is_null() {
                    let family = (*ifa.ifa_addr).sa_family as i32;
                    if family == libc::AF_INET {
                        let name = std::ffi::CStr::from_ptr(ifa.ifa_name)
                            .to_string_lossy()
                            .into_owned();
                        let sockaddr_in = ifa.ifa_addr as *const libc::sockaddr_in;
                        let ip_num = u32::from_be((*sockaddr_in).sin_addr.s_addr);
                        let ip = std::net::Ipv4Addr::from(ip_num);

                        if !ip.is_loopback() && !ip.is_link_local() {
                            let ip_str = ip.to_string();
                            if !results.iter().any(|r: &NetworkInterfaceInfo| r.name == name && r.ip == ip_str) {
                                results.push(NetworkInterfaceInfo {
                                    name,
                                    ip: ip_str,
                                    is_default: false,
                                });
                            }
                        }
                    }
                }
                cur = ifa.ifa_next;
            }
            libc::freeifaddrs(ifap);
        }
    }

    if results.is_empty() {
        let targets = [
            "8.8.8.8:80",
            "1.1.1.1:80",
            "192.168.1.1:80",
            "192.168.0.1:80",
            "10.0.0.1:80",
            "172.20.10.1:80",
            "192.168.43.1:80",
        ];
        for target in targets {
            if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
                if socket.connect(target).is_ok() {
                    if let Ok(local_addr) = socket.local_addr() {
                        let ip = local_addr.ip().to_string();
                        if ip != "127.0.0.1" && !ip.starts_with("169.254.") {
                            results.push(NetworkInterfaceInfo {
                                name: "lan".to_string(),
                                ip,
                                is_default: true,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    let best_ip = select_best_lan_ip(&results);
    for item in &mut results {
        if item.ip == best_ip {
            item.is_default = true;
        }
    }

    results
}

fn select_best_lan_ip(interfaces: &[NetworkInterfaceInfo]) -> String {
    // 1. Prefer en0 (standard macOS WiFi/Ethernet) or wlan
    for iface in interfaces {
        if iface.name == "en0" || iface.name.starts_with("wlan") {
            return iface.ip.clone();
        }
    }
    // 2. Prefer 192.168.x.x
    for iface in interfaces {
        if iface.ip.starts_with("192.168.") {
            return iface.ip.clone();
        }
    }
    // 3. Prefer 10.x.x.x or 172.16..31.x.x (including hotspot 172.20.10.x)
    for iface in interfaces {
        if iface.ip.starts_with("10.") || iface.ip.starts_with("172.") {
            return iface.ip.clone();
        }
    }
    if let Some(first) = interfaces.first() {
        return first.ip.clone();
    }

    "127.0.0.1".to_string()
}

/// Returns the primary LAN IP address.
pub fn local_ip() -> String {
    let ifaces = list_network_interfaces();
    if let Some(def) = ifaces.iter().find(|i| i.is_default) {
        return def.ip.clone();
    }
    select_best_lan_ip(&ifaces)
}

/// Generates a real, standards-compliant QR Code as an SVG string.
pub fn generate_qr_svg(content: &str) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(content.as_bytes()).map_err(|e| e.to_string())?;
    let svg = code
        .render::<svg::Color>()
        .min_dimensions(240, 240)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(svg)
}

/// Generates a non-colliding file path inside `dir` for `file_name` by appending `(1)`, `(2)`, etc.
pub fn get_non_colliding_path(dir: &std::path::Path, file_name: &str) -> PathBuf {
    let base_path = dir.join(file_name);
    if !base_path.exists() {
        return base_path;
    }

    let p = std::path::Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");

    for i in 1..10000 {
        let candidate = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let candidate_path = dir.join(&candidate);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }
    base_path
}

/// Unix timestamp helper
pub fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_ip_detection() {
        let ip = local_ip();
        assert!(!ip.is_empty());
        let parsed: Result<std::net::Ipv4Addr, _> = ip.parse();
        assert!(parsed.is_ok(), "Expected valid IPv4, got: {}", ip);
    }

    #[test]
    fn test_list_network_interfaces() {
        let ifaces = list_network_interfaces();
        for iface in &ifaces {
            assert!(!iface.ip.is_empty());
            assert!(!iface.name.is_empty());
        }
    }

    #[test]
    fn test_generate_qr_svg() {
        let test_url = "http://192.168.1.50:53317";
        let svg = generate_qr_svg(test_url).expect("QR generation should succeed");
        assert!(svg.contains("<svg"));
        assert!(svg.contains("xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn test_get_non_colliding_path() {
        let tmp = std::env::temp_dir();
        let path1 = get_non_colliding_path(&tmp, "non_existing_test_file_clypra.mp4");
        assert_eq!(path1, tmp.join("non_existing_test_file_clypra.mp4"));
    }
}
