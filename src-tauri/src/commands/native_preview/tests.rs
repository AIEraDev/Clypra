use super::*;
use crate::filmstrip_engine::decoder::VideoColorMetadata;
use crate::filmstrip_engine::stream_actor::DecodedFrame;
use crate::native_core::TextLayerSnapshot;
use std::sync::Arc;
use std::time::Instant;

fn lookahead_decision(
    current_frame: u64,
    end_frame: u64,
    same_generation: bool,
    same_quality: bool,
    same_content: bool,
    project_revision_changed: bool,
) -> LookaheadWorkerAction {
    decide_lookahead_worker_action(LookaheadWorkerDecisionInput {
        active: true,
        same_generation,
        same_quality,
        same_content,
        project_revision_changed,
        current_frame,
        end_frame,
        lag_for_ms: 0,
        ms_since_last_resync: None,
    })
}

#[test]
fn lookahead_scheduler_keeps_same_stream_alive_during_transient_starvation() {
    let action = lookahead_decision(100, 100, true, true, true, false);

    assert_eq!(
        action,
        LookaheadWorkerAction::Keep {
            reason: "starvation"
        }
    );
}

#[test]
fn lookahead_scheduler_resyncs_only_after_hysteresis_qualified_lag() {
    let action = lookahead_decision(104, 100, true, true, true, false);

    assert_eq!(
        action,
        LookaheadWorkerAction::Keep {
            reason: "starvation"
        }
    );
}

#[test]
fn lookahead_scheduler_defers_resync_until_worker_finishes() {
    let action = decide_lookahead_worker_action(LookaheadWorkerDecisionInput {
        active: true,
        same_generation: true,
        same_quality: true,
        same_content: true,
        project_revision_changed: false,
        current_frame: 110,
        end_frame: 100,
        lag_for_ms: LOOKAHEAD_RESYNC_SUSTAINED_MS,
        ms_since_last_resync: None,
    });

    assert_eq!(
        action,
        LookaheadWorkerAction::Keep {
            reason: "resync_deferred"
        }
    );
}

#[test]
fn lookahead_scheduler_starts_forward_resync_only_after_cooldown() {
    let input = |elapsed| LookaheadWorkerDecisionInput {
        active: false,
        same_generation: true,
        same_quality: true,
        same_content: true,
        project_revision_changed: false,
        current_frame: 110,
        end_frame: 100,
        lag_for_ms: LOOKAHEAD_RESYNC_SUSTAINED_MS,
        ms_since_last_resync: elapsed,
    };

    assert_eq!(
        decide_lookahead_worker_action(input(Some(LOOKAHEAD_RESYNC_COOLDOWN_MS - 1))),
        LookaheadWorkerAction::Start { reason: "none" }
    );
    assert_eq!(
        decide_lookahead_worker_action(input(Some(LOOKAHEAD_RESYNC_COOLDOWN_MS))),
        LookaheadWorkerAction::Start {
            reason: "resync_behind"
        }
    );
}

#[test]
fn lookahead_trace_reports_signed_lag_without_clamping_ahead_to_behind() {
    assert_eq!(lookahead_frame_distances(100, 104), (4, 0));
    assert_eq!(lookahead_frame_distances(104, 100), (0, 4));
}

fn simulate_playback_decode(
    service_times_ms: &[u64],
    tick_ms: u64,
    duration_ms: u64,
) -> (u64, u64) {
    assert!(!service_times_ms.is_empty());
    let mut now_ms = 0;
    let mut decoded_frames = 0;
    let mut next_decode_due_ms = service_times_ms[0];
    let mut decode_index = 0;
    let mut resyncs = 0;
    let mut lag_started_at_ms: Option<u64> = None;
    let mut last_resync_ms: Option<u64> = None;

    while now_ms <= duration_ms {
        let current_frame = now_ms / tick_ms;
        let mut frame_completed = false;
        while now_ms >= next_decode_due_ms {
            decoded_frames += 1;
            frame_completed = true;
            decode_index = (decode_index + 1) % service_times_ms.len();
            next_decode_due_ms = next_decode_due_ms.saturating_add(service_times_ms[decode_index]);
        }

        let frames_behind = current_frame.saturating_sub(decoded_frames);
        if frames_behind > LOOKAHEAD_RESYNC_BEHIND_HYSTERESIS_FRAMES {
            if lag_started_at_ms.is_none() {
                lag_started_at_ms = Some(now_ms);
            }
        } else {
            lag_started_at_ms = None;
        }

        let lag_for_ms = lag_started_at_ms
            .map(|start| now_ms.saturating_sub(start))
            .unwrap_or(0);

        let action = decide_lookahead_worker_action(LookaheadWorkerDecisionInput {
            active: !frame_completed,
            same_generation: true,
            same_quality: true,
            same_content: true,
            project_revision_changed: false,
            current_frame,
            end_frame: decoded_frames,
            lag_for_ms,
            ms_since_last_resync: last_resync_ms.map(|t| now_ms.saturating_sub(t)),
        });

        if matches!(
            action,
            LookaheadWorkerAction::Start {
                reason: "resync_behind"
            }
        ) {
            resyncs += 1;
            last_resync_ms = Some(now_ms);
            lag_started_at_ms = None;
            // A planned resync reanchors the worker once, rather than
            // cancelling every subsequent starvation observation.
            decoded_frames = current_frame;
            next_decode_due_ms = now_ms.saturating_add(service_times_ms[decode_index]);
        }

        now_ms = now_ms.saturating_add(tick_ms);
    }

    (decoded_frames, resyncs)
}

