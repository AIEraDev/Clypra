use serde::Serialize;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

pub(super) const MAX_PERCENTILE_SAMPLES: usize = 500;

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

    pub(super) fn take_and_reset(&self) -> DriftSnapshot {
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

    pub(super) fn snapshot(&self) -> DriftSnapshot {
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

pub(super) fn percentile_abs(samples: &[i64], percentile: f64) -> i64 {
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
