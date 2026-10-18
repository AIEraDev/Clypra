use super::drift::MAX_PERCENTILE_SAMPLES;
use serde::Serialize;
use std::time::Instant;

#[derive(Default, Debug)]
pub struct FramePacingAccumulator {
    pub(super) last_frame_instant: parking_lot::Mutex<Option<Instant>>,
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

    pub(super) fn take_and_reset(&self) -> FramePacingSnapshot {
        let mut intervals = self.intervals.lock();
        let snapshot = pacing_snapshot(&intervals);
        intervals.clear();
        snapshot
    }

    pub(super) fn snapshot(&self) -> FramePacingSnapshot {
        pacing_snapshot(&self.intervals.lock())
    }
}

pub(super) fn pacing_snapshot(intervals: &[(i64, i64)]) -> FramePacingSnapshot {
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
pub struct FramePacingSnapshot {
    pub n: u64,
    pub target_interval_micros: f64,
    pub stddev_micros: f64,
    pub jank_events: u64,
}