#[test]
fn slower_than_real_time_decode_resyncs_but_keeps_making_progress() {
    let (decoded_frames, resyncs) = simulate_playback_decode(&[60], 40, 1_200);

    assert!(decoded_frames > 0, "slow decode must still produce frames");
    assert!(resyncs > 0, "material lag must eventually trigger a planned resync");
}

#[test]
fn decode_jitter_around_the_budget_does_not_resync() {
    let (decoded_frames, resyncs) = simulate_playback_decode(&[30, 50, 30, 50], 40, 1_200);

    assert!(decoded_frames > 0, "jittering decode must continue making progress");
    assert_eq!(resyncs, 0, "ordinary jitter must remain below resync hysteresis");
}

#[test]
fn lookahead_scheduler_preserves_distinct_invalidation_reasons() {
    assert_eq!(
        lookahead_decision(10, 10, false, true, true, false),
        LookaheadWorkerAction::Abort { reason: "generation" }
    );
    assert_eq!(
        lookahead_decision(10, 10, true, true, false, false),
        LookaheadWorkerAction::Abort {
            reason: "clip_boundary"
        }
    );
    assert_eq!(
        lookahead_decision(10, 10, true, true, true, true),
        LookaheadWorkerAction::Abort {
            reason: "project_edit"
        }
    );
}

#[test]
fn lookahead_content_key_tracks_stream_topology_not_playback_time() {
    let layer = |source_frame: u64, path: &str| crate::native_core::VideoLayerSnapshot {
        layer_id: "layer-1".to_string(),
        asset_id: "asset-1".to_string(),
        video_path: path.to_string(),
        source_time: FrameTime::new(source_frame, source_frame as i64, DEFAULT_TIME_SCALE)
            .expect("valid source time"),
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
        crop: None,
        color_grade: None,
        body_effect: None,
    };

    let at_start = vec![layer(0, "/media/first.mp4")];
    let later_in_same_stream = vec![layer(30, "/media/first.mp4")];
    let different_stream = vec![layer(30, "/media/second.mp4")];

    assert_eq!(
        lookahead_content_key("revision-1", &at_start),
        lookahead_content_key("revision-1", &later_in_same_stream),
        "advancing source time must not restart lookahead"
    );
    assert_ne!(
        lookahead_content_key("revision-1", &later_in_same_stream),
        lookahead_content_key("revision-1", &different_stream),
        "a changed source stream must invalidate stale lookahead"
    );
    assert_ne!(
        lookahead_content_key("revision-2", &later_in_same_stream),
        lookahead_content_key("revision-1", &later_in_same_stream),
        "a project revision change must invalidate stale lookahead"
    );
}

#[test]
fn video_lookahead_does_not_warm_text_under_the_preview_lock() {
    assert!(!should_warm_native_text_during_prefetch(true, true));
    assert!(should_warm_native_text_during_prefetch(true, false));
    assert!(!should_warm_native_text_during_prefetch(false, false));
}

/// macOS-only seam test for the exact decode entry point used by the native
/// presenter. Generate a fixture first (for example with
/// `ffmpeg -f lavfi -i testsrc2=size=3840x2160:rate=30 -t 2 -c:v hevc_videotoolbox -pix_fmt nv12 fixture.mov`)
/// and set `CLYPRA_METAL_FIXTURE` to its path. The test stays ignored because
/// CI workers do not provide a VideoToolbox/Metal device.
#[cfg(all(target_os = "macos", test))]
#[tokio::test]
#[ignore = "requires a macOS VideoToolbox fixture and Metal device"]
async fn presenter_decode_seam_returns_metal_frame_when_enabled() {
    let fixture = std::env::var("CLYPRA_METAL_FIXTURE")
        .expect("set CLYPRA_METAL_FIXTURE to a generated VideoToolbox fixture");
    std::env::set_var("CLYPRA_METAL_DECODE", "1");
    let request: NativeVideoProjectFrameRequest = serde_json::from_value(serde_json::json!({
        "canvasWidth": 640,
        "canvasHeight": 360,
        "mode": "playback",
        "layers": [{
            "videoPath": fixture,
            "timeSecs": 0.0,
            "x": 0,
            "y": 0,
            "width": 640,
            "height": 360
        }]
    }))
    .expect("presenter request should deserialize");
    let options = DecodeFrameOptions {
        is_playback: true,
        ..DecodeFrameOptions::default()
    };
    let result = decode_native_video_layers_metal(&request, &options, None)
        .await
        .expect("Metal seam decode should not be cancelled");
    let Some((frames, _timings)) = result else {
        panic!("Metal decode returned no frames; inspect the typed failure counters");
    };
    assert!(matches!(
        frames.first().map(|frame| &frame.0),
        Some(DecodedFrame::Metal(_))
    ));
}

