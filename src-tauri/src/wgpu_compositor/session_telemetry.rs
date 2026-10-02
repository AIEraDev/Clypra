//! Session-scoped performance telemetry
//!
//! [`SessionTelemetryCollector`] is the **session-level** counterpart to the
//! rolling [`FrameTelemetryRing`]. The ring discards samples as it wraps;
//! the session collector accumulates totals and peak values for the entire
//! app session so the frontend can surface lifetime statistics.
//!
//! # Relationship to other telemetry types
//!
//! ```text
//! PerformanceManager::record(FrameTelemetry)
//!         │
//!         ├── FrameTelemetryRing   ← rolling 300-sample window, drives PolicyState
//!         │
//!         └── SessionTelemetryCollector  ← lifetime totals + peaks → IPC snapshot
//! ```
//!
//! # Design invariants
//!
//! - **Never cleared by `PerformanceManager::reset()`** — a project close / session
//!   reset clears the ring and policy, but session lifetime stats survive.
//!   Call [`SessionTelemetryCollector::reset_session`] explicitly on a fresh
//!   recording session if needed.
//!
//! - **Cheaply cloneable** — `Arc<Mutex<SessionState>>` internally; clone freely
//!   across threads.
//!
//! - **All Phase 5 fields populated** — `queue_wait_us`, `deadline_miss`,
//!   `dropped`, `recorded_at`, `ipc_wait_us`, `gpu_render_us` are all tracked.

use crate::wgpu_compositor::frame_telemetry::FrameTelemetry;
use crate::wgpu_compositor::render_path::FrameSource;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

// ---------------------------------------------------------------------------
// FramesBySource — breakdown of frames per render path
// ---------------------------------------------------------------------------

/// Number of frames rendered via each source path in this session.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesBySource {
    /// Frames imported via DXGI zero-copy (NV12 or P010).
    pub dxgi_nv12: u64,
    /// Frames uploaded via CPU path as NV12.
    pub cpu_nv12: u64,
    /// Frames uploaded via CPU path as RGBA8.
    pub cpu_rgba: u64,
    /// Frames with an unrecognised source (should be zero in normal operation).
    pub unknown: u64,
}

// ---------------------------------------------------------------------------
// SessionSnapshot — the IPC-visible summary
// ---------------------------------------------------------------------------

/// A point-in-time summary of the entire session's rendering performance.
///
/// Returned by `get_session_telemetry` and serialized to JSON for the frontend.
/// All latency fields are in **microseconds** to match [`FrameTelemetry`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    // ── Identity ─────────────────────────────────────────────────────────────
    /// Seconds elapsed since the session started (or last `reset_session`).
    pub session_duration_secs: f64,

    // ── Frame counts ─────────────────────────────────────────────────────────
    /// Total frames pushed through `PerformanceManager::record`.
    pub frames_produced: u64,
    /// Frames with `dropped = true`.
    pub frames_dropped: u64,
    /// Frames with `deadline_miss = true`.
    pub deadline_misses: u64,
    /// `frames_dropped / frames_produced * 100.0` — `None` if no frames yet.
    pub drop_rate_pct: Option<f64>,
    /// `deadline_misses / frames_produced * 100.0` — `None` if no frames yet.
    pub miss_rate_pct: Option<f64>,

    // ── Decode latency (CPU, µs) ─────────────────────────────────────────────
    pub avg_decode_us: Option<u64>,
    pub peak_decode_us: Option<u64>,

    // ── Scheduler queue-wait (µs) — Phase 5 ─────────────────────────────────
    /// Average queue-wait for frames that had a `queue_wait_us` measurement.
    pub avg_queue_wait_us: Option<u64>,
    pub peak_queue_wait_us: Option<u64>,

    // ── IPC round-trip (µs) — Phase 5 ────────────────────────────────────────
    pub avg_ipc_wait_us: Option<u64>,
    pub peak_ipc_wait_us: Option<u64>,

    // ── GPU render (µs) — Phase 6 will populate ──────────────────────────────
    pub avg_gpu_render_us: Option<u64>,
    pub peak_gpu_render_us: Option<u64>,

    // ── Source-path breakdown ─────────────────────────────────────────────────
    pub frames_by_source: FramesBySource,

    // ── Policy events (how many times the manager intervened) ────────────────
    /// Number of times `PerformanceManager::record` triggered a policy change
    /// that set `background_paused = true`.
    pub policy_background_pauses: u64,
    /// Number of times a policy change set `interactive_throttled = true`.
    pub policy_interactive_throttles: u64,
}

// ---------------------------------------------------------------------------
// SessionState — mutable inner state (held behind a Mutex)
// ---------------------------------------------------------------------------

