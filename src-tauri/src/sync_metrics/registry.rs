use super::snapshots::{seek_snapshot, snapshot_with, SeekEvent, SyncMetricsSnapshot};
use super::{trace_event, MAX_SEEK_EVENTS, SEEK_CORRECTNESS_TOLERANCE_MICROS};
use crate::sync_metrics::drift::DriftAccumulator;
use crate::sync_metrics::pacing::FramePacingAccumulator;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

#[derive(Default, Debug)]
pub struct SyncMetricsRegistry {
    pub av_drift: DriftAccumulator,
    pub frame_pacing: FramePacingAccumulator,
    pub dropped_frames: AtomicU64,
    pub lookahead_misses: AtomicU64,
    pub(super) seek_events: parking_lot::Mutex<VecDeque<SeekEvent>>,
    pub(super) pending_seeks: parking_lot::Mutex<VecDeque<(i64, Instant)>>,
}

impl SyncMetricsRegistry {
    pub fn record_dropped_frame(&self) {
        // This is a realtime hot path. Keep the counter lock-free and emit the
        // result only from the bounded periodic aggregate below.
        self.dropped_frames.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a lookahead queue miss: the playback demand arrived before
    /// the background decoder had a frame ready. This is NOT a visual drop
    /// (the compositor shows the closest queued frame), but it is a signal
    /// that the lookahead depth or decode throughput is insufficient.
    pub fn record_lookahead_miss(&self) {
        self.lookahead_misses.fetch_add(1, Ordering::Relaxed);
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
        let mut pending = self.pending_seeks.lock();
        if pending.is_empty() {
            return;
        }

        // 1. Drain ancient pending seeks (>2s old) abandoned during past rapid scrubbing runs.
        while let Some((_, requested_at)) = pending.front() {
            if requested_at.elapsed().as_millis() > 2000 {
                pending.pop_front();
            } else {
                break;
            }
        }
        if pending.is_empty() {
            return;
        }

        // 2. Look for a seek request whose target matches the presented frame timestamp.
        let match_tolerance = SEEK_CORRECTNESS_TOLERANCE_MICROS.max(50_000);
        let matching_idx = pending.iter().position(|(requested_ticks, _)| {
            (presented_ticks - *requested_ticks).saturating_abs() <= match_tolerance
        });

        let (requested_ticks, requested_at, correct) = if let Some(idx) = matching_idx {
            // If in active continuous playback (measure_pacing == true), do not resolve
            // ancient scrub seeks (>800ms old) that were abandoned when playback began;
            // passing their timestamp during continuous playback is normal timeline progress.
            if measure_pacing && pending[idx].1.elapsed() > std::time::Duration::from_millis(800) {
                for _ in 0..=idx {
                    pending.pop_front();
                }
                return;
            }
            // Found matching target. Drain this seek and any earlier seeks that were
            // superseded when the user scrubbed past them.
            let matched = pending.remove(idx).unwrap();
            for _ in 0..idx {
                pending.pop_front();
            }
            (matched.0, matched.1, true)
        } else if !measure_pacing {
            // Paused interactive scrub/seek frame presentation: resolve the latest seek target.
            let (target_ticks, target_at) = pending.pop_back().unwrap();
            pending.clear();
            let is_correct = (presented_ticks - target_ticks).saturating_abs() <= match_tolerance;
            (target_ticks, target_at, is_correct)
        } else {
            // In active continuous playback (measure_pacing == true), do not pop unrelated
            // ancient scrub seeks against nominal playback frames.
            return;
        };

        let latency_micros = requested_at.elapsed().as_micros().min(i64::MAX as u128) as i64;
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
        let lookahead_misses = self.lookahead_misses.swap(0, Ordering::Relaxed);
        let seeks = {
            let mut events = self.seek_events.lock();
            seek_snapshot(events.drain(..).collect())
        };
        snapshot_with(
            av_drift,
            frame_pacing,
            dropped_frames,
            lookahead_misses,
            seeks,
        )
    }

    pub fn snapshot(&self) -> SyncMetricsSnapshot {
        let seeks = seek_snapshot(self.seek_events.lock().iter().cloned().collect());
        snapshot_with(
            self.av_drift.snapshot(),
            self.frame_pacing.snapshot(),
            self.dropped_frames.load(Ordering::Relaxed),
            self.lookahead_misses.load(Ordering::Relaxed),
            seeks,
        )
    }
}
