//! Performance Manager — Phase 5.
//!
//! Sits above [`FrameScheduler`] and governs *how aggressively work is
//! admitted* — without touching the renderer, presentation-target contracts,
//! or any Phase 1–4 frozen APIs.
//!
//! ```text
//!                  PerformanceManager
//!                         │
//!               ┌─────────┴─────────┐
//!               │                   │
//!         ResourceBudget       PolicyState
//!               │                   │
//!               └─────────┬─────────┘
//!                         ▼
//!                  FrameScheduler          ← Phase 4 (frozen)
//! ```
//!
//! # Backpressure rules
//!
//! | Condition                                        | Action                        |
//! |--------------------------------------------------|-------------------------------|
//! | `deadline_misses_1s ≥ background_pause_threshold`  | Suspend background work       |
//! | `deadline_misses_1s ≥ interactive_throttle_threshold` | Throttle interactive work  |
//! | `deadline_misses_1s ≤ recovery_threshold`         | Restore normal policy         |
//!
//! **Realtime requests are never blocked.** This is the invariant that
//! preserves playback under all conditions.
//!
//! # Telemetry collection
//!
//! `PerformanceManager::record(telemetry)` is called by the render loop after
//! each presented frame. It populates the shared [`FrameTelemetryRing`] and
//! periodically re-evaluates [`PolicyState`] from the resulting
//! [`ResourceBudget`].

use crate::wgpu_compositor::frame_deadline::FrameDeadline;
use crate::wgpu_compositor::frame_request::FramePriority;
use crate::wgpu_compositor::frame_resource::FrameResource;
use crate::wgpu_compositor::frame_scheduler::{
    FrameKey, FrameScheduler, FrameTicket, SchedulerError,
};
use crate::wgpu_compositor::frame_telemetry::{FrameTelemetry, FrameTelemetryRing, ResourceBudget};
use crate::wgpu_compositor::session_telemetry::{SessionSnapshot, SessionTelemetryCollector};
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Instant;

// ---------------------------------------------------------------------------
// PolicyState — admission decisions
// ---------------------------------------------------------------------------

/// Current scheduling policy computed by [`PerformanceManager`].
///
/// Written by the performance manager when resource pressure changes.
/// Read by [`PerformanceManager::request`] at every admission gate.
///
/// All mutations go through `PerformanceManager::evaluate_policy`; never
/// mutate directly.
#[derive(Debug, Clone, Default)]
pub struct PolicyState {
    /// Background work is suspended — realtime pressure too high.
    pub background_paused: bool,
    /// Interactive work is throttled — severe realtime pressure.
    pub interactive_throttled: bool,
    /// Coalescing window: requests within this duration are merged (µs).
    /// 0 = no coalescing (Phase 5 default; active coalescing is Phase 6).
    pub coalesce_window_us: u64,
}

// ---------------------------------------------------------------------------
// PerformanceConfig — static thresholds
// ---------------------------------------------------------------------------

/// Thresholds that drive [`PolicyState`] transitions.
///
/// All values can be tuned at construction time; they are immutable at runtime.
/// Phase 6 (`AdaptiveQualityManager`) may make these adaptive.
#[derive(Debug, Clone)]
pub struct PerformanceConfig {
    /// Suspend background work when `deadline_misses_1s` reaches this value.
    pub background_pause_threshold: u32, // default: 2
    /// Throttle interactive work when `deadline_misses_1s` reaches this value.
    pub interactive_throttle_threshold: u32, // default: 5
    /// Restore normal policy when `deadline_misses_1s` drops to or below this.
    pub recovery_threshold: u32, // default: 0
    /// Ring buffer capacity (samples). 300 ≈ 5 s at 60 FPS.
    pub telemetry_capacity: usize, // default: 300
    /// Minimum interval between policy re-evaluations (µs).
    pub policy_eval_interval_us: u64, // default: 100_000 (100 ms)
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            background_pause_threshold: 2,
            interactive_throttle_threshold: 5,
            recovery_threshold: 0,
            telemetry_capacity: 300,
            policy_eval_interval_us: 100_000,
        }
    }
}

// ---------------------------------------------------------------------------
// BackpressureError
// ---------------------------------------------------------------------------

/// Error returned by [`PerformanceManager::request`] when admission is denied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackpressureError {
    /// Background request rejected — realtime pressure is too high.
    /// Caller should retry after pressure drops (indicated by a new policy snapshot).
    BackgroundSuspended,
    /// Interactive request throttled — severe realtime pressure.
    /// Retry after `retry_after_us` microseconds.
    Throttled { retry_after_us: u64 },
    /// The underlying scheduler returned an error.
    Scheduler(SchedulerError),
}

