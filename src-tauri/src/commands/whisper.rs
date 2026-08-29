use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    pub size: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "speedBytesPerSec")]
    pub speed_bytes_per_sec: u64,
}

/// Active download tasks with cancellation tokens
type DownloadTasks = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// Get the download URL for a Whisper GGML model
/// URLs from: https://huggingface.co/ggerganov/whisper.cpp
fn get_model_url(size: &str) -> Result<String, String> {
    let clean_size = size
        .strip_prefix("ggml-")
        .unwrap_or(size)
        .strip_suffix(".bin")
        .unwrap_or(size);
    let url = match clean_size {
        "tiny" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "base" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "small" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "medium" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        "large-v3" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        _ => return Err(format!("Unknown model size: {}", size)),
    };
    Ok(url.to_string())
}

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

/// Download a Whisper model directly from Hugging Face GGML CDN with progress tracking and cancellation support
#[tauri::command]
pub async fn download_whisper_model(app: tauri::AppHandle, size: String) -> Result<(), String> {
    eprintln!(
        "🦀 [download_whisper_model] Starting download for model: {}",
        size
    );

    // Get model URL
    let url = get_model_url(&size)?;

    // Get app data directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = app_data_dir.join("models").join("whisper");

    // Create models directory if it doesn't exist
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let clean_size = size
        .strip_prefix("ggml-")
        .unwrap_or(&size)
        .strip_suffix(".bin")
        .unwrap_or(&size);
    let file_path = models_dir.join(format!("ggml-{}.bin", clean_size));

    eprintln!("🦀 [download_whisper_model] Downloading from: {}", url);
    eprintln!("🦀 [download_whisper_model] Saving to: {:?}", file_path);

    // Create cancellation token
    let cancel_token = CancellationToken::new();

    // Store the token in the app state
    let tasks: DownloadTasks = app.state::<DownloadTasks>().inner().clone();
    {
        let mut tasks = tasks.lock().await;
        tasks.insert(size.clone(), cancel_token.clone());
    }

    // Start the download
    let result = perform_download(
        app.clone(),
        size.clone(),
        url,
        file_path,
        cancel_token.clone(),
    )
    .await;

    // Remove the token from state
    {
        let mut tasks = tasks.lock().await;
        tasks.remove(&size);
    }

    result
}

