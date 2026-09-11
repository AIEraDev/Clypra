//! Bounded A/V synchronization and presentation metrics.
//!
//! These metrics are intentionally additive: they observe native presentation
//! and audio-clock decisions without changing playback policy or timing.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::VecDeque;
use std::fmt::Display;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_PERCENTILE_SAMPLES: usize = 500;
const MAX_SEEK_EVENTS: usize = 50;
const SEEK_CORRECTNESS_TOLERANCE_MICROS: i64 = 16_000;

// ── Drift Suppression Configuration ─────────────────────────────────────────
//
// These values gate when a drift sample is flagged as suppressed rather than
// counted as a real synchronisation error.
//
// Suppression fires when:
//   clock_freshness_us > max(median_interval_us * staleness_multiplier,
//                            staleness_floor_us)
//
// Both fields live in `DriftSuppressionConfig` so they can be adjusted at
// runtime (e.g. from a diagnostic command or feature flag) without a source
// edit and release cut. The defaults below match the original constants; the
// values in effect at suppression time are recorded in `DriftSnapshot` so
// post-ship queries can audit whether the threshold was over- or under-tuned
// across real sessions.

/// Runtime-tunable suppression parameters for `DriftAccumulator`.
///
/// The defaults are conservative: the floor (50 ms) dominates for common
/// 512-frame / 44.1 kHz buffers; the multiplier only binds for ≥1,024-frame
/// buffers or lower sample rates. Adjust after validating the suppression
/// rate distribution from `p95_abs_micros_suppressed` in production.
#[derive(Debug, Clone, Copy)]
pub struct DriftSuppressionConfig {
    /// Multiplier applied to the median callback interval. 3× gives two
    /// missed callbacks of headroom before a sample is suppressed.
    pub staleness_multiplier: f64,
    /// Absolute floor in microseconds (50 ms default). Prevents the threshold
    /// from collapsing on very fast callbacks, and is the effective threshold
    /// for the common 512-frame / 44.1 kHz cadence (~11.6 ms interval).
    pub staleness_floor_us: u64,
}

impl Default for DriftSuppressionConfig {
    fn default() -> Self {
        Self {
            staleness_multiplier: 3.0,
            staleness_floor_us: 50_000,
        }
    }
}

// ── DriftAccumulator ─────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct DriftAccumulator {
    // ── Active (non-suppressed) samples ──────────────────────────────────────
    pub count: AtomicU64,
    pub sum_micros: AtomicI64,
    pub max_abs_micros: AtomicI64,
    samples_p95: parking_lot::Mutex<Vec<i64>>,

    // ── Suppressed samples (audit track) ─────────────────────────────────────
    // Suppressed samples are stored separately and never mixed into the active
    // percentile calculation. The audit buffer lets post-ship queries verify
    // the guard is firing on the right condition rather than over-suppressing.
    pub suppressed_count: AtomicU64,
    suppressed_p95: parking_lot::Mutex<Vec<i64>>,

    // ── Runtime-tunable suppression config ───────────────────────────────────
    // Held behind a Mutex so diagnostic commands can update it without a
    // release cut. Reads happen only in record_with_freshness (video thread,
    // not the audio callback), so lock contention is not a concern.
    pub suppression_config: parking_lot::Mutex<DriftSuppressionConfig>,
}

impl Default for DriftAccumulator {
    fn default() -> Self {
        Self {
            count: AtomicU64::new(0),
            sum_micros: AtomicI64::new(0),
            max_abs_micros: AtomicI64::new(0),
            samples_p95: parking_lot::Mutex::new(Vec::new()),
            suppressed_count: AtomicU64::new(0),
            suppressed_p95: parking_lot::Mutex::new(Vec::new()),
            suppression_config: parking_lot::Mutex::new(DriftSuppressionConfig::default()),
        }
    }
}

impl DriftAccumulator {
    /// Record a drift sample without freshness checking.
    ///
    /// Use this when no audio clock is present (e.g. export or silent preview)
    /// and the caller has already determined the sample should be counted.
    /// For all normal A/V sync paths, prefer `record_with_freshness`.
    pub fn record(&self, drift_micros: i64) {
        self.count.fetch_add(1, Ordering::Relaxed);
        self.sum_micros.fetch_add(drift_micros, Ordering::Relaxed);
        self.max_abs_micros
            .fetch_max(drift_micros.saturating_abs(), Ordering::Relaxed);
        let mut samples = self.samples_p95.lock();
        samples.push(drift_micros);
        if samples.len() > MAX_PERCENTILE_SAMPLES {
            samples.remove(0);
        }
    }

