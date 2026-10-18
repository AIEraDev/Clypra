use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub const TICKS_PER_SECOND: i64 = 1_000_000;
pub const MAX_PCM_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_MIXER_PCM_BYTES: usize = 2048 * 1024 * 1024;
pub const MAX_ACTIVE_CLIPS: usize = 512;
/// Prepared time-stretched audio is deliberately bounded independently from the
/// source PCM budget. This keeps a speed change safe on lower-memory machines.
pub const MAX_PITCH_CACHE_BYTES: usize = 256 * 1024 * 1024;
/// ~5.8 ms at 44.1 kHz. Applied by the native callback after a transport
/// discontinuity so seeking/replay cannot emit a full-scale sample step.
pub const TRANSPORT_RAMP_FRAMES: u32 = 256;

/// Number of inter-callback interval slots in the lock-free ring buffer.
/// 8 slots × ~11.6 ms (512 frames / 44.1 kHz) ≈ 93 ms of history.
/// Enough to produce a stable median and detect both cold-start and stalls.
/// Must stay small: all slots are written from the real-time audio callback
/// with no lock and no allocation.
pub const INTERVAL_RING_SIZE: usize = 8;

/// Number of buckets in the output-latency log2 histogram.
/// Bucket i covers the half-open interval [2^(i−1), 2^i) µs, with bucket 0
/// covering [0, 1) µs and bucket 15 acting as overflow (≥ 32768 µs ≈ 32 ms).
/// The range captures every expected hardware latency from sub-millisecond
/// (JACK) through high-latency Bluetooth (≈ 200 ms). Written exclusively from
/// the real-time callback with atomic fetch_add (Relaxed). No lock, no alloc.
/// 512 linear 1 ms buckets (0..511 ms) + 1 overflow bucket (≥ 512 ms). Total: 513 buckets (~4 KB).
pub const OUTPUT_LATENCY_HISTOGRAM_BUCKETS: usize = 513;

/// Maps an output latency measurement in microseconds to a bucket index in
/// `OUTPUT_LATENCY_HISTOGRAM_BUCKETS` (0..513).
/// Linear 1 ms resolution:
///   bucket 0   = [0, 1000) µs       (0 ms .. <1 ms)
///   bucket 1   = [1000, 2000) µs    (1 ms .. <2 ms)
///   ...
///   bucket 511 = [511000, 512000) µs (511 ms .. <512 ms)
///   bucket 512 = [512000, ∞) µs      (≥ 512 ms, overflow)
#[inline]
pub fn output_latency_bucket(us: u64) -> usize {
    let ms = us / 1000;
    (ms as usize).min(OUTPUT_LATENCY_HISTOGRAM_BUCKETS - 1)
}

#[derive(Clone)]
pub struct OutputLatencyMetrics {
    pub histogram: Arc<[AtomicU64; OUTPUT_LATENCY_HISTOGRAM_BUCKETS]>,
    pub available: Arc<AtomicBool>,
    pub last_us: Arc<AtomicU64>,
    pub min_us: Arc<AtomicU64>,
    pub max_us: Arc<AtomicU64>,
    pub sum_us: Arc<AtomicU64>,
    pub count: Arc<AtomicU64>,
}

