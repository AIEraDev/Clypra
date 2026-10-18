use super::executor::emit_update;
use super::models::{AudioExtractionRequest, MediaJobResult, MediaJobUpdate};
use super::MEDIA_JOBS;
use tokio_util::sync::CancellationToken;

/// Enqueue an audio extraction or stream-copy operation and return its job ID.
#[tauri::command]
pub async fn start_audio_extraction(
    app: tauri::AppHandle,
    request: AudioExtractionRequest,
) -> Result<String, String> {
    let job_id = format!("media-job-{}", uuid::Uuid::new_v4());
    let cancellation = CancellationToken::new();
    MEDIA_JOBS.lock().await.insert(
        job_id.clone(),
        super::models::JobRecord {
            cancellation: cancellation.clone(),
            result: None,
        },
    );
    emit_update(
        &app,
        MediaJobUpdate {
            job_id: job_id.clone(),
            operation: "audioExtraction".to_string(),
            state: "queued".to_string(),
            progress: Some(0.0),
            resulting_asset_id: None,
            error_summary: None,
        },
    )
    .await;
    tauri::async_runtime::spawn(super::executor::run_extraction(
        app,
        job_id.clone(),
        request,
        cancellation,
    ));
    Ok(job_id)
}

/// Request cancellation of a running media job.
#[tauri::command]
pub async fn cancel_media_job(job_id: String) -> Result<(), String> {
    let jobs = MEDIA_JOBS.lock().await;
    jobs.get(&job_id)
        .map(|job| job.cancellation.cancel())
        .ok_or_else(|| "Media job not found".to_string())
}

/// Poll for the final result of a completed media job.
#[tauri::command]
pub async fn get_media_job_result(job_id: String) -> Result<Option<MediaJobResult>, String> {
    Ok(MEDIA_JOBS
        .lock()
        .await
        .get(&job_id)
        .and_then(|job| job.result.clone()))
}
