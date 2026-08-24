use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub mode: Option<String>,
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
    #[serde(default)]
    pub seek_time_us: u32,
    #[serde(default)]
    pub conversion_time_us: u32,
    #[serde(default)]
    pub upload_time_us: u32,
    #[serde(default)]
    pub present_time_us: u32,
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
            seek_time_us: 0,
            conversion_time_us: 0,
            upload_time_us: 0,
            present_time_us: 0,
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
