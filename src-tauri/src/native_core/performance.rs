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
    #[serde(default)]
    pub present_us: Option<u64>,
    #[serde(default)]
    pub scheduler_wait_us: Option<u64>,
    #[serde(default)]
    pub ipc_wait_us: Option<u64>,
    #[serde(default)]
    pub decoder_mutex_wait_us: Option<u64>,
    #[serde(default)]
    pub gpu_queue_wait_us: Option<u64>,
    #[serde(default)]
    pub surface_acquire_us: Option<u64>,
    #[serde(default)]
    pub submit_present_us: Option<u64>,
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
    /// Hits on the VRAM SDF text layer cache. Kept separate from `cache_hits`
    /// (which measures frame-level render cache hits) to avoid skewing
    /// decode/composition telemetry. A static text layer that is never
    /// re-rendered should contribute here, not to `cache_hits`.
    #[serde(default)]
    pub text_layer_cache_hits: u64,
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
    pub conversion_upload: StagePercentiles,
    pub compose: StagePercentiles,
    pub readback: StagePercentiles,
    pub present: StagePercentiles,
    pub scheduler_wait: StagePercentiles,
    pub ipc_wait: StagePercentiles,
    pub decoder_mutex_wait: StagePercentiles,
    pub gpu_queue_wait: StagePercentiles,
    pub surface_acquire: StagePercentiles,
    pub submit_present: StagePercentiles,
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
            present_us: None,
            scheduler_wait_us: None,
            ipc_wait_us: None,
            decoder_mutex_wait_us: None,
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: None,
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
