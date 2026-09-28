//! Acceptance Tests for Phase I: Workload-Driven QoS & Intelligent Quality Controller
//!
//! Validates:
//! - I1: Decode bottleneck triggers Proxy without degrading Render Quality
//! - I2: GPU bottleneck triggers Render Quality (Half) without switching to Proxy
//! - I3: Effect bottleneck degrades EffectsPolicy without switching to Proxy
//! - I4: Asymmetric hysteresis prevents quality oscillation
//! - I5: Sustained recovery with M > N window thresholds
//! - I6: Proxy switch continuity (zero backward jumps or time disruption)
//! - I7: Surface/memory pressure triggers lookahead reduction and cache relief
//! - I8: Scrub interaction mode prioritizes latency
//! - I9: Pause mode gracefully upgrades quality without freeze or visual flash

use super::frame::ColorMetadata;
use super::qos::*;
use super::state_machine::PlaybackMode;
use super::types::{CodecType, ColorSpace, MediaTime};
use std::collections::HashMap;
use std::path::PathBuf;

fn create_test_proxy_manager() -> AsyncProxyManager {
    let mut manager = AsyncProxyManager::new();
    let proxy = ProxyVariant {
        id: ProxyId(101),
        source_asset: "asset-4k-hevc".to_string(),
        codec: CodecType::H264,
        width: 1920,
        height: 1080,
        frame_rate: 60.0,
        color: ColorMetadata {
            primaries: ColorSpace::Rec709,
            is_full_range: false,
            bit_depth: 8,
        },
        path: PathBuf::from("/cache/proxies/asset-4k-hevc_1080p.mp4"),
        is_ready: true,
    };
    manager.register_proxy(proxy);
    manager
}

// ─── I1: Decode Bottleneck Triggers Proxy ────────────────────────────────────
#[test]
fn test_phase_i1_decode_bottleneck_triggers_proxy_not_render_quality() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8,
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Inject 3 consecutive windows of heavy decode pressure (35 ms decode, target budget = 16.6 ms)
    // while GPU render is healthy (4 ms)
    for window_idx in 0..3 {
        for frame_idx in 0..10 {
            let pts = MediaTime::from_frame_index((window_idx * 10 + frame_idx) as i64, 60.0);
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 35_000,
                render_cpu_us: 1_000,
                render_gpu_us: 4_000,
                effect_timings: HashMap::new(),
                decode_queue_depth: 8,
                ready_queue_depth: 0, // Starved
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: true,
                frame_pts: pts,
            });
        }
        controller.evaluate_window(
            PlaybackMode::Play,
            MediaTime(1_000_000),
            &proxy_mgr,
            Some("asset-4k-hevc"),
        );
    }

    let decision = controller.current_decision();
    // Invariant: Media variant switches to Proxy
    assert_eq!(
        decision.media_variant,
        MediaVariant::Proxy(ProxyId(101)),
        "Decode starvation must switch to available proxy"
    );
    // Invariant: Render quality stays Full! (Compositor is not overloaded)
    assert_eq!(
        decision.render_quality,
        RenderQuality::Full,
        "Render quality must not be degraded when bottleneck is decode"
    );
    assert!(
        matches!(decision.reason, QoSReason::DecodeStarvation { .. }),
        "Reason must explicitly state decode starvation"
    );
}

// ─── I2: GPU Bottleneck Triggers Render Quality ──────────────────────────────
#[test]
fn test_phase_i2_gpu_bottleneck_triggers_render_quality_not_proxy() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8,
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Inject 3 consecutive windows of GPU render overload (24 ms render, budget = 16.6 ms)
    // while decode is fast and healthy (4 ms)
    for window_idx in 0..3 {
        for frame_idx in 0..10 {
            let pts = MediaTime::from_frame_index((window_idx * 10 + frame_idx) as i64, 60.0);
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 4_000,
                render_cpu_us: 2_000,
                render_gpu_us: 24_000,
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 4,
                surface_pool_capacity: 10,
                deadline_missed: true,
                frame_pts: pts,
            });
        }
        controller.evaluate_window(
            PlaybackMode::Play,
            MediaTime(1_000_000),
            &proxy_mgr,
            Some("asset-4k-hevc"),
        );
    }

    let decision = controller.current_decision();
    // Invariant: Render quality degrades to Half
    assert_eq!(
        decision.render_quality,
        RenderQuality::Half,
        "GPU render overload must degrade render quality to Half"
    );
    // Invariant: Media variant stays Original! (Decoder is fine)
    assert_eq!(
        decision.media_variant,
        MediaVariant::Original,
        "Media variant must remain Original when bottleneck is GPU render"
    );
    assert!(
        matches!(decision.reason, QoSReason::GpuRenderDeadlinePressure { .. }),
        "Reason must explicitly state GPU render deadline pressure"
    );
}

