use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::clymatte::{ClymatteReader, MattePrefetcher};
use crate::wgpu_compositor::NativePreviewSession;

use super::paths::resolve_matte_path;
use super::types::ClymatteStatus;

/// Check whether a valid, non-corrupted `.clymatte` file exists on disk for the clip.
#[tauri::command]
pub async fn clymatte_check_status(
    app: AppHandle,
    clip_id: String,
    clip_hash: Option<String>,
) -> Result<ClymatteStatus, String> {
    let path = resolve_matte_path(&app, &clip_id, clip_hash.as_deref())?;
    if !path.exists() {
        return Ok(ClymatteStatus {
            exists: false,
            path: None,
            frame_count: 0,
            width: 0,
            height: 0,
            fps_num: 0,
            fps_den: 0,
            file_size_bytes: 0,
        });
    }

    match ClymatteReader::open(&path) {
        Ok(reader) => {
            let file_size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok(ClymatteStatus {
                exists: true,
                path: Some(path.to_string_lossy().into_owned()),
                frame_count: reader.header.frame_count,
                width: reader.header.width,
                height: reader.header.height,
                fps_num: reader.header.fps_num,
                fps_den: reader.header.fps_den,
                file_size_bytes,
            })
        }
        Err(e) => {
            log::warn!(
                "Found invalid or outdated .clymatte file at {:?}: {e}",
                path
            );
            Ok(ClymatteStatus {
                exists: false,
                path: Some(path.to_string_lossy().into_owned()),
                frame_count: 0,
                width: 0,
                height: 0,
                fps_num: 0,
                fps_den: 0,
                file_size_bytes: 0,
            })
        }
    }
}

/// Register an existing `.clymatte` container into the active `NativePreviewSession`.
/// Enables sequential prefetching and $O(\log N)$ seeks without lock contention.
#[tauri::command]
pub async fn clymatte_register_active_matte(
    app: AppHandle,
    clip_id: String,
    file_path: Option<String>,
    clip_hash: Option<String>,
) -> Result<ClymatteStatus, String> {
    let path = if let Some(custom_path) = file_path {
        PathBuf::from(custom_path)
    } else {
        resolve_matte_path(&app, &clip_id, clip_hash.as_deref())?
    };

    if !path.exists() {
        return Err(format!("Matte file does not exist: {:?}", path));
    }

    let reader = Arc::new(
        ClymatteReader::open(&path).map_err(|e| format!("Failed to open .clymatte file: {e}"))?,
    );
    let status = ClymatteStatus {
        exists: true,
        path: Some(path.to_string_lossy().into_owned()),
        frame_count: reader.header.frame_count,
        width: reader.header.width,
        height: reader.header.height,
        fps_num: reader.header.fps_num,
        fps_den: reader.header.fps_den,
        file_size_bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    };

    let prefetcher = Arc::new(MattePrefetcher::new(reader));

    if let Some(session_state) = app.try_state::<Arc<Mutex<NativePreviewSession>>>() {
        let mut session = session_state.lock().await;
        session.register_matte_prefetcher(clip_id.clone(), Arc::clone(&prefetcher));
        log::info!(
            "[Clymatte] Registered prefetcher for clip '{}' ({} frames, {}x{})",
            clip_id,
            status.frame_count,
            status.width,
            status.height
        );
    }

    Ok(status)
}

/// Unregister an active matte prefetcher when the effect is toggled off or clip removed.
#[tauri::command]
pub async fn clymatte_unregister_active_matte(
    app: AppHandle,
    clip_id: String,
) -> Result<(), String> {
    if let Some(session_state) = app.try_state::<Arc<Mutex<NativePreviewSession>>>() {
        let mut session = session_state.lock().await;
        session.unregister_matte_prefetcher(&clip_id);
        log::info!(
            "[Clymatte] Unregistered matte prefetcher for clip '{}'",
            clip_id
        );
    }
    Ok(())
}
