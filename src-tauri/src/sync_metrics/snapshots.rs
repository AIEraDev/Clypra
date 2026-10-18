use super::drift::DriftSnapshot;
use super::pacing::FramePacingSnapshot;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub lookahead_misses: u64,
    pub seeks: SeekSnapshot,
    pub timestamp_epoch_ms: u64,
}

pub(super) fn seek_snapshot(events: Vec<SeekEvent>) -> SeekSnapshot {
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

pub(super) fn snapshot_with(
    av_drift: DriftSnapshot,
    frame_pacing: FramePacingSnapshot,
    dropped_frames: u64,
    lookahead_misses: u64,
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
        lookahead_misses,
        seeks,
        timestamp_epoch_ms,
    }
}