impl Default for OutputLatencyMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputLatencyMetrics {
    pub fn new() -> Self {
        Self {
            histogram: Arc::new(std::array::from_fn(|_| AtomicU64::new(0))),
            available: Arc::new(AtomicBool::new(false)),
            last_us: Arc::new(AtomicU64::new(0)),
            min_us: Arc::new(AtomicU64::new(u64::MAX)),
            max_us: Arc::new(AtomicU64::new(0)),
            sum_us: Arc::new(AtomicU64::new(0)),
            count: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn reset(&self) {
        for slot in self.histogram.iter() {
            slot.store(0, Ordering::Release);
        }
        self.available.store(false, Ordering::Release);
        self.last_us.store(0, Ordering::Release);
        self.min_us.store(u64::MAX, Ordering::Release);
        self.max_us.store(0, Ordering::Release);
        self.sum_us.store(0, Ordering::Release);
        self.count.store(0, Ordering::Release);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
    pub available: bool,
    pub running: bool,
    pub playing: bool,
    pub host: Option<String>,
    pub device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub sample_format: Option<String>,
    pub audio_position_ticks: u64,
    pub callback_count: u64,
    pub rendered_frames: u64,
    pub non_silent_frames: u64,
    pub last_error: Option<String>,
    pub speed: f32,
    pub volume: f32,
    pub muted: bool,
    pub mixer_lock_misses: u64,
    pub callback_time_us: u64,
    pub callback_max_time_us: u64,
    pub callback_over_budget_count: u64,
    /// Total number of `seek()` calls since the stream was last started.
    /// Useful for correlating audio latency spikes with seek activity.
    pub seek_count: u64,
    /// Cumulative seek latency in microseconds since the stream was last
    /// started. Divide by `seek_count` to obtain the mean seek latency.
    pub seek_latency_total_us: u64,
    /// Histogram of `playback − callback` output latency measurements from the
    /// CPAL `OutputCallbackInfo::timestamp()` API. 512 1-ms linear buckets
    /// (0..511 ms) plus 1 overflow bucket (≥ 512 ms).
    /// `None` when no cpal timestamp was available (host does not populate it).
    /// Observation only — no playback behavior is modified.
    pub output_latency_us_histogram: Option<Vec<u64>>,
    /// Most recent `playback − callback` output latency measurement in microseconds.
    pub output_latency_last_us: Option<u64>,
    /// Minimum `playback − callback` output latency measurement in microseconds.
    pub output_latency_min_us: Option<u64>,
    /// Maximum `playback − callback` output latency measurement in microseconds.
    pub output_latency_max_us: Option<u64>,
    /// Cumulative sum of `playback − callback` output latency measurements in microseconds.
    pub output_latency_sum_us: Option<u64>,
    /// Total count of valid `playback − callback` output latency measurements.
    pub output_latency_count: Option<u64>,
    /// Microseconds since the last CPAL callback advanced the audio clock.
    /// `None` if the stream has never fired a callback (clock never started).
    /// Used by A/V drift suppression: when this value exceeds the adaptive
    /// freshness threshold, drift samples are flagged rather than counted as
    /// real synchronization error.
    pub clock_freshness_us: Option<u64>,
    /// Median inter-callback spacing in microseconds, derived from the last
    /// INTERVAL_RING_SIZE callback intervals recorded by the audio thread.
    /// `None` when fewer than 2 callbacks have fired (ring not yet seeded).
    /// This is the value used to compute the adaptive staleness threshold in
    /// `DriftAccumulator::record_with_freshness()` — replaces the previous
    /// lifetime-mean-of-processing-duration that was orders of magnitude
    /// smaller than the actual inter-callback spacing.
    pub median_callback_interval_us: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipStatus {
    pub id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_count: usize,
    pub duration_ticks: i64,
    pub timeline_start_ticks: i64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub channel_mode: String,
    pub downmix: String,
    pub channel_map: Option<Vec<usize>>,
    pub preserve_pitch: bool,
}

/// A point-in-time inspection of the sole native preview audio path.
///
/// This is deliberately derived from the installed native mixer and output
/// clock rather than maintaining a second diagnostic model. It lets the UI
/// distinguish timeline/decode silence from a callback or device-output
/// failure without changing the production playback path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioDiagnostics {
    pub status: NativeAudioStatus,
    pub installed_clips: Vec<NativeAudioClipStatus>,
    pub active_clip_ids: Vec<String>,
    /// Peak amplitude the native mixer would render in its next 20 ms window.
    pub mixer_peak: f32,
    /// Per-clip evidence from that same mixer window. This distinguishes a
    /// silent decode/envelope from a clip that was never installed or active.
    pub clip_diagnostics: Vec<NativeAudioClipDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipDiagnostic {
    pub id: String,
    pub active: bool,
    pub mixer_peak: f32,
}

#[derive(Debug, Default)]
pub struct NativeAudioMixerInspection {
    pub active_clip_ids: Vec<String>,
    pub mixer_peak: f32,
    pub clip_diagnostics: Vec<NativeAudioClipDiagnostic>,
}

