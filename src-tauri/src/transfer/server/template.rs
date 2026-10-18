use std::collections::HashMap;

// ── Static Web Hub page (Responsive Mobile Hub) ─────────────────────────────

pub const UPLOAD_PAGE: &str = r#"<!DOCTYPE html>
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


pub fn render_upload_page(theme: &HashMap<String, String>) -> String {
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