    /// Record a drift sample with audio-clock freshness checking.
    ///
    /// When the clock is stale — meaning the CPAL callback has not advanced
    /// `position_ticks` recently — the measurement is not a real A/V error:
    /// it reflects a frozen clock reading, not actual playback drift.
    ///
    /// Stale samples are stored in a separate audit buffer (`suppressed_count`,
    /// `p95_abs_micros_suppressed` in the snapshot) rather than dropped.
    /// This lets callers confirm the guard is catching what it should rather
    /// than silently discarding data.
    ///
    /// # Arguments
    /// * `drift_micros` — signed drift: `frame_position_ticks - audio_ticks` (µs).
    /// * `clock_freshness_us` — µs since last CPAL callback; `None` if the
    ///   clock has never fired (stream not yet started).
    /// * `median_callback_interval_us` — median of recent callback intervals
    ///   in µs, used to adapt the threshold. Pass `None` when not available;
    ///   the floor constant is used instead.
    pub fn record_with_freshness(
        &self,
        drift_micros: i64,
        clock_freshness_us: Option<u64>,
        median_callback_interval_us: Option<u64>,
    ) {
        let config = *self.suppression_config.lock();
        let is_stale = match clock_freshness_us {
            // Clock has never fired — always suppress. This is the
            // "no audio track / audio not yet started" case.
            None => true,
            Some(freshness_us) => {
                let threshold_us = match median_callback_interval_us {
                    Some(interval_us) => {
                        let adaptive = (interval_us as f64 * config.staleness_multiplier) as u64;
                        adaptive.max(config.staleness_floor_us)
                    }
                    // No interval history yet (first few callbacks) — use floor.
                    None => config.staleness_floor_us,
                };
                freshness_us > threshold_us
            }
        };

        if is_stale {
            // Audit path: count and store but do not affect the active metrics.
            self.suppressed_count.fetch_add(1, Ordering::Relaxed);
            let mut suppressed = self.suppressed_p95.lock();
            suppressed.push(drift_micros);
            if suppressed.len() > MAX_PERCENTILE_SAMPLES {
                suppressed.remove(0);
            }
        } else {
            self.record(drift_micros);
        }
    }

    fn take_and_reset(&self) -> DriftSnapshot {
        let count = self.count.swap(0, Ordering::Relaxed);
        let sum = self.sum_micros.swap(0, Ordering::Relaxed);
        let max_abs = self.max_abs_micros.swap(0, Ordering::Relaxed);
        let suppressed_n = self.suppressed_count.swap(0, Ordering::Relaxed);
        let config = *self.suppression_config.lock();

        let mut samples = self.samples_p95.lock();
        let p95_abs = percentile_abs(&samples, 0.95);
        samples.clear();

        let mut suppressed = self.suppressed_p95.lock();
        let p95_abs_micros_suppressed = if suppressed_n > 0 {
            Some(percentile_abs(&suppressed, 0.95))
        } else {
            None
        };
        suppressed.clear();

        DriftSnapshot {
            n: count,
            avg_micros: if count == 0 {
                0.0
            } else {
                sum as f64 / count as f64
            },
            max_abs_micros: max_abs,
            p95_abs_micros: p95_abs,
            suppressed_n,
            p95_abs_micros_suppressed,
            suppression_multiplier: config.staleness_multiplier,
            suppression_floor_us: config.staleness_floor_us,
        }
    }

    fn snapshot(&self) -> DriftSnapshot {
        let count = self.count.load(Ordering::Relaxed);
        let sum = self.sum_micros.load(Ordering::Relaxed);
        let max_abs = self.max_abs_micros.load(Ordering::Relaxed);
        let suppressed_n = self.suppressed_count.load(Ordering::Relaxed);
        let config = *self.suppression_config.lock();

        let samples = self.samples_p95.lock();
        let suppressed = self.suppressed_p95.lock();
        let p95_abs_micros_suppressed = if suppressed_n > 0 {
            Some(percentile_abs(&suppressed, 0.95))
        } else {
            None
        };

        DriftSnapshot {
            n: count,
            avg_micros: if count == 0 {
                0.0
            } else {
                sum as f64 / count as f64
            },
            max_abs_micros: max_abs,
            p95_abs_micros: percentile_abs(&samples, 0.95),
            suppressed_n,
            p95_abs_micros_suppressed,
            suppression_multiplier: config.staleness_multiplier,
            suppression_floor_us: config.staleness_floor_us,
        }
    }
}