impl std::fmt::Display for BackpressureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BackgroundSuspended => write!(f, "background work suspended (realtime pressure)"),
            Self::Throttled { retry_after_us } => write!(
                f,
                "interactive work throttled — retry after {retry_after_us}µs"
            ),
            Self::Scheduler(e) => write!(f, "scheduler error: {e}"),
        }
    }
}

impl std::error::Error for BackpressureError {}

// ---------------------------------------------------------------------------
// PerformanceTicket — wraps FrameTicket with timing metadata
// ---------------------------------------------------------------------------

/// Opaque handle returned by [`PerformanceManager::request`].
///
/// Carries the enqueue timestamp and deadline alongside the inner
/// [`FrameTicket`] so that [`PerformanceManager::await_frame`] can compute
/// `queue_wait_us` and `deadline_miss` without requiring the caller to
/// track them separately.
pub struct PerformanceTicket {
    pub(crate) ticket: FrameTicket,
    pub(crate) enqueue_time: Instant,
    pub(crate) deadline: FrameDeadline,
}

// ---------------------------------------------------------------------------
// QueueMetrics — per-frame timing returned by await_frame
// ---------------------------------------------------------------------------

/// Per-frame scheduling metrics computed by [`PerformanceManager::await_frame`].
///
/// The caller uses these to populate [`FrameTelemetry`] before calling
/// [`PerformanceManager::record`].
#[derive(Debug, Clone)]
pub struct QueueMetrics {
    /// Time spent waiting in the scheduler queue (µs).
    /// Populates [`FrameTelemetry::queue_wait_us`].
    pub queue_wait_us: u64,
    /// True if the frame was ready after its `FrameDeadline::present_by`.
    /// Populates [`FrameTelemetry::deadline_miss`].
    pub deadline_miss: bool,
}

// ---------------------------------------------------------------------------
// PerformanceManager
// ---------------------------------------------------------------------------

/// Admission gate and telemetry collector above [`FrameScheduler`].
///
/// # Cloneability
///
/// `PerformanceManager` is cheaply cloneable (`Arc` internally). All clones
/// share the same policy state, telemetry ring, and underlying scheduler.
#[derive(Clone)]
pub struct PerformanceManager {
    scheduler: FrameScheduler,
    telemetry: Arc<Mutex<FrameTelemetryRing>>,
    policy: Arc<Mutex<PolicyState>>,
    config: PerformanceConfig,
    last_policy_eval: Arc<Mutex<Instant>>,
    /// Session-scoped aggregator — NOT cleared by `reset()`.
    /// Use `reset_session()` to start a new per-project accumulation.
    session: SessionTelemetryCollector,
}

impl PerformanceManager {
    /// Create a new `PerformanceManager` wrapping the given scheduler.
    ///
    /// Optionally pass an existing [`SessionTelemetryCollector`] so the
    /// same session instance is shared across Tauri state and this manager.
    /// If `None`, a fresh collector is created.
    pub fn new(scheduler: FrameScheduler, config: PerformanceConfig) -> Self {
        Self::with_session(scheduler, config, SessionTelemetryCollector::new())
    }

    /// Construct with an externally owned session collector.
    ///
    /// Use this when you need to hand the same `SessionTelemetryCollector` to
    /// both Tauri state (for `get_session_telemetry`) and this manager.
    pub fn with_session(
        scheduler: FrameScheduler,
        config: PerformanceConfig,
        session: SessionTelemetryCollector,
    ) -> Self {
        let capacity = config.telemetry_capacity;
        Self {
            scheduler,
            telemetry: Arc::new(Mutex::new(FrameTelemetryRing::new(capacity))),
            policy: Arc::new(Mutex::new(PolicyState::default())),
            config,
            last_policy_eval: Arc::new(Mutex::new(Instant::now())),
            session,
        }
    }

    /// Borrow the session collector for Tauri state registration or diagnostics.
    pub fn session_collector(&self) -> &SessionTelemetryCollector {
        &self.session
    }

    /// Return a [`SessionSnapshot`] from the session-level aggregator.
    pub fn session_snapshot(&self) -> SessionSnapshot {
        self.session.snapshot()
    }

    // -----------------------------------------------------------------------
    // request — admission gate
    // -----------------------------------------------------------------------

