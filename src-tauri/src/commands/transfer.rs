use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::transfer::server::{generate_qr_svg, list_network_interfaces, unix_secs, NetworkInterfaceInfo};
use crate::transfer::{DiscoveredDevice, StagedFile, TransferService, TransferSession};

// ── Helper ────────────────────────────────────────────────────────────────────

fn get_service(app: &AppHandle) -> Result<Arc<TransferService>, String> {
    app.try_state::<Arc<TransferService>>()
        .ok_or_else(|| "Transfer service not initialized".to_string())
        .map(|s| s.inner().clone())
}

fn local_ip() -> String {
    crate::transfer::server::local_ip()
}

fn guess_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/m4a",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns `{ running, port, localIp }`.
#[tauri::command]
pub async fn get_transfer_service_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let service = get_service(&app)?;
    Ok(serde_json::json!({
        "running":  service.is_running(),
        "port":     service.get_bound_port(),
        "localIp":  local_ip(),
    }))
}

/// Returns the list of network interfaces and IP addresses on this machine.
#[tauri::command]
pub async fn get_network_interfaces(_app: AppHandle) -> Result<Vec<NetworkInterfaceInfo>, String> {
    Ok(list_network_interfaces())
}

/// Returns the list of devices discovered via UDP multicast or active subnet scan.
#[tauri::command]
pub async fn get_discovered_devices(app: AppHandle) -> Result<Vec<DiscoveredDevice>, String> {
    let service = get_service(&app)?;
    Ok(service.discovered_devices.iter().map(|e| e.value().clone()).collect())
}

/// Triggers an active subnet scan to discover LocalSend nodes even if UDP multicast is blocked.
#[tauri::command]
pub async fn scan_local_network(app: AppHandle) -> Result<Vec<DiscoveredDevice>, String> {
    let service = get_service(&app)?;
    let ip = local_ip();
    if ip == "127.0.0.1" {
        return Ok(Vec::new());
    }

    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return Ok(Vec::new());
    }

    let subnet_prefix = format!("{}.{}.{}.", parts[0], parts[1], parts[2]);
    let bound_port = service.get_bound_port();
    let ports = if bound_port == 53317 {
        vec![53317, 53318]
    } else {
        vec![53317, bound_port]
    };

    let discovered = crate::transfer::discovery::scan_subnet(service.clone(), &subnet_prefix, &ports).await;
    Ok(discovered)
}

/// Returns a real standards-compliant SVG QR code string.
#[tauri::command]
pub async fn get_transfer_qr_code(app: AppHandle, custom_url: Option<String>) -> Result<String, String> {
    let service = get_service(&app)?;
    let url = match custom_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => {
            let ip = local_ip();
            let port = service.get_bound_port();
            format!("http://{}:{}", ip, port)
        }
    };
    generate_qr_svg(&url)
}

/// Stages files on desktop so that a phone can download them via the Web Hub.
#[tauri::command]
pub async fn stage_files_for_transfer(app: AppHandle, paths: Vec<String>) -> Result<Vec<StagedFile>, String> {
    let service = get_service(&app)?;
    let now = unix_secs();

    for path_str in paths {
        let path = Path::new(&path_str);
        if !path.exists() || !path.is_file() {
            continue;
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unnamed".to_string());

        let size = match tokio::fs::metadata(path).await {
            Ok(m) => m.len(),
            Err(_) => continue,
        };

        let mime_type = guess_mime(path).to_string();
        let id = Uuid::new_v4().to_string();

        let staged = StagedFile {
            id: id.clone(),
            file_name,
            file_path: path_str,
            size,
            mime_type,
            created_at: now,
        };

        service.staged_files.insert(id, staged);
    }

    get_staged_files(app).await
}

/// Removes a file from the staged transfer list.
#[tauri::command]
pub async fn unstage_file(app: AppHandle, file_id: String) -> Result<(), String> {
    let service = get_service(&app)?;
    service.staged_files.remove(&file_id);
    Ok(())
}

/// Clears all staged transfer files.
#[tauri::command]
pub async fn clear_staged_files(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    service.staged_files.clear();
    Ok(())
}

/// Returns the list of currently staged files.
#[tauri::command]
pub async fn get_staged_files(app: AppHandle) -> Result<Vec<StagedFile>, String> {
    let service = get_service(&app)?;
    let mut files: Vec<StagedFile> = service
        .staged_files
        .iter()
        .map(|e| e.value().clone())
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.created_at));
    Ok(files)
}

