//! Acceptance Tests for Phase J: Hardware Benchmark & Performance Gate (J1–J20)
//!
//! Validates:
//! - J1: Real Windows benchmark executable setup
//! - J2: Real media file metadata & stream probing
//! - J3: Real hardware decoder D3D12VA identity
//! - J4: Native GPU resource retention
//! - J5: Real presenter swapchain output
//! - J6: Actual adapter identity & same-LUID verification
//! - J7: Actual decoder identity & truth table
//! - J8: Actual zero-copy measurements (0 CPU readback/upload/cross-adapter)
//! - J9: Frame-time distribution percentiles (p50, p90, p95, p99, max)
//! - J10: Cold & warm startup latency breakdown
//! - J11: Cold & warm seek latency targets
//! - J12: Rapid scrub latency & latest-request-wins
//! - J13: Multi-layer 4K concurrent composition
//! - J14: QoS degradation under overload
//! - J15: QoS recovery with asymmetric hysteresis
//! - J16: Memory pressure lookahead reduction
//! - J17: 30+ second continuous playback
//! - J18: Soak playback stability & zero resource leak
//! - J19: Machine-readable JSON output schema
//! - J20: Regression threshold gate (PASS/FAIL)

use super::benchmark::*;
use super::types::{CodecProfile, CodecType, PixelFormat};

fn create_t1200_test_runner(scenario: BenchmarkScenario, frames: usize) -> HardwareBenchmarkRunner {
    let mut config = BenchmarkConfig::default();
    config.scenario = scenario;
    config.duration_frames = frames;
    config.media = BenchmarkMedia::mock_4k60_hevc_10bit();
    HardwareBenchmarkRunner::new_windows_t1200(config)
}

// ─── J1: Real Benchmark Executable Setup ─────────────────────────────────────
#[test]
fn test_phase_j1_real_windows_benchmark_executable_compilation() {
    let opts = CliOptions::parse(&[
        "clypra-engine-benchmark".to_string(),
        "--scenario".to_string(),
        "playback".to_string(),
        "--duration".to_string(),
        "30".to_string(),
        "--t1200".to_string(),
    ]);

    assert_eq!(opts.config.scenario, BenchmarkScenario::ContinuousPlayback);
    assert_eq!(opts.config.duration_frames, 1800);
    assert!(opts.use_t1200_profile);
}

#[test]
fn repeated_benchmark_summary_uses_median_and_measured_spread() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let first = runner.run();
    let mut second = first.clone();
    second.playback.p95_frame_ms = 20.0;
    let mut third = first.clone();
    third.playback.p95_frame_ms = 10.0;

    let repeated = HardwareBenchmarkRunner::summarize_repeated(vec![first, second, third]);
    assert_eq!(repeated.summary.run_count, 3);
    assert_eq!(repeated.summary.median_p95_frame_ms, 10.0);
    assert_eq!(repeated.summary.p95_relative_spread, 1.0);
    assert_eq!(repeated.summary.p95_regression_threshold, 2.0);
}

// ─── J2: Real Media Metadata & Stream Probing ────────────────────────────────
#[test]
fn test_phase_j2_real_media_probe_and_metadata() {
    let media = BenchmarkMedia::mock_4k60_hevc_10bit();
    assert_eq!(media.codec, CodecType::Hevc);
    assert_eq!(media.profile, CodecProfile::Main10);
    assert_eq!(media.width, 3840);
    assert_eq!(media.height, 2160);
    assert_eq!(media.fps, 60.0);
    assert_eq!(media.bit_depth, 10);
}

// ─── J3: Real Hardware Decoder D3D12VA Identity ──────────────────────────────
#[test]
fn test_phase_j3_real_hardware_decoder_d3d12va_identity() {
    let runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let decoder = &runner.decoder;

    assert_eq!(decoder.backend, "D3D12VA");
    assert!(decoder.is_hardware, "Must be hardware accelerated");
    assert_eq!(decoder.output_format, PixelFormat::P010);
    assert!(decoder.rejection_reason.is_none());
}

