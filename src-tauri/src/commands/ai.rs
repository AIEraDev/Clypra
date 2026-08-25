//! IPC commands for the on-device AI inference pipeline.
//!
//! Exposes MediaPipe face tracking and model management to the frontend
//! via Tauri's typed command system.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::ai::{
    mediapipe_tracker::{BoundingBox, MediaPipeFaceTracker},
    model_manager::{self, MediaPipeModel},
};

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Active face-tracking cancellation tokens, keyed by clip ID.
pub type TrackingTasks = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// Call once during `app.setup()` to register the shared state.
pub fn init_ai_state() -> TrackingTasks {
    Arc::new(Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Tracking commands
// ---------------------------------------------------------------------------

/// Describes a single decoded frame ready for inference.
#[derive(Debug, Deserialize)]
pub struct FrameInput {
    /// Timestamp of this frame in milliseconds.
    pub timestamp_ms: u64,
    /// Flat CHW pixel buffer, normalised to [0.0, 1.0].
    /// Expected shape: `[3 × width × height]`.
    pub pixels: Vec<f32>,
    pub width: usize,
    pub height: usize,
}

/// One tracking result for a single frame.
#[derive(Debug, Serialize)]
pub struct TrackingResult {
    pub timestamp_ms: u64,
    pub bounding_box: Option<BoundingBox>,
}

/// Run face/subject detection over a sequence of pre-decoded frames.
///
/// Frames should be downscaled to 256×256 or 512×512 before calling this.
/// The command is non-blocking — inference runs on a dedicated thread pool.
/// Cancel at any time with [`cancel_face_tracking`].
#[tauri::command]
pub async fn run_face_tracking(
    app: tauri::AppHandle,
    clip_id: String,
    model_name: String,
    frames: Vec<FrameInput>,
) -> Result<Vec<TrackingResult>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    // Resolve model path
    let model_enum = parse_model_name(&model_name)?;
    let model_file = model_manager::model_path(&app_data_dir, &model_enum);

    if !model_file.exists() {
        return Err(format!(
            "Model '{model_name}' not found. Download it first with download_mediapipe_model."
        ));
    }

    // Create tracker (loads ONNX session)
    let tracker = MediaPipeFaceTracker::new(model_file.to_str().unwrap_or_default())?;

    // Register cancellation token
    let cancel_token = CancellationToken::new();
    {
        let tasks: TrackingTasks = app.state::<TrackingTasks>().inner().clone();
        let mut map = tasks.lock().await;
        map.insert(clip_id.clone(), cancel_token.clone());
    }

    // Convert frame inputs
    let frames_data: Vec<(u64, Vec<f32>, (usize, usize))> = frames
        .into_iter()
        .map(|f| (f.timestamp_ms, f.pixels, (f.width, f.height)))
        .collect();

    // Run inference
    let raw_results = tracker
        .track_sequence(frames_data, cancel_token.clone())
        .await;

    // Deregister token
    {
        let tasks: TrackingTasks = app.state::<TrackingTasks>().inner().clone();
        let mut map = tasks.lock().await;
        map.remove(&clip_id);
    }

    let results = raw_results?
        .into_iter()
        .map(|(ts, bbox)| TrackingResult {
            timestamp_ms: ts,
            bounding_box: bbox,
        })
        .collect();

    Ok(results)
}

/// Cancel an ongoing face-tracking job for the given clip.
#[tauri::command]
pub async fn cancel_face_tracking(app: tauri::AppHandle, clip_id: String) -> Result<(), String> {
    let tasks: TrackingTasks = app.state::<TrackingTasks>().inner().clone();
    let map = tasks.lock().await;
    if let Some(token) = map.get(&clip_id) {
        token.cancel();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Model management commands
// ---------------------------------------------------------------------------

/// Download a MediaPipe ONNX model to `<app_data_dir>/models/mediapipe/`.
///
/// Emits `mediapipe_model_progress` events during download.
#[tauri::command]
pub async fn download_mediapipe_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    let model = parse_model_name(&model_name)?;
    model_manager::download_model(&app, &model).await?;
    Ok(())
}

/// Check whether a MediaPipe model is already downloaded.
#[tauri::command]
pub async fn verify_mediapipe_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<bool, String> {
    let model = parse_model_name(&model_name)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(model_manager::model_exists(&app_data_dir, &model))
}

/// Delete a downloaded MediaPipe model.
#[tauri::command]
pub async fn delete_mediapipe_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    let model = parse_model_name(&model_name)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let path = model_manager::model_path(&app_data_dir, &model);
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete model: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_model_name(name: &str) -> Result<MediaPipeModel, String> {
    match name {
        "face-detector-short-range" => Ok(MediaPipeModel::FaceDetectorShortRange),
        "face-detector-full-range" => Ok(MediaPipeModel::FaceDetectorFullRange),
        "selfie-segmenter" => Ok(MediaPipeModel::SelfieSegmenter),
        _ => Err(format!("Unknown MediaPipe model: '{name}'")),
    }
}