fn percentile_abs(samples: &[i64], percentile: f64) -> i64 {
    if samples.is_empty() {
        return 0;
    }
    let mut absolute: Vec<i64> = samples
        .iter()
        .map(|sample| sample.saturating_abs())
        .collect();
    absolute.sort_unstable();
    let index = ((absolute.len() as f64 - 1.0) * percentile.clamp(0.0, 1.0)).round() as usize;
    absolute[index.min(absolute.len() - 1)]
}

#[derive(Default, Debug)]
pub struct FramePacingAccumulator {
    last_frame_instant: parking_lot::Mutex<Option<Instant>>,
    intervals: parking_lot::Mutex<Vec<(i64, i64)>>,
}

impl FramePacingAccumulator {
    pub fn record_frame_presented(&self, target_interval_micros: i64) {
        let mut last = self.last_frame_instant.lock();
        let now = Instant::now();
        if let Some(previous) = *last {
            let actual = now
                .duration_since(previous)
                .as_micros()
                .min(i64::MAX as u128) as i64;
            let mut intervals = self.intervals.lock();
            intervals.push((actual, target_interval_micros.max(1)));
            if intervals.len() > MAX_PERCENTILE_SAMPLES {
                intervals.remove(0);
            }
        }
        *last = Some(now);
    }

    pub fn reset_last_frame(&self) {
        *self.last_frame_instant.lock() = None;
    }

    fn take_and_reset(&self) -> FramePacingSnapshot {
        let mut intervals = self.intervals.lock();
        let snapshot = pacing_snapshot(&intervals);
        intervals.clear();
        snapshot
    }

    fn snapshot(&self) -> FramePacingSnapshot {
        pacing_snapshot(&self.intervals.lock())
    }
}

