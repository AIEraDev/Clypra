use super::*;

#[cfg(test)]
mod tests {
    use super::render_session::{
        playback_quality_after_lookahead_misses, should_follow_audio_clock,
    };
    use super::*;
    use crate::native_core::{
        PlaybackClockStatus, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
    };
    use parking_lot::RwLock;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8};
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    fn plan() -> PlaybackPlan {
        PlaybackPlan {
            contract_version: crate::native_core::NATIVE_CORE_CONTRACT_VERSION,
            project_revision: "test:1".to_string(),
            frame_rate: 30,
            duration_frames: 30,
            audio_track_count: 0,
        }
    }

    fn clock(ticks: i64) -> FrameTime {
        FrameTime::new(0, ticks, DEFAULT_TIME_SCALE).unwrap()
    }

    #[test]
    fn coordinator_preserves_native_frame_addressing() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();
        runtime.play(clock(0)).unwrap();
        let state = runtime.tick(clock(500_000)).unwrap();
        assert_eq!(state.presented_frame, Some(15));
        assert_eq!(state.project_revision, "test:1");
    }

    #[test]
    fn play_from_audio_reanchors_runtime_to_audio_position() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();

        let state = runtime.play_from_audio(clock(500_000)).unwrap();

        assert_eq!(state.audio_position_ticks, 500_000);
        assert_eq!(state.presented_frame, Some(15));
        assert_eq!(state.clock_status, PlaybackClockStatus::MonotonicFallback);
    }

    #[test]
    fn coordinator_auto_configures_when_unconfigured() {
        let mut runtime = NativePlaybackRuntime::new();
        assert!(runtime.state().is_ok());
    }

    #[test]
    fn seek_from_audio_reanchors_continuous_playback() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();
        runtime.play(clock(0)).unwrap();

        let state = runtime.seek_from_audio(12, clock(500_000)).unwrap();
        assert_eq!(state.presented_frame, Some(12));

        let state = runtime.tick(clock(600_000)).unwrap();
        assert_eq!(state.presented_frame, Some(15));
    }

    fn demand(request_id: &str, frame_index: u64) -> NativePlaybackFrameDemand {
        NativePlaybackFrameDemand {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request_id.to_string(),
            frame_time: FrameTime::new(frame_index, frame_index as i64, DEFAULT_TIME_SCALE)
                .unwrap(),
            generation: Some(1),
            mode: Some("playback".to_string()),
            video_layers: Vec::new(),
            raster_layers: Vec::new(),
            text_layers: Vec::new(),
            transition_progress: None,
        }
    }

    #[test]
    fn latest_playback_demand_replaces_obsolete_pending_frame() {
        let mut slot = LatestPlaybackDemand::default();
        slot.replace(demand("old", 1));
        slot.replace(demand("new", 2));
        let current = slot.take().unwrap();
        assert_eq!(current.request_id, "new");
        assert!(slot.take().is_none());
    }

    #[test]
    fn explicit_paused_demand_bypasses_audio_clock_coalescing() {
        // A paused seek can legitimately request the frame currently reported
        // by the audio clock. It still needs a completion event, so it must
        // not enter the continuous-playback same-frame fast path.
        assert!(!should_follow_audio_clock(true));
        assert!(should_follow_audio_clock(false));
    }

    #[test]
    fn repeated_playback_deadline_misses_downgrade_only_lookahead_scale() {
        use crate::native_core::QualityTier;

        // A single miss can be ordinary scheduling jitter; two consecutive
        // misses mean the startup keyframe probe no longer represents this GOP.
        assert_eq!(
            playback_quality_after_lookahead_misses(QualityTier::Full, 1),
            QualityTier::Full
        );
        assert_eq!(
            playback_quality_after_lookahead_misses(QualityTier::Full, 2),
            QualityTier::Half
        );
        assert_eq!(
            playback_quality_after_lookahead_misses(QualityTier::Half, 2),
            QualityTier::Quarter
        );
        // Quarter and Proxy both decode at quarter scale, so repeated misses
        // must not report a meaningless further downgrade.
        assert_eq!(
            playback_quality_after_lookahead_misses(QualityTier::Quarter, 8),
            QualityTier::Quarter
        );
    }

    #[test]
    fn lookahead_adaptation_never_changes_paused_snapshot_quality() {
        use crate::native_core::QualityTier;

        let session = test_session(test_snapshot());
        assert_eq!(session.snapshot.read().quality, QualityTier::Full);
        session.record_playback_lookahead_hit();
        session.record_playback_lookahead_miss();
        session.record_playback_lookahead_miss();

        assert_eq!(session.playback_quality(), QualityTier::Half);
        assert_eq!(session.snapshot.read().quality, QualityTier::Full);
    }

    fn test_snapshot_with_text() -> FrameRequest {
        FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "init".to_string(),
            frame_time: clock(0),
            output_width: 1920,
            output_height: 1080,
            quality: crate::native_core::QualityTier::Full,
            color_policy: crate::native_core::ColorPolicy::default(),
            render_graph_version: 1,
            generation: Some(1),
            mode: Some("playback".to_string()),
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
            project: crate::native_core::ProjectSnapshot {
                schema_version: 1,
                project_revision: "test:1".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: Vec::new(),
                raster_layers: Vec::new(),
                text_layers: vec![crate::native_core::TextLayerSnapshot {
                    layer_id: Some("title".to_string()),
                    text: "Hello".to_string(),
                    font_id: "inter".to_string(),
                    font_size: 48.0,
                    font_weight: "normal".to_string(),
                    font_style: "normal".to_string(),
                    letter_spacing: 0.0,
                    line_height: 1.2,
                    color: [1.0, 1.0, 1.0, 1.0],
                    text_align: "center".to_string(),
                    vertical_align: "middle".to_string(),
                    x: 100.0,
                    y: 100.0,
                    box_width: Some(200.0),
                    box_height: Some(100.0),
                    rotation: 0.0,
                    opacity: 0.0,
                    z_index: 1,
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
                }],
                transition: None,
            },
        }
    }

    fn test_snapshot() -> FrameRequest {
        let mut s = test_snapshot_with_text();
        s.project.text_layers.clear();
        s
    }

    fn test_session(snapshot: FrameRequest) -> NativeRenderSession {
        let playback_quality = snapshot.quality;
        NativeRenderSession {
            snapshot: RwLock::new(Arc::new(snapshot)),
            last_materialized: RwLock::new(None),
            active_streams: Mutex::new(HashSet::new()),
            leases: Mutex::new(HashMap::new()),
            actors: Mutex::new(HashMap::new()),
            pending: Mutex::new(LatestPlaybackDemand::default()),
            notify: tokio::sync::Notify::new(),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(1),
            worker: Mutex::new(None),
            configured_at: Instant::now(),
            ready_after_us: AtomicU64::new(0),
            first_presented: AtomicBool::new(false),
            playback_quality: AtomicU8::new(super::render_session::quality_to_code(
                playback_quality,
            )),
            playback_lookahead_miss_streak: AtomicU8::new(0),
            playback_lookahead_feedback_armed: AtomicBool::new(false),
        }
    }

    #[test]
    fn pause_keeps_render_worker_available_for_explicit_frame_demand() {
        let session = test_session(test_snapshot());
        session
            .running
            .store(true, std::sync::atomic::Ordering::Release);
        session
            .pending
            .lock()
            .unwrap()
            .replace(demand("obsolete-playback", 10));

        session.pause_continuous_playback();

        assert!(session.running.load(std::sync::atomic::Ordering::Acquire));
        assert!(session.pending.lock().unwrap().take().is_none());
    }

    #[test]
    fn lookahead_adaptation_ignores_pause_and_startup_transition_misses() {
        use crate::native_core::QualityTier;

        let session = test_session(test_snapshot());
        session.record_playback_lookahead_miss();
        session.record_playback_lookahead_miss();
        assert_eq!(session.playback_quality(), QualityTier::Full);

        session.record_playback_lookahead_hit();
        session.record_playback_lookahead_miss();
        session.record_playback_lookahead_miss();
        assert_eq!(session.playback_quality(), QualityTier::Half);

        session.pause_continuous_playback();
        session.record_playback_lookahead_miss();
        session.record_playback_lookahead_miss();
        assert_eq!(session.playback_quality(), QualityTier::Half);
    }

    #[test]
    fn test_cly_bug_012_reconcile_active_streams_drops_exited_leases_and_actors() {
        let session = test_session(test_snapshot());
        let key1 = ("/test/v1.mp4".to_string(), "clip-1".to_string());
        let key2 = ("/test/v2.mp4".to_string(), "clip-2".to_string());

        // Initially both clip-1 and clip-2 are active
        {
            let mut active = session.active_streams.lock().unwrap();
            active.insert(key1.clone());
            active.insert(key2.clone());
        }

        // When clip-1 exits and only clip-2 remains active:
        let mut new_active = HashSet::new();
        new_active.insert(key2.clone());
        session.reconcile_active_streams(&new_active);

        let active = session.active_streams.lock().unwrap();
        assert_eq!(active.len(), 1);
        assert!(
            !active.contains(&key1),
            "Exited stream must be pruned from active_streams"
        );
        assert!(active.contains(&key2));
    }

    #[test]
    fn materialize_request_handles_sdf_to_raster_transition() {
        let session = test_session(test_snapshot_with_text());

        let mut d = demand("demand-1", 1);
        d.raster_layers = vec![crate::native_core::NativePlaybackRasterLayerUpdate {
            layer_id: Some("title".to_string()),
            asset_id: "native-text:title:abc".to_string(),
            width: 640,
            height: 120,
            display_width: Some(300.0),
            display_height: Some(60.0),
            x: 150.0,
            y: 120.0,
            rotation: 5.0,
            opacity: 0.85,
            z_index: 2,
            blend_mode: None,
            is_mask: false,
        }];
        d.text_layers = Vec::new();

        let materialized = session
            .materialize_request(Some(&d))
            .expect("transition should succeed");
        assert_eq!(materialized.project.raster_layers.len(), 1);
        assert_eq!(materialized.project.text_layers.len(), 0);
        let raster = &materialized.project.raster_layers[0];
        assert_eq!(raster.asset_id, "native-text:title:abc");
        assert_eq!(raster.opacity, 0.85);
        assert_eq!(raster.display_width, Some(300.0));
    }

    #[test]
    fn materialize_request_retains_last_known_good_state_on_missed_demand_tick() {
        let session = test_session(test_snapshot_with_text());

        // Tick 1: dynamic demand arrives with opacity 0.75
        let mut d = demand("demand-1", 1);
        d.text_layers = vec![crate::native_core::NativePlaybackTextLayerUpdate {
            layer_id: Some("title".to_string()),
            x: 100.0,
            y: 100.0,
            rotation: 0.0,
            opacity: 0.75,
            z_index: 1,
        }];
        let mat1 = session.materialize_request(Some(&d)).unwrap();
        assert_eq!(mat1.project.text_layers[0].opacity, 0.75);

        // Tick 2: demand was taken by slot.take(), leaving None for a synthetic missed tick
        let mat2 = session.materialize_request(None).unwrap();
        // Crucial Fix 1 assertion: opacity must NOT revert to 0.0 (clip start snapshot),
        // it must retain 0.75 (the last applied dynamic state)!
        assert_eq!(mat2.project.text_layers[0].opacity, 0.75);
    }

    #[test]
    fn materialize_request_dynamically_adds_and_removes_overlay_layers() {
        // Session configured with base video only (zero raster layers, zero text layers)
        let session = test_session(test_snapshot());

        // Frame 114: text clip enters on the timeline
        let mut d1 = demand("demand-enter", 114);
        d1.raster_layers = vec![crate::native_core::NativePlaybackRasterLayerUpdate {
            layer_id: Some("clip-title".to_string()),
            asset_id: "native-text:clip-title:v1".to_string(),
            width: 400,
            height: 100,
            display_width: Some(200.0),
            display_height: Some(50.0),
            x: 100.0,
            y: 200.0,
            rotation: 0.0,
            opacity: 0.5,
            z_index: 3,
            blend_mode: Some("screen".to_string()),
            is_mask: false,
        }];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("dynamic addition should succeed");
        assert_eq!(mat1.project.raster_layers.len(), 1);
        let layer = &mat1.project.raster_layers[0];
        assert_eq!(layer.layer_id.as_deref(), Some("clip-title"));
        assert_eq!(layer.asset_id, "native-text:clip-title:v1");
        assert_eq!(layer.opacity, 0.5);
        assert_eq!(layer.display_width, Some(200.0));
        assert_eq!(layer.blend_mode, "screen");

        // Frame 428: text clip exits timeline
        let mut d2 = demand("demand-exit", 428);
        d2.raster_layers = Vec::new();
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("dynamic removal should succeed");
        assert_eq!(mat2.project.raster_layers.len(), 0);

        // Frame 429: missed tick after exit retains empty overlay state
        let mat3 = session.materialize_request(None).unwrap();
        assert_eq!(mat3.project.raster_layers.len(), 0);
    }

    #[test]
    fn materialize_request_dynamically_adds_and_removes_subject_cutout_layers() {
        // Session configured with base video only (layer_id: "video-1")
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![crate::native_core::VideoLayerSnapshot {
            layer_id: "video-1".to_string(),
            asset_id: "video-1".to_string(),
            video_path: "/test/video.mp4".to_string(),
            source_time: FrameTime::new(0, 0, 30).unwrap(),
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
        }];
        let session = test_session(snapshot);

        // Frame 50: Behind-subject text clip begins -> cutout synthesized
        let mut d1 = demand("demand-cutout-enter", 50);
        d1.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("video-1".to_string()),
                source_time: FrameTime::new(50, 50, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("video-1:subject-cutout".to_string()),
                source_time: FrameTime::new(50, 50, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 0.0, // Buffering segmentation mask
                z_index: 2,
                color_grade: None,
                body_effect: None,
            },
        ];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("dynamic cutout addition should succeed");
        assert_eq!(mat1.project.video_layers.len(), 2);
        assert_eq!(mat1.project.video_layers[0].layer_id, "video-1");
        assert_eq!(
            mat1.project.video_layers[1].layer_id,
            "video-1:subject-cutout"
        );
        assert_eq!(mat1.project.video_layers[1].opacity, 0.0);
        assert!(mat1.project.video_layers[1].body_effect.is_some());
        assert_eq!(
            mat1.project.video_layers[1]
                .body_effect
                .as_ref()
                .unwrap()
                .renderer,
            "body_cutout"
        );

        // Frame 120: Cutout ends, reverting to single base video layer
        let mut d2 = demand("demand-cutout-exit", 120);
        d2.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("video-1".to_string()),
            source_time: FrameTime::new(120, 120, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("dynamic cutout removal should succeed");
        assert_eq!(mat2.project.video_layers.len(), 1);
        assert_eq!(mat2.project.video_layers[0].layer_id, "video-1");
    }

    #[test]
    fn materialize_request_preserves_body_effect_on_cutout_layers_across_steady_playback() {
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![crate::native_core::VideoLayerSnapshot {
            layer_id: "vid-main".to_string(),
            asset_id: "vid-main".to_string(),
            video_path: "/test/v.mp4".to_string(),
            source_time: FrameTime::new(0, 0, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1280.0,
            height: 720.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
            crop: None,
            color_grade: None,
            body_effect: None,
        }];
        let session = test_session(snapshot);

        // Tick 1: Behind-subject cutout enters with active body_effect mask
        let mut d1 = demand("demand-1", 100);
        d1.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main".to_string()),
                source_time: FrameTime::new(100, 100, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main:subject-cutout".to_string()),
                source_time: FrameTime::new(100, 100, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 2,
                color_grade: None,
                body_effect: Some(crate::native_core::BodyEffectSnapshot {
                    mask_asset_id: "vid-main:subject-cutout_fx:100".to_string(),
                    renderer: "body_cutout".to_string(),
                    color_r: 1.0,
                    color_g: 1.0,
                    color_b: 1.0,
                    strength: 1.0,
                    radius: 4.0,
                    time: 3.33,
                }),
            },
        ];
        let mat1 = session.materialize_request(Some(&d1)).unwrap();
        assert_eq!(mat1.project.video_layers.len(), 2);
        let cutout1 = &mat1.project.video_layers[1];
        assert_eq!(cutout1.layer_id, "vid-main:subject-cutout");
        assert_eq!(cutout1.opacity, 1.0);
        assert!(cutout1.body_effect.is_some());
        assert_eq!(
            cutout1.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:100"
        );

        // Tick 2: Steady state (video layer count unchanged, mask updated)
        let mut d2 = demand("demand-2", 101);
        d2.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main".to_string()),
                source_time: FrameTime::new(101, 101, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main:subject-cutout".to_string()),
                source_time: FrameTime::new(101, 101, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 2,
                color_grade: None,
                body_effect: Some(crate::native_core::BodyEffectSnapshot {
                    mask_asset_id: "vid-main:subject-cutout_fx:101".to_string(),
                    renderer: "body_cutout".to_string(),
                    color_r: 1.0,
                    color_g: 1.0,
                    color_b: 1.0,
                    strength: 1.0,
                    radius: 4.0,
                    time: 3.36,
                }),
            },
        ];
        let mat2 = session.materialize_request(Some(&d2)).unwrap();
        assert_eq!(mat2.project.video_layers.len(), 2);
        let cutout2 = &mat2.project.video_layers[1];
        assert_eq!(
            cutout2.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:101"
        );

        // Tick 3: Synthetic missed tick (demand is None). Snapshot must retain body_effect!
        let mat3 = session.materialize_request(None).unwrap();
        assert_eq!(mat3.project.video_layers.len(), 2);
        let cutout3 = &mat3.project.video_layers[1];
        assert!(cutout3.body_effect.is_some());
        assert_eq!(
            cutout3.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:101"
        );
        assert_eq!(cutout3.opacity, 1.0);
    }

    #[test]
    fn materialize_request_supports_varying_video_layer_counts_in_multitrack_timeline() {
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![
            crate::native_core::VideoLayerSnapshot {
                layer_id: "track-1-clip".to_string(),
                asset_id: "asset-1".to_string(),
                video_path: "/test/v1.mp4".to_string(),
                source_time: FrameTime::new(0, 0, 30).unwrap(),
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
            },
            crate::native_core::VideoLayerSnapshot {
                layer_id: "track-2-clip".to_string(),
                asset_id: "asset-2".to_string(),
                video_path: "/test/v2.mp4".to_string(),
                source_time: FrameTime::new(0, 0, 30).unwrap(),
                x: 200.0,
                y: 200.0,
                width: 640.0,
                height: 360.0,
                rotation: 0.0,
                opacity: 0.8,
                z_index: 1,
                blend_mode: "normal".to_string(),
                crop: None,
                color_grade: None,
                body_effect: None,
            },
        ];
        let session = test_session(snapshot);

        // Frame 10: Single track active (demand has only track 1)
        let mut d1 = demand("demand-t1", 10);
        d1.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("track-1-clip".to_string()),
            source_time: FrameTime::new(10, 10, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("single track demand should succeed on multitrack session");
        assert_eq!(mat1.project.video_layers.len(), 1);
        assert_eq!(mat1.project.video_layers[0].layer_id, "track-1-clip");

        // Frame 30: Both tracks active (PIP overlay)
        let mut d2 = demand("demand-pip", 30);
        d2.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("track-1-clip".to_string()),
                source_time: FrameTime::new(30, 30, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("track-2-clip".to_string()),
                source_time: FrameTime::new(15, 15, 30).unwrap(),
                x: 250.0,
                y: 180.0,
                width: 640.0,
                height: 360.0,
                rotation: 5.0,
                opacity: 0.9,
                z_index: 1,
                color_grade: None,
                body_effect: None,
            },
        ];
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("pip multitrack demand should succeed");
        assert_eq!(mat2.project.video_layers.len(), 2);
        assert_eq!(mat2.project.video_layers[0].layer_id, "track-1-clip");
        assert_eq!(mat2.project.video_layers[1].layer_id, "track-2-clip");
        assert_eq!(mat2.project.video_layers[1].rotation, 5.0);

        // Frame 50: Gap / title card (zero video layers)
        let mut d3 = demand("demand-gap", 50);
        d3.video_layers = Vec::new();
        let mat3 = session
            .materialize_request(Some(&d3))
            .expect("gap with 0 video layers should succeed");
        assert!(mat3.project.video_layers.is_empty());

        // Frame 70: Track 2 only active
        let mut d4 = demand("demand-t2-only", 70);
        d4.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("track-2-clip".to_string()),
            source_time: FrameTime::new(55, 55, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat4 = session
            .materialize_request(Some(&d4))
            .expect("track 2 only demand should succeed");
        assert_eq!(mat4.project.video_layers.len(), 1);
        assert_eq!(mat4.project.video_layers[0].layer_id, "track-2-clip");
        assert_eq!(mat4.project.video_layers[0].video_path, "/test/v2.mp4");
    }
}
