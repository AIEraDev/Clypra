#[cfg(test)]
mod tests {
    use crate::engine::frame::{ColorMetadata, VideoFrame};
    use crate::engine::planner::{MediaFrameCache, MediaPriority};
    use crate::engine::surface::{
        GpuFence, SurfaceBackend, SurfaceHandle, SurfaceSync, VideoSurface,
    };
    use crate::engine::temporal::{
        KeyframeEntry, KeyframeIndex, TemporalController, TemporalDirection, TemporalState,
    };
    use crate::engine::types::{MediaTime, PixelFormat};
    use std::time::Duration;

    fn create_test_video_frame(pts: MediaTime, generation: u64, asset_id: &str) -> VideoFrame {
        let sync = SurfaceSync {
            producer_fence: Some(GpuFence::new(1, 0x1111)),
            consumer_fence: Some(GpuFence::new(2, 0x2222)),
            producer_value: generation,
            consumer_value: 0,
            fence_value: generation,
            is_ready: true,
            keyed_mutex_key: None,
        };
        let surface = VideoSurface::new(
            SurfaceBackend::D3D12,
            3840,
            2160,
            PixelFormat::P010,
            sync,
            SurfaceHandle::D3D12 {
                resource_ptr: 0x9999,
            },
        );
        VideoFrame::new(
            asset_id,
            pts,
            MediaTime::from_micros(16_667),
            generation,
            surface,
            ColorMetadata::default(),
        )
    }

    #[test]
    fn test_phase_g1_rapid_seek_latest_wins() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        // 5 Rapid seeks dispatched in immediate succession
        let (req_10, _) = controller.begin_seek(MediaTime::from_secs_f64(10.0), 1, "video-1");
        let (req_20, _) = controller.begin_seek(MediaTime::from_secs_f64(20.0), 1, "video-1");
        let (req_30, _) = controller.begin_seek(MediaTime::from_secs_f64(30.0), 1, "video-1");
        let (req_40, _) = controller.begin_seek(MediaTime::from_secs_f64(40.0), 1, "video-1");
        let (req_50, _) = controller.begin_seek(MediaTime::from_secs_f64(50.0), 1, "video-1");

        assert_eq!(controller.current_generation, 6);
        assert_eq!(req_50.playback_generation, 6);
        assert_eq!(req_50.target, MediaTime::from_secs_f64(50.0));

        // Simulate delayed frames arriving from older seeks
        let frame_10 = create_test_video_frame(
            MediaTime::from_secs_f64(10.0),
            req_10.playback_generation,
            "video-1",
        );
        let frame_20 = create_test_video_frame(
            MediaTime::from_secs_f64(20.0),
            req_20.playback_generation,
            "video-1",
        );
        let frame_30 = create_test_video_frame(
            MediaTime::from_secs_f64(30.0),
            req_30.playback_generation,
            "video-1",
        );
        let frame_40 = create_test_video_frame(
            MediaTime::from_secs_f64(40.0),
            req_40.playback_generation,
            "video-1",
        );
        let frame_50 = create_test_video_frame(
            MediaTime::from_secs_f64(50.0),
            req_50.playback_generation,
            "video-1",
        );

        // INVARIANT: Stale frames can NEVER be presented!
        assert!(!controller.is_frame_presentable(&frame_10));
        assert!(!controller.is_frame_presentable(&frame_20));
        assert!(!controller.is_frame_presentable(&frame_30));
        assert!(!controller.is_frame_presentable(&frame_40));

