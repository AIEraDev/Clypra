use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Preview interaction modes used by the native performance diagnostics.
/// Unknown or non-preview request modes remain representable as `None` on a
/// sample so legacy callers cannot accidentally enter the wrong bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewMode {
    Playback,
    PlaybackLookahead,
    Seek,
    Scrub,
    FrameStep,
    Prefetch,
}

impl PreviewMode {
    pub fn from_request_mode(mode: Option<&str>) -> Option<Self> {
        match mode {
            Some("playback") => Some(Self::Playback),
            Some("playback-lookahead") => Some(Self::PlaybackLookahead),
            Some("seek") => Some(Self::Seek),
            Some("scrub") => Some(Self::Scrub),
            Some("frameStep") | Some("frame-step") => Some(Self::FrameStep),
            Some("prefetch") => Some(Self::Prefetch),
            _ => None,
        }
    }
}

/// Records how a frame request was satisfied so reports can distinguish
/// true decode work from cache or in-place reuse.
///
/// Serialised as kebab-case strings so they are readable in JSON reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServedFrom {
    /// FFmpeg decoded at least one packet during this request.
    DecodedInRequest,
    /// Frame was returned from the ready-frame ring-buffer or last-frame slot
    /// without issuing any new FFmpeg decode call.
    ReadyCache,
    /// `decide_decoder_action` returned `ReuseCurrent`; the frame at
    /// `current_pts` (which may be slightly ahead of `target_pts` by up to
    /// one frame duration) was returned without decoding or seeking.
    ReusedCurrent,
    /// Consumer short-circuit: the current playback frame is identical to the
    /// last delivered one (same generation, frame_index, dimensions, and layer
    /// composition). A 12-byte `UNCH` sentinel was returned instead of RGBA
    /// bytes; the frontend retained the existing canvas content without calling
    /// `putImageData`.
    UnchangedSkipped,
}

/// Runtime limits used to protect the fast editing path during migration.
/// Durations are integer microseconds; timestamps remain governed by FrameTime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceBudget {
    pub target_fps: u32,
    pub max_frame_render_time_us: u32,
    pub max_seek_latency_ms: u32,
    pub max_cpu_bridge_bytes_per_second: u64,
    pub max_cache_bytes: u64,
}

impl Default for PerformanceBudget {
    fn default() -> Self {
        Self {
            target_fps: 60,
            max_frame_render_time_us: 16_667,
            max_seek_latency_ms: 100,
            // This is a guardrail for paused-frame transport, never a playback
            // target. Native playback must use a surface/shared texture path.
            max_cpu_bridge_bytes_per_second: 500_000_000,
            max_cache_bytes: 1_073_741_824,
        }
    }
}

