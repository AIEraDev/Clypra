//! Metrics registry for thumbnail decode, convert, and downsample stages.
//!
//! Provides lock-free atomic accumulation across decoder threads with
//! periodic 5-second aggregated summaries and on-demand snapshots.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use crate::thumbnail_engine::pyramid::SpatialTier;

/// Atomic microsecond accumulator for a single pipeline stage.
#[derive(Default, Debug)]
pub struct StageAccumulator {
    pub count: AtomicU64,
    pub total_micros: AtomicU64,
}

impl StageAccumulator {
    #[inline]
    pub fn record(&self, elapsed: Duration) {
        self.count.fetch_add(1, Ordering::Relaxed);
        self.total_micros
            .fetch_add(elapsed.as_micros() as u64, Ordering::Relaxed);
    }

    #[inline]
    pub fn avg_micros(&self) -> f64 {
        let n = self.count.load(Ordering::Relaxed);
        if n == 0 {
            0.0
        } else {
            self.total_micros.load(Ordering::Relaxed) as f64 / n as f64
        }
    }

    #[inline]
    pub fn take_and_reset(&self) -> (u64, f64) {
        let n = self.count.swap(0, Ordering::Relaxed);
        let total = self.total_micros.swap(0, Ordering::Relaxed);
        (n, if n == 0 { 0.0 } else { total as f64 / n as f64 })
    }

    #[inline]
    pub fn snapshot(&self) -> (u64, f64) {
        let n = self.count.load(Ordering::Relaxed);
        let total = self.total_micros.load(Ordering::Relaxed);
        (n, if n == 0 { 0.0 } else { total as f64 / n as f64 })
    }
}

/// Aggregated metrics for a single spatial tier (L0/L1/L2/L3).
#[derive(Default, Debug)]
pub struct TierMetrics {
    pub seek: StageAccumulator,
    pub decode: StageAccumulator,
    pub convert: StageAccumulator,
    pub convert_fast_path: AtomicU64,
    pub convert_slow_path: AtomicU64,
    pub downsample: StageAccumulator,
    pub serialize: StageAccumulator,
    pub tier_cache_hits: AtomicU64,
    pub decodes: AtomicU64,
    pub evictions: AtomicU64,
}

impl TierMetrics {
    pub fn take_and_reset(&self) -> TierMetricsSummary {
        let (_seek_n, seek_avg) = self.seek.take_and_reset();
        let (decode_n, decode_avg) = self.decode.take_and_reset();
        let (_convert_n, convert_avg) = self.convert.take_and_reset();
        let fast_hits = self.convert_fast_path.swap(0, Ordering::Relaxed);
        let slow_hits = self.convert_slow_path.swap(0, Ordering::Relaxed);
        let (_downsample_n, downsample_avg) = self.downsample.take_and_reset();
        let (_serialize_n, serialize_avg) = self.serialize.take_and_reset();
        let hits = self.tier_cache_hits.swap(0, Ordering::Relaxed);
        let decodes = self.decodes.swap(0, Ordering::Relaxed);
        let evictions = self.evictions.swap(0, Ordering::Relaxed);

        let total_ops = hits + decodes;
        let hit_rate = if total_ops == 0 {
            0.0
        } else {
            (hits as f64 / total_ops as f64) * 100.0
        };

        TierMetricsSummary {
            operations: decodes.max(decode_n),
            seek_avg_ms: seek_avg / 1000.0,
            decode_avg_ms: decode_avg / 1000.0,
            convert_avg_ms: convert_avg / 1000.0,
            convert_fast_hits: fast_hits,
            convert_slow_hits: slow_hits,
            downsample_avg_ms: downsample_avg / 1000.0,
            serialize_avg_ms: serialize_avg / 1000.0,
            tier_cache_hits: hits,
            decodes,
            evictions,
            hit_rate_pct: hit_rate,
        }
    }