    /// Submit a frame request through the admission gate.
    ///
    /// - **Realtime**: always admitted, never throttled.
    /// - **Interactive**: admitted unless `interactive_throttled` is active.
    /// - **Background**: admitted unless `background_paused` is active.
    ///
    /// Returns a [`PerformanceTicket`] which must be resolved via
    /// [`await_frame`].
    pub async fn request(
        &self,
        key: FrameKey,
        deadline: FrameDeadline,
    ) -> Result<PerformanceTicket, BackpressureError> {
        // Read policy (brief sync lock, no await inside).
        let (bg_paused, interactive_throttled) = {
            let p = self.policy.lock();
            (p.background_paused, p.interactive_throttled)
        };

        match deadline.priority {
            // Realtime is never blocked.
            FramePriority::Realtime => {}

            FramePriority::Interactive => {
                if interactive_throttled {
                    // 50 ms retry suggestion — Phase 6 will make this adaptive.
                    return Err(BackpressureError::Throttled {
                        retry_after_us: 50_000,
                    });
                }
            }

            FramePriority::Background => {
                if bg_paused {
                    return Err(BackpressureError::BackgroundSuspended);
                }
            }
        }

        let enqueue_time = Instant::now();
        let ticket = self.scheduler.request(key, deadline.clone()).await;
        Ok(PerformanceTicket {
            ticket,
            enqueue_time,
            deadline,
        })
    }

    // -----------------------------------------------------------------------
    // await_frame — resolve a ticket
    // -----------------------------------------------------------------------

    /// Await the frame for a given ticket and return scheduling metrics.
    ///
    /// Returns `(Arc<FrameResource>, QueueMetrics)` on success.
    /// The caller should call [`record`] with the assembled [`FrameTelemetry`]
    /// after presenting the frame.
    pub async fn await_frame(
        &self,
        ticket: PerformanceTicket,
    ) -> Result<(Arc<FrameResource>, QueueMetrics), SchedulerError> {
        let enqueue_time = ticket.enqueue_time;
        let deadline = ticket.deadline;

        let resource = self.scheduler.await_frame(ticket.ticket).await?;

        let queue_wait_us = enqueue_time.elapsed().as_micros() as u64;
        let deadline_miss = deadline.is_expired();

        Ok((
            resource,
            QueueMetrics {
                queue_wait_us,
                deadline_miss,
            },
        ))
    }

    // -----------------------------------------------------------------------
    // record — push telemetry and drive policy
    // -----------------------------------------------------------------------

    /// Record a completed-frame telemetry sample.
    ///
    /// Sets `recorded_at` to `Instant::now()` before pushing to the ring.
    /// Periodically re-evaluates [`PolicyState`] from the resulting
    /// [`ResourceBudget`].
    pub fn record(&self, mut telemetry: FrameTelemetry) {
        // Stamp the sample with the current instant for time-windowed metrics.
        telemetry.recorded_at = Some(Instant::now());

        // Push to the rolling ring (drives PolicyState) and the session
        // aggregator (drives lifetime statistics).
        {
            let mut ring = self.telemetry.lock();
            ring.push(telemetry.clone());
        }
        self.session.push(&telemetry);

        // Throttled policy evaluation — at most once per eval_interval.
        let should_eval = {
            let now = Instant::now();
            let mut last = self.last_policy_eval.lock();
            let elapsed = now.duration_since(*last).as_micros() as u64;
            if elapsed >= self.config.policy_eval_interval_us {
                *last = now;
                true
            } else {
                false
            }
        };

        if should_eval {
            self.evaluate_policy();
        }
    }

    // -----------------------------------------------------------------------
    // budget — read-only snapshot
    // -----------------------------------------------------------------------

    /// Compute a [`ResourceBudget`] snapshot from current telemetry and
    /// live scheduler state.
    pub fn budget(&self) -> ResourceBudget {
        let mut budget = {
            let ring = self.telemetry.lock();
            ring.compute_budget()
        };
        budget.in_flight_count = self.scheduler.in_flight_count();
        budget
    }

    // -----------------------------------------------------------------------
    // policy — read-only snapshot
    // -----------------------------------------------------------------------

    /// Current [`PolicyState`] snapshot for diagnostics / testing.
    pub fn policy(&self) -> PolicyState {
        self.policy.lock().clone()
    }

    // -----------------------------------------------------------------------
    // reset — clear ring + policy on project close
    // -----------------------------------------------------------------------

    /// Clear the rolling telemetry ring, reset policy to defaults, and reset
    /// the underlying scheduler.
    ///
    /// **Does NOT reset the session aggregator.** Session lifetime stats span
    /// the entire app session regardless of project open/close. Call
    /// [`reset_session`] explicitly if you need per-project statistics.
    pub fn reset(&self) {
        {
            let mut ring = self.telemetry.lock();
            ring.clear();
        }
        {
            let mut policy = self.policy.lock();
            *policy = PolicyState::default();
        }
        self.scheduler.reset();
    }