impl PerformanceBudget {
    pub fn validate(&self) -> Result<(), String> {
        if self.target_fps == 0 {
            return Err("Performance budget target_fps must be non-zero".to_string());
        }
        if self.max_frame_render_time_us == 0
            || self.max_seek_latency_ms == 0
            || self.max_cpu_bridge_bytes_per_second == 0
            || self.max_cache_bytes == 0
        {
            return Err("Performance budget limits must be non-zero".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSample {
    pub request_id: String,
    pub frame_index: u64,
    pub decode_time_us: u32,
    pub compose_time_us: u32,
    pub readback_time_us: u32,
    pub total_time_us: u32,
    pub bytes_transferred: u64,
    pub cache_hit: bool,
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub mode: Option<PreviewMode>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub strategy: Option<String>,
    /// Transfer path for this frame: `dxgi-zero-copy`, `cpu-nv12`,
    /// `cpu-rgba`, `mixed`, or `gpu-raster`. This is separate from the
    /// scheduling strategy so fleet analysis can isolate copy pressure.
    #[serde(default)]
    pub transfer_path: Option<String>,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub dropped: bool,
    /// Stable drop classification used by the performance API. This is kept
    /// separate from the boolean so stale, cancelled, and audio-late frames
    /// can be diagnosed without mixing their percentiles.
    #[serde(default)]
    pub drop_reason: Option<String>,
    #[serde(default)]
    pub seek_time_us: u32,
    #[serde(default)]
    pub conversion_time_us: u32,
    #[serde(default)]
    pub upload_time_us: u32,
    #[serde(default)]
    pub present_time_us: u32,
    /// Optional phase timings that are only meaningful on the path where the
    /// corresponding phase exists. `None` is different from a measured zero.
    #[serde(default)]
    pub decode_us: Option<u64>,
    #[serde(default)]
    pub conversion_upload_us: Option<u64>,
    #[serde(default)]
    pub compose_us: Option<u64>,
    #[serde(default)]
    pub readback_us: Option<u64>,
    /// CPU-side bracket from texture-copy submission to map_async completion.
    /// `timestamp_query_available` states whether this is a GPU timestamp or
    /// the portable (coarse) CPU bracket used on older adapters.
    #[serde(default)]
    pub map_wait_us: Option<u64>,
    #[serde(default)]
    pub timestamp_query_available: Option<bool>,
    #[serde(default)]
    pub present_us: Option<u64>,
    #[serde(default)]
    pub scheduler_wait_us: Option<u64>,
    /// Time spent waiting for an in-flight lookahead decode before the
    /// presentation path falls back to a cold decode.
    #[serde(default)]
    pub lookahead_wait_us: Option<u64>,
    /// One-time initialization work observed on a visible presentation path,
    /// such as waiting for pipeline warmup or creating a new compositor graph.
    #[serde(default)]
    pub cold_start_init_us: Option<u64>,
    /// Time a fully decoded lookahead frame spent waiting in the preview queue
    /// before presentation. This is distinct from lock/scheduler contention.
    #[serde(default)]
    pub queue_residency_us: Option<u64>,
    #[serde(default)]
    pub ipc_wait_us: Option<u64>,
    #[serde(default)]
    pub decoder_mutex_wait_us: Option<u64>,
    /// Time spent waiting on the StreamDecoderActor for a frame.
    /// When prime cache hits, this is nearly zero (<10µs).
    #[serde(default)]
    pub actor_wait_us: Option<u64>,
    #[serde(default)]
    pub gpu_queue_wait_us: Option<u64>,
    #[serde(default)]
    pub surface_acquire_us: Option<u64>,
    #[serde(default)]
    pub submit_present_us: Option<u64>,
    /// Hardware decode capability policy selected by the session-start probe.
    /// Repeated on native samples so adaptive telemetry sampling preserves the
    /// session decision. One of `"full"`, `"reduced"`, or `"proxy"`.
    #[serde(default)]
    pub capability_policy: Option<String>,
    /// Wall-clock duration of the capability probe keyframe decode, in
    /// microseconds. Repeated alongside `capability_policy`; absent when the
    /// first video layer has no renderable frames at `time_secs = 0.0`.
    #[serde(default)]
    pub capability_probe_us: Option<u64>,
    /// Time spent demuxing packets from container and file I/O (Option 3).
    #[serde(default)]
    pub demux_wait_us: Option<u64>,
    /// Container format name (e.g. "mp4", "matroska,webm", "mov").
    #[serde(default)]
    pub container_format: Option<String>,
    /// Whether hardware decoding acceleration is active for the frame stream.
    #[serde(default)]
    pub is_hardware_accelerated: Option<bool>,
    /// Number of container seeks performed to satisfy this decode request.
    /// Playback should normally remain at zero after its initial warm-up.
    #[serde(default)]
    pub decoder_seek_count: Option<u32>,
    /// Frames emitted by the decoder while resolving this request. Comparing
    /// this with delivered frames exposes GOP re-decode amplification.
    #[serde(default)]
    pub decoder_frames_decoded: Option<u32>,
    /// CPU transfer time for a hardware-decoded frame, when that frame had to
    /// be downloaded before preview conversion.
    #[serde(default)]
    pub hardware_frame_download_us: Option<u64>,
    /// CPU scale / colorspace conversion to preview NV12 planes. This is kept
    /// separate from packet decode and GPU upload.
    #[serde(default)]
    pub scale_colorspace_us: Option<u64>,
    /// Source media facts needed to interpret a decode measurement.
    #[serde(default)]
    pub source_width: Option<u32>,
    #[serde(default)]
    pub source_height: Option<u32>,
    #[serde(default)]
    pub source_bits_per_raw_sample: Option<u8>,
    #[serde(default)]
    /// Source average frame rate multiplied by 1,000 to preserve common
    /// fractional rates while keeping the sample comparable/Eq-friendly.
    pub source_frame_rate_milli: Option<u32>,
    /// Microseconds within the request lifecycle not accounted for by explicitly
    /// measured stages (such as session mutex contention or task scheduling).
    #[serde(default)]
    pub unaccounted_us: Option<u64>,
    /// Stream codec name (e.g. "h264", "hevc", "vp9", "av1").
    #[serde(default)]
    pub codec_name: Option<String>,
    /// Number of hardware textures downloaded from GPU memory to CPU RAM.
    #[serde(default)]
    pub hardware_frames_downloaded: Option<u32>,
    /// Microseconds where the sum of component stages exceeds total request time,
    /// indicating overlapping execution or double-counting.
    #[serde(default)]
    pub stage_overlap_us: Option<u64>,
    /// How this request was satisfied: decoded in-request, from the ready-frame
    /// ring-buffer / last-frame cache, or by reusing the current decoder position.
    /// `None` on legacy samples that predate this field.
    #[serde(default)]
    pub served_from: Option<ServedFrom>,
    /// Microseconds spent waiting for the NativeFrameService / cache lock.
    #[serde(default)]
    pub cache_lock_wait_us: Option<u64>,
    /// Microseconds spent inserting/storing into the NativeFrameService cache.
    #[serde(default)]
    pub cache_insert_us: Option<u64>,
    /// Hardware acceleration device backend type (e.g. "d3d11va", "videotoolbox", "vaapi", "software").
    #[serde(default)]
    pub hw_device_type: Option<String>,
}

impl PerformanceSample {
    pub fn exceeds_render_budget(&self, budget: &PerformanceBudget) -> bool {
        self.total_time_us > budget.max_frame_render_time_us
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFrameServiceStats {
    pub total_requests: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cached_entries: usize,
    pub cached_bytes: usize,
    pub cache_budget_bytes: usize,
    pub cache_eviction_count: u64,
    pub cache_rejected_entry_count: u64,
    pub last_sample: Option<PerformanceSample>,
    /// Monotonically increases for every newly recorded sample. Consumers
    /// polling stats can use this cursor to avoid reporting the same sample
    /// repeatedly while the editor is idle.
    #[serde(default)]
    pub last_sample_sequence: u64,
    #[serde(default)]
    pub window_started_at_ms: u64,
    #[serde(default)]
    pub window_request_count: u64,
    #[serde(default)]
    pub window_dropped_frames: u64,
    #[serde(default)]
    pub window_stale_frames: u64,
    #[serde(default)]
    pub window_cancelled_frames: u64,
    #[serde(default)]
    pub window_seek_p50_ms: Option<f64>,
    #[serde(default)]
    pub window_seek_p95_ms: Option<f64>,
    #[serde(default)]
    pub window_seek_p99_ms: Option<f64>,
    #[serde(default)]
    pub window_cache_hit_rate: f64,
    #[serde(default)]
    pub mode_stats: Vec<ModeStats>,
    /// Lifetime hits on the VRAM SDF text layer cache since process start.
    /// Kept separate from `cache_hits` (which measures frame-level render cache hits)
    /// to avoid skewing decode/composition telemetry. Expected to be 0 for projects
    /// that only use Canvas 2D / worker text rasterization.
    #[serde(default)]
    pub text_layer_cache_hits: u64,
    /// Lifetime hits on the native SDF glyph cache since process start.
    #[serde(default)]
    pub glyph_cache_hits: u64,
    /// Lifetime misses on the native SDF glyph cache since process start.
    #[serde(default)]
    pub glyph_cache_misses: u64,
    /// Number of times schedule_lookahead_predecode was called (PR4 instrumentation).
    #[serde(default)]
    pub lookahead_trigger_count: u64,
    /// Number of triggers dropped by the in-flight guard (demand-trigger diagnosis).
    #[serde(default)]
    pub lookahead_trigger_dropped: u64,
    /// Total producer idle time in ms (gap between finishing one prime and starting next).
    #[serde(default)]
    pub producer_idle_total_ms: f64,
    /// Most recent "ahead of audio clock" value in ms (positive = producer is ahead).
    #[serde(default)]
    pub producer_ahead_of_clock_ms: f64,
}

// ── PR4: Producer trigger instrumentation ──────────────────────────────────────
// These atomics diagnose why the producer runs at ~1/3 capacity.
// The hypothesis: schedule_lookahead_predecode triggers are frequently dropped
// by the in-flight guard, so effective trigger rate << producer capacity.

static LOOKAHEAD_TRIGGER_COUNT: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static LOOKAHEAD_TRIGGER_DROPPED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static PRODUCER_IDLE_TOTAL_US: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static PRODUCER_AHEAD_OF_CLOCK_MS_MILLI: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);

pub fn lookahead_trigger_count() -> u64 {
    LOOKAHEAD_TRIGGER_COUNT.load(std::sync::atomic::Ordering::Relaxed)
}
pub fn lookahead_trigger_dropped() -> u64 {
    LOOKAHEAD_TRIGGER_DROPPED.load(std::sync::atomic::Ordering::Relaxed)
}
pub fn producer_idle_total_ms() -> f64 {
    PRODUCER_IDLE_TOTAL_US.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1_000.0
}
pub fn producer_ahead_of_clock_ms() -> f64 {
    PRODUCER_AHEAD_OF_CLOCK_MS_MILLI.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1_000.0
}
pub fn record_lookahead_trigger() {
    LOOKAHEAD_TRIGGER_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}
pub fn record_lookahead_trigger_dropped() {
    LOOKAHEAD_TRIGGER_DROPPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}
pub fn record_producer_idle_us(us: u64) {
    PRODUCER_IDLE_TOTAL_US.fetch_add(us, std::sync::atomic::Ordering::Relaxed);
}
pub fn record_producer_ahead_of_clock_ms(ms: f64) {
    PRODUCER_AHEAD_OF_CLOCK_MS_MILLI.store(
        (ms * 1_000.0) as i64,
        std::sync::atomic::Ordering::Relaxed,
    );
}

// ── Text & Glyph Cache Telemetry Instrumentation ──────────────────────────────
static TEXT_LAYER_CACHE_HITS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static TEXT_LAYER_CACHE_MISSES: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static GLYPH_CACHE_HITS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

static GLYPH_CACHE_MISSES: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub fn text_layer_cache_hits() -> u64 {
    TEXT_LAYER_CACHE_HITS.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn text_layer_cache_misses() -> u64 {
    TEXT_LAYER_CACHE_MISSES.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn glyph_cache_hits() -> u64 {
    GLYPH_CACHE_HITS.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn glyph_cache_misses() -> u64 {
    GLYPH_CACHE_MISSES.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn record_text_layer_cache_hit() {
    TEXT_LAYER_CACHE_HITS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

pub fn record_text_layer_cache_miss() {
    TEXT_LAYER_CACHE_MISSES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

pub fn record_glyph_cache_hit() {
    GLYPH_CACHE_HITS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

pub fn record_glyph_cache_miss() {
    GLYPH_CACHE_MISSES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}


/// A cursor-bounded batch of native samples. The cursor belongs to the
/// service, not to the UI, so polling this endpoint never records a new
/// measurement and an idle editor cannot duplicate the last frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePerformanceSampleBatch {
    pub samples: Vec<PerformanceSample>,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub next_sequence: u64,
    pub oldest_sequence: u64,
    pub latest_sequence: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagePercentiles {
    pub p50: Option<u64>,
    pub p95: Option<u64>,
    pub p99: Option<u64>,
    pub sample_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeStats {
    pub mode: PreviewMode,
    pub decode: StagePercentiles,
    pub packet_decode: StagePercentiles,
    pub conversion_upload: StagePercentiles,
    pub compose: StagePercentiles,
    pub readback: StagePercentiles,
    /// Submit-to-map_async-complete CPU bracket; see sample metadata for
    /// whether a true GPU timestamp query was available.
    pub map_wait: StagePercentiles,
    pub present: StagePercentiles,
    pub scheduler_wait: StagePercentiles,
    pub lookahead_wait: StagePercentiles,
    pub cold_start_init: StagePercentiles,
    pub queue_residency: StagePercentiles,
    pub ipc_wait: StagePercentiles,
    pub decoder_mutex_wait: StagePercentiles,
    pub demux_wait: StagePercentiles,
    /// Actual container seeks per decoded frame request. Steady playback
    /// should approach zero once the decoder is warm.
    pub decoder_seek_count: StagePercentiles,
    /// Decoder output-frame count per request; values above one reveal GOP
    /// amplification rather than a simple presentation-rate problem.
    pub decoder_frames_decoded: StagePercentiles,
    pub hardware_frame_download: StagePercentiles,
    pub scale_colorspace: StagePercentiles,
    pub gpu_queue_wait: StagePercentiles,
    pub surface_acquire: StagePercentiles,
    pub submit_present: StagePercentiles,
    pub stage_overlap: StagePercentiles,
    /// Microseconds within each invoke not attributed to any measured stage.
    /// A persistently large value here points to OS scheduling, mutex wait, or
    /// Tauri/IPC serialization overhead that the individual stage timers miss.
    pub unaccounted: StagePercentiles,
    /// Mutex lock acquisition duration for the frame service / cache.
    pub cache_lock_wait: StagePercentiles,
    /// Time spent inserting the rendered packet into the frame cache.
    pub cache_insert: StagePercentiles,
    pub unique_frames_delivered: usize,
    pub repeated_frames_delivered: usize,
    pub delivered_unique_fps: Option<f64>,
    pub served_from_decoded_count: usize,
    pub served_from_ready_cache_count: usize,
    pub served_from_reused_current_count: usize,
    /// Playback frames that were identical to the last delivered frame and were
    /// returned as a 12-byte UNCH sentinel. The frontend retained the existing
    /// canvas content without calling `putImageData`.
    pub skipped_unchanged_count: usize,
    /// Lookahead frames decoded on GPU without host CPU transfer (Arm 2b).
    pub lookahead_downloads_skipped_count: usize,
    pub downloads_wasted_count: usize,
    #[serde(default)]
    pub window_source: String,
    #[serde(default)]
    pub sample_span_ms: Option<u64>,
    pub dropped_count: usize,
    pub stale_count: usize,
}

pub(crate) fn optional_stage_percentiles(
    samples: &[PerformanceSample],
    pick: impl Fn(&PerformanceSample) -> Option<u64>,
) -> StagePercentiles {
    let mut values: Vec<u64> = samples.iter().filter_map(pick).collect();
    values.sort_unstable();
    let percentile = |pct: f64| -> Option<u64> {
        if values.is_empty() {
            return None;
        }
        let index = ((values.len() - 1) as f64 * pct).round() as usize;
        values.get(index).copied()
    };
    StagePercentiles {
        p50: percentile(0.50),
        p95: percentile(0.95),
        p99: percentile(0.99),
        sample_count: values.len(),
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

pub fn percentile_ms(samples: &mut [u32], percentile: f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    samples.sort_unstable();
    let index = ((samples.len() - 1) as f64 * percentile).round() as usize;
    samples.get(index).map(|value| *value as f64 / 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_budget_matches_60_fps_editing_target() {
        let budget = PerformanceBudget::default();
        budget.validate().unwrap();
        assert_eq!(budget.target_fps, 60);
        assert_eq!(budget.max_frame_render_time_us, 16_667);
    }

    #[test]
    fn sample_flags_only_render_budget_overruns() {
        let budget = PerformanceBudget::default();
        let sample = PerformanceSample {
            request_id: "request-1".to_string(),
            frame_index: 3,
            decode_time_us: 1_000,
            compose_time_us: 1_000,
            readback_time_us: 15_000,
            total_time_us: 17_000,
            bytes_transferred: 1_024,
            cache_hit: false,
            generation: None,
            mode: None,
            quality: None,
            strategy: None,
            transfer_path: None,
            cancelled: false,
            stale: false,
            dropped: false,
            drop_reason: None,
            seek_time_us: 0,
            conversion_time_us: 0,
            upload_time_us: 0,
            present_time_us: 0,
            decode_us: None,
            conversion_upload_us: None,
            compose_us: None,
            readback_us: None,
            map_wait_us: None,
            timestamp_query_available: None,
            present_us: None,
            scheduler_wait_us: None,
            lookahead_wait_us: None,
            cold_start_init_us: None,
            queue_residency_us: None,
            ipc_wait_us: None,
            decoder_mutex_wait_us: None,
            actor_wait_us: None,
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: None,
            capability_policy: None,
            capability_probe_us: None,
            demux_wait_us: None,
            container_format: None,
            is_hardware_accelerated: None,
            decoder_seek_count: None,
            decoder_frames_decoded: None,
            hardware_frame_download_us: None,
            scale_colorspace_us: None,
            source_width: None,
            source_height: None,
            source_bits_per_raw_sample: None,
            source_frame_rate_milli: None,
            unaccounted_us: None,
            codec_name: None,
            hardware_frames_downloaded: None,
            stage_overlap_us: None,
            served_from: None,
            cache_lock_wait_us: None,
            cache_insert_us: None,
            hw_device_type: None,
        };
        assert!(sample.exceeds_render_budget(&budget));
    }

    #[test]
    fn percentile_metrics_are_sorted_and_reported_in_milliseconds() {
        let mut values = vec![30_000, 10_000, 20_000];
        assert_eq!(percentile_ms(&mut values, 0.50), Some(20.0));
        assert_eq!(percentile_ms(&mut [], 0.95), None);
    }
}
