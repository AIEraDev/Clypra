use crate::transfer::{TransferService};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub(super) fn get_service(app: &AppHandle) -> Result<Arc<TransferService>, String> {
    app.try_state::<Arc<TransferService>>()
        .ok_or_else(|| "Transfer service not initialized".to_string())
        .map(|s| s.inner().clone())
}

pub(super) fn local_ip() -> String {
    crate::transfer::server::local_ip()
}

pub(super) fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
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