    /// Reset session-level statistics (e.g. on project open).
    ///
    /// Unlike [`reset`], this clears the [`SessionTelemetryCollector`] and
    /// restarts the session clock. The rolling ring and policy are not touched.
    pub fn reset_session(&self) {
        self.session.reset_session();
    }

    // -----------------------------------------------------------------------
    // evaluate_policy — internal
    // -----------------------------------------------------------------------

    fn evaluate_policy(&self) {
        let misses = {
            let ring = self.telemetry.lock();
            ring.deadline_miss_count_1s()
        };

        let (bg_before, it_before) = {
            let p = self.policy.lock();
            (p.background_paused, p.interactive_throttled)
        };

        let mut policy = self.policy.lock();
        if misses >= self.config.interactive_throttle_threshold {
            policy.interactive_throttled = true;
            policy.background_paused = true;
        } else if misses >= self.config.background_pause_threshold {
            policy.interactive_throttled = false;
            policy.background_paused = true;
        } else if misses <= self.config.recovery_threshold {
            policy.interactive_throttled = false;
            policy.background_paused = false;
        }
        // Between recovery_threshold and pause_threshold → maintain current state.

        // Record policy change events in the session aggregator.
        let bg_after = policy.background_paused;
        let it_after = policy.interactive_throttled;
        drop(policy);

        // Only count state *transitions* into the throttled/paused state.
        if bg_after && !bg_before || it_after && !it_before {
            self.session
                .record_policy_event(bg_after && !bg_before, it_after && !it_before);
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn make_miss(now: Instant) -> FrameTelemetry {
        FrameTelemetry {
            deadline_miss: true,
            recorded_at: Some(now),
            ..Default::default()
        }
    }

    #[test]
    fn policy_state_default_allows_all_priorities() {
        let p = PolicyState::default();
        assert!(!p.background_paused, "default: background allowed");
        assert!(!p.interactive_throttled, "default: interactive allowed");
    }

    #[test]
    fn resource_budget_from_empty_ring_has_no_latencies() {
        let ring = FrameTelemetryRing::new(10);
        let budget = ring.compute_budget();
        assert!(budget.decode_p50_us.is_none());
        assert!(budget.decode_p95_us.is_none());
        assert_eq!(budget.deadline_misses_1s, 0);
        assert_eq!(budget.dropped_frames_1s, 0);
    }

    #[test]
    fn deadline_miss_count_1s_counts_only_recent_misses() {
        let mut ring = FrameTelemetryRing::new(20);
        let now = Instant::now();

        // 2 fresh misses (within the last second)
        ring.push(make_miss(now));
        ring.push(make_miss(now));

        // 1 old miss (outside the window) — subtract 2 seconds
        let old_miss = FrameTelemetry {
            deadline_miss: true,
            recorded_at: Some(now - Duration::from_secs(2)),
            ..Default::default()
        };
        ring.push(old_miss);

        assert_eq!(
            ring.deadline_miss_count_1s(),
            2,
            "Only recent misses must be counted"
        );
    }

    #[test]
    fn two_misses_trigger_background_pause() {
        let now = Instant::now();
        let mut ring = FrameTelemetryRing::new(20);
        ring.push(make_miss(now));
        ring.push(make_miss(now));

        let misses = ring.deadline_miss_count_1s();
        let config = PerformanceConfig::default();
        assert!(
            misses >= config.background_pause_threshold,
            "2 misses must meet or exceed the pause threshold ({})",
            config.background_pause_threshold
        );
    }

    #[test]
    fn zero_misses_triggers_recovery() {
        let config = PerformanceConfig::default();
        let ring = FrameTelemetryRing::new(20); // empty
        assert!(
            ring.deadline_miss_count_1s() <= config.recovery_threshold,
            "0 misses must be at or below recovery threshold"
        );
    }

    #[test]
    fn backpressure_error_display() {
        assert!(!BackpressureError::BackgroundSuspended
            .to_string()
            .is_empty());
        assert!(!BackpressureError::Throttled {
            retry_after_us: 50_000
        }
        .to_string()
        .is_empty());
        assert!(!BackpressureError::Scheduler(SchedulerError::Cancelled)
            .to_string()
            .is_empty());
    }

    #[test]
    fn performance_config_defaults_are_ordered_correctly() {
        let cfg = PerformanceConfig::default();
        assert!(
            cfg.recovery_threshold < cfg.background_pause_threshold,
            "recovery must be below pause threshold"
        );
        assert!(
            cfg.background_pause_threshold < cfg.interactive_throttle_threshold,
            "pause must be below throttle threshold"
        );
    }
}
