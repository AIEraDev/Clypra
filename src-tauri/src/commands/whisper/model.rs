use tauri::Manager;

pub const MIN_WHISPER_MODEL_BYTES: u64 = 10 * 1024 * 1024; // 10 MB minimum for any Whisper model

/// Validates that a file on disk is an actual GGML Whisper model:
/// - File exists and is a regular file
/// - Size is at least 10MB (tiny is ~75MB; eliminates 68-byte mock files or aborted downloads)
/// - Not a PyTorch .pt file
/// - Header magic matches GGML format ("ggml", "ggmf", or "ggmv")
pub fn is_valid_whisper_model_file(path: &std::path::Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if ext.eq_ignore_ascii_case("pt") {
            return false;
        }
    }
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if metadata.len() < MIN_WHISPER_MODEL_BYTES {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    use std::io::Read;
    let mut header = [0u8; 4];
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    &header == b"ggml"
        || &header == b"ggmf"
        || &header == b"ggmv"
        || &header == b"lmgg"
        || &header == b"fmgg"
        || &header == b"vmgg"
}

/// Resolves the file path for a Whisper model on disk.
/// Checks absolute path, ggml-{size}.bin, or {size}.bin.
/// Strictly enforces that the target file is a validated GGML binary >= 10MB.
pub fn resolve_model_file_path(
    app_data_dir: &std::path::Path,
    model_size_or_path: &str,
) -> Option<std::path::PathBuf> {
    let direct_path = std::path::PathBuf::from(model_size_or_path);
    if is_valid_whisper_model_file(&direct_path) {
        return Some(direct_path);
    }

    let models_dir = app_data_dir.join("models").join("whisper");
    let clean_name = model_size_or_path
        .strip_prefix("ggml-")
        .unwrap_or(model_size_or_path)
        .strip_suffix(".bin")
        .unwrap_or(model_size_or_path)
        .strip_suffix(".pt")
        .unwrap_or(model_size_or_path);

    let candidates = [
        models_dir.join(format!("ggml-{}.bin", clean_name)),
        models_dir.join(format!("{}.bin", clean_name)),
    ];

    candidates
        .into_iter()
        .find(|candidate| is_valid_whisper_model_file(candidate))
}

/// Delete a downloaded Whisper model from app data directory
#[tauri::command]
pub async fn delete_whisper_model(app: tauri::AppHandle, size: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    if let Some(model_path) = resolve_model_file_path(&app_data_dir, &size) {
        tokio::fs::remove_file(&model_path)
            .await
            .map_err(|e| format!("Failed to delete model file: {}", e))?;
        log::debug!("🦀 [delete_whisper_model] Deleted model: {:?}", model_path);
    } else {
        log::debug!("🦀 [delete_whisper_model] Model not found for: {}", size);
    }

    Ok(())
}

/// List all downloaded and verified Whisper models from app data directory
#[tauri::command]
pub async fn list_downloaded_models(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = app_data_dir.join("models").join("whisper");

    if !models_dir.exists() {
        return Ok(vec![]);
    }

    let mut models = Vec::new();

    let mut entries = tokio::fs::read_dir(&models_dir)
        .await
        .map_err(|e| format!("Failed to read models directory: {}", e))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let path = entry.path();
        if is_valid_whisper_model_file(&path) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let clean_name = stem.strip_prefix("ggml-").unwrap_or(stem);
                if !models.contains(&clean_name.to_string()) {
                    models.push(clean_name.to_string());
                }
            }
        }
    }

    Ok(models)
}

/// Verify if a Whisper model is actually downloaded and validated on disk
#[tauri::command]
pub async fn verify_whisper_model_exists(
    app: tauri::AppHandle,
    size: String,
) -> Result<bool, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(resolve_model_file_path(&app_data_dir, &size).is_some())
}