#[test]
fn visible_frame_allocation_preserves_explicit_demand_attribution() {
    let request_id =
        crate::wgpu_compositor::FrameRequestId::new("request:seek:1").expect("request identity");
    let attribution = frame_attribution_for_mode(
        &crate::wgpu_compositor::RenderLifecycleContext::new(request_id.clone()),
        Some("scrub"),
    )
    .expect("attribution");

    assert!(matches!(
        attribution,
        crate::wgpu_compositor::FrameAttribution::Correlated { request_ids, workload: crate::wgpu_compositor::WorkloadMode::Scrub }
        if request_ids == vec![request_id]
    ));
}

#[test]
fn visible_frame_allocation_does_not_synthesize_playback_request_attribution() {
    let attribution = frame_attribution_for_mode(
        &crate::wgpu_compositor::RenderLifecycleContext::empty(),
        Some("playback"),
    )
    .expect("attribution");

    assert!(matches!(
        attribution,
        crate::wgpu_compositor::FrameAttribution::Uncorrelated {
            reason: crate::wgpu_compositor::MissingCorrelationReason::UnknownProducer
        }
    ));
}

#[test]
fn presentation_attempt_completion_terminalizes_frame_and_request_once() {
    let registry = std::sync::Mutex::new(crate::wgpu_compositor::FrameLifecycleRegistry::default());
    let request_id = registry
        .lock()
        .expect("registry")
        .begin_request("scrub")
        .expect("request");
    let mut lifecycle = PresentationLifecycleGuard::begin(
        &registry,
        crate::wgpu_compositor::FrameAttribution::correlated(
            vec![request_id.clone()],
            crate::wgpu_compositor::WorkloadMode::Scrub,
        )
        .expect("attribution"),
        vec![request_id.clone()],
    )
    .expect("lifecycle");
    let frame_id = lifecycle.frame_id().clone();

    lifecycle.complete().expect("complete presentation");

    let registry = registry.lock().expect("registry");
    assert!(matches!(
        registry.frame_state(&frame_id).expect("frame"),
        crate::wgpu_compositor::LifecycleState::Terminal(
            crate::wgpu_compositor::FrameTerminalDisposition::Presented { .. }
        )
    ));
    assert!(matches!(
        registry.request_state(&request_id).expect("request"),
        crate::wgpu_compositor::LifecycleState::Terminal(
            crate::wgpu_compositor::RequestTerminalDisposition::Presented { frame_id: presented }
        ) if presented == &frame_id
    ));
}

#[test]
fn failed_presentation_attempt_terminalizes_its_frame_without_synthetic_request() {
    let registry = std::sync::Mutex::new(crate::wgpu_compositor::FrameLifecycleRegistry::default());
    let mut lifecycle = PresentationLifecycleGuard::begin(
        &registry,
        crate::wgpu_compositor::FrameAttribution::Uncorrelated {
            reason: crate::wgpu_compositor::MissingCorrelationReason::UnknownProducer,
        },
        Vec::new(),
    )
    .expect("lifecycle");
    let frame_id = lifecycle.frame_id().clone();

    lifecycle.fail(crate::wgpu_compositor::PresentationFailureReason::SurfaceAcquireFailed);

    let registry = registry.lock().expect("registry");
    assert!(matches!(
        registry.frame_state(&frame_id).expect("frame"),
        crate::wgpu_compositor::LifecycleState::Terminal(
            crate::wgpu_compositor::FrameTerminalDisposition::FailedAfterRecovery { .. }
        )
    ));
    assert_eq!(
        registry
            .frame_accounting()
            .expect("accounting")
            .failed_after_recovery,
        1
    );
}

#[test]
fn visible_seek_and_scrub_requests_preempt_filmstrip_work() {
    assert!(is_preview_preemptive_request(Some(true), Some("scrub")));
    assert!(is_preview_preemptive_request(Some(false), Some("seek")));
    assert!(is_preview_preemptive_request(None, Some("seek")));
    assert!(!is_preview_preemptive_request(
        Some(false),
        Some("playback")
    ));
    assert!(!is_preview_preemptive_request(None, Some("prefetch")));
}