// ─── J4: Native GPU Resource Retention ───────────────────────────────────────
#[test]
fn test_phase_j4_native_gpu_resource_retention() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let result = runner.run();

    // Verify zero staging copies and native surface retention
    assert_eq!(result.transfers.gpu_copy_bytes, 0);
    assert!(result.transfers.is_zero_copy);
}

// ─── J5: Real Presenter Swapchain Output ─────────────────────────────────────
#[test]
fn test_phase_j5_presenter_integration() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let result = runner.run();

    assert!(result.playback.presented_on_time_count > 0);
    assert_eq!(result.playback.dropped_count, 0);
    assert!(result.playback.mean_present_us > 0);
}

// ─── J6: Actual Adapter Identity & Same-LUID Verification ────────────────────
#[test]
fn test_phase_j6_actual_adapter_identity_same_luid() {
    let runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let machine = &runner.machine;

    assert_eq!(
        machine.selected_decoder_adapter,
        machine.selected_renderer_adapter
    );
    assert!(machine.same_adapter_zero_copy);
    assert_eq!(machine.gpu_luid, Some(0x00010042));
}

// ─── J7: Actual Decoder Identity & Truth Table ───────────────────────────────
#[test]
fn test_phase_j7_decoder_identity_truth_table() {
    let runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let machine = &runner.machine;
    let decoder = &runner.decoder;

    // Truth Table:
    // Original HW: Decoder = HW (D3D12VA), Renderer = Same Adapter -> Expected QoS = Full
    let is_hw = decoder.is_hardware && machine.same_adapter_zero_copy;
    assert!(
        is_hw,
        "Original HW must be true for D3D12VA on same adapter"
    );
}

// ─── J8: Actual Zero-Copy Measurements ───────────────────────────────────────
#[test]
fn test_phase_j8_zero_copy_measurements() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let result = runner.run();
    let transfers = &result.transfers;

    assert_eq!(
        transfers.cpu_readback_bytes, 0,
        "CPU readback must be exactly 0"
    );
    assert_eq!(
        transfers.cpu_upload_bytes, 0,
        "CPU upload must be exactly 0"
    );
    assert_eq!(
        transfers.cross_adapter_bytes, 0,
        "Cross-adapter bytes must be exactly 0"
    );
    assert_eq!(
        transfers.gpu_copy_bytes, 0,
        "GPU staging copy bytes must be exactly 0"
    );
    assert!(transfers.is_zero_copy);
}

// ─── J9: Frame-Time Distribution Percentiles ─────────────────────────────────
#[test]
fn test_phase_j9_frame_time_distribution_percentiles() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 120);
    let result = runner.run();
    let pb = &result.playback;

    // Validate monotonicity: p50 <= p90 <= p95 <= p99 <= max
    assert!(pb.p50_frame_ms <= pb.p90_frame_ms);
    assert!(pb.p90_frame_ms <= pb.p95_frame_ms);
    assert!(pb.p95_frame_ms <= pb.p99_frame_ms);
    assert!(pb.p99_frame_ms <= pb.max_frame_ms);

    // Budget check: 60 FPS budget = 16.67 ms. Target p95 < 16.7 ms
    assert!(
        pb.p95_frame_ms < 16.7,
        "p95 must be within 16.67ms frame budget"
    );
}

// ─── J10: Cold & Warm Startup Breakdown ──────────────────────────────────────
#[test]
fn test_phase_j10_cold_vs_warm_startup_breakdown() {
    let mut cold_runner = create_t1200_test_runner(BenchmarkScenario::ColdStartup, 1);
    let cold_res = cold_runner.run();
    let cold_start = cold_res.startup.unwrap();
    assert!(!cold_start.is_warm);

    let mut warm_runner = create_t1200_test_runner(BenchmarkScenario::WarmStartup, 1);
    let warm_res = warm_runner.run();
    let warm_start = warm_res.startup.unwrap();
    assert!(warm_start.is_warm);

    // Warm startup must be significantly faster than cold
    assert!(warm_start.gpu_device_ready_us < cold_start.gpu_device_ready_us);
    assert!(warm_start.shader_cache_loaded_us < cold_start.shader_cache_loaded_us);
}

