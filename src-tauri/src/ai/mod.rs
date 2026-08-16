//! AI inference subsystem for Clypra.
//!
//! Provides on-device computer vision via ONNX Runtime:
//! - [`mediapipe_tracker`]: Face/subject detection and tracking for Auto-Reframe
//! - [`model_manager`]: Model download, storage, and SHA-256 integrity verification

pub mod mediapipe_tracker;
pub mod model_manager;