#[test]
fn interactive_seek_does_not_restart_forward_lookahead() {
    assert!(!should_schedule_lookahead_predecode(
        Some(true),
        Some("seek")
    ));
    assert!(!should_schedule_lookahead_predecode(
        Some(true),
        Some("scrub")
    ));
    assert!(!should_schedule_lookahead_predecode(None, Some("seek")));

    // The post-release paused frame is no longer interactive and can
    // safely prime frames for a subsequent playback start.
    assert!(should_schedule_lookahead_predecode(None, None));
    assert!(should_schedule_lookahead_predecode(None, Some("playback")));
}

#[test]
fn interactive_scrub_is_not_dropped_for_audio_lateness() {
    assert!(!should_drop_frame_for_audio_lateness(
        true,
        2_000_000,
        true,
        Some(true),
        Some("playback"),
        true,
    ));
    assert!(!should_drop_frame_for_audio_lateness(
        true,
        2_000_000,
        false,
        Some(false),
        Some("scrub"),
        true,
    ));
}

#[test]
fn settled_seek_and_severe_playback_drift_keep_audio_lateness_policy() {
    assert!(should_drop_frame_for_audio_lateness(
        true,
        0,
        false,
        Some(false),
        Some("seek"),
        true,
    ));
    assert!(should_drop_frame_for_audio_lateness(
        false,
        120_001,
        true,
        Some(false),
        Some("playback"),
        true,
    ));
}

#[test]
fn unspecified_sdr_metadata_uses_limited_rec709_defaults() {
    let params = color_params(&VideoColorMetadata::default()).expect("default should be supported");
    assert_eq!(params.color_space, 0);
    assert_eq!(params.range, 0);
    assert_eq!(params.tonemap_operator, 0);
}

#[test]
fn lookahead_is_bounded_by_the_interactive_queue_capacity() {
    assert_eq!(
        deadline_aware_lookahead_count(30, 16, Some(40_000)).count,
        6
    );
    assert_eq!(
        deadline_aware_lookahead_count(30, 16, Some(500_000)).count,
        6
    );

    assert_eq!(
        deadline_aware_lookahead_count(60, 16, Some(20_000)).count,
        8
    );
    assert_eq!(
        deadline_aware_lookahead_count(60, 16, Some(500_000)).count,
        8
    );
}

#[test]
fn aggregates_explicit_transfer_tags_without_defaulting_to_cpu() {
    use crate::native_core::performance::FrameTransferPath;

    assert_eq!(aggregate_transfer_paths(&[]), None);
    assert_eq!(
        aggregate_transfer_paths(&[
            FrameTransferPath::MetalZeroCopyP010,
            FrameTransferPath::MetalZeroCopyP010,
        ]),
        Some(FrameTransferPath::MetalZeroCopyP010)
    );
    assert_eq!(
        aggregate_transfer_paths(&[
            FrameTransferPath::MetalZeroCopyP010,
            FrameTransferPath::CpuNv12,
        ]),
        Some(FrameTransferPath::Mixed)
    );
}

#[test]
fn lookahead_sample_keeps_decoded_transfer_path_separate_from_strategy() {
    let decoded = vec![(
        DecodedFrame::Cpu {
            y: Arc::from(vec![0_u8; 4]),
            uv: Arc::from(vec![0_u8; 2]),
        },
        2,
        2,
        VideoColorMetadata::default(),
        0,
    )];

    assert_eq!(decoded[0].0.transfer_path(), FrameTransferPath::CpuNv12);
    assert_eq!(
        decoded_frame_transfer_path(&decoded),
        FrameTransferPath::CpuNv12
    );
    assert_eq!(
        decoded_frame_transfer_path(&[]),
        FrameTransferPath::GpuRaster
    );
}

#[test]
fn zero_copy_guard_flags_hardware_frames_that_reach_cpu() {
    assert!(super::is_required_zero_copy_violation(
        FrameTransferPath::CpuNv12,
        Some(true),
        true,
        false,
    ));
    assert!(!super::is_required_zero_copy_violation(
        FrameTransferPath::MetalZeroCopyP010,
        Some(true),
        true,
        false,
    ));
    assert!(!super::is_required_zero_copy_violation(
        FrameTransferPath::CpuNv12,
        Some(false),
        true,
        false,
    ));
    assert!(!super::is_required_zero_copy_violation(
        FrameTransferPath::CpuNv12,
        Some(true),
        true,
        true,
    ));
}

#[test]
fn typed_stream_control_outcomes_do_not_become_decode_failures() {
    use crate::filmstrip_engine::stream_actor::StreamDecodeError;

    assert!(matches!(
        NativePresentationError::from(StreamDecodeError::Superseded),
        NativePresentationError::Superseded
    ));
    assert!(matches!(
        NativePresentationError::from(StreamDecodeError::Cancelled),
        NativePresentationError::Cancelled
    ));
    assert!(matches!(
        NativePresentationError::from(StreamDecodeError::Decoder("decoder failed".into())),
        NativePresentationError::Decode(_)
    ));
    assert!(matches!(
        NativePresentationError::from(StreamDecodeError::Actor("actor failed".into())),
        NativePresentationError::Pipeline(_)
    ));
}

