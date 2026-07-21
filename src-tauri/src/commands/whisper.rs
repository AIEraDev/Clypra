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

struct DownloadTask {
    cancel: CancellationToken,
    finished: CancellationToken,
}

/// Active download tasks with cancellation and completion signals
type DownloadTasks = Arc<Mutex<HashMap<String, Arc<DownloadTask>>>>;

async fn register_download_task(
    tasks: &DownloadTasks,
    size: &str,
) -> Result<Arc<DownloadTask>, String> {
    let mut tasks = tasks.lock().await;

    match tasks.entry(size.to_string()) {
        std::collections::hash_map::Entry::Occupied(_) => {
            Err(format!("Download already active for model: {}", size))
        }
        std::collections::hash_map::Entry::Vacant(entry) => {
            let active = Arc::new(DownloadTask {
                cancel: CancellationToken::new(),
                finished: CancellationToken::new(),
            });
            entry.insert(active.clone());
            Ok(active)
        }
    }
}

async fn finish_download_task(tasks: &DownloadTasks, size: &str, active: &Arc<DownloadTask>) {
    {
        let mut tasks = tasks.lock().await;
        let is_current = tasks
            .get(size)
            .is_some_and(|current| Arc::ptr_eq(current, active));

        if is_current {
            tasks.remove(size);
        }
    }

    active.finished.cancel();
}

async fn cancel_download_task(tasks: &DownloadTasks, size: &str) -> Result<(), String> {
    let active = {
        let tasks = tasks.lock().await;
        tasks.get(size).cloned()
    }
    .ok_or_else(|| format!("No active download found for: {}", size))?;

    active.cancel.cancel();
    active.finished.cancelled().await;
    Ok(())
}

/// Get the download URL for a Whisper model
/// URLs from: https://github.com/openai/whisper/blob/main/whisper/__init__.py
fn get_model_url(size: &str) -> Result<String, String> {
    let url = match size {
        "tiny" => "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
        "base" => "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
        "small" => "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
        "medium" => "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
        "large-v3" => "https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt",
        _ => return Err(format!("Unknown model size: {}", size)),
    };
    Ok(url.to_string())
}