    pub fn snapshot(&self) -> TierMetricsSummary {
        let (seek_n, seek_avg) = self.seek.snapshot();
        let (_decode_n, decode_avg) = self.decode.snapshot();
        let (_convert_n, convert_avg) = self.convert.snapshot();
        let fast_hits = self.convert_fast_path.load(Ordering::Relaxed);
        let slow_hits = self.convert_slow_path.load(Ordering::Relaxed);
        let (_downsample_n, downsample_avg) = self.downsample.snapshot();
        let (_serialize_n, serialize_avg) = self.serialize.snapshot();
        let hits = self.tier_cache_hits.load(Ordering::Relaxed);
        let decodes = self.decodes.load(Ordering::Relaxed);
        let evictions = self.evictions.load(Ordering::Relaxed);

        let total_ops = hits + decodes;
        let hit_rate = if total_ops == 0 {
            0.0
        } else {
            (hits as f64 / total_ops as f64) * 100.0
        };

        TierMetricsSummary {
            operations: decodes.max(seek_n),
            seek_avg_ms: seek_avg / 1000.0,
            decode_avg_ms: decode_avg / 1000.0,
            convert_avg_ms: convert_avg / 1000.0,
            convert_fast_hits: fast_hits,
            convert_slow_hits: slow_hits,
            downsample_avg_ms: downsample_avg / 1000.0,
            serialize_avg_ms: serialize_avg / 1000.0,
            tier_cache_hits: hits,
            decodes,
            evictions,
            hit_rate_pct: hit_rate,
        }
    }
}

/// JSON-serializable summary for stderr periodic logs and frontend query.
#[derive(Debug, Clone, Serialize)]
pub struct TierMetricsSummary {
    pub operations: u64,
    pub seek_avg_ms: f64,
    pub decode_avg_ms: f64,
    pub convert_avg_ms: f64,
    pub convert_fast_hits: u64,
    pub convert_slow_hits: u64,
    pub downsample_avg_ms: f64,
    pub serialize_avg_ms: f64,
    pub tier_cache_hits: u64,
    pub decodes: u64,
    pub evictions: u64,
    pub hit_rate_pct: f64,
}

#[derive(Default, Debug)]
pub struct DecoderMetricsRegistry {
    /// Shared full-resolution decode/convert work. This is intentionally not
    /// stored on L0-L3: one source frame is decoded and converted once, then
    /// fan-outs are downsampled into the requested tiers.
    pub source: TierMetrics,
    pub l0: TierMetrics,
    pub l1: TierMetrics,
    pub l2: TierMetrics,
    pub l3: TierMetrics,
}

impl DecoderMetricsRegistry {
    pub fn for_tier(&self, tier: SpatialTier) -> &TierMetrics {
        match tier {
            SpatialTier::L0 => &self.l0,
            SpatialTier::L1 => &self.l1,
            SpatialTier::L2 => &self.l2,
            SpatialTier::L3 => &self.l3,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FullDecodeMetricsSnapshot {
    pub source: TierMetricsSummary,
    pub l0: TierMetricsSummary,
    pub l1: TierMetricsSummary,
    pub l2: TierMetricsSummary,
    pub l3: TierMetricsSummary,
    pub timestamp_epoch_ms: u64,
}

pub static METRICS: Lazy<DecoderMetricsRegistry> = Lazy::new(DecoderMetricsRegistry::default);
pub static PROFILE_ENABLED: Lazy<AtomicBool> = Lazy::new(|| {
    let enabled = std::env::var("CLYPRA_PROFILE_FILMSTRIP")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(true); // Default to active profiling in local builds
    AtomicBool::new(enabled)
});

static FLUSH_LOOP_STARTED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

/// Start background 5s periodic summary printer.
pub fn ensure_metrics_flush_loop() {
    if FLUSH_LOOP_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    tokio::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            flush_periodic_metrics();
        }
    });
}

fn flush_periodic_metrics() {
    let source = METRICS.source.take_and_reset();
    let s0 = METRICS.l0.take_and_reset();
    let s1 = METRICS.l1.take_and_reset();
    let s2 = METRICS.l2.take_and_reset();
    let s3 = METRICS.l3.take_and_reset();

    let has_any = source.operations > 0
        || source.tier_cache_hits > 0
        || source.evictions > 0
        || s0.operations > 0
        || s0.tier_cache_hits > 0
        || s0.evictions > 0
        || s1.operations > 0
        || s1.tier_cache_hits > 0
        || s1.evictions > 0
        || s2.operations > 0
        || s2.tier_cache_hits > 0
        || s2.evictions > 0
        || s3.operations > 0
        || s3.tier_cache_hits > 0
        || s3.evictions > 0;

    if !has_any {
        return;
    }

    eprintln!("─────── 🎬 [Filmstrip Metrics: 5s Window] ───────");
    print_tier_line("SRC", &source);
    print_tier_line("L0", &s0);
    print_tier_line("L1", &s1);
    print_tier_line("L2", &s2);
    print_tier_line("L3", &s3);
    eprintln!("─────────────────────────────────────────────────");
}