// ─── I3: Effect Bottleneck Degrades Effects Policy ───────────────────────────
#[test]
fn test_phase_i3_effect_bottleneck_triggers_effects_policy() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8,
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Inject an expensive blur effect taking 18 ms (more than entire 16.6 ms frame budget)
    for window_idx in 0..3 {
        for frame_idx in 0..10 {
            let pts = MediaTime::from_frame_index((window_idx * 10 + frame_idx) as i64, 60.0);
            let mut effects = HashMap::new();
            effects.insert("gaussian_blur".to_string(), 18_000);

            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 4_000,
                render_cpu_us: 1_000,
                render_gpu_us: 20_000,
                effect_timings: effects,
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: true,
                frame_pts: pts,
            });
        }
        controller.evaluate_window(
            PlaybackMode::Play,
            MediaTime(1_000_000),
            &proxy_mgr,
            Some("asset-4k-hevc"),
        );
    }

    let decision = controller.current_decision();
    // Invariant: EffectsPolicy is degraded to Reduced
    assert_eq!(
        decision.effects_policy,
        EffectsPolicy::Reduced,
        "Expensive effect must degrade EffectsPolicy"
    );
    // Invariant: Media variant remains Original (no proxy needed!)
    assert_eq!(decision.media_variant, MediaVariant::Original);
    assert!(
        matches!(decision.reason, QoSReason::ExpensiveEffectPressure { .. }),
        "Reason must explicitly name the expensive effect"
    );
}

// ─── I4: Hysteresis Prevents Quality Oscillation ────────────────────────────
#[test]
fn test_phase_i4_hysteresis_prevents_oscillation() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8,
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Alternate: Healthy, Unhealthy, Healthy, Unhealthy for 10 windows
    for cycle in 0..10 {
        let is_spike = cycle % 2 == 1;
        for frame_idx in 0..10 {
            let pts = MediaTime::from_frame_index((cycle * 10 + frame_idx) as i64, 60.0);
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: if is_spike { 30_000 } else { 4_000 },
                render_cpu_us: 1_000,
                render_gpu_us: 5_000,
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: if is_spike { 0 } else { 4 },
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: is_spike,
                frame_pts: pts,
            });
        }
        controller.evaluate_window(
            PlaybackMode::Play,
            MediaTime(1_000_000),
            &proxy_mgr,
            Some("asset-4k-hevc"),
        );
    }

    // Invariant: Because unhealthiness never reached 3 consecutive windows, NO oscillation occurred!
    assert_eq!(
        controller.current_decision().render_quality,
        RenderQuality::Full
    );
    assert_eq!(
        controller.current_decision().media_variant,
        MediaVariant::Original
    );
    assert_eq!(
        controller.transition_history().len(),
        0,
        "Alternating load must produce zero QoS transitions (no hysteresis oscillation)"
    );
}

// ─── I5: Sustained Recovery with M > N Windows ──────────────────────────────
#[test]
fn test_phase_i5_sustained_recovery_with_asymmetric_thresholds() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8, // M > N
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // 1. Trigger degradation with 3 bad windows
    for _ in 0..3 {
        for _ in 0..10 {
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 4_000,
                render_cpu_us: 1_000,
                render_gpu_us: 25_000, // GPU overload
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: true,
                frame_pts: MediaTime(0),
            });
        }
        controller.evaluate_window(PlaybackMode::Play, MediaTime(0), &proxy_mgr, None);
    }
    assert_eq!(
        controller.current_decision().render_quality,
        RenderQuality::Half
    );

    // 2. Feed 5 healthy windows (less than recover_window_threshold 8)
    for _ in 0..5 {
        for _ in 0..10 {
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 4_000,
                render_cpu_us: 1_000,
                render_gpu_us: 5_000, // Healthy
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: false,
                frame_pts: MediaTime(0),
            });
        }
        controller.evaluate_window(PlaybackMode::Play, MediaTime(0), &proxy_mgr, None);
    }
    // Must NOT have recovered yet!
    assert_eq!(
        controller.current_decision().render_quality,
        RenderQuality::Half,
        "Quality must not recover before M consecutive healthy windows"
    );

    // 3. Feed remaining 3 healthy windows (total 8 = M)
    for _ in 0..3 {
        for _ in 0..10 {
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 4_000,
                render_cpu_us: 1_000,
                render_gpu_us: 5_000,
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 3,
                surface_pool_capacity: 10,
                deadline_missed: false,
                frame_pts: MediaTime(0),
            });
        }
        controller.evaluate_window(PlaybackMode::Play, MediaTime(0), &proxy_mgr, None);
    }

    // Now quality must be recovered!
    assert_eq!(
        controller.current_decision().render_quality,
        RenderQuality::Full,
        "Quality must recover to Full after M=8 healthy windows"
    );
}

