use serde::{Deserialize, Serialize};

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
}

impl PerformanceSample {
    pub fn exceeds_render_budget(&self, budget: &PerformanceBudget) -> bool {
        self.total_time_us > budget.max_frame_render_time_us
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFrameServiceStats {
    pub total_requests: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cached_entries: usize,
    pub cached_bytes: usize,
    pub last_sample: Option<PerformanceSample>,
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
        };
        assert!(sample.exceeds_render_budget(&budget));
    }
}