/// Download a Whisper model directly from OpenAI CDN with progress tracking and cancellation support
#[tauri::command]
pub async fn download_whisper_model(
    app: tauri::AppHandle,
    size: String,
) -> Result<(), String> {
    eprintln!("🦀 [download_whisper_model] Starting download for model: {}", size);
    
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

    let file_path = models_dir.join(format!("{}.pt", size));
    
    eprintln!("🦀 [download_whisper_model] Downloading from: {}", url);
    eprintln!("🦀 [download_whisper_model] Saving to: {:?}", file_path);
    
    // Register the active download before starting network work
    let tasks: DownloadTasks = app.state::<DownloadTasks>().inner().clone();
    let active = register_download_task(&tasks, &size).await?;
    
    // Start the download
    let result = perform_download(
        app.clone(),
        size.clone(),
        url,
        file_path,
        active.cancel.clone(),
    ).await;

    finish_download_task(&tasks, &size, &active).await;
    
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
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    eprintln!("🦀 [download_whisper_model] Total size: {} MB", total_size / 1_048_576);
    
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    let mut downloaded = 0u64;
    let mut last_update = std::time::Instant::now();
    let mut last_downloaded = 0u64;
    
    loop {
        tokio::select! {
            // Check for cancellation
            _ = cancel_token.cancelled() => {
                eprintln!("🦀 [download_whisper_model] Download cancelled");
                // Clean up partial file
                let _ = tokio::fs::remove_file(&file_path).await;
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
                        let _ = tokio::fs::remove_file(&file_path).await;
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
    
    // Flush file
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;
    
    eprintln!("🦀 [download_whisper_model] Download completed: {} MB", downloaded / 1_048_576);
    
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
pub async fn delete_whisper_model(
    app: tauri::AppHandle,
    size: String,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let model_path = app_data_dir
        .join("models")
        .join("whisper")
        .join(format!("{}.pt", size));

    if model_path.exists() {
        tokio::fs::remove_file(&model_path)
            .await
            .map_err(|e| format!("Failed to delete model file: {}", e))?;
        eprintln!("🦀 [delete_whisper_model] Deleted model: {:?}", model_path);
    } else {
        eprintln!("🦀 [delete_whisper_model] Model not found: {:?}", model_path);
    }

    Ok(())
}

/// List all downloaded Whisper models from app data directory
#[tauri::command]
pub async fn list_downloaded_models(
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
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

    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read entry: {}", e))? {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("pt") {
            if let Some(stem) = path.file_stem() {
                if let Some(name) = stem.to_str() {
                    models.push(name.to_string());
                }
            }
        }
    }

    Ok(models)
}

/// Cancel an ongoing Whisper model download
#[tauri::command]
pub async fn cancel_whisper_download(
    app: tauri::AppHandle,
    size: String,
) -> Result<(), String> {
    let tasks: DownloadTasks = app.state::<DownloadTasks>().inner().clone();
    cancel_download_task(&tasks, &size).await?;
    eprintln!("🦀 [cancel_whisper_download] Cancelled download for: {}", size);

    Ok(())
}

/// Verify if a Whisper model is actually downloaded to disk
/// Checks the app data directory
#[tauri::command]
pub async fn verify_whisper_model_exists(
    app: tauri::AppHandle,
    size: String,
) -> Result<bool, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let model_path = app_data_dir
        .join("models")
        .join("whisper")
        .join(format!("{}.pt", size));
    
    let exists = model_path.exists();
    
    if exists {
        // Check file size to ensure it's a real model file
        if let Ok(metadata) = tokio::fs::metadata(&model_path).await {
            let file_size = metadata.len();
            eprintln!("🦀 [verify_whisper_model_exists] Model '{}' at {:?}: exists ({}MB)", 
                size, model_path, file_size / 1_048_576);
            
            // Whisper models should be at least 10MB (tiny is ~39MB, base is ~74MB)
            if file_size < 10_000_000 {
                eprintln!("⚠️ [verify_whisper_model_exists] Model file too small ({}MB), likely incomplete", 
                    file_size / 1_048_576);
                return Ok(false);
            }
            
            return Ok(true);
        }
    } else {
        eprintln!("🦀 [verify_whisper_model_exists] Model '{}' at {:?}: not found", size, model_path);
    }
    
    Ok(false)
}

/// Initialize download tasks state
pub fn init_download_state() -> DownloadTasks {
    Arc::new(Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::poll;
    use std::task::Poll;
    use tokio::sync::Barrier;

    #[tokio::test]
    async fn duplicate_registration_is_rejected_atomically() {
        let tasks = init_download_state();
        let barrier = Arc::new(Barrier::new(3));
        let mut attempts = Vec::new();

        for _ in 0..2 {
            let tasks = tasks.clone();
            let barrier = barrier.clone();
            attempts.push(tokio::spawn(async move {
                barrier.wait().await;
                register_download_task(&tasks, "tiny").await
            }));
        }

        barrier.wait().await;
        let first = attempts.remove(0).await.expect("registration task panicked");
        let second = attempts.remove(0).await.expect("registration task panicked");
        let outcomes = [first, second];

        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter_map(|result| result.as_ref().err())
                .collect::<Vec<_>>(),
            vec![&"Download already active for model: tiny".to_string()]
        );
        assert_eq!(tasks.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn cancelling_a_missing_download_returns_an_explicit_error() {
        let tasks = init_download_state();

        assert_eq!(
            cancel_download_task(&tasks, "tiny").await,
            Err("No active download found for: tiny".to_string())
        );
    }

    #[tokio::test]
    async fn cancellation_waits_for_partial_cleanup_and_task_removal() {
        let tasks = init_download_state();
        let active = register_download_task(&tasks, "tiny")
            .await
            .expect("initial registration should succeed");
        let partial_path = std::env::temp_dir().join(format!(
            "clypra-whisper-cancel-{}.part",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::write(&partial_path, b"partial model")
            .await
            .expect("partial file should be created");

        let mut cancellation = Box::pin(cancel_download_task(&tasks, "tiny"));
        assert!(matches!(poll!(&mut cancellation), Poll::Pending));
        assert!(active.cancel.is_cancelled());
        assert!(partial_path.exists());
        assert!(tasks.lock().await.contains_key("tiny"));

        tokio::fs::remove_file(&partial_path)
            .await
            .expect("partial file cleanup should finish");
        finish_download_task(&tasks, "tiny", &active).await;
        cancellation
            .await
            .expect("cancellation should complete after cleanup");

        assert!(!partial_path.exists());
        assert!(!tasks.lock().await.contains_key("tiny"));
    }
}
