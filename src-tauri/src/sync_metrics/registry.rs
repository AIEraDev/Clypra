use super::snapshots::{seek_snapshot, snapshot_with, SeekEvent, SyncMetricsSnapshot};
use super::{trace_event, MAX_SEEK_EVENTS, SEEK_CORRECTNESS_TOLERANCE_MICROS};
use crate::sync_metrics::drift::DriftAccumulator;
use crate::sync_metrics::pacing::FramePacingAccumulator;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

#[derive(Debug, Clone, Copy)]
pub(super) struct PendingSeek {
    pub(super) requested_ticks: i64,
    pub(super) requested_at: Instant,
    pub(super) generation: Option<u64>,
}

#[derive(Default, Debug)]
pub struct SyncMetricsRegistry {
    pub av_drift: DriftAccumulator,
    pub frame_pacing: FramePacingAccumulator,
    pub dropped_frames: AtomicU64,
    pub lookahead_misses: AtomicU64,
    pub(super) seek_events: parking_lot::Mutex<VecDeque<SeekEvent>>,
    pub(super) pending_seeks: parking_lot::Mutex<VecDeque<PendingSeek>>,
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
        self.record_seek_requested_with_generation(requested_ticks, None);
    }

    /// Bind an audio seek to the preview demand generation when the caller
    /// has one. A paused frame from an older generation must not settle the
    /// latest seek merely because it is the next frame to reach the surface.
    pub fn record_seek_requested_with_generation(
        &self,
        requested_ticks: i64,
        generation: Option<u64>,
    ) {
        let mut pending = self.pending_seeks.lock();
        if let Some(generation) = generation {
            // A newer interaction supersedes every older correlated seek.
            // Retire those records immediately instead of letting a late
            // decoded frame convert them into a fast-but-wrong resolution.
            pending.retain(|pending_seek| {
                pending_seek
                    .generation
                    .is_none_or(|pending_generation| pending_generation >= generation)
            });
        }
        pending.push_back(PendingSeek {
            requested_ticks,
            requested_at: Instant::now(),
            generation,
        });
        while pending.len() > MAX_SEEK_EVENTS {
            pending.pop_front();
        }
        let pending_count = pending.len();
        drop(pending);
        trace_event(
            "seek_requested",
            format_args!(
                "requested_ticks={requested_ticks} generation={generation:?} pending={pending_count}"
            ),
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
        self.record_frame_presented_with_generation(
            presented_ticks,
            target_interval_micros,
            measure_pacing,
            resolve_seek,
            None,
        );
    }

    pub fn record_frame_presented_with_generation(
        &self,
        presented_ticks: i64,
        target_interval_micros: i64,
        measure_pacing: bool,
        resolve_seek: bool,
        generation: Option<u64>,
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
        while let Some(pending_seek) = pending.front() {
            if pending_seek.requested_at.elapsed().as_millis() > 2000 {
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
        let matching_idx = pending.iter().position(|pending_seek| {
            (generation.is_none()
                || pending_seek.generation.is_none()
                || pending_seek.generation == generation)
                && (presented_ticks - pending_seek.requested_ticks).saturating_abs()
                    <= match_tolerance
        });

        let (requested_ticks, requested_at, correct, seek_generation) =
            if let Some(idx) = matching_idx {
                // If in active continuous playback (measure_pacing == true), do not resolve
                // ancient scrub seeks (>800ms old) that were abandoned when playback began;
                // passing their timestamp during continuous playback is normal timeline progress.
                if measure_pacing
                    && pending[idx].requested_at.elapsed() > std::time::Duration::from_millis(800)
                {
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
                (
                    matched.requested_ticks,
                    matched.requested_at,
                    true,
                    matched.generation,
                )
            } else if !measure_pacing {
                // Paused interactive scrub/seek frame presentation: resolve the latest seek target.
                let pending_seek = match pending.pop_back() {
                    Some(pending_seek)
                        if generation.is_none()
                            || pending_seek.generation.is_none()
                            || pending_seek.generation == generation =>
                    {
                        pending_seek
                    }
                    Some(pending_seek) => {
                        pending.push_back(pending_seek);
                        return;
                    }
                    None => return,
                };
                pending.clear();
                let is_correct = (presented_ticks - pending_seek.requested_ticks).saturating_abs()
                    <= match_tolerance;
                (
                    pending_seek.requested_ticks,
                    pending_seek.requested_at,
                    is_correct,
                    pending_seek.generation,
                )
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
            generation: seek_generation,
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
