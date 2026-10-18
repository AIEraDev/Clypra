use crate::transfer::{server::unix_secs, StagedFile};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::helpers::{get_service, guess_mime};

/// Stages files on desktop so that a phone can download them via the Web Hub.
#[tauri::command]
pub async fn stage_files_for_transfer(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<StagedFile>, String> {
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
        valid_files.push((
            file_id.clone(),
            p_str.clone(),
            name.clone(),
            size,
            mime.clone(),
        ));
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

    let prep_url = format!(
        "http://{}:{}/api/localsend/v2/prepare-upload",
        peer_ip, peer_port
    );
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
            peer_ip, peer_port, session_id, file_id, token
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
