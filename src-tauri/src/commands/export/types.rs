use serde::{Deserialize, Serialize};

/// Timing breakdown returned by `finalize_video_export`.
///
/// All duration fields are in **milliseconds** so the TypeScript layer can
/// feed them directly into `telemetryCollector.recordExportSpan` without
/// unit conversion gymnastics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTimings {
    /// Wall-clock time from `start_video_export` to FFmpeg process exit (ms).
    pub total_export_ms: f64,
    /// Time from closing stdin (all frames written) to FFmpeg process exit.
    /// This is the pure FFmpeg encode/mux time with no frame rendering in it.
    pub ffmpeg_finalize_ms: f64,
    /// Mean per-frame stdin write latency over the last ≤60 frames (ms).
    /// Represents the render→pipe transfer cost on the TS/Rust boundary.
    pub avg_frame_write_ms: f64,
    /// p95 per-frame stdin write latency (ms). High values indicate
    /// scheduling jitter or pipe backpressure from a slow encoder.
    pub p95_frame_write_ms: f64,
    /// Number of frames written to the encoder (may differ from
    /// `total_frames` if the export was cancelled partway through).
    pub frames_written: u32,
    /// Number of terminal source-decode misses recovered by repeating the
    /// most recently composited frame. A non-zero value means the export
    /// completed, but an input stream ended before its declared duration.
    pub source_eof_fallback_frames: u32,
}

/// Export progress update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    /// Current frame number
    pub current_frame: u32,

    /// Total frames to export
    pub total_frames: u32,

    /// Progress (0.0 - 1.0)
    pub progress: f64,

    /// Estimated time remaining in seconds
    pub eta_seconds: f64,

    /// Current FPS (frames per second)
    pub fps: f64,

    /// Real-time factor (e.g. 2.5 = 2.5x real time speed)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtf: Option<f64>,
}

/// Audio clip configuration for mixing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudioClip {
    /// Absolute local file path
    pub path: String,

    /// Start time in seconds (relative to the export video start)
    pub start_time: f64,

    /// Duration in seconds to play
    pub duration: f64,

    /// Trim in offset in seconds inside the source media file
    pub trim_in: f64,

    /// Volume multiplier (0.0-1.0)
    /// This prevents precision loss during serialization round-trips
    pub volume: f64,

    /// Fade-in duration in seconds
    pub fade_in: Option<f64>,

    /// Fade-out duration in seconds
    pub fade_out: Option<f64>,

    /// Fade-in curve profile ("linear", "exponential", "logarithmic", "s-curve")
    pub fade_in_curve: Option<String>,

    /// Fade-out curve profile ("linear", "exponential", "logarithmic", "s-curve")
    pub fade_out_curve: Option<String>,

    /// Stereo pan (-1.0 to 1.0)
    pub pan: Option<f64>,

    /// Equalizer low gain (dB)
    pub eq_low: Option<f64>,

    /// Equalizer mid gain (dB)
    pub eq_mid: Option<f64>,

    /// Equalizer high gain (dB)
    pub eq_high: Option<f64>,

    /// Noise suppression level (0.0 to 1.0)
    pub noise_suppression: Option<f64>,

    /// Volume automation points rebased to this exported clip slice.
    pub volume_keyframes: Option<Vec<ExportAudioKeyframe>>,

    /// Explicit source-channel handling shared with preview.
    pub channel_mode: Option<String>,
    pub downmix: Option<String>,
    pub channel_map: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudioKeyframe {
    pub time: f64,
    pub gain: f64,
    pub easing: Option<String>,
}

/// Export configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    /// Output file path
    pub output_path: String,

    /// Video width
    pub width: u32,

    /// Video height
    pub height: u32,

    /// Frame rate
    pub frame_rate: f64,

    /// Total frames to export
    pub total_frames: u32,

    /// Video codec (h264, h265, prores)
    pub codec: String,

    /// Quality preset (ultrafast, fast, medium, slow, veryslow)
    pub preset: String,

    /// CRF quality (0-51, lower = better quality)
    pub crf: u32,

    /// Pixel format (yuv420p, yuv444p)
    pub pixel_format: String,

    /// Audio clips to mix
    pub audio_clips: Option<Vec<ExportAudioClip>>,
}

