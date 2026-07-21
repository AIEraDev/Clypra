use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(4 * 60 * 60);

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

#[derive(Debug, Clone, PartialEq, Eq)]
enum DownloadCompletion {
    Cancelled,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DownloadError {
    Cancelled,
    Failed(String),
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("Download cancelled"),
            Self::Failed(message) => formatter.write_str(message),
        }
    }
}

struct DownloadTask {
    cancel: CancellationToken,
    completion: watch::Sender<Option<DownloadCompletion>>,
}

impl DownloadTask {
    fn new() -> Self {
        let (completion, _) = watch::channel(None);
        Self {
            cancel: CancellationToken::new(),
            completion,
        }
    }

    fn complete(&self, completion: DownloadCompletion) {
        if self.completion.borrow().is_none() {
            self.completion.send_replace(Some(completion));
        }
    }
}

struct DownloadRegistry {
    tasks: Mutex<HashMap<String, Arc<DownloadTask>>>,
}

/// Tauri-managed wrapper. The task implementation stays private to this module.
#[derive(Clone)]
pub(crate) struct DownloadState {
    registry: Arc<DownloadRegistry>,
}

fn lock_download_tasks(
    state: &DownloadState,
) -> std::sync::MutexGuard<'_, HashMap<String, Arc<DownloadTask>>> {
    state
        .registry
        .tasks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn register_download_task(state: &DownloadState, size: &str) -> Result<Arc<DownloadTask>, String> {
    let mut tasks = lock_download_tasks(state);

    match tasks.entry(size.to_string()) {
        std::collections::hash_map::Entry::Occupied(_) => {
            Err(format!("Download already active for model: {}", size))
        }
        std::collections::hash_map::Entry::Vacant(entry) => {
            let active = Arc::new(DownloadTask::new());
            entry.insert(active.clone());
            Ok(active)
        }
    }
}

fn finish_download_task(
    state: &DownloadState,
    size: &str,
    active: &Arc<DownloadTask>,
    completion: DownloadCompletion,
) {
    let mut tasks = lock_download_tasks(state);
    let is_current = tasks
        .get(size)
        .is_some_and(|current| Arc::ptr_eq(current, active));

    if is_current {
        tasks.remove(size);
    }
    drop(tasks);

    active.complete(completion);
}

async fn cancel_download_task(state: &DownloadState, size: &str) -> Result<(), String> {
    let active = {
        let tasks = lock_download_tasks(state);
        tasks.get(size).cloned()
    }
    .ok_or_else(|| format!("No active download found for: {}", size))?;

    let mut completion = active.completion.subscribe();
    active.cancel.cancel();

    loop {
        if let Some(outcome) = completion.borrow().clone() {
            return match outcome {
                DownloadCompletion::Cancelled => Ok(()),
                DownloadCompletion::Completed => {
                    Err(format!("Download completed before cancellation: {}", size))
                }
                DownloadCompletion::Failed(message) => Err(format!(
                    "Download failed before cancellation completed for {}: {}",
                    size, message
                )),
            };
        }

        completion.changed().await.map_err(|_| {
            format!(
                "Download completion channel closed unexpectedly for: {}",
                size
            )
        })?;
    }
}

fn partial_path_for(final_path: &Path) -> PathBuf {
    let mut partial_name = final_path.as_os_str().to_os_string();
    partial_name.push(".part");
    PathBuf::from(partial_name)
}

async fn remove_partial_file(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove partial download {}: {}",
            path.display(),
            error
        )),
    }
}

fn remove_partial_file_blocking(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove partial download {}: {}",
            path.display(),
            error
        )),
    }
}

async fn cleanup_failed_download(partial_path: &Path, error: DownloadError) -> DownloadError {
    match remove_partial_file(partial_path).await {
        Ok(()) => error,
        Err(cleanup_error) => DownloadError::Failed(format!("{}; {}", error, cleanup_error)),
    }
}