fn pacing_snapshot(intervals: &[(i64, i64)]) -> FramePacingSnapshot {
    if intervals.is_empty() {
        return FramePacingSnapshot::default();
    }
    let actual_mean = intervals
        .iter()
        .map(|(actual, _)| *actual as f64)
        .sum::<f64>()
        / intervals.len() as f64;
    let variance = intervals
        .iter()
        .map(|(actual, _)| (*actual as f64 - actual_mean).powi(2))
        .sum::<f64>()
        / intervals.len() as f64;
    let target = intervals
        .iter()
        .map(|(_, target)| *target as f64)
        .sum::<f64>()
        / intervals.len() as f64;
    let jank_events = intervals
        .iter()
        .filter(|(actual, target)| *actual as f64 > *target as f64 * 1.5)
        .count() as u64;
    FramePacingSnapshot {
        n: intervals.len() as u64,
        target_interval_micros: target,
        stddev_micros: variance.sqrt(),
        jank_events,
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DriftSnapshot {
    /// Number of active (non-suppressed) drift samples in this window.
    pub n: u64,
    pub avg_micros: f64,
    pub max_abs_micros: i64,
    /// P95 absolute drift computed from active samples only.
    /// This is the number to use for dashboard reporting once the suppression
    /// guard is validated. See also `p95_abs_micros_suppressed`.
    pub p95_abs_micros: i64,
    /// Number of drift samples suppressed this window because the audio clock
    /// was stale at measurement time. Non-zero values indicate the guard fired;
    /// use `p95_abs_micros_suppressed` to audit what was suppressed.
    pub suppressed_n: u64,
    /// P95 absolute drift of suppressed samples only. `None` when `suppressed_n`
    /// is zero. Use this to confirm the guard is catching invalid readings
    /// (expected: large values corresponding to frame timestamps) rather than
    /// real drift events (unexpected: small values similar to active samples).
    pub p95_abs_micros_suppressed: Option<i64>,
    /// Suppression config that was active at the time this snapshot was taken.
    /// Note: this is a per-window value, not per-sample — it reflects the config
    /// at snapshot/reset time, not necessarily the config in effect for every
    /// individual suppressed sample within the window. In practice this is
    /// equivalent as long as config changes are infrequent and discrete (release
    /// boundaries or explicit diagnostic pushes), which is the expected pattern.
    /// If per-sample attribution is ever required, threshold values would need
    /// to travel in the suppressed_p95 buffer alongside each drift measurement.
    pub suppression_multiplier: f64,
    pub suppression_floor_us: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct FramePacingSnapshot {
    pub n: u64,
    pub target_interval_micros: f64,
    pub stddev_micros: f64,
    pub jank_events: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeekEvent {
    pub requested_ticks: i64,
    pub presented_ticks: i64,
    pub latency_micros: i64,
    pub correct: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SeekSnapshot {
    pub n: u64,
    pub avg_latency_micros: f64,
    pub max_latency_micros: i64,
    pub correct: u64,
    pub events: Vec<SeekEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncMetricsSnapshot {
    pub av_drift: DriftSnapshot,
    pub frame_pacing: FramePacingSnapshot,
    pub dropped_frames: u64,
    pub seeks: SeekSnapshot,
    pub timestamp_epoch_ms: u64,
}

#[derive(Default, Debug)]
pub struct SyncMetricsRegistry {
    pub av_drift: DriftAccumulator,
    pub frame_pacing: FramePacingAccumulator,
    pub dropped_frames: AtomicU64,
    seek_events: parking_lot::Mutex<VecDeque<SeekEvent>>,
    pending_seeks: parking_lot::Mutex<VecDeque<(i64, Instant)>>,
}

impl SyncMetricsRegistry {
    pub fn record_dropped_frame(&self) {
        // This is a realtime hot path. Keep the counter lock-free and emit the
        // result only from the bounded periodic aggregate below.
        self.dropped_frames.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_seek_requested(&self, requested_ticks: i64) {
        let mut pending = self.pending_seeks.lock();
        pending.push_back((requested_ticks, Instant::now()));
        while pending.len() > MAX_SEEK_EVENTS {
            pending.pop_front();
        }
        let pending_count = pending.len();
        drop(pending);
        trace_event(
            "seek_requested",
            format_args!("requested_ticks={requested_ticks} pending={pending_count}"),
        );
    }

    pub fn record_frame_presented(&self, presented_ticks: i64, target_interval_micros: i64) {
        self.record_frame_presented_with_pacing(presented_ticks, target_interval_micros, true);
    }

    pub fn record_frame_presented_with_pacing(
        &self,
        presented_ticks: i64,
        target_interval_micros: i64,
        measure_pacing: bool,
    ) {
        self.record_frame_presented_with_options(
            presented_ticks,
            target_interval_micros,
            measure_pacing,
            true,
        );
    }

    pub fn record_frame_presented_with_options(
        &self,
        presented_ticks: i64,
        target_interval_micros: i64,
        measure_pacing: bool,
        resolve_seek: bool,
    ) {
        if measure_pacing {
            self.frame_pacing
                .record_frame_presented(target_interval_micros);
        } else {
            // Do not bridge a paused/seek frame to the next playback frame;
            // that would turn a normal pause into seconds of fake jank.
            self.frame_pacing.reset_last_frame();
        }
        if !resolve_seek {
            return;
        }
        let Some((requested_ticks, requested_at)) = self.pending_seeks.lock().pop_front() else {
            return;
        };
        let latency_micros = requested_at.elapsed().as_micros().min(i64::MAX as u128) as i64;
        let correct = (presented_ticks - requested_ticks).saturating_abs()
            <= SEEK_CORRECTNESS_TOLERANCE_MICROS;
        let mut events = self.seek_events.lock();
        events.push_back(SeekEvent {
            requested_ticks,
            presented_ticks,
            latency_micros,
            correct,
        });
        while events.len() > MAX_SEEK_EVENTS {
            events.pop_front();
        }
        trace_event(
            "seek_resolved",
            format_args!(
                "requested_ticks={requested_ticks} presented_ticks={presented_ticks} latency_micros={latency_micros} correct={correct}"
            ),
        );
    }

    pub fn take_and_reset(&self) -> SyncMetricsSnapshot {
        let av_drift = self.av_drift.take_and_reset();
        let frame_pacing = self.frame_pacing.take_and_reset();
        let dropped_frames = self.dropped_frames.swap(0, Ordering::Relaxed);
        let seeks = {
            let mut events = self.seek_events.lock();
            seek_snapshot(events.drain(..).collect())
        };
        snapshot_with(av_drift, frame_pacing, dropped_frames, seeks)
    }

    pub fn snapshot(&self) -> SyncMetricsSnapshot {
        let seeks = seek_snapshot(self.seek_events.lock().iter().cloned().collect());
        snapshot_with(
            self.av_drift.snapshot(),
            self.frame_pacing.snapshot(),
            self.dropped_frames.load(Ordering::Relaxed),
            seeks,
        )
    }
}

fn seek_snapshot(events: Vec<SeekEvent>) -> SeekSnapshot {
    let n = events.len() as u64;
    let total_latency = events
        .iter()
        .map(|event| event.latency_micros as f64)
        .sum::<f64>();
    SeekSnapshot {
        n,
        avg_latency_micros: if n == 0 {
            0.0
        } else {
            total_latency / n as f64
        },
        max_latency_micros: events
            .iter()
            .map(|event| event.latency_micros)
            .max()
            .unwrap_or(0),
        correct: events.iter().filter(|event| event.correct).count() as u64,
        events,
    }
}

fn snapshot_with(
    av_drift: DriftSnapshot,
    frame_pacing: FramePacingSnapshot,
    dropped_frames: u64,
    seeks: SeekSnapshot,
) -> SyncMetricsSnapshot {
    let timestamp_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    SyncMetricsSnapshot {
        av_drift,
        frame_pacing,
        dropped_frames,
        seeks,
        timestamp_epoch_ms,
    }
}

pub static SYNC_METRICS: Lazy<SyncMetricsRegistry> = Lazy::new(SyncMetricsRegistry::default);
/// Retained as a compatibility hook for native callers. Diagnostics are
/// delivered through the Tauri event bridge instead of blocking stderr.
pub fn trace_event(_event: &str, _details: impl Display) {
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn drift_snapshot_reports_signed_average_and_percentiles() {
        let accumulator = DriftAccumulator::default();
        accumulator.record(-10);
        accumulator.record(20);
        accumulator.record(30);
        let snapshot = accumulator.take_and_reset();
        assert_eq!(snapshot.n, 3);
        assert!((snapshot.avg_micros - 13.333).abs() < 0.01);
        assert_eq!(snapshot.max_abs_micros, 30);
        assert_eq!(snapshot.p95_abs_micros, 30);
        assert_eq!(snapshot.suppressed_n, 0);
        assert!(snapshot.p95_abs_micros_suppressed.is_none());
        assert_eq!(accumulator.take_and_reset().n, 0);
    }

    #[test]
    fn drift_samples_are_bounded() {
        let accumulator = DriftAccumulator::default();
        for value in 0..(MAX_PERCENTILE_SAMPLES + 100) {
            accumulator.record(value as i64);
        }
        let snapshot = accumulator.take_and_reset();
        assert_eq!(snapshot.n, (MAX_PERCENTILE_SAMPLES + 100) as u64);
        assert_eq!(snapshot.p95_abs_micros, 574);
    }

    // ── Freshness suppression tests ───────────────────────────────────────────

    #[test]
    fn fresh_clock_records_normally() {
        let acc = DriftAccumulator::default();
        // freshness_us=1_000 (1 ms), interval=10_000 (10 ms)
        // threshold = max(10_000 × 3, 50_000) = 50_000 (floor wins)
        // 1_000 < 50_000 → should NOT be suppressed
        acc.record_with_freshness(500, Some(1_000), Some(10_000));
        let snap = acc.take_and_reset();
        assert_eq!(snap.n, 1, "active count");
        assert_eq!(snap.suppressed_n, 0, "suppressed count");
        assert!(snap.p95_abs_micros_suppressed.is_none());
    }

    #[test]
    fn stale_clock_goes_to_audit_buffer() {
        let acc = DriftAccumulator::default();
        // freshness_us=100_000 (100 ms), threshold = max(10_000*3, 50_000) = 50_000
        // 100_000 > 50_000 → should be suppressed
        acc.record_with_freshness(3_000_000, Some(100_000), Some(10_000));
        let snap = acc.take_and_reset();
        assert_eq!(snap.n, 0, "active count must be zero");
        assert_eq!(snap.suppressed_n, 1, "suppressed count");
        assert_eq!(snap.p95_abs_micros_suppressed, Some(3_000_000));
    }

    #[test]
    fn never_fired_clock_is_always_suppressed() {
        let acc = DriftAccumulator::default();
        // clock_freshness_us=None means stream never started
        acc.record_with_freshness(5_000_000, None, None);
        let snap = acc.take_and_reset();
        assert_eq!(snap.n, 0);
        assert_eq!(snap.suppressed_n, 1);
    }

    #[test]
    fn floor_applies_when_no_interval_history() {
        let acc = DriftAccumulator::default();
        // No interval history → threshold = floor = 50_000
        // freshness_us=40_000 < 50_000 → active
        acc.record_with_freshness(200, Some(40_000), None);
        let snap = acc.take_and_reset();
        assert_eq!(snap.n, 1);
        assert_eq!(snap.suppressed_n, 0);

        // freshness_us=60_000 > 50_000 → suppressed
        acc.record_with_freshness(200, Some(60_000), None);
        let snap2 = acc.take_and_reset();
        assert_eq!(snap2.n, 0);
        assert_eq!(snap2.suppressed_n, 1);
    }

    #[test]
    fn active_and_suppressed_samples_accumulate_independently() {
        let acc = DriftAccumulator::default();
        // 3 active, 2 suppressed
        for _ in 0..3 {
            acc.record_with_freshness(100, Some(1_000), Some(10_000));
        }
        for _ in 0..2 {
            acc.record_with_freshness(9_000_000, Some(200_000), Some(10_000));
        }
        let snap = acc.take_and_reset();
        assert_eq!(snap.n, 3);
        assert_eq!(snap.suppressed_n, 2);
        assert_eq!(snap.p95_abs_micros, 100);
        assert_eq!(snap.p95_abs_micros_suppressed, Some(9_000_000));
        // Verify reset clears both
        let empty = acc.take_and_reset();
        assert_eq!(empty.n, 0);
        assert_eq!(empty.suppressed_n, 0);
    }

    #[test]
    fn suppressed_samples_do_not_inflate_active_p95() {
        let acc = DriftAccumulator::default();
        // One real small drift, two suppressed huge values
        acc.record_with_freshness(500, Some(1_000), Some(10_000));
        acc.record_with_freshness(5_000_000, None, None);
        acc.record_with_freshness(5_000_000, None, None);
        let snap = acc.take_and_reset();
        assert_eq!(snap.p95_abs_micros, 500, "active P95 must not be polluted by suppressed samples");
    }

    // ── Existing registry tests ───────────────────────────────────────────────

    #[test]
    fn pacing_counts_jank_and_resets() {
        let accumulator = FramePacingAccumulator::default();
        *accumulator.last_frame_instant.lock() = Some(Instant::now() - Duration::from_millis(60));
        accumulator.record_frame_presented(33_333);
        let snapshot = accumulator.take_and_reset();
        assert_eq!(snapshot.n, 1);
        assert_eq!(snapshot.jank_events, 1);
        assert_eq!(accumulator.take_and_reset().n, 0);
    }

    #[test]
    fn non_playback_frames_do_not_bridge_pacing_across_a_pause() {
        let registry = SyncMetricsRegistry::default();
        registry.record_frame_presented_with_pacing(0, 33_333, true);
        registry.record_frame_presented_with_pacing(33_333, 33_333, false);
        registry.record_frame_presented_with_pacing(66_666, 33_333, true);

        assert_eq!(registry.frame_pacing.take_and_reset().n, 0);
    }

    #[test]
    fn lookahead_frames_do_not_resolve_pending_seek() {
        let registry = SyncMetricsRegistry::default();
        registry.record_seek_requested(100_000);
        registry.record_frame_presented_with_options(200_000, 33_333, true, false);
        assert_eq!(registry.seek_events.lock().len(), 0);

        registry.record_frame_presented_with_options(100_000, 33_333, true, true);
        let snapshot = registry.take_and_reset();
        assert_eq!(snapshot.seeks.n, 1);
        assert_eq!(snapshot.seeks.correct, 1);
    }

    #[test]
    fn seek_events_and_pending_requests_are_bounded() {
        let registry = SyncMetricsRegistry::default();
        for requested_ticks in 0..(MAX_SEEK_EVENTS + 10) as i64 {
            registry.record_seek_requested(requested_ticks);
        }
        for presented_ticks in 10..(MAX_SEEK_EVENTS + 10) as i64 {
            registry.record_frame_presented(presented_ticks, 33_333);
        }

        let snapshot = registry.take_and_reset();
        assert_eq!(snapshot.seeks.n, MAX_SEEK_EVENTS as u64);
        assert_eq!(snapshot.seeks.correct, MAX_SEEK_EVENTS as u64);
        assert_eq!(snapshot.seeks.events.first().unwrap().requested_ticks, 10);
        assert_eq!(registry.take_and_reset().seeks.n, 0);
    }
}
