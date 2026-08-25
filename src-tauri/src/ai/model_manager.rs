//! MediaPipe ONNX model manager.
//!
//! Handles on-demand download, local storage, and SHA-256 integrity
//! verification for MediaPipe-derived ONNX models — following the same
//! pattern as the Whisper model loader.
//!
//! Models are stored in `<app_data_dir>/models/mediapipe/<model_name>.onnx`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Known downloadable MediaPipe ONNX models.
/// Source: Hugging Face `qualcomm/MediaPipe` and converted Google TFLite exports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum MediaPipeModel {
    /// BlazeFace short-range detector — 256×256 input, optimised for front-facing camera.
    FaceDetectorShortRange,
    /// BlazeFace full-range detector — 256×256 input, handles larger distance range.
    FaceDetectorFullRange,
    /// MediaPipe selfie segmenter — 256×256 input, binary foreground/background mask.
    SelfieSegmenter,
}

impl MediaPipeModel {
    /// Human-readable identifier used in filesystem paths and IPC.
    pub fn id(&self) -> &'static str {
        match self {
            Self::FaceDetectorShortRange => "face-detector-short-range",
            Self::FaceDetectorFullRange => "face-detector-full-range",
            Self::SelfieSegmenter => "selfie-segmenter",
        }
    }

    /// CDN download URL (Hugging Face).
    pub fn url(&self) -> &'static str {
        match self {
            Self::FaceDetectorShortRange => {
                "https://huggingface.co/qualcomm/MediaPipe-Face-Detection/resolve/main/MediaPipeFaceDetection.onnx"
            }
            Self::FaceDetectorFullRange => {
                "https://huggingface.co/qualcomm/MediaPipe-Face-Detection/resolve/main/MediaPipeFaceDetectionFullRange.onnx"
            }
            Self::SelfieSegmenter => {
                "https://huggingface.co/qualcomm/MediaPipe-Selfie-Segmentation/resolve/main/MediaPipeSelfieSegmentation.onnx"
            }
        }
    }

    /// Expected SHA-256 hex digest for integrity verification.
    /// Update these when bumping model versions.
    pub fn expected_sha256(&self) -> Option<&'static str> {
        match self {
            // Leave None to skip checksum verification during development.
            // Set to the actual digest before shipping to production.
            Self::FaceDetectorShortRange => None,
            Self::FaceDetectorFullRange => None,
            Self::SelfieSegmenter => None,
        }
    }
}

/// Download progress event payload — mirrors the Whisper model progress format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub model: String,
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "speedBytesPerSec")]
    pub speed_bytes_per_sec: u64,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Returns the directory where all MediaPipe ONNX models are stored.
pub fn models_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("models").join("mediapipe")
}

/// Returns the full path for a given model on disk.
pub fn model_path(app_data_dir: &Path, model: &MediaPipeModel) -> PathBuf {
    models_dir(app_data_dir).join(format!("{}.onnx", model.id()))
}

/// Returns `true` if the model file exists and has a non-zero size.
pub fn model_exists(app_data_dir: &Path, model: &MediaPipeModel) -> bool {
    let path = model_path(app_data_dir, model);
    path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/// Download a MediaPipe ONNX model with progress events and SHA-256 verification.
///
/// Emits `mediapipe_model_progress` events on `app` during download.
/// On completion, verifies the file's SHA-256 digest if `model.expected_sha256()`
/// is set, deleting the file and returning an error on mismatch.
pub async fn download_model(
    app: &tauri::AppHandle,
    model: &MediaPipeModel,
) -> Result<PathBuf, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let dir = models_dir(&app_data_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create models dir: {e}"))?;

    let dest = model_path(&app_data_dir, model);
    let model_id = model.id().to_string();

    let response = reqwest::get(model.url())
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_report = std::time::Instant::now();
    let mut last_bytes: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_report).as_millis() >= 400 {
            let elapsed = now.duration_since(last_report).as_secs_f64();
            let speed = ((downloaded - last_bytes) as f64 / elapsed) as u64;

            let _ = app.emit(
                "mediapipe_model_progress",
                ModelDownloadProgress {
                    model: model_id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    speed_bytes_per_sec: speed,
                },
            );

            last_report = now;
            last_bytes = downloaded;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;

    // Emit final progress
    let _ = app.emit(
        "mediapipe_model_progress",
        ModelDownloadProgress {
            model: model_id,
            downloaded_bytes: downloaded,
            total_bytes,
            speed_bytes_per_sec: 0,
        },
    );

    // SHA-256 integrity check
    if let Some(expected) = model.expected_sha256() {
        verify_sha256(&dest, expected).await.inspect_err(|_e| {
            // Delete the corrupt file so the next download is a clean retry
            let _ = std::fs::remove_file(&dest);
        })?;
    }

    Ok(dest)
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// Compute the SHA-256 digest of a file and compare it to `expected_hex`.
pub async fn verify_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Failed to read model for verification: {e}"))?;

    let digest = Sha256::digest(&bytes);
    let actual_hex = format!("{digest:x}");

    if actual_hex != expected_hex {
        return Err(format!(
            "SHA-256 mismatch for '{}': expected {expected_hex}, got {actual_hex}",
            path.display()
        ));
    }

    Ok(())
}