fn completion_for_download_result(result: &Result<(), DownloadError>) -> DownloadCompletion {
    match result {
        Ok(()) => DownloadCompletion::Completed,
        Err(DownloadError::Cancelled) => DownloadCompletion::Cancelled,
        Err(DownloadError::Failed(message)) => DownloadCompletion::Failed(message.clone()),
    }
}

struct DownloadTaskGuard {
    state: DownloadState,
    size: String,
    active: Arc<DownloadTask>,
    partial_path: PathBuf,
    armed: bool,
}

impl DownloadTaskGuard {
    fn new(
        state: DownloadState,
        size: String,
        active: Arc<DownloadTask>,
        partial_path: PathBuf,
    ) -> Self {
        Self {
            state,
            size,
            active,
            partial_path,
            armed: true,
        }
    }

    fn finish(mut self, completion: DownloadCompletion) {
        finish_download_task(&self.state, &self.size, &self.active, completion);
        self.armed = false;
    }
}

impl Drop for DownloadTaskGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        self.armed = false;

        let state = self.state.clone();
        let size = self.size.clone();
        let active = self.active.clone();
        let partial_path = self.partial_path.clone();

        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let completion = match remove_partial_file(&partial_path).await {
                    Ok(()) => DownloadCompletion::Failed(format!(
                        "Download task aborted for model: {}",
                        size
                    )),
                    Err(cleanup_error) => DownloadCompletion::Failed(format!(
                        "Download task aborted for model: {}; {}",
                        size, cleanup_error
                    )),
                };
                finish_download_task(&state, &size, &active, completion);
            });
        } else {
            let completion = match remove_partial_file_blocking(&partial_path) {
                Ok(()) => {
                    DownloadCompletion::Failed(format!("Download task aborted for model: {}", size))
                }
                Err(cleanup_error) => DownloadCompletion::Failed(format!(
                    "Download task aborted for model: {}; {}",
                    size, cleanup_error
                )),
            };
            finish_download_task(&state, &size, &active, completion);
        }
    }
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
pub async fn download_whisper_model(app: tauri::AppHandle, size: String) -> Result<(), String> {
    eprintln!(
        "🦀 [download_whisper_model] Starting download for model: {}",
        size
    );

    let url = get_model_url(&size)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let models_dir = app_data_dir.join("models").join("whisper");

    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let final_path = models_dir.join(format!("{}.pt", size));
    let partial_path = partial_path_for(&final_path);

    eprintln!("🦀 [download_whisper_model] Downloading from: {}", url);
    eprintln!("🦀 [download_whisper_model] Saving to: {:?}", final_path);

    let state = app.state::<DownloadState>().inner().clone();
    let active = register_download_task(&state, &size)?;
    let guard = DownloadTaskGuard::new(state, size.clone(), active.clone(), partial_path.clone());

    let raw_result = perform_download(
        app.clone(),
        size.clone(),
        url,
        partial_path.clone(),
        final_path,
        active.cancel.clone(),
    )
    .await;

    let result = match raw_result {
        Ok(()) => Ok(()),
        Err(error) => Err(cleanup_failed_download(&partial_path, error).await),
    };

    guard.finish(completion_for_download_result(&result));

    result.map_err(|error| error.to_string())
}

fn build_download_client() -> Result<reqwest::Client, DownloadError> {
    reqwest::Client::builder()
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TOTAL_TIMEOUT)
        .build()
        .map_err(|error| {
            DownloadError::Failed(format!("Failed to create download client: {}", error))
        })
}

async fn start_download_request(
    client: &reqwest::Client,
    url: &str,
    cancel_token: &CancellationToken,
) -> Result<reqwest::Response, DownloadError> {
    let request = client.get(url).send();
    let response = tokio::select! {
        biased;
        _ = cancel_token.cancelled() => return Err(DownloadError::Cancelled),
        response = request => response.map_err(|error| {
            DownloadError::Failed(format!("Failed to start download: {}", error))
        })?,
    };

    if cancel_token.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }

    if !response.status().is_success() {
        return Err(DownloadError::Failed(format!(
            "Download failed with status: {}",
            response.status()
        )));
    }

    Ok(response)
}