async fn perform_download(
    app: tauri::AppHandle,
    size: String,
    url: String,
    file_path: std::path::PathBuf,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    // Emit initial progress event
    let _ = app.emit(
        "whisper_model_progress",
        DownloadProgressPayload {
            size: size.clone(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
        },
    );

    // Start HTTP request
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    eprintln!(
        "🦀 [download_whisper_model] Total size: {} MB",
        total_size / 1_048_576
    );

    let part_path = file_path.with_extension("bin.part");
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("Failed to create temporary download file: {}", e))?;

    let mut downloaded = 0u64;
    let mut last_update = std::time::Instant::now();
    let mut last_downloaded = 0u64;

    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                eprintln!("🦀 [download_whisper_model] Download cancelled");
                // Clean up partial file
                let _ = tokio::fs::remove_file(&part_path).await;
                return Err("Download cancelled".to_string());
            }

            // Process next chunk
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        // Write chunk to file
                        file.write_all(&chunk)
                            .await
                            .map_err(|e| format!("Failed to write to file: {}", e))?;

                        downloaded += chunk.len() as u64;

                        // Emit progress every 500ms
                        let now = std::time::Instant::now();
                        if now.duration_since(last_update).as_millis() >= 500 {
                            let elapsed_secs = now.duration_since(last_update).as_secs_f64();
                            let bytes_since_last = downloaded - last_downloaded;
                            let speed = (bytes_since_last as f64 / elapsed_secs) as u64;

                            eprintln!("🦀 [download] Progress: {}/{} MB ({:.1}%) @ {} MB/s",
                                downloaded / 1_048_576,
                                total_size / 1_048_576,
                                (downloaded as f64 / total_size as f64) * 100.0,
                                speed / 1_048_576
                            );

                            let _ = app.emit(
                                "whisper_model_progress",
                                DownloadProgressPayload {
                                    size: size.clone(),
                                    downloaded_bytes: downloaded,
                                    total_bytes: total_size,
                                    speed_bytes_per_sec: speed,
                                },
                            );

                            last_update = now;
                            last_downloaded = downloaded;
                        }
                    }
                    Some(Err(e)) => {
                        // Clean up partial file
                        let _ = tokio::fs::remove_file(&part_path).await;
                        return Err(format!("Download error: {}", e));
                    }
                    None => {
                        // Download complete
                        break;
                    }
                }
            }
        }
    }

    // Flush file and drop handle before validation and renaming
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);

    // Validate completed file format and size
    if !is_valid_whisper_model_file(&part_path) {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(
            "Downloaded file failed GGML model validation (corrupt or incomplete)".to_string(),
        );
    }

    tokio::fs::rename(&part_path, &file_path)
        .await
        .map_err(|e| format!("Failed to finalize model file: {}", e))?;

    eprintln!(
        "🦀 [download_whisper_model] Download completed and verified: {} MB",
        downloaded / 1_048_576
    );

    // Emit final progress event
    let _ = app.emit(
        "whisper_model_progress",
        DownloadProgressPayload {
            size: size.clone(),
            downloaded_bytes: downloaded,
            total_bytes: total_size,
            speed_bytes_per_sec: 0,
        },
    );

    Ok(())
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
        eprintln!("🦀 [delete_whisper_model] Deleted model: {:?}", model_path);
    } else {
        eprintln!("🦀 [delete_whisper_model] Model not found for: {}", size);
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

/// Cancel an ongoing Whisper model download
#[tauri::command]
pub async fn cancel_whisper_download(app: tauri::AppHandle, size: String) -> Result<(), String> {
    let tasks: DownloadTasks = app.state::<DownloadTasks>().inner().clone();
    let tasks = tasks.lock().await;

    if let Some(token) = tasks.get(&size) {
        token.cancel();
        eprintln!(
            "🦀 [cancel_whisper_download] Cancelled download for: {}",
            size
        );
    } else {
        eprintln!(
            "🦀 [cancel_whisper_download] No active download found for: {}",
            size
        );
    }

    Ok(())
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

/// Initialize download tasks state
pub fn init_download_state() -> DownloadTasks {
    Arc::new(Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_is_valid_whisper_model_rejects_missing_and_tiny_files() {
        let temp_dir = std::env::temp_dir().join("clypra_test_whisper");
        let _ = std::fs::create_dir_all(&temp_dir);

        // 1. Missing file
        let missing = temp_dir.join("nonexistent.bin");
        assert!(!is_valid_whisper_model_file(&missing));

        // 2. 68-byte mock file (reproducing the exact mock found on disk)
        let mock_file = temp_dir.join("mock.bin");
        std::fs::write(
            &mock_file,
            b"Downloaded at: SystemTime { tv_sec: 1781398073 }",
        )
        .unwrap();
        assert!(!is_valid_whisper_model_file(&mock_file));

        // 3. PyTorch file (.pt) rejected even if large
        let pt_file = temp_dir.join("test.pt");
        let mut pt_handle = std::fs::File::create(&pt_file).unwrap();
        pt_handle.write_all(b"PK\x03\x04").unwrap();
        pt_handle.set_len(15 * 1024 * 1024).unwrap();
        drop(pt_handle);
        assert!(!is_valid_whisper_model_file(&pt_file));

        // 4. Large file (15MB) with WRONG magic header
        let wrong_magic = temp_dir.join("wrong_magic.bin");
        let mut wm_handle = std::fs::File::create(&wrong_magic).unwrap();
        wm_handle.write_all(b"RAND").unwrap();
        wm_handle.set_len(15 * 1024 * 1024).unwrap();
        drop(wm_handle);
        assert!(!is_valid_whisper_model_file(&wrong_magic));

        // 5. Large file (15MB) with VALID "ggml" magic header
        let valid_ggml = temp_dir.join("valid_model.bin");
        let mut valid_handle = std::fs::File::create(&valid_ggml).unwrap();
        valid_handle.write_all(b"ggml").unwrap();
        valid_handle.set_len(15 * 1024 * 1024).unwrap();
        drop(valid_handle);
        assert!(is_valid_whisper_model_file(&valid_ggml));

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_model_file_path_rejects_corrupted_candidates() {
        let temp_dir = std::env::temp_dir().join("clypra_test_whisper_resolve");
        let models_dir = temp_dir.join("models").join("whisper");
        let _ = std::fs::create_dir_all(&models_dir);

        // Put a 68-byte mock file at tiny.bin
        let corrupt_path = models_dir.join("tiny.bin");
        std::fs::write(&corrupt_path, b"Downloaded at: mock").unwrap();

        // Put a .pt file at tiny.pt
        let pt_path = models_dir.join("tiny.pt");
        std::fs::write(&pt_path, b"pytorch").unwrap();

        // resolve_model_file_path must NOT return the corrupt or .pt candidate!
        assert_eq!(resolve_model_file_path(&temp_dir, "tiny"), None);

        // Now place a valid ggml file at ggml-tiny.bin
        let valid_path = models_dir.join("ggml-tiny.bin");
        let mut file = std::fs::File::create(&valid_path).unwrap();
        file.write_all(b"ggml").unwrap();
        file.set_len(15 * 1024 * 1024).unwrap();
        drop(file);

        // Must now find the valid model!
        assert_eq!(resolve_model_file_path(&temp_dir, "tiny"), Some(valid_path));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