/// Outbound transfer: Sends files directly to a discovered peer using the LocalSend v2 protocol.
#[tauri::command]
pub async fn send_files_to_peer(
    app: AppHandle,
    peer_ip: String,
    peer_port: u16,
    file_paths: Vec<String>,
) -> Result<String, String> {
    let service = get_service(&app)?;

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrepareBody {
        info: serde_json::Value,
        files: HashMap<String, FileItem>,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FileItem {
        id: String,
        file_name: String,
        size: u64,
        file_type: String,
    }

    let mut valid_files = Vec::new();
    let mut files_map = HashMap::new();
    let mut total_bytes: u64 = 0;

    for (idx, p_str) in file_paths.iter().enumerate() {
        let p = Path::new(p_str);
        if !p.exists() {
            return Err(format!("File does not exist: {}", p_str));
        }
        let meta = tokio::fs::metadata(p)
            .await
            .map_err(|e| format!("Cannot read file metadata: {e}"))?;
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("file-{}", idx));
        let size = meta.len();
        let mime = guess_mime(p).to_string();
        let file_id = format!("file-{}", idx);

        total_bytes += size;
        valid_files.push((file_id.clone(), p_str.clone(), name.clone(), size, mime.clone()));
        files_map.insert(
            file_id.clone(),
            FileItem {
                id: file_id,
                file_name: name,
                size,
                file_type: mime,
            },
        );
    }

    if valid_files.is_empty() {
        return Err("No files selected for transfer".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let prep_url = format!("http://{}:{}/api/localsend/v2/prepare-upload", peer_ip, peer_port);
    let prep_body = PrepareBody {
        info: serde_json::to_value(&service.device_info).unwrap_or_default(),
        files: files_map,
    };

    let prep_res = client
        .post(&prep_url)
        .json(&prep_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to peer {peer_ip}:{peer_port}: {e}"))?;

    if prep_res.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("Transfer request was declined by the remote device".to_string());
    }
    if !prep_res.status().is_success() {
        return Err(format!("Peer returned error status: {}", prep_res.status()));
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrepareResponse {
        session_id: String,
        files: HashMap<String, String>,
    }

    let prep_data = prep_res
        .json::<PrepareResponse>()
        .await
        .map_err(|e| format!("Invalid response from peer: {e}"))?;

    let session_id = prep_data.session_id;
    let tokens = prep_data.files;
    let mut sent_total: u64 = 0;

    for (file_id, file_path_str, name, size, mime) in valid_files {
        let token = tokens
            .get(&file_id)
            .ok_or_else(|| format!("Missing token for file {name}"))?;

        let upload_url = format!(
            "http://{}:{}/api/localsend/v2/upload?sessionId={}&fileId={}&token={}",
            peer_ip,
            peer_port,
            session_id,
            file_id,
            token
        );

        let file = tokio::fs::File::open(&file_path_str)
            .await
            .map_err(|e| format!("Cannot open {name}: {e}"))?;
        let stream = tokio_util::io::ReaderStream::new(file);
        let body = reqwest::Body::wrap_stream(stream);

        let up_res = client
            .post(&upload_url)
            .header("Content-Type", mime)
            .header("Content-Length", size)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Failed to upload {name}: {e}"))?;

        if !up_res.status().is_success() {
            return Err(format!("Upload for {name} failed: {}", up_res.status()));
        }

        sent_total += size;
        let _ = app.emit(
            "clypra://transfer-outbound-progress",
            serde_json::json!({
                "sessionId": session_id,
                "fileId": file_id,
                "fileName": name,
                "bytesSent": sent_total,
                "totalBytes": total_bytes,
            }),
        );
    }

    let _ = app.emit(
        "clypra://transfer-outbound-complete",
        serde_json::json!({
            "sessionId": session_id,
            "success": true,
        }),
    );

    Ok(session_id)
}

/// Accepts a pending transfer session (resolves the user-consent oneshot).
#[tauri::command]
pub async fn accept_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;
    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(true);
        Ok(())
    } else {
        Err(format!("No pending consent for session {session_id}"))
    }
}

/// Rejects a pending transfer session.
#[tauri::command]
pub async fn reject_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;
    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(false);
        Ok(())
    } else {
        Err(format!("No pending consent for session {session_id}"))
    }
}