fn print_tier_line(label: &str, s: &TierMetricsSummary) {
    if s.operations == 0 && s.tier_cache_hits == 0 && s.evictions == 0 {
        return;
    }
    eprintln!(
        "[metrics:5s] {} n={:<3} seek={:.2}ms decode={:.2}ms convert={:.2}ms(fast={}/slow={}) downsample={:.2}ms serialize={:.2}ms hit_rate={:.1}% evictions={}",
        label,
        s.operations,
        s.seek_avg_ms,
        s.decode_avg_ms,
        s.convert_avg_ms,
        s.convert_fast_hits,
        s.convert_slow_hits,
        s.downsample_avg_ms,
        s.serialize_avg_ms,
        s.hit_rate_pct,
        s.evictions
    );
}

/// Take snapshot of cumulative metrics on demand without resetting.
pub fn get_metrics_snapshot() -> FullDecodeMetricsSnapshot {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    FullDecodeMetricsSnapshot {
        source: METRICS.source.snapshot(),
        l0: METRICS.l0.snapshot(),
        l1: METRICS.l1.snapshot(),
        l2: METRICS.l2.snapshot(),
        l3: METRICS.l3.snapshot(),
        timestamp_epoch_ms: now,
    }
}

/// Lightweight timer helper.
pub struct Timer(Option<Instant>);

impl Timer {
    #[inline]
    pub fn start() -> Self {
        if PROFILE_ENABLED.load(Ordering::Relaxed) {
            Timer(Some(Instant::now()))
        } else {
            Timer(None)
        }
    }

    #[inline]
    pub fn elapsed(&self) -> Option<Duration> {
        self.0.map(|start| start.elapsed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_stage_accumulator() {
        let acc = StageAccumulator::default();
        assert_eq!(acc.avg_micros(), 0.0);

        acc.record(Duration::from_millis(10));
        acc.record(Duration::from_millis(20));
        acc.record(Duration::from_millis(30));

        let (n, avg) = acc.take_and_reset();
        assert_eq!(n, 3);
        assert!((avg - 20000.0).abs() < 0.1);

        assert_eq!(acc.avg_micros(), 0.0);
    }

    #[test]
    fn test_tier_metrics_hit_rate_and_reset() {
        let tm = TierMetrics::default();
        tm.tier_cache_hits.fetch_add(4, Ordering::Relaxed);
        tm.decodes.fetch_add(6, Ordering::Relaxed);
        tm.evictions.fetch_add(1, Ordering::Relaxed);

        let summary = tm.take_and_reset();
        assert_eq!(summary.tier_cache_hits, 4);
        assert_eq!(summary.decodes, 6);
        assert_eq!(summary.evictions, 1);
        assert!((summary.hit_rate_pct - 40.0).abs() < 0.01);

        // Second take should be empty
        let summary2 = tm.take_and_reset();
        assert_eq!(summary2.tier_cache_hits, 0);
        assert_eq!(summary2.decodes, 0);
    }

    #[test]
    fn test_metrics_registry_for_tier() {
        let registry = DecoderMetricsRegistry::default();
        registry
            .for_tier(SpatialTier::L2)
            .tier_cache_hits
            .fetch_add(5, Ordering::Relaxed);

        let summary = registry.l2.snapshot();
        assert_eq!(summary.tier_cache_hits, 5);
    }

    #[test]
    fn test_conversion_metrics_report_duration_and_path_counts() {
        let metrics = TierMetrics::default();
        metrics.convert.record(Duration::from_millis(4));
        metrics.convert_fast_path.fetch_add(1, Ordering::Relaxed);
        metrics.convert_slow_path.fetch_add(2, Ordering::Relaxed);

        let summary = metrics.take_and_reset();

        assert!((summary.convert_avg_ms - 4.0).abs() < 0.01);
        assert_eq!(summary.convert_fast_hits, 1);
        assert_eq!(summary.convert_slow_hits, 2);
    }
}