#[test]
fn full_range_rec601_selects_the_explicit_matrix() {
    let color = VideoColorMetadata {
        range: "full".to_string(),
        matrix: "bt601_625".to_string(),
        transfer: "bt709".to_string(),
        ..Default::default()
    };

    let params = color_params(&color).expect("Rec.601 SDR should be supported");
    assert_eq!(params.color_space, 3);
    assert_eq!(params.range, 1);
}

#[test]
fn unsupported_partial_metadata_is_rejected() {
    let color = VideoColorMetadata {
        matrix: "bt2020_ncl".to_string(),
        transfer: "unspecified".to_string(),
        ..Default::default()
    };

    assert!(color_params(&color).is_err());
}

#[test]
fn frame_color_metadata_wins_with_stream_fallbacks() {
    let stream = VideoColorMetadata {
        range: "full".to_string(),
        matrix: "bt601_625".to_string(),
        transfer: "bt709".to_string(),
        ..Default::default()
    };

    let frame = VideoColorMetadata {
        matrix: "bt709".to_string(),
        ..Default::default()
    };

    let merged = merge_color_metadata(frame, &stream);
    assert_eq!(merged.range, "full");
    assert_eq!(merged.matrix, "bt709");
    assert_eq!(merged.transfer, "bt709");
}

#[test]
fn project_request_defaults_are_stable() {
    let request: NativeProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"color":[1,0,0,1],"x":0,"y":0,"width":100,"height":50}]}"#,
        )
        .expect("project request should deserialize");

    assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
    assert_eq!(request.layers[0].opacity, 1.0);
    assert_eq!(request.layers[0].blend_mode, "normal");
    validate_project_request(&request).expect("default request should validate");
}

#[test]
fn project_request_rejects_invalid_geometry_and_blend_modes() {
    let mut request = NativeProjectFrameRequest {
        canvas_width: 320,
        canvas_height: 180,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: Vec::new(),
    };
    request.layers.push(super::NativeProjectSolidLayer {
        color: [1.0, 0.0, 0.0, 1.0],
        x: 0.0,
        y: 0.0,
        width: -1.0,
        height: 10.0,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
    });

    assert!(validate_project_request(&request).is_err());
    assert!(parse_blend_mode("unsupported").is_err());
    assert_eq!(
        parse_blend_mode("color-dodge").unwrap(),
        crate::wgpu_compositor::BlendMode::ColorDodge
    );
    assert_eq!(
        parse_blend_mode("colordodge").unwrap(),
        crate::wgpu_compositor::BlendMode::ColorDodge
    );
    assert_eq!(
        parse_blend_mode("darken").unwrap(),
        crate::wgpu_compositor::BlendMode::Darken
    );
    assert_eq!(
        parse_blend_mode("lighten").unwrap(),
        crate::wgpu_compositor::BlendMode::Lighten
    );
}

#[test]
fn project_pixels_map_to_top_left_ndc() {
    let layer = super::NativeProjectSolidLayer {
        color: [1.0, 0.0, 0.0, 1.0],
        x: 0.0,
        y: 0.0,
        width: 160.0,
        height: 90.0,
        rotation: 90.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
    };

    let transform = project_layer_transform(&layer, 320.0, 180.0);

    assert!((transform.translate_x + 0.5).abs() < f32::EPSILON);
    assert!((transform.translate_y - 0.5).abs() < f32::EPSILON);
    assert!((transform.scale_x - 0.5).abs() < f32::EPSILON);
    assert!((transform.scale_y - 0.5).abs() < f32::EPSILON);
    assert!((transform.rotation_rad + std::f32::consts::FRAC_PI_2).abs() < 1e-6);
    assert!((transform.canvas_aspect_ratio - (320.0 / 180.0)).abs() < f32::EPSILON);
}

#[test]
fn raster_rotation_preserves_the_authored_screen_angle_on_a_widescreen_canvas() {
    // Regression: rotating in NDC made -45° appear as roughly -29° on a
    // 16:9 preview because the NDC X and Y axes have unequal pixel scales.
    // The compositor matrix must rotate a text baseline by its authored
    // angle in canvas pixels, matching the transform overlay.
    let layer = super::NativeProjectSolidLayer {
        color: [1.0, 1.0, 1.0, 1.0],
        x: 460.0,
        y: 300.0,
        width: 420.0,
        height: 80.0,
        rotation: -45.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
    };
    let canvas_width = 1920.0;
    let canvas_height = 1080.0;
    let matrix = project_layer_transform(&layer, canvas_width, canvas_height).to_matrix();

    // The transformed local X axis is the text baseline. Convert its NDC
    // direction to canvas pixels (NDC Y points upward) before measuring it.
    let dx = matrix[0][0] * canvas_width;
    let dy = -matrix[0][1] * canvas_height;
    let visible_angle = dy.atan2(dx).to_degrees();

    assert!(
        (visible_angle - layer.rotation).abs() < 0.001,
        "expected {}°, got {}°",
        layer.rotation,
        visible_angle,
    );
}

