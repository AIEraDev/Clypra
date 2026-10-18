use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::model::is_valid_whisper_model_file;

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
pub type DownloadTasks = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// Get the download URL for a Whisper GGML model
/// URLs from: https://huggingface.co/ggerganov/whisper.cpp
pub(crate) fn get_model_url(size: &str) -> Result<String, String> {
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

/// Download a Whisper model directly from Hugging Face GGML CDN with progress tracking and cancellation support
#[tauri::command]
pub async fn download_whisper_model(app: tauri::AppHandle, size: String) -> Result<(), String> {
    log::debug!(
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

    log::debug!("🦀 [download_whisper_model] Downloading from: {}", url);
    log::debug!("🦀 [download_whisper_model] Saving to: {:?}", file_path);

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
    log::debug!(
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
                log::debug!("🦀 [download_whisper_model] Download cancelled");
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

                            log::debug!("🦀 [download] Progress: {}/{} MB ({:.1}%) @ {} MB/s",
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

    log::debug!(
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

/// Cancel an ongoing Whisper model download
#[tauri::command]
pub async fn cancel_whisper_download(app: tauri::AppHandle, size: String) -> Result<(), String> {
    let tasks: DownloadTasks = app.state::<DownloadTasks>().inner().clone();
    let tasks = tasks.lock().await;

    if let Some(token) = tasks.get(&size) {
        token.cancel();
        log::debug!(
            "🦀 [cancel_whisper_download] Cancelled download for: {}",
            size
        );
    } else {
        log::debug!(
            "🦀 [cancel_whisper_download] No active download found for: {}",
            size
        );
    }

    Ok(())
}

/// Initialize download tasks state
pub fn init_download_state() -> DownloadTasks {
    Arc::new(Mutex::new(HashMap::new()))
}
