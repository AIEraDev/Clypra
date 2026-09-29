//! Quality of Service (QoS) Controller
//!
//! Evaluates rolling performance windows, diagnoses bottlenecks, enforces
//! asymmetric hysteresis (M > N), selects independent render/media/effects policies,
//! and orchestrates safe frame-boundary proxy transitions.

use super::super::state_machine::PlaybackMode;
use super::super::types::MediaTime;
use super::metrics::{PerformanceSnapshot, PerformanceWindow};
use super::proxy_manager::AsyncProxyManager;
use super::types::{
    Bottleneck, EffectsPolicy, MediaVariant, PerformanceEnvelope, PlaybackPolicySnapshot,
    QoSDecision, QoSReason, RenderQuality,
};

/// Configuration thresholds for the QoS Controller.
#[derive(Debug, Clone)]
pub struct QoSConfig {
    /// Number of consecutive unhealthy windows required to trigger quality degradation (N)
    pub degrade_window_threshold: usize,
    /// Number of consecutive healthy windows required to trigger quality recovery (M, where M > N)
    pub recover_window_threshold: usize,
    /// Target timeline framerate
    pub target_fps: f64,
    /// Rolling window sample capacity (frames)
    pub window_capacity: usize,
}

impl Default for QoSConfig {
    fn default() -> Self {
        Self {
            degrade_window_threshold: 3,
            recover_window_threshold: 8,
            target_fps: 60.0,
            window_capacity: 15, // ~250ms at 60 FPS
        }
    }
}

/// Transition event logged when QoS decision changes.
#[derive(Debug, Clone, PartialEq)]
pub struct QoSTransitionEvent {
    pub previous: QoSDecision,
    pub current: QoSDecision,
    pub timestamp: MediaTime,
    pub bottleneck: Bottleneck,
}

/// Authoritative QoS Controller of the Real-Time Media Engine.
pub struct QoSController {
    config: QoSConfig,
    window: PerformanceWindow,
    current_decision: QoSDecision,
    consecutive_unhealthy_windows: usize,
    consecutive_healthy_windows: usize,
    last_diagnosed_bottleneck: Bottleneck,
    transition_history: Vec<QoSTransitionEvent>,
    /// Number of newly recorded frames since the last control-loop decision.
    /// A rolling window must not be re-evaluated for every overlapping frame:
    /// doing so turns a 250 ms observation window into a 16 ms oscillator.
    samples_since_evaluation: usize,
    pending_paused_upgrade: bool,
    manual_override: Option<QoSDecision>,
}

impl QoSController {
    pub fn new(config: QoSConfig) -> Self {
        let window = PerformanceWindow::new(config.window_capacity, config.target_fps);
        Self {
            config,
            window,
            current_decision: QoSDecision::default(),
            consecutive_unhealthy_windows: 0,
            consecutive_healthy_windows: 0,
            last_diagnosed_bottleneck: Bottleneck::None,
            transition_history: Vec::new(),
            samples_since_evaluation: 0,
            pending_paused_upgrade: false,
            manual_override: None,
        }
    }

    /// Current active QoS decision.
    #[inline]
    pub fn current_decision(&self) -> &QoSDecision {
        if let Some(ref ov) = self.manual_override {
            ov
        } else {
            &self.current_decision
        }
    }

    /// Records a new frame performance snapshot and updates rolling window.
    pub fn record_frame_snapshot(&mut self, snapshot: PerformanceSnapshot) {
        self.window.push(snapshot);
        self.samples_since_evaluation = self.samples_since_evaluation.saturating_add(1);
    }

    /// Starts a fresh transport observation period. Metrics collected before a
    /// pause, seek, or device restart cannot describe the next playback run.
    pub fn begin_transport(&mut self) {
        self.window.clear();
        self.samples_since_evaluation = 0;
        self.consecutive_unhealthy_windows = 0;
        self.consecutive_healthy_windows = 0;
        self.last_diagnosed_bottleneck = Bottleneck::None;
        self.current_decision = QoSDecision::default();
    }