fn text_layer_with_box(box_width: Option<f32>, box_height: Option<f32>) -> TextLayerSnapshot {
    TextLayerSnapshot {
        layer_id: None,
        text: "Hello".to_string(),
        font_id: "inter".to_string(),
        font_size: 48.0,
        font_weight: "normal".to_string(),
        font_style: "normal".to_string(),
        letter_spacing: 0.0,
        line_height: 1.2,
        color: [1.0, 1.0, 1.0, 1.0],
        text_align: "left".to_string(),
        vertical_align: "top".to_string(),
        x: 10.0,
        y: 20.0,
        box_width,
        box_height,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
        stroke_color: None,
        stroke_width: None,
        shadow_color: None,
        shadow_offset: None,
        shadow_blur: None,
        background: None,
        runs: Vec::new(),
        template_id: None,
        template_data: None,
        effect: None,
    }
}

#[test]
fn native_text_scale_fits_rasterized_bounds_inside_text_box() {
    let layer = text_layer_with_box(Some(100.0), Some(40.0));

    assert_eq!(compute_text_layer_scale(&layer, 200.0, 80.0), 0.5);
    assert_eq!(compute_text_layer_scale(&layer, 80.0, 30.0), 1.0);
}

#[test]
fn native_text_scale_does_not_scale_without_a_valid_text_box() {
    let layer = text_layer_with_box(None, None);
    assert_eq!(compute_text_layer_scale(&layer, 200.0, 80.0), 1.0);
    assert_eq!(compute_text_layer_scale(&layer, f32::NAN, 80.0), 1.0);
}

#[test]
fn video_project_request_defaults_are_stable() {
    let request: NativeVideoProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"videoPath":"/tmp/clip.mp4","timeSecs":1.0,"x":0,"y":0,"width":320,"height":180}]}"#,
        )
        .expect("video project request should deserialize");

    assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
    assert_eq!(request.layers[0].opacity, 1.0);
    assert_eq!(request.layers[0].blend_mode, "normal");
    validate_video_project_request(&request).expect("default request should validate");
}

#[test]
fn video_project_rejects_invalid_raster_payloads() {
    let mut request: NativeVideoProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[],"rasterLayers":[{"rgba":[255,255,255,255],"width":2,"height":2,"x":0,"y":0}]}"#,
        )
        .expect("video project request should deserialize");

    assert!(validate_video_project_request(&request).is_err());
    request.raster_layers[0].rgba = Some(vec![255; 16]);
    validate_video_project_request(&request).expect("valid raster payload should validate");
}

#[test]
fn native_preview_queue_is_bounded_and_consumable() {
    let mut queue = NativePreviewFrameQueue::new(2);
    assert_eq!(queue.max_entries(), 2);
    assert_eq!(
        NativePreviewFrameQueue::new(24).max_entries(),
        NATIVE_PREVIEW_QUEUE_CAPACITY
    );
    let queued_frame = || QueuedNativeFrame {
        frame_index: 0,
        decoded_frames: Vec::new(),
        decode_timings: NativeDecodeTimings::default(),
        queued_at: Instant::now(),
        ready_at: Instant::now(),
        scheduler_wait_us: 0,
        lifecycle_context: crate::wgpu_compositor::RenderLifecycleContext::empty(),
    };
    assert!(queue.begin("frame-1", None));
    assert!(!queue.begin("frame-1", None));
    queue.complete(
        "frame-1".to_string(),
        queued_frame(),
        queue.lifecycle_epoch(),
    );
    assert!(queue.contains("frame-1"));
    assert!(queue.take("frame-1").is_some());
    assert!(!queue.contains("frame-1"));

    assert!(queue.begin("frame-2", None));
    queue.complete(
        "frame-2".to_string(),
        queued_frame(),
        queue.lifecycle_epoch(),
    );
    assert!(queue.begin("frame-3", None));
    queue.complete(
        "frame-3".to_string(),
        queued_frame(),
        queue.lifecycle_epoch(),
    );
    assert!(queue.begin("frame-4", None));
    queue.complete(
        "frame-4".to_string(),
        queued_frame(),
        queue.lifecycle_epoch(),
    );
    assert!(!queue.contains("frame-2"));
    assert!(queue.contains("frame-3"));
    assert!(queue.contains("frame-4"));
}

