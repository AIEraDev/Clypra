use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

use crate::commands::export::ExportProgress;

use super::executor::{run_native_export, wait_for_native_job};
use super::models::{
    acquire_export_slot, release_export_slot, validate_plan, NativeExportCompletion,
    NativeExportJob, NativeTimelineExportPlan, NATIVE_EXPORT_JOBS,
};

#[tauri::command]
pub async fn start_native_timeline_export(
    plan: NativeTimelineExportPlan,
    on_progress: Channel<ExportProgress>,
) -> Result<String, String> {
    validate_plan(&plan)?;
    acquire_export_slot()?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let cancellation = CancellationToken::new();
    let result = Arc::new(Mutex::new(None));
    let completed = Arc::new(Notify::new());
    NATIVE_EXPORT_JOBS.lock().await.insert(
        session_id.clone(),
        NativeExportJob {
            cancellation: cancellation.clone(),
            result: result.clone(),
            completed: completed.clone(),
        },
    );

    let task_cancellation = cancellation.clone();
    let task_session_id = session_id.clone();
    tokio::spawn(async move {
        let export_result =
            run_native_export(&task_session_id, plan, on_progress, task_cancellation).await;
        *result.lock().await = Some(export_result);
        completed.notify_waiters();
    });
    Ok(session_id)
}

#[tauri::command]
pub async fn finalize_native_timeline_export(
    session_id: String,
) -> Result<NativeExportCompletion, String> {
    let (result, completed) = NATIVE_EXPORT_JOBS
        .lock()
        .await
        .get(&session_id)
        .map(|job| (job.result.clone(), job.completed.clone()))
        .ok_or_else(|| format!("Native export session not found: {session_id}"))?;
    let result = wait_for_native_job(result, completed).await;
    if NATIVE_EXPORT_JOBS
        .lock()
        .await
        .remove(&session_id)
        .is_some()
    {
        release_export_slot();
    }
    result
}

#[tauri::command]
pub async fn cancel_native_timeline_export(session_id: String) -> Result<(), String> {
    let (cancellation, result, completed) = NATIVE_EXPORT_JOBS
        .lock()
        .await
        .get(&session_id)
        .map(|job| {
            (
                job.cancellation.clone(),
                job.result.clone(),
                job.completed.clone(),
            )
        })
        .ok_or_else(|| format!("Native export session not found: {session_id}"))?;
    cancellation.cancel();
    let _ = wait_for_native_job(result, completed).await;
    if NATIVE_EXPORT_JOBS
        .lock()
        .await
        .remove(&session_id)
        .is_some()
    {
        release_export_slot();
    }
    Ok(())
}