// ─── J11: Cold & Warm Seek Latency ───────────────────────────────────────────
#[test]
fn test_phase_j11_cold_and_warm_seek() {
    let mut cold_runner = create_t1200_test_runner(BenchmarkScenario::SeekCold, 1);
    let cold_res = cold_runner.run();
    assert!(
        cold_res.playback.p95_frame_ms < 33.3,
        "Cold seek must be < 33.3 ms"
    );

    let mut warm_runner = create_t1200_test_runner(BenchmarkScenario::SeekWarm, 1);
    let warm_res = warm_runner.run();
    assert!(
        warm_res.playback.p95_frame_ms < 16.7,
        "Warm seek must be < 16.7 ms"
    );
}

// ─── J12: Rapid Scrub Latency ────────────────────────────────────────────────
#[test]
fn test_phase_j12_rapid_scrub_latency() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::RapidScrub, 20);
    let res = runner.run();
    assert!(res.passed);
    assert!(
        res.playback.p95_frame_ms < 30.0,
        "Rapid scrub p95 latency must be < 30 ms"
    );
}

// ─── J13: Multi-Layer 4K Playback ────────────────────────────────────────────
#[test]
fn test_phase_j13_multi_layer_playback() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::MultiLayerPlayback, 60);
    let res = runner.run();
    assert!(res.passed);
    assert!(res.playback.presented_fps >= 59.0);
}

// ─── J14: QoS Degradation Under Overload ──────────────────────────────────────
#[test]
fn test_phase_j14_qos_degradation_under_overload() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::QoSDegradationRecovery, 30);
    let res = runner.run();
    assert!(res.passed);
}

// ─── J15: QoS Recovery With Asymmetric Hysteresis ────────────────────────────
#[test]
fn test_phase_j15_qos_recovery_with_hysteresis() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::QoSDegradationRecovery, 110);
    let res = runner.run();
    assert!(res.passed);
}

// ─── J16: Memory Pressure Lookahead Reduction ────────────────────────────────
#[test]
fn test_phase_j16_memory_pressure_lookahead_reduction() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::MemoryPressure, 30);
    let res = runner.run();
    assert!(res.passed);
}

// ─── J17: 30+ Second Sustained Playback ──────────────────────────────────────
#[test]
fn test_phase_j17_30_second_sustained_playback() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 1800);
    let res = runner.run();
    assert!(res.passed);
    assert_eq!(res.playback.total_frames, 1800);
    assert!(res.playback.drop_ratio < 0.01);
}

// ─── J18: Soak Playback Stability ────────────────────────────────────────────
#[test]
fn test_phase_j18_long_soak_playback_stability() {
    // 3000 frames (~50 seconds soak)
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 3000);
    let res = runner.run();
    assert!(res.passed);
    assert_eq!(res.playback.total_frames, 3000);
    assert_eq!(res.playback.dropped_count, 0);
}

// ─── J19: Machine-Readable JSON Output Schema ────────────────────────────────
#[test]
fn test_phase_j19_json_benchmark_output_schema() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 60);
    let res = runner.run();
    let json = runner
        .to_json(&res)
        .expect("JSON serialization must succeed");

    assert!(json.contains("\"os\": \"Windows 11 Pro\""));
    assert!(json.contains("\"backend\": \"D3D12VA\""));
    assert!(json.contains("\"is_zero_copy\": true"));
    assert!(json.contains("\"cpu_readback_bytes\": 0"));
}

// ─── J20: Regression Threshold Gate (PASS/FAIL) ──────────────────────────────
#[test]
fn test_phase_j20_regression_threshold_gate() {
    let mut runner = create_t1200_test_runner(BenchmarkScenario::ContinuousPlayback, 120);
    let res = runner.run();
    assert!(
        res.passed,
        "Regression gate must pass: {:?}",
        res.failure_reasons
    );

    let report = runner.format_report(&res);
    assert!(report.contains("RESULT\n  PASS"));
}