#[test]
fn queue_residency_measures_only_ready_frame_wait() {
    let ready_at = Instant::now();
    let presentation_started = ready_at + std::time::Duration::from_micros(400_000);

    assert_eq!(queue_residency_us(ready_at, presentation_started), 400_000);
}

#[test]
fn queue_residency_is_zero_when_a_ready_frame_is_immediately_presented() {
    let now = Instant::now();
    assert_eq!(queue_residency_us(now, now), 0);
}

#[test]
fn queue_rejects_entries_from_an_earlier_playback_lifetime() {
    let mut queue = NativePreviewFrameQueue::new(2);
    let stale_epoch = queue.lifecycle_epoch();
    queue.reset();

    assert!(!queue.complete(
        "old-frame".to_string(),
        QueuedNativeFrame {
            frame_index: 1,
            decoded_frames: Vec::new(),
            decode_timings: NativeDecodeTimings::default(),
            queued_at: Instant::now(),
            ready_at: Instant::now(),
            scheduler_wait_us: 0,
            lifecycle_context: crate::wgpu_compositor::RenderLifecycleContext::empty(),
        },
        stale_epoch,
    ));
    assert!(queue.is_empty());
}

#[test]
fn queue_discards_ready_frames_that_missed_the_latency_deadline() {
    let mut queue = NativePreviewFrameQueue::new(2);
    let epoch = queue.lifecycle_epoch();
    let now = Instant::now();
    assert!(queue.complete(
        "expired-frame".to_string(),
        QueuedNativeFrame {
            frame_index: 1,
            decoded_frames: Vec::new(),
            decode_timings: NativeDecodeTimings::default(),
            queued_at: now,
            ready_at: now,
            scheduler_wait_us: 0,
            lifecycle_context: crate::wgpu_compositor::RenderLifecycleContext::empty(),
        },
        epoch,
    ));

    queue.discard_expired(now + std::time::Duration::from_micros(MAX_LOOKAHEAD_EXPIRATION_US + 1));
    assert!(queue.is_empty());
}

#[test]
fn queue_discards_stale_forward_frames_on_backward_discontinuity() {
    let mut queue = NativePreviewFrameQueue::new(NATIVE_PREVIEW_QUEUE_CAPACITY);
    let epoch = queue.lifecycle_epoch();
    let queued_frame = |idx: u64| QueuedNativeFrame {
        frame_index: idx,
        decoded_frames: Vec::new(),
        decode_timings: NativeDecodeTimings::default(),
        queued_at: Instant::now(),
        ready_at: Instant::now(),
        scheduler_wait_us: 0,
        lifecycle_context: crate::wgpu_compositor::RenderLifecycleContext::empty(),
    };

    // Populate with frames from the old playhead up to capacity
    let end_idx = 400 + NATIVE_PREVIEW_QUEUE_CAPACITY as u64;
    for idx in 400..=end_idx {
        let key = format!("frame-{}", idx);
        assert!(queue.begin(&key, Some(idx)));
        queue.complete(key, queued_frame(idx), epoch);
    }
    assert_eq!(queue.highest_frame_index(), Some(end_idx));
    assert_eq!(queue.len(), NATIVE_PREVIEW_QUEUE_CAPACITY);

    // Discontinuity: playhead jumped backward to frame 0.
    queue.discard_discontinuity(0, NATIVE_PREVIEW_LOOKAHEAD_FRAMES);

    // The retained frames are outside the new interactive window and must
    // be purged.
    assert!(queue.is_empty());
    assert_eq!(queue.highest_frame_index(), None);
}

#[test]
fn queue_invalidate_generation_resets_queue_and_epochs() {
    let mut queue = NativePreviewFrameQueue::new(10);
    let old_epoch = queue.lifecycle_epoch();
    let queued_frame = |idx: u64| QueuedNativeFrame {
        frame_index: idx,
        decoded_frames: Vec::new(),
        decode_timings: NativeDecodeTimings::default(),
        queued_at: Instant::now(),
        ready_at: Instant::now(),
        scheduler_wait_us: 0,
        lifecycle_context: crate::wgpu_compositor::RenderLifecycleContext::empty(),
    };

    queue.begin("frame-50", Some(50));
    queue.complete("frame-50".to_string(), queued_frame(50), old_epoch);
    assert_eq!(queue.highest_frame_index(), Some(50));

    // Invalidate to generation 2
    queue.invalidate_generation(2);
    assert!(queue.is_empty());
    assert_eq!(queue.highest_frame_index(), None);
    assert!(queue.is_generation_current(2));
    assert!(!queue.is_generation_current(1));

    // An async decode from the old epoch must be rejected
    assert!(!queue.complete("stale".to_string(), queued_frame(51), old_epoch));
}