    /// Evaluates the current performance window and updates QoS state.
    /// Called periodically at the end of each measurement window (every 250–500 ms)
    /// or when playback mode transitions.
    pub fn evaluate_window(
        &mut self,
        current_mode: PlaybackMode,
        current_pts: MediaTime,
        proxy_manager: &AsyncProxyManager,
        active_asset_id: Option<&str>,
    ) -> QoSDecision {
        if let Some(ref ov) = self.manual_override {
            return ov.clone();
        }

        // 1. Interaction-Mode Specific Policies
        match current_mode {
            PlaybackMode::Scrub => {
                // Scrubbing prioritizes latency and latest-frame responsiveness
                let scrub_decision = QoSDecision {
                    media_variant: self.current_decision.media_variant.clone(),
                    render_quality: RenderQuality::Half,
                    effects_policy: EffectsPolicy::Reduced,
                    lookahead_reduction: 0.5,
                    reason: QoSReason::ScrubLatencyOptimization,
                    confidence: 0.95,
                };
                self.apply_decision(scrub_decision, current_pts, Bottleneck::None);
                return self.current_decision.clone();
            }
            PlaybackMode::Idle => {
                // Paused mode: Asynchronously restore to full quality without pausing freeze
                if self.current_decision.render_quality != RenderQuality::Full
                    || self.current_decision.effects_policy != EffectsPolicy::Full
                {
                    self.pending_paused_upgrade = true;
                    let upgrade_decision = QoSDecision {
                        media_variant: self.current_decision.media_variant.clone(),
                        render_quality: RenderQuality::Full,
                        effects_policy: EffectsPolicy::Full,
                        lookahead_reduction: 0.0,
                        reason: QoSReason::PausedQualityRestoration,
                        confidence: 1.0,
                    };
                    self.apply_decision(upgrade_decision, current_pts, Bottleneck::None);
                }
                return self.current_decision.clone();
            }
            _ => {}
        }

        // Evaluate complete, non-overlapping observation windows only. This
        // makes the configured degrade/recover thresholds represent windows,
        // rather than consecutive RAF ticks, and prevents Full/Half/Quarter
        // churn from a single transient frame.
        if self.window.len() < self.config.window_capacity
            || self.samples_since_evaluation < self.config.window_capacity
        {
            return self.current_decision.clone();
        }
        self.samples_since_evaluation = 0;

        // 2. Diagnose Bottleneck from Rolling Performance Window
        let (bottleneck, confidence) = self.window.diagnose_bottleneck();
        self.last_diagnosed_bottleneck = bottleneck.clone();

        let is_unhealthy = !matches!(bottleneck, Bottleneck::None);

        if is_unhealthy {
            self.consecutive_unhealthy_windows += 1;
            self.consecutive_healthy_windows = 0;
        } else {
            self.consecutive_healthy_windows += 1;
            self.consecutive_unhealthy_windows = 0;
        }

        // 3. Hysteresis Check: Only degrade after N consecutive bad windows,
        // and only recover after M consecutive good windows (M > N)
        if is_unhealthy
            && self.consecutive_unhealthy_windows >= self.config.degrade_window_threshold
        {
            let mut new_decision = self.current_decision.clone();
            new_decision.confidence = confidence;

            match &bottleneck {
                Bottleneck::Decode => {
                    // DECODE BOTTLENECK:
                    // Prefer switching to Proxy if available.
                    // If no proxy is ready yet, downgrade RenderQuality and reduce lookahead
                    // to relieve memory and bus contention on constrained GPUs.
                    let decode_mean = self.window.mean_decode_us();
                    let mut proxy_switched = false;

                    if let Some(asset_id) = active_asset_id {
                        if let Some(ready_proxy) = proxy_manager.get_ready_proxy(asset_id) {
                            new_decision.media_variant = MediaVariant::Proxy(ready_proxy.id);
                            proxy_switched = true;
                        }
                    }

                    if !proxy_switched {
                        new_decision.render_quality = match new_decision.render_quality {
                            RenderQuality::Full => RenderQuality::Half,
                            RenderQuality::Half => RenderQuality::Quarter,
                            RenderQuality::Quarter => RenderQuality::Quarter,
                        };
                        new_decision.lookahead_reduction =
                            (new_decision.lookahead_reduction + 0.25).min(0.75);
                    }

                    new_decision.reason = QoSReason::DecodeStarvation {
                        decode_mean_us: decode_mean,
                        ready_depth: self.window.mean_ready_queue_depth() as usize,
                    };
                }
                Bottleneck::RenderGpu => {
                    // GPU RENDER BOTTLENECK:
                    // Keep MediaVariant Original; degrade RenderQuality (Full -> Half -> Quarter)
                    new_decision.render_quality = match new_decision.render_quality {
                        RenderQuality::Full => RenderQuality::Half,
                        RenderQuality::Half => RenderQuality::Quarter,
                        RenderQuality::Quarter => RenderQuality::Quarter,
                    };
                    new_decision.reason = QoSReason::GpuRenderDeadlinePressure {
                        gpu_render_mean_us: self.window.mean_render_gpu_us(),
                        misses: self.window.deadline_miss_count(),
                        total_frames: self.window.len() as u64,
                    };
                }
                Bottleneck::Effect(ref effect_name) => {
                    // EXPENSIVE EFFECT BOTTLENECK:
                    // Degrade EffectsPolicy (Full -> Reduced -> Minimal -> BypassOptional)
                    new_decision.effects_policy = match new_decision.effects_policy {
                        EffectsPolicy::Full => EffectsPolicy::Reduced,
                        EffectsPolicy::Reduced => EffectsPolicy::Minimal,
                        EffectsPolicy::Minimal => EffectsPolicy::BypassOptional,
                        EffectsPolicy::BypassOptional => EffectsPolicy::BypassOptional,
                    };
                    let effect_mean = self.window.dominant_effect().map(|(_, us)| us).unwrap_or(0);
                    new_decision.reason = QoSReason::ExpensiveEffectPressure {
                        effect_name: effect_name.clone(),
                        effect_mean_us: effect_mean,
                    };
                }
                Bottleneck::SurfacePool | Bottleneck::Memory => {
                    // MEMORY / SURFACE PRESSURE:
                    // Reduce lookahead and trigger proactive cache eviction
                    new_decision.lookahead_reduction =
                        (new_decision.lookahead_reduction + 0.25).min(0.75);
                    new_decision.reason = QoSReason::SurfaceMemoryPressure {
                        pool_utilization_pct: self.window.peak_pool_utilization(),
                        vram_used_bytes: (self.window.peak_pool_utilization() * 100_000_000.0)
                            as usize,
                    };
                }
                _ => {}
            }

            self.apply_decision(new_decision, current_pts, bottleneck);
        } else if !is_unhealthy
            && self.consecutive_healthy_windows >= self.config.recover_window_threshold
        {
            // RECOVERY (after M consecutive healthy windows)
            let mut new_decision = self.current_decision.clone();
            new_decision.confidence = confidence;
            new_decision.reason = QoSReason::Healthy;

            // Step-wise recovery
            if new_decision.render_quality == RenderQuality::Quarter {
                new_decision.render_quality = RenderQuality::Half;
            } else if new_decision.render_quality == RenderQuality::Half {
                new_decision.render_quality = RenderQuality::Full;
            }

            if new_decision.effects_policy != EffectsPolicy::Full {
                new_decision.effects_policy = match new_decision.effects_policy {
                    EffectsPolicy::BypassOptional => EffectsPolicy::Minimal,
                    EffectsPolicy::Minimal => EffectsPolicy::Reduced,
                    EffectsPolicy::Reduced => EffectsPolicy::Full,
                    EffectsPolicy::Full => EffectsPolicy::Full,
                };
            }

            if new_decision.lookahead_reduction > 0.0 {
                new_decision.lookahead_reduction =
                    (new_decision.lookahead_reduction - 0.25).max(0.0);
            }

            if matches!(new_decision.media_variant, MediaVariant::Proxy(_)) {
                new_decision.media_variant = MediaVariant::Original;
            }

            self.apply_decision(new_decision, current_pts, Bottleneck::None);
        }

        self.current_decision.clone()
    }

