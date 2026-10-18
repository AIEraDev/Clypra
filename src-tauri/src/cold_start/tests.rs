use std::time::Instant;

use crate::cold_start::milestones::record_first_sound;
use crate::cold_start::models::{bucket_file_size_log2_mb, MAX_DISTINCT_STAGES, RING_BUFFER_CAPACITY};
use crate::cold_start::os::classify_media_location;
use crate::cold_start::recorder::{force_process_start, get_report, record_span, SpanGuard};

#[test]
fn test_spans_ordered_and_monotonic() {
    force_process_start();
    let guard1 = SpanGuard::start("test_monotonic_1");
    std::thread::sleep(std::time::Duration::from_millis(5));
    guard1.finish_ok();

    let guard2 = SpanGuard::start("test_monotonic_2");
    std::thread::sleep(std::time::Duration::from_millis(5));
    guard2.finish_ok();

    let report = get_report();
    let span1 = report
        .spans
        .iter()
        .find(|s| s.stage == "test_monotonic_1")
        .unwrap();
    let span2 = report
        .spans
        .iter()
        .find(|s| s.stage == "test_monotonic_2")
        .unwrap();

    assert!(span2.started_at_us >= span1.started_at_us);
    assert!(span1.work_us >= 4_000); // At least 4ms
    assert!(span2.work_us >= 4_000);
    assert!(span1.ok);
    assert!(span2.ok);
}

#[test]
fn test_span_guard_early_return_records_ok_false() {
    force_process_start();
    fn failing_operation_with_question_mark() -> Result<(), &'static str> {
        let _guard = SpanGuard::start("test_guard_early_return");
        std::thread::sleep(std::time::Duration::from_millis(2));
        // Early return via `?` operator — guard dropped without finish_ok()
        Err("probe failed early")?;
        Ok(())
    }

    let res = failing_operation_with_question_mark();
    assert!(res.is_err());

    let report = get_report();
    let span = report
        .spans
        .iter()
        .rfind(|s| s.stage == "test_guard_early_return")
        .expect("Span must be recorded even on early return");

    assert!(
        !span.ok,
        "Span dropped via early return must have ok: false"
    );
    assert!(span.work_us >= 1_500);
}

#[test]
fn test_span_guard_panic_records_ok_false() {
    force_process_start();
    let panic_result = std::panic::catch_unwind(|| {
        let _guard = SpanGuard::start("test_guard_panic");
        std::thread::sleep(std::time::Duration::from_millis(2));
        panic!("unexpected decoder panic");
    });
    assert!(panic_result.is_err());

    let report = get_report();
    let span = report
        .spans
        .iter()
        .rfind(|s| s.stage == "test_guard_panic")
        .expect("Span must be recorded on panic unwind");

    assert!(!span.ok, "Span dropped via panic must have ok: false");
    assert!(span.work_us >= 1_500);
}

#[test]
fn test_span_guard_finish_ok_records_ok_true() {
    force_process_start();
    let mut guard = SpanGuard::start("test_guard_success");
    guard.set_waited(500);
    guard.finish_ok();

    let report = get_report();
    let span = report
        .spans
        .iter()
        .rfind(|s| s.stage == "test_guard_success")
        .unwrap();

    assert!(span.ok);
    assert_eq!(span.waited_by_interactive_us, 500);
}

#[test]
fn test_ring_bound_and_aggregate_overflow() {
    force_process_start();
    let initial_report = get_report();
    let initial_dropped = initial_report.dropped_spans;

    // Push 600 spans (exceeding RING_BUFFER_CAPACITY = 512)
    for i in 0..600 {
        let mut guard = SpanGuard::start("test_overflow_stage");
        guard.set_waited(10);
        if i % 2 == 0 {
            guard.finish_ok();
        } else {
            drop(guard); // drops with ok: false
        }
    }

    let report = get_report();
    assert!(report.spans.len() <= RING_BUFFER_CAPACITY);
    assert!(report.dropped_spans >= initial_dropped + (600 - RING_BUFFER_CAPACITY) as u64);

    let agg = report.aggregates.get("test_overflow_stage").unwrap();
    assert!(agg.count >= 600);
    assert!(agg.ok_count >= 300);
    assert!(agg.err_count >= 300);
    assert!(agg.total_waited_us >= 6_000);
}

#[test]
fn test_stage_keys_bounded_to_64() {
    force_process_start();
    // Push spans with 80 distinct stage names
    for i in 0..80 {
        let stage_name = format!("stage_key_unique_{i}");
        record_span(&stage_name, Instant::now(), 0, false);
    }

    let report = get_report();
    assert!(
        report.aggregates.len() <= MAX_DISTINCT_STAGES,
        "Aggregates map exceeded MAX_DISTINCT_STAGES (len={})",
        report.aggregates.len()
    );
    assert!(
        report.aggregates.contains_key("other"),
        "Excess stages must fold into 'other'"
    );
}

#[test]
fn test_bucket_file_size_log2_mb() {
    assert_eq!(bucket_file_size_log2_mb(0), 0);
    assert_eq!(bucket_file_size_log2_mb(100), 1);
    assert_eq!(bucket_file_size_log2_mb(500 * 1024), 1);
    assert_eq!(bucket_file_size_log2_mb(1024 * 1024), 1);
    assert_eq!(bucket_file_size_log2_mb(1024 * 1024 + 1), 2);
    assert_eq!(bucket_file_size_log2_mb(3 * 1024 * 1024), 4);
    assert_eq!(bucket_file_size_log2_mb(5 * 1024 * 1024), 8);
    assert_eq!(bucket_file_size_log2_mb(15 * 1024 * 1024), 16);
    assert_eq!(bucket_file_size_log2_mb(60 * 1024 * 1024), 64);
    assert_eq!(bucket_file_size_log2_mb(100 * 1024 * 1024), 128);
    assert_eq!(bucket_file_size_log2_mb(1000 * 1024 * 1024), 1024);
}

#[test]
fn test_classify_media_location_samples() {
    #[cfg(target_os = "windows")]
    {
        let fixed = classify_media_location(std::path::Path::new("C:\\Videos\\clip.mp4"));
        assert!(fixed == "fixed" || fixed == "unknown");
    }
    #[cfg(not(target_os = "windows"))]
    {
        let loc = classify_media_location(std::path::Path::new("/tmp/test.mp4"));
        assert!(loc == "fixed" || loc == "unknown");
    }
}

#[test]
fn test_report_serialization_keys() {
    force_process_start();
    let report = get_report();
    let json = serde_json::to_string(&report).expect("ColdStartReport must serialize");
    assert!(json.contains("\"processEpochMs\":"));
    assert!(json.contains("\"milestones\":"));
    assert!(json.contains("\"audioMetrics\":"));
    assert!(json.contains("\"aggregates\":"));
    assert!(json.contains("\"droppedSpans\":"));
    assert!(json.contains("\"spans\":"));
}

#[test]
fn test_first_sound_latency_preserves_zero() {
    // Record latency as 0 us (valid output when driver has no device latency offset)
    record_first_sound(0);
    let report = get_report();
    assert_eq!(
        report.milestones.first_sound_latency_us,
        Some(0),
        "A latency of 0 must be preserved as Some(0), not None"
    );
}