#[test]
fn queue_observe_frame_index_snaps_backward_on_regression() {
    let mut queue = NativePreviewFrameQueue::new(10);
    queue.observe_frame_index(420);
    assert_eq!(queue.highest_frame_index(), Some(420));

    // Normal small forward progression
    queue.observe_frame_index(421);
    assert_eq!(queue.highest_frame_index(), Some(421));

    // Big backward presentation (e.g. restart from 0)
    queue.observe_frame_index(0);
    assert_eq!(queue.highest_frame_index(), Some(0));
}

#[test]
fn to_video_project_request_scales_raster_layers_proportionally_to_output_resolution() {
    use crate::native_core::contracts::{
        ColorPolicy, FrameRequest, FrameTime, ProjectSnapshot, QualityTier, RasterLayerSnapshot,
        DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
    };

    let request = FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "test-raster-scale".to_string(),
        frame_time: FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-1".to_string(),
            frame_rate: 30,
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![],
            raster_layers: vec![RasterLayerSnapshot {
                layer_id: None,
                asset_id: "text-1".to_string(),
                rgba: None,
                width: 480,
                height: 120,
                display_width: None,
                display_height: None,
                x: 720.0,
                y: 480.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                color_grade: None,
                is_mask: false,
                is_text: true,
                is_premultiplied: false,
            }],
            text_layers: vec![],
            effect_layers: vec![],
            transition: None,
        },
        output_width: 320,
        output_height: 180,
        quality: QualityTier::Half,
        color_policy: ColorPolicy::default(),
        render_graph_version: 1,
        generation: None,
        target_generation: None,
        mode: None,
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
        is_scrubbing: None,
        allow_keyframe_approx: None,
        lookahead_horizon_frames: None,
        lookahead_clamp_reason: None,
    };

    let legacy = super::to_video_project_request(&request).expect("request should convert");
    assert_eq!(legacy.canvas_width, 320);
    assert_eq!(legacy.canvas_height, 180);
    assert_eq!(legacy.raster_layers.len(), 1);

    let raster = &legacy.raster_layers[0];
    // Raw texture pixel dimensions are preserved for GPU upload
    assert_eq!(raster.width, 480);
    assert_eq!(raster.height, 120);
    // Position and display dimensions are scaled to the output surface coordinate system
    assert_eq!(raster.x, 120.0);
    assert_eq!(raster.y, 80.0);
    assert_eq!(raster.display_width(), 80.0);
    assert_eq!(raster.display_height(), 20.0);
}

#[test]
fn test_cly_bug_002_transition_with_raster_and_extra_video_layers() {
    let transition = super::TransitionSnapshot {
        transition_type: "cross-dissolve".to_string(),
        outgoing_layer: "video-1".to_string(),
        incoming_layer: "video-2".to_string(),
        progress: 0.5,
        feather: 0.0,
        intensity: 1.0,
        fade_color: None,
    };
    // 3 video layers (outgoing, incoming, and an overlay video) + 1 raster overlay
    let layer_ids = vec![
        "video-1".to_string(),
        "video-2".to_string(),
        "video-3".to_string(),
    ];
    let result = super::validate_transition(&transition, &layer_ids, 1);
    assert!(
        result.is_ok(),
        "Transitions must allow extra video layers and raster overlay layers: {:?}",
        result
    );
}

#[test]
fn test_cly_bug_010_video_crop_margins_preserved_in_request_conversion() {
    use crate::native_core::contracts::{
        ColorPolicy, CropMarginsSnapshot, FrameRequest, FrameTime, ProjectSnapshot, QualityTier,
        VideoLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
    };

    let request = FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "test-crop-margins".to_string(),
        frame_time: FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-crop".to_string(),
            frame_rate: 30,
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![VideoLayerSnapshot {
                layer_id: "layer-1".to_string(),
                asset_id: "asset-1".to_string(),
                video_path: "/test/video.mp4".to_string(),
                source_time: FrameTime::new(1, 0, DEFAULT_TIME_SCALE).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                crop: Some(CropMarginsSnapshot {
                    left: 0.1,
                    top: 0.2,
                    right: 0.15,
                    bottom: 0.25,
                }),
                color_grade: None,
                body_effect: None,
            }],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: vec![],
            transition: None,
        },
        output_width: 1920,
        output_height: 1080,
        quality: QualityTier::Full,
        color_policy: ColorPolicy::default(),
        render_graph_version: 1,
        generation: None,
        target_generation: None,
        mode: None,
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
        is_scrubbing: None,
        allow_keyframe_approx: None,
        lookahead_horizon_frames: None,
        lookahead_clamp_reason: None,
    };

    let legacy = super::to_video_project_request(&request).expect("request should convert");
    assert_eq!(legacy.layers.len(), 1);
    assert_eq!(
        legacy.layers[0].crop,
        Some(CropMarginsSnapshot {
            left: 0.1,
            top: 0.2,
            right: 0.15,
            bottom: 0.25,
        })
    );
}
