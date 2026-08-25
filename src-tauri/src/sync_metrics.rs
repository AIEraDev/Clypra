//! Bounded A/V synchronization and presentation metrics.
//!
//! These metrics are intentionally additive: they observe native presentation
//! and audio-clock decisions without changing playback policy or timing.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::VecDeque;
use std::fmt::Display;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_PERCENTILE_SAMPLES: usize = 500;
const MAX_SEEK_EVENTS: usize = 50;
const SEEK_CORRECTNESS_TOLERANCE_MICROS: i64 = 16_000;

#[derive(Default, Debug)]
pub struct DriftAccumulator {
    pub count: AtomicU64,
    pub sum_micros: AtomicI64,
    pub max_abs_micros: AtomicI64,
    samples_p95: parking_lot::Mutex<Vec<i64>>,
}

impl DriftAccumulator {
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

    fn take_and_reset(&self) -> DriftSnapshot {
        let count = self.count.swap(0, Ordering::Relaxed);
        let sum = self.sum_micros.swap(0, Ordering::Relaxed);
        let max_abs = self.max_abs_micros.swap(0, Ordering::Relaxed);
        let mut samples = self.samples_p95.lock();
        let p95_abs = percentile_abs(&samples, 0.95);
        samples.clear();
        DriftSnapshot {
            n: count,
            avg_micros: if count == 0 {
                0.0
            } else {
                sum as f64 / count as f64
            },
            max_abs_micros: max_abs,
            p95_abs_micros: p95_abs,
        }
    }

    fn snapshot(&self) -> DriftSnapshot {
        let count = self.count.load(Ordering::Relaxed);
        let sum = self.sum_micros.load(Ordering::Relaxed);
        let max_abs = self.max_abs_micros.load(Ordering::Relaxed);
        let samples = self.samples_p95.lock();
        DriftSnapshot {
            n: count,
            avg_micros: if count == 0 {
                0.0
            } else {
                sum as f64 / count as f64
            },
            max_abs_micros: max_abs,
            p95_abs_micros: percentile_abs(&samples, 0.95),
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
    pub n: u64,
    pub avg_micros: f64,
    pub max_abs_micros: i64,
    pub p95_abs_micros: i64,
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
        let dropped_frames = self.dropped_frames.fetch_add(1, Ordering::Relaxed) + 1;
        trace_event(
            "frame_dropped",
            format_args!("dropped_frames={dropped_frames}"),
        );
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
        trace_event(
            "frame_presented",
            format_args!(
                "presented_ticks={presented_ticks} target_interval_micros={target_interval_micros} measure_pacing={measure_pacing} resolve_seek={resolve_seek}"
            ),
        );
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
static FLUSH_LOOP_STARTED: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
static TRACE_ENABLED: Lazy<bool> = Lazy::new(|| {
    ["CLYPRA_TRACE_AV_SYNC", "CLYPRA_TRACE_SYNC"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .any(|value| value == "1" || value.eq_ignore_ascii_case("true"))
});

/// Emit high-volume native events only when explicitly enabled. The stable
/// marker and epoch timestamp make Rust stderr and browser console output
/// searchable and correlatable during playback investigations.
pub fn trace_event(event: &str, details: impl Display) {
    if !*TRACE_ENABLED {
        return;
    }
    let timestamp_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    eprintln!(
        "[av-sync][rust] source=rust event={event} ts_epoch_ms={timestamp_epoch_ms} {details}"
    );
}

pub fn ensure_metrics_flush_loop() {
    if FLUSH_LOOP_STARTED.swap(1, Ordering::SeqCst) != 0 {
        return;
    }
    // Tauri setup runs synchronously and is not guaranteed to be inside a
    // Tokio context. Use Tauri's runtime bridge so startup never panics with
    // "there is no reactor running".
    tauri::async_runtime::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            flush_periodic_metrics();
        }
    });
}

fn flush_periodic_metrics() {
    let snapshot = SYNC_METRICS.take_and_reset();
    if snapshot.av_drift.n == 0
        && snapshot.frame_pacing.n == 0
        && snapshot.dropped_frames == 0
        && snapshot.seeks.n == 0
    {
        return;
    }
    let window_id = snapshot.timestamp_epoch_ms / 5_000;
    eprintln!(
        "─────── 🎯 [A/V Sync Metrics: 5s Window] [av-sync][rust] source=rust event=window_flush ts_epoch_ms={} window_id={} ───────",
        snapshot.timestamp_epoch_ms,
        window_id,
    );
    if snapshot.av_drift.n > 0 || snapshot.dropped_frames > 0 {
        eprintln!(
            "[av-sync][rust] source=rust event=drift_window n={} avg={:+.2}ms max_abs={:.2}ms p95_abs={:.2}ms dropped={}",
            snapshot.av_drift.n,
            snapshot.av_drift.avg_micros / 1000.0,
            snapshot.av_drift.max_abs_micros as f64 / 1000.0,
            snapshot.av_drift.p95_abs_micros as f64 / 1000.0,
            snapshot.dropped_frames,
        );
    }
    if snapshot.frame_pacing.n > 0 {
        eprintln!(
            "[av-sync][rust] source=rust event=pacing_window target={:.2}ms stddev={:.2}ms jank_events={}",
            snapshot.frame_pacing.target_interval_micros / 1000.0,
            snapshot.frame_pacing.stddev_micros / 1000.0,
            snapshot.frame_pacing.jank_events,
        );
    }
    if snapshot.seeks.n > 0 {
        eprintln!(
            "[av-sync][rust] source=rust event=seek_window seeks={} avg_latency={:.2}ms max_latency={:.2}ms correct={}/{}",
            snapshot.seeks.n,
            snapshot.seeks.avg_latency_micros / 1000.0,
            snapshot.seeks.max_latency_micros as f64 / 1000.0,
            snapshot.seeks.correct,
            snapshot.seeks.n,
        );
    }
    eprintln!("─────────────────────────────────────────────────");
}

#[cfg(test)]
mod tests {
    use super::*;

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
