use crate::native_audio::NativeAudioKeyframe;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipFailure {
    pub clip_id: String,
    pub path: String,
    pub error: String,
    pub is_cap_exceeded: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipRequest {
    pub path: String,
    pub clip_id: String,
    pub timeline_start_ticks: i64,
    pub source_start_ticks: i64,
    pub duration_ticks: i64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub fade_in_curve: String,
    pub fade_out_curve: String,
    pub volume_keyframes: Vec<NativeAudioKeyframe>,
    pub channel_mode: String,
    pub downmix: String,
    pub channel_map: Option<Vec<usize>>,
    pub preserve_pitch: bool,
}

/// A single entry in a batched parameter-only update request (CLY-BUG-023).
/// Used by `update_native_audio_clip_parameters_batch` to flush all in-flight
/// parameter changes for N clips in a single Tauri IPC invocation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipParameterUpdate {
    pub clip_id: String,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub fade_in_curve: String,
    pub fade_out_curve: String,
    pub volume_keyframes: Vec<NativeAudioKeyframe>,
}