    /// Applies a new decision and records transition event if changed.
    fn apply_decision(&mut self, next: QoSDecision, pts: MediaTime, bottleneck: Bottleneck) {
        if next != self.current_decision {
            self.transition_history.push(QoSTransitionEvent {
                previous: self.current_decision.clone(),
                current: next.clone(),
                timestamp: pts,
                bottleneck,
            });
            self.current_decision = next;
        }
    }

    /// Sets a manual QoS override for debugging or user preferences.
    pub fn set_manual_override(&mut self, override_decision: Option<QoSDecision>) {
        if let Some(ref d) = override_decision {
            self.current_decision = d.clone();
        }
        self.manual_override = override_decision;
    }

    /// Checks if a high-quality frame replacement is pending after pausing.
    #[inline]
    pub fn is_pending_paused_upgrade(&self) -> bool {
        self.pending_paused_upgrade
    }

    /// Clears the pending paused upgrade flag once the high-quality frame has rendered.
    #[inline]
    pub fn clear_pending_paused_upgrade(&mut self) {
        self.pending_paused_upgrade = false;
    }

    /// Returns recorded transition history.
    pub fn transition_history(&self) -> &[QoSTransitionEvent] {
        &self.transition_history
    }

    /// Last diagnosed bottleneck.
    #[inline]
    pub fn last_diagnosed_bottleneck(&self) -> &Bottleneck {
        &self.last_diagnosed_bottleneck
    }