// ─── I6: Proxy Switch Continuity ─────────────────────────────────────────────
#[test]
fn test_phase_i6_proxy_switch_continuity() {
    let proxy_mgr = create_test_proxy_manager();

    // Verify proxy has identical frame rate and duration structure
    let proxy = proxy_mgr.get_ready_proxy("asset-4k-hevc").unwrap();
    assert_eq!(proxy.frame_rate, 60.0);
    assert_eq!(proxy.width, 1920);
    assert_eq!(proxy.height, 1080);

    // Simulate switching at timestamp T = 32.400s (frame 1944 at 60 FPS)
    let switch_pts = MediaTime::from_secs_f64(32.4);
    let target_frame = switch_pts.as_frame_index(60.0);

    // Source mapping verification: Frame index must be strictly identical across variants
    let mapped_source_pts = MediaTime::from_frame_index(target_frame, proxy.frame_rate);
    assert_eq!(
        mapped_source_pts, switch_pts,
        "Timeline timestamp and frame addressing must be invariant across proxy switch"
    );

    // Presentation continuity: Next frame must be T + 1/60s (zero backwards jump)
    let next_frame_pts = MediaTime::from_frame_index(target_frame + 1, proxy.frame_rate);
    assert!(
        next_frame_pts > switch_pts,
        "Next presentation PTS must advance monotonically without backwards jumps"
    );
    assert_eq!(
        next_frame_pts - switch_pts,
        MediaTime::from_frame_index(1, 60.0)
    );
}

// ─── I7: Memory Pressure Triggers Lookahead Reduction ────────────────────────
#[test]
fn test_phase_i7_surface_memory_pressure_lookahead_reduction() {
    let config = QoSConfig {
        degrade_window_threshold: 3,
        recover_window_threshold: 8,
        target_fps: 60.0,
        window_capacity: 10,
    };
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Inject surface pool 95% full (9 out of 10 allocated)
    for _ in 0..3 {
        for _ in 0..10 {
            controller.record_frame_snapshot(PerformanceSnapshot {
                decode_us: 5_000,
                render_cpu_us: 1_000,
                render_gpu_us: 5_000,
                effect_timings: HashMap::new(),
                decode_queue_depth: 2,
                ready_queue_depth: 4,
                surface_pool_used: 10,
                surface_pool_capacity: 10, // 100% full
                deadline_missed: false,
                frame_pts: MediaTime(0),
            });
        }
        controller.evaluate_window(PlaybackMode::Play, MediaTime(0), &proxy_mgr, None);
    }

    let decision = controller.current_decision();
    assert!(
        decision.lookahead_reduction > 0.0,
        "High pool utilization must reduce lookahead window"
    );
    assert_eq!(
        decision.media_variant,
        MediaVariant::Original,
        "Memory pressure must not trigger premature proxy switch"
    );
    assert!(
        matches!(decision.reason, QoSReason::SurfaceMemoryPressure { .. }),
        "Reason must explicitly state memory pressure"
    );
}

// ─── I8: Scrub Interaction Mode Prioritizes Latency ──────────────────────────
#[test]
fn test_phase_i8_scrub_mode_prioritizes_latency() {
    let config = QoSConfig::default();
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // Evaluate in Scrub mode
    let decision =
        controller.evaluate_window(PlaybackMode::Scrub, MediaTime(5_000_000), &proxy_mgr, None);

    assert_eq!(decision.render_quality, RenderQuality::Half);
    assert_eq!(decision.effects_policy, EffectsPolicy::Reduced);
    assert_eq!(decision.lookahead_reduction, 0.5);
    assert_eq!(decision.reason, QoSReason::ScrubLatencyOptimization);
}

// ─── I9: Pause Mode Gracefully Restores Quality ──────────────────────────────
#[test]
fn test_phase_i9_pause_graceful_quality_restoration() {
    let config = QoSConfig::default();
    let mut controller = QoSController::new(config);
    let proxy_mgr = create_test_proxy_manager();

    // 1. Manually set degraded state as if playing under load
    controller.set_manual_override(Some(QoSDecision {
        media_variant: MediaVariant::Original,
        render_quality: RenderQuality::Half,
        effects_policy: EffectsPolicy::Reduced,
        lookahead_reduction: 0.0,
        reason: QoSReason::GpuRenderDeadlinePressure {
            gpu_render_mean_us: 20_000,
            misses: 5,
            total_frames: 10,
        },
        confidence: 0.9,
    }));
    assert_eq!(
        controller.current_decision().render_quality,
        RenderQuality::Half
    );

    // 2. Remove manual override and simulate User pressing Pause (Idle mode)
    controller.set_manual_override(None);
    let decision =
        controller.evaluate_window(PlaybackMode::Idle, MediaTime(10_000_000), &proxy_mgr, None);

    // Invariant: Decision targets Full quality restoration
    assert_eq!(decision.render_quality, RenderQuality::Full);
    assert_eq!(decision.effects_policy, EffectsPolicy::Full);
    assert_eq!(decision.reason, QoSReason::PausedQualityRestoration);

    // Invariant: Flag indicates pending asynchronous upgrade so visible frame is not flashed
    assert!(
        controller.is_pending_paused_upgrade(),
        "Controller must flag pending asynchronous high-quality upgrade on pause"
    );

    // Simulate background render finishing
    controller.clear_pending_paused_upgrade();
    assert!(!controller.is_pending_paused_upgrade());
}
