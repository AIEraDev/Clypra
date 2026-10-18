use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use crate::audio::decoder::decode_audio_clip;
use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip};
use super::types::NativeAudioClipStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioKeyframe {
    /// Relative clip time in native timeline ticks.
    pub time: i64,
    pub gain: f32,
    pub easing: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NativePcmClip {
    pub id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Arc<[f32]>,
    pub timeline_start_ticks: i64,
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

impl NativePcmClip {
    pub fn status(&self) -> NativeAudioClipStatus {
        NativeAudioClipStatus {
            id: self.id.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels,
            sample_count: self.samples.len(),
            duration_ticks: self.duration_ticks,
            timeline_start_ticks: self.timeline_start_ticks,
            gain: self.gain,
            pan: self.pan,
            fade_in_ticks: self.fade_in_ticks,
            fade_out_ticks: self.fade_out_ticks,
            channel_mode: self.channel_mode.clone(),
            downmix: self.downmix.clone(),
            channel_map: self.channel_map.clone(),
            preserve_pitch: self.preserve_pitch,
        }
    }
}

impl From<DecodedAudioClip> for NativePcmClip {
    fn from(clip: DecodedAudioClip) -> Self {
        Self {
            id: clip.config.id,
            sample_rate: clip.sample_rate,
            channels: clip.channels,
            samples: clip.samples,
            timeline_start_ticks: clip.config.timeline_start_ticks,
            duration_ticks: clip.config.duration_ticks,
            gain: clip.config.gain,
            pan: 0.0,
            fade_in_ticks: clip.config.fade_in_ticks,
            fade_out_ticks: clip.config.fade_out_ticks,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        }
    }
}

impl From<NativePcmClip> for DecodedAudioClip {
    fn from(clip: NativePcmClip) -> Self {
        Self {
            config: AudioClipConfig {
                id: clip.id,
                path: String::new(),
                timeline_start_ticks: clip.timeline_start_ticks,
                source_start_ticks: 0,
                duration_ticks: clip.duration_ticks,
                gain: clip.gain,
                fade_in_ticks: clip.fade_in_ticks,
                fade_out_ticks: clip.fade_out_ticks,
                track_id: None,
            },
            sample_rate: clip.sample_rate,
            channels: clip.channels,
            samples: clip.samples,
        }
    }
}


/// Decodes an audio clip file into a `NativePcmClip` using the high-performance
/// format-agnostic audio decoder.
pub async fn decode_native_audio_clip(
    path: &Path,
    clip_id: String,
    timeline_start_ticks: i64,
    source_start_ticks: i64,
    duration_ticks: i64,
    gain: f32,
    pan: f32,
    fade_in_ticks: i64,
    fade_out_ticks: i64,
    fade_in_curve: String,
    fade_out_curve: String,
    volume_keyframes: Vec<NativeAudioKeyframe>,
    channel_mode: String,
    downmix: String,
    channel_map: Option<Vec<usize>>,
    preserve_pitch: bool,
    sample_rate: u32,
    channels: u16,
) -> Result<NativePcmClip, String> {
    let config = AudioClipConfig {
        id: clip_id.clone(),
        path: path.to_string_lossy().to_string(),
        timeline_start_ticks,
        source_start_ticks,
        duration_ticks,
        gain: gain.clamp(0.0, 4.0),
        fade_in_ticks: fade_in_ticks.max(0),
        fade_out_ticks: fade_out_ticks.max(0),
        track_id: None,
    };

    // Decode into the requested working layout, not blindly into the device
    // layout. This makes explicit mono/stereo downmix deterministic before the
    // real-time channel matrix is applied.
    let decode_channels = if channel_mode == "mono" || downmix == "mono" {
        1
    } else if channel_mode == "stereo" || downmix == "stereo" {
        2
    } else {
        channels
    };
    let decoded = decode_audio_clip(path, config, sample_rate, decode_channels)
        .await
        .map_err(|error| {
            log::warn!(
                "[NativeAudio] Audio decoding failed for clip {}: {} (path: {:?})",
                clip_id,
                error,
                path
            );
            error.to_string()
        })?;
    let mut native: NativePcmClip = decoded.into();
    native.pan = pan.clamp(-1.0, 1.0);
    native.fade_in_curve = fade_in_curve;
    native.fade_out_curve = fade_out_curve;
    native.volume_keyframes = volume_keyframes;
    native.volume_keyframes.sort_by_key(|point| point.time);
    native.channel_mode = match channel_mode.as_str() {
        "mono" | "stereo" | "multichannel" => channel_mode,
        _ => "auto".to_string(),
    };
    native.downmix = match downmix.as_str() {
        "mono" | "stereo" => downmix,
        _ => "auto".to_string(),
    };
    native.channel_map = channel_map.filter(|map| !map.is_empty());
    native.preserve_pitch = preserve_pitch;
    Ok(native)
}