struct SessionState {
    started_at: Instant,

    frames_produced: u64,
    frames_dropped: u64,
    deadline_misses: u64,

    // Decode
    total_decode_us: u64,
    peak_decode_us: u64,

    // Queue wait (Phase 5)
    total_queue_wait_us: u64,
    queue_wait_samples: u64,
    peak_queue_wait_us: u64,

    // IPC wait (Phase 5)
    total_ipc_wait_us: u64,
    ipc_wait_samples: u64,
    peak_ipc_wait_us: u64,

    // GPU render (Phase 6)
    total_gpu_render_us: u64,
    gpu_render_samples: u64,
    peak_gpu_render_us: u64,

    // Source breakdown
    dxgi_nv12_frames: u64,
    cpu_nv12_frames: u64,
    cpu_rgba_frames: u64,
    unknown_frames: u64,

    // Policy event counters
    policy_background_pauses: u64,
    policy_interactive_throttles: u64,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
            frames_produced: 0,
            frames_dropped: 0,
            deadline_misses: 0,
            total_decode_us: 0,
            peak_decode_us: 0,
            total_queue_wait_us: 0,
            queue_wait_samples: 0,
            peak_queue_wait_us: 0,
            total_ipc_wait_us: 0,
            ipc_wait_samples: 0,
            peak_ipc_wait_us: 0,
            total_gpu_render_us: 0,
            gpu_render_samples: 0,
            peak_gpu_render_us: 0,
            dxgi_nv12_frames: 0,
            cpu_nv12_frames: 0,
            cpu_rgba_frames: 0,
            unknown_frames: 0,
            policy_background_pauses: 0,
            policy_interactive_throttles: 0,
        }
    }
}

impl SessionState {
    fn push(&mut self, t: &FrameTelemetry) {
        self.frames_produced += 1;

        if t.dropped {
            self.frames_dropped += 1;
        }
        if t.deadline_miss {
            self.deadline_misses += 1;
        }

        // Decode
        self.total_decode_us += t.decode_cpu_us;
        if t.decode_cpu_us > self.peak_decode_us {
            self.peak_decode_us = t.decode_cpu_us;
        }

        // Queue wait — only samples that have been measured (Phase 5)
        if let Some(qw) = t.queue_wait_us {
            self.total_queue_wait_us += qw;
            self.queue_wait_samples += 1;
            if qw > self.peak_queue_wait_us {
                self.peak_queue_wait_us = qw;
            }
        }

        // IPC wait — only measured samples (Phase 5)
        if let Some(ipc) = t.ipc_wait_us {
            self.total_ipc_wait_us += ipc;
            self.ipc_wait_samples += 1;
            if ipc > self.peak_ipc_wait_us {
                self.peak_ipc_wait_us = ipc;
            }
        }

        // GPU render — only measured samples (Phase 6)
        if let Some(gpu) = t.gpu_render_us {
            self.total_gpu_render_us += gpu;
            self.gpu_render_samples += 1;
            if gpu > self.peak_gpu_render_us {
                self.peak_gpu_render_us = gpu;
            }
        }

        // Source breakdown
        match &t.source {
            FrameSource::DxgiNv12 { .. } => self.dxgi_nv12_frames += 1,
            FrameSource::CpuNv12 { .. } => self.cpu_nv12_frames += 1,
            FrameSource::CpuRgba { .. } => self.cpu_rgba_frames += 1,
        }
    }

    fn snapshot(&self) -> SessionSnapshot {
        let duration = self.started_at.elapsed().as_secs_f64();
        let n = self.frames_produced;

        SessionSnapshot {
            session_duration_secs: duration,
            frames_produced: n,
            frames_dropped: self.frames_dropped,
            deadline_misses: self.deadline_misses,

            drop_rate_pct: if n > 0 {
                Some(self.frames_dropped as f64 / n as f64 * 100.0)
            } else {
                None
            },
            miss_rate_pct: if n > 0 {
                Some(self.deadline_misses as f64 / n as f64 * 100.0)
            } else {
                None
            },

            avg_decode_us: self.total_decode_us.checked_div(n),
            peak_decode_us: if n > 0 {
                Some(self.peak_decode_us)
            } else {
                None
            },

            avg_queue_wait_us: self
                .total_queue_wait_us
                .checked_div(self.queue_wait_samples),
            peak_queue_wait_us: if self.queue_wait_samples > 0 {
                Some(self.peak_queue_wait_us)
            } else {
                None
            },

            avg_ipc_wait_us: self.total_ipc_wait_us.checked_div(self.ipc_wait_samples),
            peak_ipc_wait_us: if self.ipc_wait_samples > 0 {
                Some(self.peak_ipc_wait_us)
            } else {
                None
            },

            avg_gpu_render_us: self
                .total_gpu_render_us
                .checked_div(self.gpu_render_samples),
            peak_gpu_render_us: if self.gpu_render_samples > 0 {
                Some(self.peak_gpu_render_us)
            } else {
                None
            },

            frames_by_source: FramesBySource {
                dxgi_nv12: self.dxgi_nv12_frames,
                cpu_nv12: self.cpu_nv12_frames,
                cpu_rgba: self.cpu_rgba_frames,
                unknown: self.unknown_frames,
            },

            policy_background_pauses: self.policy_background_pauses,
            policy_interactive_throttles: self.policy_interactive_throttles,
        }
    }
}

