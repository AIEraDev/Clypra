use sha2::{Digest, Sha256};
use std::io::Read;
use tauri::Manager;

pub const MIN_WHISPER_MODEL_BYTES: u64 = 10 * 1024 * 1024; // 10 MB minimum for any Whisper model

/// Verified official Hugging Face Git LFS SHA-256 checksums
pub const WHISPER_SHA256_TINY: &str =
    "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
pub const WHISPER_SHA256_BASE: &str =
    "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
pub const WHISPER_SHA256_SMALL: &str =
    "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
pub const WHISPER_SHA256_MEDIUM: &str =
    "0837f6a7d5cb0d1ab86b896fe3952d43e5c9a9d7099cbab744888be62d0ba921";
pub const WHISPER_SHA256_LARGE_V3: &str =
    "53a7b0368c04ec47eb389710f6ab1a5f6e81f1816f19472eec305a4ec581a967";

/// Returns expected SHA-256 checksum for a known model name.
pub fn expected_sha256_for_model(size_or_name: &str) -> Option<&'static str> {
    let clean = size_or_name
        .strip_prefix("ggml-")
        .unwrap_or(size_or_name)
        .strip_suffix(".bin")
        .unwrap_or(size_or_name)
        .trim();
    match clean {
        "tiny" => Some(WHISPER_SHA256_TINY),
        "base" => Some(WHISPER_SHA256_BASE),
        "small" => Some(WHISPER_SHA256_SMALL),
        "medium" => Some(WHISPER_SHA256_MEDIUM),
        "large-v3" | "large" => Some(WHISPER_SHA256_LARGE_V3),
        _ => None,
    }
}

/// Computes SHA-256 checksum of a file on disk.
pub fn compute_file_sha256(path: &std::path::Path) -> Result<String, std::io::Error> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024]; // 64 KB streaming buffer
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let hash = hasher.finalize();
    Ok(format!("{:x}", hash))
}

/// Verifies that a file matches an expected SHA-256 hex string.
pub fn verify_file_sha256(path: &std::path::Path, expected_hex: &str) -> bool {
    match compute_file_sha256(path) {
        Ok(actual_hex) => actual_hex.eq_ignore_ascii_case(expected_hex),
        Err(_) => false,
    }
}

/// Validates that a file on disk matches its expected SHA-256 checksum if known.
pub fn validate_model_checksum(
    path: &std::path::Path,
    model_size_or_name: &str,
) -> Result<(), String> {
    let Some(expected_hash) = expected_sha256_for_model(model_size_or_name) else {
        return Ok(());
    };

    let actual_hash = compute_file_sha256(path)
        .map_err(|e| format!("Failed to read file for checksum verification: {}", e))?;

    if !actual_hash.eq_ignore_ascii_case(expected_hash) {
        return Err(format!(
            "Checksum mismatch for model '{}': expected {}, got {}",
            model_size_or_name, expected_hash, actual_hash
        ));
    }

    Ok(())
}

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

    candidates.into_iter().find(|candidate| {
        is_valid_whisper_model_file(candidate)
            && validate_model_checksum(candidate, clean_name).is_ok()
    })
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
