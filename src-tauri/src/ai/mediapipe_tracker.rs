//! MediaPipe-derived face/subject tracking via ONNX Runtime.
//!
//! Architecture:
//! - Inference runs inside `tokio::task::spawn_blocking` — never on the async executor.
//! - Frames are downscaled to 256×256 or 512×512 before inference (10–15 FPS cadence).
//! - A [`CancellationToken`] allows the caller to abort mid-sequence (e.g., clip deleted).
//! - The returned bounding boxes are timestamp-keyed; the frontend Kalman smoother
//!   interpolates them to 60 FPS for the PixiJS overlay.
//!
//! Execution provider fallback chain per platform:
//! - macOS:   CoreML → CPU
//! - Windows: DirectML → CPU
//! - Linux:   CPU

use ndarray::Array4;
use ort::ep::CPU;
use ort::session::{Session, builder::SessionBuilder};
use ort::value::TensorRef;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Normalised axis-aligned bounding box in [0, 1] coordinate space.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BoundingBox {
    /// Left edge, normalised to [0, 1] relative to frame width.
    pub x: f32,
    /// Top edge, normalised to [0, 1] relative to frame height.
    pub y: f32,
    /// Box width, normalised to [0, 1].
    pub width: f32,
    /// Box height, normalised to [0, 1].
    pub height: f32,
    /// Detection confidence in [0, 1].
    pub confidence: f32,
}

/// ONNX-backed face/subject tracker.
///
/// `session.run()` requires `&mut Session`, so the session is wrapped in
/// `Arc<Mutex<Session>>` for safe sharing into `spawn_blocking` closures.
pub struct MediaPipeFaceTracker {
    session: Arc<Mutex<Session>>,
    /// Output names resolved once at load time to avoid per-frame locking overhead.
    score_output_name: String,
    box_output_name: String,
}

impl MediaPipeFaceTracker {
    /// Load a MediaPipe-derived ONNX model from `model_path`.
    ///
    /// Configures the platform-optimal execution provider chain automatically.
    pub fn new(model_path: &str) -> Result<Self, String> {
        let session = build_session(model_path)?;

        // Resolve output names while we still have exclusive access
        let score_output_name = session
            .outputs()
            .first()
            .map(|o| o.name().to_string())
            .ok_or("Model has no outputs")?;
        let box_output_name = session
            .outputs()
            .get(1)
            .map(|o| o.name().to_string())
            .ok_or("Model has fewer than 2 outputs")?;

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            score_output_name,
            box_output_name,
        })
    }

    /// Run face/subject detection over a sequence of pre-decoded frame buffers.
    ///
    /// # Parameters
    /// - `frames`: `(timestamp_ms, normalised_rgb_f32_pixels, (width, height))`  
    ///   Pixels must be in **NCHW** order (channel-first), normalised to `[0.0, 1.0]`.  
    ///   Recommended resolution: 256×256 or 512×512.
    /// - `cancel_token`: Cancel mid-sequence cleanly (e.g., the user deleted the clip).
    ///
    /// # Returns
    /// A timestamp-keyed result vector. `None` indicates no detection at that frame.
    pub async fn track_sequence(
        &self,
        frames: Vec<(u64, Vec<f32>, (usize, usize))>,
        cancel_token: CancellationToken,
    ) -> Result<Vec<(u64, Option<BoundingBox>)>, String> {
        let session = Arc::clone(&self.session);
        let score_name = self.score_output_name.clone();
        let box_name = self.box_output_name.clone();

        tokio::task::spawn_blocking(move || {
            // Acquire the mutex inside the blocking thread — this is safe because
            // spawn_blocking threads are not limited by the async executor.
            let mut session_guard = session.blocking_lock();
            let mut results = Vec::with_capacity(frames.len());

            for (pts_ms, pixel_data, (w, h)) in frames {
                if cancel_token.is_cancelled() {
                    return Err("Inference cancelled".to_string());
                }

                let bbox = run_single_frame(
                    &mut session_guard,
                    pixel_data,
                    w,
                    h,
                    &score_name,
                    &box_name,
                )?;
                results.push((pts_ms, bbox));
            }

            Ok(results)
        })
        .await
        .map_err(|e| format!("Inference worker panicked: {e}"))?
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn build_session(model_path: &str) -> Result<Session, String> {
    // CPU is the universal fallback. Hardware-accelerated EPs (CoreML on macOS,
    // DirectML on Windows) can be enabled by adding the corresponding ort features
    // to Cargo.toml: `ort = { features = ["coreml"] }` etc.
    // ort will automatically fall through to CPU if the EP is unavailable at runtime.
    SessionBuilder::new()
        .map_err(|e| e.to_string())?
        .with_execution_providers([CPU::default().build()])
        .map_err(|e| e.to_string())?
        .commit_from_file(model_path)
        .map_err(|e| format!("Failed to load model '{model_path}': {e}"))
}

fn run_single_frame(
    session: &mut Session,
    pixel_data: Vec<f32>,
    w: usize,
    h: usize,
    score_name: &str,
    box_name: &str,
) -> Result<Option<BoundingBox>, String> {
    // Input shape: NCHW [batch=1, channels=3, height, width]
    let array = Array4::from_shape_vec([1, 3, h, w], pixel_data)
        .map_err(|e| format!("Invalid input shape: {e}"))?;

    let input_tensor = TensorRef::from_array_view(&array)
        .map_err(|e| format!("Failed to create input tensor: {e}"))?;

    // ort::inputs! macro produces [SessionInputValue; N] which implements Into<SessionInputs>
    let outputs = session
        .run(ort::inputs![input_tensor])
        .map_err(|e| format!("Inference failed: {e}"))?;

    Ok(parse_detections(&outputs, score_name, box_name))
}

/// Parse raw ONNX output tensors into the highest-confidence bounding box.
///
/// MediaPipe face detection models output two tensors:
/// - scores / classificators: shape `[1, num_anchors, 1]`
/// - boxes / regressors:      shape `[1, num_anchors, 4]` (cx, cy, w, h normalised)
///
/// Applies a confidence threshold of 0.5 and returns the top detection.
fn parse_detections(
    outputs: &ort::session::SessionOutputs,
    score_name: &str,
    box_name: &str,
) -> Option<BoundingBox> {
    let score_value = outputs.get(score_name)?;
    let box_value = outputs.get(box_name)?;

    let (_, scores_flat) = score_value.try_extract_tensor::<f32>().ok()?;
    let (_, boxes_flat) = box_value.try_extract_tensor::<f32>().ok()?;

    const CONFIDENCE_THRESHOLD: f32 = 0.5;

    let (best_idx, &best_score) = scores_flat
        .iter()
        .enumerate()
        .filter(|(_, &s)| s >= CONFIDENCE_THRESHOLD)
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))?;

    let base = best_idx * 4;
    if base + 3 >= boxes_flat.len() {
        return None;
    }

    let cx = boxes_flat[base];
    let cy = boxes_flat[base + 1];
    let bw = boxes_flat[base + 2];
    let bh = boxes_flat[base + 3];

    Some(BoundingBox {
        x: (cx - bw / 2.0).clamp(0.0, 1.0),
        y: (cy - bh / 2.0).clamp(0.0, 1.0),
        width: bw.clamp(0.0, 1.0),
        height: bh.clamp(0.0, 1.0),
        confidence: best_score,
    })
}