// ---------------------------------------------------------------------------
// SessionTelemetryCollector — public API
// ---------------------------------------------------------------------------

/// Session-scoped telemetry aggregator.
///
/// Cheaply cloneable — all clones share the same `Arc<Mutex<SessionState>>`.
/// Registered as Tauri managed state so `get_session_telemetry` can query it
/// independently of `PerformanceManager`.
#[derive(Clone)]
pub struct SessionTelemetryCollector {
    inner: Arc<Mutex<SessionState>>,
}

impl SessionTelemetryCollector {
    /// Create a new collector. The session clock starts now.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SessionState::default())),
        }
    }

    /// Record one completed frame.
    ///
    /// Called by [`PerformanceManager::record`] after updating the ring buffer.
    /// All Phase 5 fields are read: `queue_wait_us`, `ipc_wait_us`,
    /// `deadline_miss`, `dropped`, `gpu_render_us`, `source`.
    pub fn push(&self, telemetry: &FrameTelemetry) {
        self.inner.lock().push(telemetry);
    }

    /// Record a policy event — call when `PerformanceManager` updates policy.
    pub fn record_policy_event(&self, background_paused: bool, interactive_throttled: bool) {
        let mut s = self.inner.lock();
        if background_paused {
            s.policy_background_pauses += 1;
        }
        if interactive_throttled {
            s.policy_interactive_throttles += 1;
        }
    }

    /// Return a snapshot of all session statistics.
    ///
    /// Takes a brief Mutex lock; suitable to call from any thread.
    pub fn snapshot(&self) -> SessionSnapshot {
        self.inner.lock().snapshot()
    }

    /// Reset all counters and restart the session clock.
    ///
    /// Call on project-open if you want per-project (not per-app) statistics.
    /// `PerformanceManager::reset()` does NOT call this automatically.
    pub fn reset_session(&self) {
        let mut s = self.inner.lock();
        *s = SessionState::default();
    }

    /// Number of frames collected so far (for testing / health checks).
    pub fn frames_produced(&self) -> u64 {
        self.inner.lock().frames_produced
    }

    /// Record the frame transfer path / source directly (e.g. "dxgi-zero-copy", "cpu-nv12", "cpu-rgba").
    pub fn record_frame_source(&self, transfer_path: &str) {
        let mut s = self.inner.lock();
        s.frames_produced += 1;
        match transfer_path {
            "dxgi-zero-copy" => s.dxgi_nv12_frames += 1,
            "cpu-nv12" => s.cpu_nv12_frames += 1,
            "cpu-rgba" => s.cpu_rgba_frames += 1,
            _ => s.unknown_frames += 1,
        }
    }
}

impl Default for SessionTelemetryCollector {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wgpu_compositor::frame_telemetry::FrameTelemetry;
    use crate::wgpu_compositor::render_path::FrameSource;
    use std::time::Instant;

    fn rgba_frame(
        decode_us: u64,
        queue_wait_us: Option<u64>,
        deadline_miss: bool,
        dropped: bool,
    ) -> FrameTelemetry {
        FrameTelemetry {
            decode_cpu_us: decode_us,
            queue_wait_us,
            deadline_miss,
            dropped,
            recorded_at: Some(Instant::now()),
            source: FrameSource::CpuRgba {
                width: 1920,
                height: 1080,
            },
            ..Default::default()
        }
    }

    #[test]
    fn empty_snapshot_has_none_latencies() {
        let c = SessionTelemetryCollector::new();
        let s = c.snapshot();
        assert_eq!(s.frames_produced, 0);
        assert!(s.avg_decode_us.is_none());
        assert!(s.avg_queue_wait_us.is_none());
        assert!(s.drop_rate_pct.is_none());
        assert!(s.miss_rate_pct.is_none());
    }

