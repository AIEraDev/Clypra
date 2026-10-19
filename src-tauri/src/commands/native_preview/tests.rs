use super::*;
use std::time::Instant;
use crate::native_core::TextLayerSnapshot;
use crate::filmstrip_engine::decoder::VideoColorMetadata;

    #[test]
    fn visible_seek_and_scrub_requests_preempt_filmstrip_work() {
        assert!(is_preview_preemptive_request(Some(true), Some("scrub")));
        assert!(is_preview_preemptive_request(Some(false), Some("seek")));
        assert!(is_preview_preemptive_request(None, Some("seek")));
        assert!(!is_preview_preemptive_request(Some(false), Some("playback")));
        assert!(!is_preview_preemptive_request(None, Some("prefetch")));
    }

    #[test]
    fn unspecified_sdr_metadata_uses_limited_rec709_defaults() {
        let params =
            color_params(&VideoColorMetadata::default()).expect("default should be supported");
        assert_eq!(params.color_space, 0);
        assert_eq!(params.range, 0);
        assert_eq!(params.tonemap_operator, 0);
    }

    #[test]
    fn lookahead_is_bounded_by_the_interactive_queue_capacity() {
        // At 30 fps: frame_budget_us = 33_333. Slow decode cannot expand the
        // preview queue beyond two entries: extra speculative work would only
        // make a weak adapter present older frames.
        assert_eq!(deadline_aware_lookahead_count(30, 16, Some(40_000)), 2);
        assert_eq!(deadline_aware_lookahead_count(30, 16, Some(500_000)), 2);

        // At 60 fps (and >=50 fps): frame_budget_us = 16_666. High framerate
        // streams expand the speculative queue to 4 entries to absorb decode jitter.
        assert_eq!(deadline_aware_lookahead_count(60, 16, Some(20_000)), 4);
        assert_eq!(deadline_aware_lookahead_count(60, 16, Some(500_000)), 4);
    }

    #[test]
    fn classifies_surface_transfer_paths_without_guessing() {
        assert_eq!(
            classify_surface_transfer_path(0, false, false),
            "gpu-raster"
        );
        assert_eq!(
            classify_surface_transfer_path(1, true, false),
            "dxgi-zero-copy"
        );
        assert_eq!(classify_surface_transfer_path(1, false, true), "cpu-nv12");
        assert_eq!(classify_surface_transfer_path(2, true, true), "mixed");
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
            },
            epoch,
        ));

        queue.discard_expired(
            now + std::time::Duration::from_micros(MAX_LOOKAHEAD_EXPIRATION_US + 1),
        );
        assert!(queue.is_empty());
    }

    #[test]
    fn queue_discards_stale_forward_frames_on_backward_discontinuity() {
        let mut queue = NativePreviewFrameQueue::new(10);
        let epoch = queue.lifecycle_epoch();
        let queued_frame = |idx: u64| QueuedNativeFrame {
            frame_index: idx,
            decoded_frames: Vec::new(),
            decode_timings: NativeDecodeTimings::default(),
            queued_at: Instant::now(),
            ready_at: Instant::now(),
            scheduler_wait_us: 0,
        };

        // Populate with frames from the old playhead at 400..405
        for idx in 400..=405 {
            let key = format!("frame-{}", idx);
            assert!(queue.begin(&key, Some(idx)));
            queue.complete(key, queued_frame(idx), epoch);
        }
        assert_eq!(queue.highest_frame_index(), Some(405));
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
            ColorPolicy, FrameRequest, FrameTime, ProjectSnapshot, QualityTier,
            RasterLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
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
                }],
                text_layers: vec![],
                transition: None,
            },
            output_width: 320,
            output_height: 180,
            quality: QualityTier::Half,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
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
                transition: None,
            },
            output_width: 1920,
            output_height: 1080,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
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