/// Marks a session as cancelled and cleans up tokens.
#[tauri::command]
pub async fn cancel_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;

    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(false);
    }

    if let Some(mut s) = service.sessions.get_mut(&session_id) {
        s.state = crate::transfer::SessionState::Cancelled;
    }

    Ok(())
}

/// Returns all known transfer sessions.
#[tauri::command]
pub async fn get_transfer_sessions(app: AppHandle) -> Result<Vec<TransferSession>, String> {
    let service = get_service(&app)?;
    Ok(service.sessions.iter().map(|e| e.value().clone()).collect())
}

/// Returns `"http://{localIp}:{port}"` — useful for manual display and copy.
#[tauri::command]
pub async fn get_transfer_server_url(app: AppHandle) -> Result<String, String> {
    let service = get_service(&app)?;
    let ip = local_ip();
    let port = service.get_bound_port();
    Ok(format!("http://{}:{}", ip, port))
}

/// Helper to determine the standard default transfer save directory on the user's system:
/// e.g. ~/Downloads/Clypra Transfers
pub fn get_default_transfer_dir(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(download_dir) = app.path().download_dir() {
        download_dir.join("Clypra Transfers")
    } else if let Ok(home) = app.path().home_dir() {
        home.join("Downloads").join("Clypra Transfers")
    } else {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("Clypra Transfers")
    }
}

/// Returns the current active directory where incoming files are saved.
#[tauri::command]
pub async fn get_transfer_save_directory(app: AppHandle) -> Result<String, String> {
    let service = get_service(&app)?;
    let dir = service.get_inbox_dir();
    if dir.as_os_str().is_empty() {
        let def = get_default_transfer_dir(&app);
        let _ = std::fs::create_dir_all(&def);
        service.set_inbox_dir(def.clone());
        Ok(def.to_string_lossy().to_string())
    } else {
        Ok(dir.to_string_lossy().to_string())
    }
}

/// Sets the directory where incoming files should be saved.
#[tauri::command]
pub async fn set_transfer_save_directory(app: AppHandle, path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| format!("Cannot create folder {:?}: {e}", p))?;
    let service = get_service(&app)?;
    service.set_inbox_dir(p.clone());
    Ok(p.to_string_lossy().to_string())
}

/// Opens the transfer save directory in the system file manager (Finder / Explorer).
#[tauri::command]
pub async fn open_transfer_save_directory(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    let dir = service.get_inbox_dir();
    let target_dir = if dir.as_os_str().is_empty() {
        get_default_transfer_dir(&app)
    } else {
        dir
    };
    let _ = std::fs::create_dir_all(&target_dir);

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&target_dir).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&target_dir).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&target_dir).spawn();
    }
    Ok(())
}

/// Opens a specific file with the system default application (e.g. Preview for images, player for videos).
#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    let path = crate::commands::media::normalize_file_path(&path);
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/C", "start", "", &path]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
    Ok(())
}

/// Reveals a file in the system file manager (Finder on macOS, File Explorer on Windows).
#[tauri::command]
pub async fn show_item_in_folder(path: String) -> Result<(), String> {
    let path = crate::commands::media::normalize_file_path(&path);
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").args(["-R", &path]).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(format!("/select,\"{}\"", path)).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = p.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
    Ok(())
}

/// Starts the transfer service if it is not already running.
#[tauri::command]
pub async fn start_transfer_service(app: AppHandle, custom_dir: Option<String>) -> Result<(), String> {
    let service = get_service(&app)?;
    let inbox_dir = match custom_dir {
        Some(d) if !d.trim().is_empty() => {
            let p = std::path::PathBuf::from(d);
            let _ = std::fs::create_dir_all(&p);
            p
        }
        _ => {
            let current = service.get_inbox_dir();
            if !current.as_os_str().is_empty() {
                current
            } else {
                let def = get_default_transfer_dir(&app);
                let _ = std::fs::create_dir_all(&def);
                def
            }
        }
    };

    if service.is_running() {
        service.set_inbox_dir(inbox_dir);
        return Ok(());
    }

    service.start(app.clone(), inbox_dir).await
}

/// Stops the transfer service.
#[tauri::command]
pub async fn stop_transfer_service(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    service
        .server_running
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Updates the transfer service theme colors for the mobile web page.
#[tauri::command]
pub async fn update_transfer_theme(
    app: AppHandle,
    theme: HashMap<String, String>,
) -> Result<(), String> {
    let service = get_service(&app)?;
    service.set_theme_colors(theme);
    Ok(())
}