async fn finalize_download(
    partial_path: &Path,
    final_path: &Path,
    cancel_token: &CancellationToken,
) -> Result<(), DownloadError> {
    finalize_download_at_commit_point(final_path, cancel_token, || {
        tokio::fs::rename(partial_path, final_path)
    })
    .await
}

async fn finalize_download_at_commit_point<Commit, CommitFuture>(
    final_path: &Path,
    cancel_token: &CancellationToken,
    commit: Commit,
) -> Result<(), DownloadError>
where
    Commit: FnOnce() -> CommitFuture,
    CommitFuture: std::future::Future<Output = std::io::Result<()>>,
{
    if cancel_token.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }

    commit().await.map_err(|error| {
        DownloadError::Failed(format!(
            "Failed to finalize download {}: {}",
            final_path.display(),
            error
        ))
    })
}

async fn perform_download(
    app: tauri::AppHandle,
    size: String,
    url: String,
    partial_path: PathBuf,
    final_path: PathBuf,
    cancel_token: CancellationToken,
) -> Result<(), DownloadError> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let _ = app.emit(
        "whisper_model_progress",
        DownloadProgressPayload {
            size: size.clone(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
        },
    );

    let client = build_download_client()?;
    let response = start_download_request(&client, &url, &cancel_token).await?;
    let total_size = response.content_length().unwrap_or(0);
    eprintln!(
        "🦀 [download_whisper_model] Total size: {} MB",
        total_size / 1_048_576
    );

    let mut stream = response.bytes_stream();
    let mut file = tokio::select! {
        biased;
        _ = cancel_token.cancelled() => return Err(DownloadError::Cancelled),
        file = tokio::fs::File::create(&partial_path) => file.map_err(|error| {
            DownloadError::Failed(format!(
                "Failed to create partial download {}: {}",
                partial_path.display(),
                error
            ))
        })?,
    };

    let mut downloaded = 0u64;
    let mut last_update = std::time::Instant::now();
    let mut last_downloaded = 0u64;

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => return Err(DownloadError::Cancelled),
            chunk_result = stream.next() => chunk_result,
        };

        match chunk_result {
            Some(Ok(chunk)) => {
                tokio::select! {
                    biased;
                    _ = cancel_token.cancelled() => return Err(DownloadError::Cancelled),
                    result = file.write_all(&chunk) => result.map_err(|error| {
                        DownloadError::Failed(format!("Failed to write partial download: {}", error))
                    })?,
                }

                downloaded += chunk.len() as u64;

                let now = std::time::Instant::now();
                if now.duration_since(last_update).as_millis() >= 500 {
                    let elapsed_secs = now.duration_since(last_update).as_secs_f64();
                    let bytes_since_last = downloaded - last_downloaded;
                    let speed = (bytes_since_last as f64 / elapsed_secs) as u64;
                    let progress_percent = if total_size == 0 {
                        0.0
                    } else {
                        (downloaded as f64 / total_size as f64) * 100.0
                    };

                    eprintln!(
                        "🦀 [download] Progress: {}/{} MB ({:.1}%) @ {} MB/s",
                        downloaded / 1_048_576,
                        total_size / 1_048_576,
                        progress_percent,
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
            Some(Err(error)) => {
                return Err(DownloadError::Failed(format!(
                    "Download stream error: {}",
                    error
                )));
            }
            None => break,
        }
    }

    if cancel_token.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }

    tokio::select! {
        biased;
        _ = cancel_token.cancelled() => return Err(DownloadError::Cancelled),
        result = file.flush() => result.map_err(|error| {
            DownloadError::Failed(format!("Failed to flush partial download: {}", error))
        })?,
    }
    drop(file);

    finalize_download(&partial_path, &final_path, &cancel_token).await?;

    eprintln!(
        "🦀 [download_whisper_model] Download completed: {} MB",
        downloaded / 1_048_576
    );

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
        eprintln!(
            "🦀 [delete_whisper_model] Model not found: {:?}",
            model_path
        );
    }

    Ok(())
}

