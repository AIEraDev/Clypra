//! Bounded A/V synchronization and presentation metrics.
//!
//! These metrics are intentionally additive: they observe native presentation
//! and audio-clock decisions without changing playback policy or timing.

mod drift;
mod pacing;
mod registry;
mod snapshots;

#[cfg(test)]
mod tests;

use once_cell::sync::Lazy;
use std::fmt::Display;

pub(super) const MAX_SEEK_EVENTS: usize = 50;
pub(super) const SEEK_CORRECTNESS_TOLERANCE_MICROS: i64 = 16_000;

pub use drift::{DriftAccumulator, DriftSnapshot, DriftSuppressionConfig};
pub use pacing::{FramePacingAccumulator, FramePacingSnapshot};
pub use registry::SyncMetricsRegistry;
pub use snapshots::{SeekEvent, SeekSnapshot, SyncMetricsSnapshot};

pub static SYNC_METRICS: Lazy<SyncMetricsRegistry> = Lazy::new(SyncMetricsRegistry::default);

/// Retained as a compatibility hook for native callers. Diagnostics are
/// delivered through the Tauri event bridge instead of blocking stderr.
pub fn trace_event(_event: &str, _details: impl Display) {}