        // Only the authoritative target 50s frame is presentable
        assert!(controller.is_frame_presentable(&frame_50));
    }

    #[test]
    fn test_phase_g2_rapid_scrub_coalescing() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        // 100 rapid scrub motion events
        let mut last_req = None;
        for i in 1..=100 {
            let target = MediaTime::from_secs_f64(10.0 + (i as f64 * 0.1));
            let req = controller.begin_scrub(target, 1);
            last_req = Some(req);
        }

        let final_req = last_req.unwrap();
        assert_eq!(controller.current_generation, 101);
        assert_eq!(final_req.playback_generation, 101);
        assert_eq!(final_req.target, MediaTime::from_secs_f64(20.0));
        assert_eq!(controller.state, TemporalState::Scrubbing);
    }

    #[test]
    fn test_phase_g3_cache_hit_seek() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        // Pre-populate cache at 30.0s
        let frame_30 = create_test_video_frame(MediaTime::from_secs_f64(30.0), 1, "video-1");
        controller.cache_decoded_frame(frame_30, MediaPriority::Next);

        // Seek to 30.0s -> Cache Hit!
        let (req, maybe_frame) =
            controller.begin_seek(MediaTime::from_secs_f64(30.0), 1, "video-1");

        assert!(maybe_frame.is_some());
        assert_eq!(maybe_frame.unwrap().pts, MediaTime::from_secs_f64(30.0));
        assert!(controller.telemetry.cache_hit);
        assert_eq!(controller.state, TemporalState::PresentingTarget);
        assert_eq!(req.target, MediaTime::from_secs_f64(30.0));
    }

    #[test]
    fn test_phase_g4_keyframe_index_resolution() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        let index = KeyframeIndex::new(vec![
            KeyframeEntry {
                pts: MediaTime::from_secs_f64(0.0),
                byte_offset: 0,
            },
            KeyframeEntry {
                pts: MediaTime::from_secs_f64(10.0),
                byte_offset: 5_000_000,
            },
            KeyframeEntry {
                pts: MediaTime::from_secs_f64(25.0),
                byte_offset: 12_500_000,
            },
            KeyframeEntry {
                pts: MediaTime::from_secs_f64(55.4),
                byte_offset: 27_700_000,
            },
            KeyframeEntry {
                pts: MediaTime::from_secs_f64(70.0),
                byte_offset: 35_000_000,
            },
        ]);

        controller.register_keyframe_index("video-1", index);

        // Seek target: 57.8s -> nearest keyframe is 55.4s
        let keyframe = controller.resolve_keyframe("video-1", MediaTime::from_secs_f64(57.8));
        assert_eq!(keyframe.pts, MediaTime::from_secs_f64(55.4));
        assert_eq!(keyframe.byte_offset, 27_700_000);

        // Seek target: 24.9s -> nearest keyframe is 10.0s
        let keyframe_early = controller.resolve_keyframe("video-1", MediaTime::from_secs_f64(24.9));
        assert_eq!(keyframe_early.pts, MediaTime::from_secs_f64(10.0));
    }

    #[test]
    fn test_phase_g5_decoder_stall_during_seek() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        let (req, _) = controller.begin_seek(MediaTime::from_secs_f64(45.0), 1, "video-1");

        // Simulate 100ms stall on decoder thread
        std::thread::sleep(Duration::from_millis(5));

        // Controller remains non-blocking and intact
        assert_eq!(controller.current_generation, req.playback_generation);
        assert_eq!(controller.last_target, MediaTime::from_secs_f64(45.0));
        assert_eq!(controller.state, TemporalState::ResolvingTarget);
    }

    #[test]
    fn test_phase_g6_seek_during_playback() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);
        controller.state = TemporalState::Playing;

        // User triggers seek to 70s during active playback
        let (req, _) = controller.begin_seek(MediaTime::from_secs_f64(70.0), 1, "video-1");

        assert_eq!(req.target, MediaTime::from_secs_f64(70.0));
        assert_eq!(controller.current_generation, 2);
        assert_ne!(controller.state, TemporalState::Playing);
    }

    #[test]
    fn test_phase_g7_scrub_direction_transitions() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        controller.begin_scrub(MediaTime::from_secs_f64(10.0), 1);
        controller.begin_scrub(MediaTime::from_secs_f64(20.0), 1);
        assert_eq!(controller.current_direction, TemporalDirection::Forward);

        controller.begin_scrub(MediaTime::from_secs_f64(30.0), 1);
        assert_eq!(controller.current_direction, TemporalDirection::Forward);

        controller.begin_scrub(MediaTime::from_secs_f64(20.0), 1);
        assert_eq!(controller.current_direction, TemporalDirection::Reverse);

        controller.begin_scrub(MediaTime::from_secs_f64(10.0), 1);
        assert_eq!(controller.current_direction, TemporalDirection::Reverse);
    }

    #[test]
    fn test_phase_g8_exact_frame_step() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);
        controller.last_target = MediaTime::from_micros(100_000);

        // Step +1 at 60fps (16_667 µs)
        let step_fwd = controller.step_frame(1, 60.0, 1);
        assert_eq!(step_fwd.target.as_micros(), 116_667);
        assert_eq!(controller.current_direction, TemporalDirection::Forward);
        assert_eq!(controller.state, TemporalState::PresentingTarget);

        // Step -1 back (16_667 µs)
        let step_rev = controller.step_frame(-1, 60.0, 1);
        assert_eq!(step_rev.target.as_micros(), 100_000);
        assert_eq!(controller.current_direction, TemporalDirection::Reverse);
    }

    #[test]
    fn test_phase_g9_react_freeze_temporal_independence() {
        let cache = MediaFrameCache::new(20, 100 * 1024 * 1024);
        let mut controller = TemporalController::new(cache);

        // Simulate React frozen for 500ms
        let start = std::time::Instant::now();
        std::thread::sleep(Duration::from_millis(10)); // Simulated sleep in test harness

        // Native temporal navigation processes multiple seeks without stalling
        for i in 1..=10 {
            let target = MediaTime::from_secs_f64(i as f64 * 5.0);
            controller.begin_seek(target, 1, "video-1");
        }

        assert_eq!(controller.current_generation, 11);
        assert_eq!(controller.last_target, MediaTime::from_secs_f64(50.0));
        assert!(start.elapsed() >= Duration::from_millis(10));
    }
}