/// List all downloaded Whisper models from app data directory
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
pub async fn cancel_whisper_download(app: tauri::AppHandle, size: String) -> Result<(), String> {
    let state = app.state::<DownloadState>().inner().clone();
    cancel_download_task(&state, &size).await?;
    eprintln!(
        "🦀 [cancel_whisper_download] Cancelled download for: {}",
        size
    );

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
            eprintln!(
                "🦀 [verify_whisper_model_exists] Model '{}' at {:?}: exists ({}MB)",
                size,
                model_path,
                file_size / 1_048_576
            );

            // Whisper models should be at least 10MB (tiny is ~39MB, base is ~74MB)
            if file_size < 10_000_000 {
                eprintln!("⚠️ [verify_whisper_model_exists] Model file too small ({}MB), likely incomplete", 
                    file_size / 1_048_576);
                return Ok(false);
            }

            return Ok(true);
        }
    } else {
        eprintln!(
            "🦀 [verify_whisper_model_exists] Model '{}' at {:?}: not found",
            size, model_path
        );
    }

    Ok(false)
}

/// Initialize download tasks state
pub(crate) fn init_download_state() -> DownloadState {
    DownloadState {
        registry: Arc::new(DownloadRegistry {
            tasks: Mutex::new(HashMap::new()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::poll;
    use std::task::Poll;
    use tokio::sync::Barrier;

    fn temporary_model_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "clypra-whisper-{}-{}.pt",
            label,
            uuid::Uuid::new_v4()
        ))
    }

    fn task_count(state: &DownloadState) -> usize {
        lock_download_tasks(state).len()
    }

    fn has_task(state: &DownloadState, size: &str) -> bool {
        lock_download_tasks(state).contains_key(size)
    }

    #[tokio::test]
    async fn duplicate_registration_is_rejected_atomically() {
        let state = init_download_state();
        let barrier = Arc::new(Barrier::new(3));
        let mut attempts = Vec::new();

        for _ in 0..2 {
            let state = state.clone();
            let barrier = barrier.clone();
            attempts.push(tokio::spawn(async move {
                barrier.wait().await;
                register_download_task(&state, "tiny")
            }));
        }

        barrier.wait().await;
        let first = attempts
            .remove(0)
            .await
            .expect("registration task panicked");
        let second = attempts
            .remove(0)
            .await
            .expect("registration task panicked");
        let outcomes = [first, second];

        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter_map(|result| result.as_ref().err())
                .collect::<Vec<_>>(),
            vec![&"Download already active for model: tiny".to_string()]
        );
        assert_eq!(task_count(&state), 1);
    }

    #[tokio::test]
    async fn cancelling_a_missing_download_returns_an_explicit_error() {
        let state = init_download_state();

        assert_eq!(
            cancel_download_task(&state, "tiny").await,
            Err("No active download found for: tiny".to_string())
        );
    }

    #[tokio::test]
    async fn cancellation_waits_for_partial_cleanup_and_task_removal() {
        let state = init_download_state();
        let active =
            register_download_task(&state, "tiny").expect("initial registration should succeed");
        let final_path = temporary_model_path("cancel");
        let partial_path = partial_path_for(&final_path);
        tokio::fs::write(&partial_path, b"partial model")
            .await
            .expect("partial file should be created");
        let guard = DownloadTaskGuard::new(
            state.clone(),
            "tiny".to_string(),
            active.clone(),
            partial_path.clone(),
        );

        let mut cancellation = Box::pin(cancel_download_task(&state, "tiny"));
        assert!(matches!(poll!(&mut cancellation), Poll::Pending));
        assert!(active.cancel.is_cancelled());
        assert!(partial_path.exists());
        assert!(has_task(&state, "tiny"));

        assert_eq!(
            cleanup_failed_download(&partial_path, DownloadError::Cancelled).await,
            DownloadError::Cancelled
        );
        guard.finish(DownloadCompletion::Cancelled);
        cancellation
            .await
            .expect("cancellation should complete after cleanup");

        assert!(!partial_path.exists());
        assert!(!final_path.exists());
        assert!(!has_task(&state, "tiny"));
    }

    #[tokio::test]
    async fn cancellation_rejects_a_download_that_completed_before_it_won_the_race() {
        let state = init_download_state();
        let active =
            register_download_task(&state, "tiny").expect("initial registration should succeed");
        let mut cancellation = Box::pin(cancel_download_task(&state, "tiny"));

        assert!(matches!(poll!(&mut cancellation), Poll::Pending));
        finish_download_task(&state, "tiny", &active, DownloadCompletion::Completed);

        assert_eq!(
            cancellation.await,
            Err("Download completed before cancellation: tiny".to_string())
        );
    }

    #[tokio::test]
    async fn cancellation_reports_a_failed_download_instead_of_claiming_success() {
        let state = init_download_state();
        let active =
            register_download_task(&state, "tiny").expect("initial registration should succeed");
        let mut cancellation = Box::pin(cancel_download_task(&state, "tiny"));

        assert!(matches!(poll!(&mut cancellation), Poll::Pending));
        finish_download_task(
            &state,
            "tiny",
            &active,
            DownloadCompletion::Failed("HTTP 503".to_string()),
        );

        assert_eq!(
            cancellation.await,
            Err("Download failed before cancellation completed for tiny: HTTP 503".to_string())
        );
    }

    #[tokio::test]
    async fn cancellation_after_eof_but_before_rename_keeps_the_final_path_absent() {
        let final_path = temporary_model_path("pre-rename-cancel");
        let partial_path = partial_path_for(&final_path);
        let cancel = CancellationToken::new();
        tokio::fs::write(&partial_path, b"complete model bytes")
            .await
            .expect("partial file should be created");

        cancel.cancel();
        let error = finalize_download(&partial_path, &final_path, &cancel)
            .await
            .expect_err("cancellation must win before rename");
        let error = cleanup_failed_download(&partial_path, error).await;

        assert_eq!(error, DownloadError::Cancelled);
        assert!(!partial_path.exists());
        assert!(!final_path.exists());
    }

    #[tokio::test]
    async fn cancellation_after_commit_point_reports_completed_and_keeps_final_file() {
        let final_path = temporary_model_path("commit-point-cancel");
        let partial_path = partial_path_for(&final_path);
        tokio::fs::write(&partial_path, b"complete model bytes")
            .await
            .expect("partial file should be created");
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task_partial_path = partial_path.clone();
        let task_final_path = final_path.clone();
        let error_path = final_path.clone();
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();

        let finalization = tokio::spawn(async move {
            let result =
                finalize_download_at_commit_point(&error_path, &task_cancel, || async move {
                    let _ = entered_tx.send(());
                    release_rx
                        .await
                        .map_err(|_| std::io::Error::other("test commit release channel closed"))?;
                    tokio::fs::rename(task_partial_path, task_final_path).await
                })
                .await;
            let completion = completion_for_download_result(&result);
            (result, completion)
        });

        entered_rx
            .await
            .expect("finalization should enter the commit point");
        cancel.cancel();
        release_tx
            .send(())
            .expect("finalization should still await the commit");
        let (result, completion) = finalization
            .await
            .expect("finalization task should not panic");

        assert_eq!(result, Ok(()));
        assert_eq!(completion, DownloadCompletion::Completed);
        assert!(!partial_path.exists());
        assert_eq!(
            tokio::fs::read(&final_path)
                .await
                .expect("committed final file should exist"),
            b"complete model bytes"
        );
        tokio::fs::remove_file(&final_path)
            .await
            .expect("test final file should be removed");
    }

    #[tokio::test]
    async fn successful_finalize_atomically_promotes_the_partial_file() {
        let final_path = temporary_model_path("finalize");
        let partial_path = partial_path_for(&final_path);
        let cancel = CancellationToken::new();
        tokio::fs::write(&partial_path, b"complete model bytes")
            .await
            .expect("partial file should be created");

        finalize_download(&partial_path, &final_path, &cancel)
            .await
            .expect("finalization should succeed");

        assert!(!partial_path.exists());
        assert_eq!(
            tokio::fs::read(&final_path)
                .await
                .expect("final file should be readable"),
            b"complete model bytes"
        );
        tokio::fs::remove_file(&final_path)
            .await
            .expect("test final file should be removed");
    }

    #[tokio::test]
    async fn partial_cleanup_failure_is_propagated() {
        let final_path = temporary_model_path("cleanup-failure");
        let partial_path = partial_path_for(&final_path);
        tokio::fs::create_dir(&partial_path)
            .await
            .expect("directory should simulate an unremovable partial file");

        let error = cleanup_failed_download(&partial_path, DownloadError::Cancelled).await;

        match error {
            DownloadError::Failed(message) => {
                assert!(message.contains("Download cancelled"));
                assert!(message.contains("Failed to remove partial download"));
            }
            other => panic!("cleanup failure should replace cancellation, got {other:?}"),
        }
        tokio::fs::remove_dir(&partial_path)
            .await
            .expect("test directory should be removed");
    }

    #[tokio::test]
    async fn dropping_a_download_guard_cleans_partial_state_and_wakes_cancellation() {
        let state = init_download_state();
        let active =
            register_download_task(&state, "tiny").expect("initial registration should succeed");
        let final_path = temporary_model_path("aborted");
        let partial_path = partial_path_for(&final_path);
        tokio::fs::write(&partial_path, b"partial model")
            .await
            .expect("partial file should be created");
        let guard = DownloadTaskGuard::new(
            state.clone(),
            "tiny".to_string(),
            active.clone(),
            partial_path.clone(),
        );
        let mut cancellation = Box::pin(cancel_download_task(&state, "tiny"));
        assert!(matches!(poll!(&mut cancellation), Poll::Pending));
        assert!(active.cancel.is_cancelled());

        drop(guard);

        let error = tokio::time::timeout(Duration::from_secs(1), &mut cancellation)
            .await
            .expect("cancellation should not hang")
            .expect_err("aborted task must not report successful cancellation");
        assert!(error.contains("Download task aborted"));
        assert!(!partial_path.exists());
        assert!(!has_task(&state, "tiny"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn waiting_for_response_headers_is_cancellable() {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("local test listener should bind");
        let address = listener
            .local_addr()
            .expect("local listener should have an address");
        let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("test request should connect");
            let _ = accepted_tx.send(());
            let _ = release_rx.recv();
            drop(stream);
        });
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .expect("test client should build");
        let cancel = CancellationToken::new();
        let request_cancel = cancel.clone();
        let url = format!("http://{address}/model.pt");
        let request =
            tokio::spawn(
                async move { start_download_request(&client, &url, &request_cancel).await },
            );

        accepted_rx
            .await
            .expect("server should accept the request before cancellation");
        cancel.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), request)
            .await
            .expect("request cancellation should not wait for headers")
            .expect("request task should not panic");
        let _ = release_tx.send(());
        server.join().expect("test server thread should exit");

        assert!(matches!(result, Err(DownloadError::Cancelled)));
    }
}
