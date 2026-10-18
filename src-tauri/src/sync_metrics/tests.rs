use super::drift::DriftAccumulator;
use super::pacing::FramePacingAccumulator;
use super::registry::SyncMetricsRegistry;
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::drift::MAX_PERCENTILE_SAMPLES;
    use super::super::MAX_SEEK_EVENTS;

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
        assert_eq!(
            snap.p95_abs_micros, 500,
            "active P95 must not be polluted by suppressed samples"
        );
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

    #[test]
    fn rapid_scrub_superseded_seeks_do_not_poison_continuous_playback() {
        let registry = SyncMetricsRegistry::default();
        // User rapidly scrubs across timeline positions
        registry.record_seek_requested(10_000_000);
        registry.record_seek_requested(15_000_000);
        registry.record_seek_requested(20_000_000);
        registry.record_seek_requested(25_000_000);

        // Frame presented at 25s matches the latest active scrub target
        registry.record_frame_presented_with_options(25_000_000, 33_333, false, true);
        assert_eq!(registry.pending_seeks.lock().len(), 0);

        // Continuous playback begins: nominal frames must not pop phantom seeks
        registry.record_frame_presented_with_options(25_033_333, 33_333, true, true);
        registry.record_frame_presented_with_options(25_066_666, 33_333, true, true);

        let snapshot = registry.take_and_reset();
        assert_eq!(snapshot.seeks.n, 1);
        assert_eq!(snapshot.seeks.correct, 1);
        assert_eq!(snapshot.seeks.events[0].requested_ticks, 25_000_000);
    }

    #[test]
    fn continuous_playback_does_not_resolve_stale_abandoned_scrub_seeks() {
        let registry = SyncMetricsRegistry::default();
        // User clicked/scrubbed to 10s and 20s
        registry.record_seek_requested(10_000_000);
        registry.record_seek_requested(20_000_000);

        // Artificially age the pending seeks past 800ms
        {
            let mut pending = registry.pending_seeks.lock();
            for item in pending.iter_mut() {
                item.1 = Instant::now() - Duration::from_millis(900);
            }
        }

        // Playback starts from 0s and reaches 10s and 20s during continuous playback
        registry.record_frame_presented_with_options(10_000_000, 33_333, true, true);
        registry.record_frame_presented_with_options(20_000_000, 33_333, true, true);

        // Stale seeks must NOT have been converted into 900ms+ false seek latency events
        let snapshot = registry.take_and_reset();
        assert_eq!(
            snapshot.seeks.n, 0,
            "abandoned stale scrub seeks must not record as resolved seeks during playback"
        );
        assert_eq!(
            registry.pending_seeks.lock().len(),
            0,
            "stale seeks should be drained"
        );
    }
}