    #[test]
    fn frame_counts_are_accurate() {
        let c = SessionTelemetryCollector::new();
        c.push(&rgba_frame(5000, Some(200), false, false));
        c.push(&rgba_frame(4000, Some(300), true, false));
        c.push(&rgba_frame(6000, Some(100), false, true));

        let s = c.snapshot();
        assert_eq!(s.frames_produced, 3);
        assert_eq!(s.deadline_misses, 1, "one deadline_miss");
        assert_eq!(s.frames_dropped, 1, "one dropped");
    }

    #[test]
    fn decode_avg_and_peak() {
        let c = SessionTelemetryCollector::new();
        c.push(&rgba_frame(2000, None, false, false));
        c.push(&rgba_frame(8000, None, false, false));

        let s = c.snapshot();
        assert_eq!(s.avg_decode_us, Some(5000), "avg of 2000+8000 = 5000");
        assert_eq!(s.peak_decode_us, Some(8000), "peak is 8000");
    }

    #[test]
    fn queue_wait_only_counted_when_some() {
        let c = SessionTelemetryCollector::new();
        c.push(&rgba_frame(1000, None, false, false)); // no queue_wait
        c.push(&rgba_frame(1000, Some(400), false, false));
        c.push(&rgba_frame(1000, Some(600), false, false));

        let s = c.snapshot();
        assert_eq!(s.avg_queue_wait_us, Some(500), "avg of 400+600 / 2");
        assert_eq!(s.peak_queue_wait_us, Some(600));
    }

    #[test]
    fn drop_rate_and_miss_rate_percentages() {
        let c = SessionTelemetryCollector::new();
        c.push(&rgba_frame(1000, None, true, false));
        c.push(&rgba_frame(1000, None, false, true));
        c.push(&rgba_frame(1000, None, false, false));
        c.push(&rgba_frame(1000, None, false, false));

        let s = c.snapshot();
        let miss_pct = s.miss_rate_pct.unwrap();
        let drop_pct = s.drop_rate_pct.unwrap();
        assert!((miss_pct - 25.0).abs() < 0.01, "1/4 miss = 25%");
        assert!((drop_pct - 25.0).abs() < 0.01, "1/4 drop = 25%");
    }

    #[test]
    fn source_breakdown_counts_correctly() {
        let c = SessionTelemetryCollector::new();
        c.push(&FrameTelemetry {
            source: FrameSource::DxgiNv12 {
                width: 1920,
                height: 1080,
            },
            ..Default::default()
        });
        c.push(&FrameTelemetry {
            source: FrameSource::CpuNv12 {
                width: 1920,
                height: 1080,
            },
            ..Default::default()
        });
        c.push(&FrameTelemetry {
            source: FrameSource::CpuRgba {
                width: 1920,
                height: 1080,
            },
            ..Default::default()
        });

        let s = c.snapshot();
        assert_eq!(s.frames_by_source.dxgi_nv12, 1);
        assert_eq!(s.frames_by_source.cpu_nv12, 1);
        assert_eq!(s.frames_by_source.cpu_rgba, 1);
        assert_eq!(s.frames_by_source.unknown, 0);
    }

    #[test]
    fn test_record_frame_source_direct() {
        let c = SessionTelemetryCollector::new();
        c.record_frame_source("dxgi-zero-copy");
        c.record_frame_source("cpu-nv12");
        c.record_frame_source("cpu-rgba");
        c.record_frame_source("unknown-path");

        let s = c.snapshot();
        assert_eq!(s.frames_produced, 4);
        assert_eq!(s.frames_by_source.dxgi_nv12, 1);
        assert_eq!(s.frames_by_source.cpu_nv12, 1);
        assert_eq!(s.frames_by_source.cpu_rgba, 1);
        assert_eq!(s.frames_by_source.unknown, 1);
    }

    #[test]
    fn reset_session_clears_all_state() {
        let c = SessionTelemetryCollector::new();
        c.push(&rgba_frame(5000, Some(300), true, false));
        assert_eq!(c.frames_produced(), 1);

        c.reset_session();
        let s = c.snapshot();
        assert_eq!(s.frames_produced, 0);
        assert!(s.avg_decode_us.is_none());
        assert!(s.avg_queue_wait_us.is_none());
    }

    #[test]
    fn policy_events_accumulate() {
        let c = SessionTelemetryCollector::new();
        c.record_policy_event(true, false);
        c.record_policy_event(true, false);
        c.record_policy_event(false, true);

        let s = c.snapshot();
        assert_eq!(s.policy_background_pauses, 2);
        assert_eq!(s.policy_interactive_throttles, 1);
    }

    #[test]
    fn session_duration_is_positive() {
        let c = SessionTelemetryCollector::new();
        std::thread::sleep(std::time::Duration::from_millis(1));
        assert!(c.snapshot().session_duration_secs > 0.0);
    }
}
