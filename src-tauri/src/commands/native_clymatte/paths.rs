use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) fn resolve_matte_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get app cache dir: {e}"))?;
    let matte_dir = cache_dir.join("mattes");
    if !matte_dir.exists() {
        std::fs::create_dir_all(&matte_dir)
            .map_err(|e| format!("Failed to create mattes cache dir: {e}"))?;
    }
    Ok(matte_dir)
}

pub(crate) fn resolve_matte_path(
    app: &AppHandle,
    clip_id: &str,
    clip_hash: Option<&str>,
) -> Result<PathBuf, String> {
    let dir = resolve_matte_dir(app)?;
    let file_name = if let Some(hash) = clip_hash {
        if !hash.trim().is_empty() {
            format!("{hash}.clymatte")
        } else {
            format!("{clip_id}.clymatte")
        }
    } else {
        format!("{clip_id}.clymatte")
    };
    Ok(dir.join(file_name))
}

pub(crate) fn parse_hash_32(hex_or_str: Option<&str>) -> [u8; 32] {
    let mut out = [0u8; 32];
    if let Some(s) = hex_or_str {
        let bytes = s.as_bytes();
        let len = bytes.len().min(32);
        out[..len].copy_from_slice(&bytes[..len]);
    }
    out
}