    /// Returns the current playback policy snapshot for UI observation.
    pub fn current_policy_snapshot(&self) -> PlaybackPolicySnapshot {
        let decision = self.current_decision();
        let is_decode_starved = matches!(
            decision.reason,
            QoSReason::DecodeStarvation { .. }
                | QoSReason::DecodeDeadlinePressure { .. }
                | QoSReason::DecoderThroughputInsufficient { .. }
        );
        PlaybackPolicySnapshot {
            media_variant: decision.media_variant.clone(),
            render_quality: decision.render_quality,
            effects_policy: decision.effects_policy,
            reason: decision.reason.clone(),
            is_decode_starved,
        }
    }

    /// Computes the active performance envelope against target frame budget.
    pub fn performance_envelope(&self) -> PerformanceEnvelope {
        let target_budget = (1_000_000.0 / self.config.target_fps) as u64;
        let decode_us = self.window.mean_decode_us();
        let render_us = self.window.mean_render_gpu_us();
        let miss_ratio = self.window.deadline_miss_ratio();
        let sustained = self.consecutive_unhealthy_windows >= self.config.degrade_window_threshold;
        PerformanceEnvelope::from_timings(
            target_budget,
            decode_us,
            render_us,
            miss_ratio,
            sustained,
        )
    }

    /// Metrics from the same rolling window used to make QoS decisions.
    /// Diagnostics must never mix those decisions with a single-frame sample.
    pub fn window_metrics(&self) -> (u64, u64, f32, f32, usize, usize) {
        (
            self.window.mean_decode_us(),
            self.window.mean_render_gpu_us(),
            self.window.deadline_miss_ratio(),
            self.window.peak_pool_utilization(),
            self.consecutive_unhealthy_windows,
            self.consecutive_healthy_windows,
        )
    }
}
