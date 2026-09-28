//! QoS Telemetry and Explainable Diagnostic Logging
//!
//! Formats human-readable diagnostics and structured metrics explaining
//! exactly why the engine changed render quality, media variants, or effects policies.

use super::controller::QoSTransitionEvent;
use super::metrics::PerformanceWindow;
use super::types::{Bottleneck, QoSDecision};
use serde::{Deserialize, Serialize};

/// Structured, machine-readable telemetry snapshot of the QoS subsystem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QoSTelemetry {
    pub active_decision: QoSDecision,
    pub diagnosed_bottleneck: Bottleneck,
    pub consecutive_unhealthy_windows: usize,
    pub consecutive_healthy_windows: usize,
    pub window_mean_decode_us: u64,
    pub window_mean_gpu_render_us: u64,
    pub window_miss_ratio: f32,
    pub window_pool_utilization: f32,
    pub transition_count: usize,
}

impl QoSTelemetry {
    /// Formats an explainable human-readable diagnostic report.
    pub fn format_report(&self, window: &PerformanceWindow) -> String {
        let decision = &self.active_decision;
        let mut out = String::new();

        out.push_str("QoS Decision\n");
        out.push_str("────────────────────────\n");
        out.push_str(&format!("Media: {:?}\n", decision.media_variant));
        out.push_str(&format!("Render: {:?}\n", decision.render_quality));
        out.push_str(&format!("Effects: {:?}\n", decision.effects_policy));
        out.push_str(&format!(
            "Lookahead Reduction: {:.0}%\n",
            decision.lookahead_reduction * 100.0
        ));
        out.push_str(&format!("Reason: {:?}\n", decision.reason));
        out.push_str(&format!("Confidence: {:.2}\n", decision.confidence));
        out.push_str("────────────────────────\n");
        out.push_str("Performance Window:\n");
        out.push_str(&format!("  Decode Mean: {} us\n", window.mean_decode_us()));
        out.push_str(&format!(
            "  GPU Render Mean: {} us\n",
            window.mean_render_gpu_us()
        ));
        out.push_str(&format!(
            "  Miss Ratio: {:.1}%\n",
            window.deadline_miss_ratio() * 100.0
        ));
        out.push_str(&format!(
            "  Pool Utilization: {:.1}%\n",
            window.peak_pool_utilization() * 100.0
        ));
        out.push_str(&format!(
            "  Ready Queue Depth: {:.1}\n",
            window.mean_ready_queue_depth()
        ));

        out
    }

    /// Formats a single transition event for diagnostic logging.
    pub fn format_transition(event: &QoSTransitionEvent, window: &PerformanceWindow) -> String {
        format!(
            "QoS Transition [{:?}] at {} us\n\
             Quality: {:?} -> {:?}\n\
             Media: {:?} -> {:?}\n\
             Effects: {:?} -> {:?}\n\
             Reason: {:?}\n\
             Window Samples: {}\n\
             Deadline Misses: {} / {}\n\
             GPU Render Mean: {} us\n\
             Decode Mean: {} us\n",
            event.bottleneck,
            event.timestamp.as_micros(),
            event.previous.render_quality,
            event.current.render_quality,
            event.previous.media_variant,
            event.current.media_variant,
            event.previous.effects_policy,
            event.current.effects_policy,
            event.current.reason,
            window.len(),
            window.deadline_miss_count(),
            window.len(),
            window.mean_render_gpu_us(),
            window.mean_decode_us()
        )
    }
}
