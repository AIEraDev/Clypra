#[cfg(test)]
mod tests {
    use crate::engine::frame::{ColorMetadata, VideoFrame};
    use crate::engine::planner::{
        DecodeRange, FrameCacheKey, MediaFrameCache, MediaPriority, MediaRequest,
        PerAssetQueueManager, PlaybackDirection, PrefetchPolicy, QueueConfig, ReadyFrame,
        ReadyFrameQueue, ReadyTimingStatus, WorkPlanner, WorkResult,
    };
    use crate::engine::render_plan::{RenderLayer, RenderPlan};
    use crate::engine::scheduler::{FrameDeadline, FramePacingDecision, PlaybackScheduler};
    use crate::engine::surface::{
        GpuFence, SurfaceBackend, SurfaceHandle, SurfaceSync, VideoSurface,
    };
    use crate::engine::types::{CanvasSpec, MediaTime, PixelFormat};
    use std::time::{Duration, Instant};

    fn create_test_render_plan(time_secs: f64, generation: u64, revision: u64) -> RenderPlan {
        let canvas = CanvasSpec {
            width: 3840,
            height: 2160,
            fps: 60.0,
            sample_rate: 48000,
        };
        let mut plan = RenderPlan::empty(
            generation,
            revision,
            MediaTime::from_secs_f64(time_secs),
            canvas,
            [0.0, 0.0, 0.0, 1.0],
        );

        plan.layers.push(RenderLayer::video(
            "layer-1",
            "clip-video-a",
            "asset-video-a",
            MediaTime::from_secs_f64(time_secs),
        ));

        plan
    }

    fn create_test_video_frame(pts: MediaTime, asset_id: &str) -> VideoFrame {
        let sync = SurfaceSync {
            producer_fence: Some(GpuFence::new(1, 0x1111)),
            consumer_fence: Some(GpuFence::new(2, 0x2222)),
            producer_value: 1,
            consumer_value: 0,
            fence_value: 1,
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
            1,
            surface,
            ColorMetadata::default(),
        )
    }

    #[test]
    fn test_phase_f1_media_work_plan_generation() {
        let policy = PrefetchPolicy {
            playback_window: Duration::from_millis(100), // ~6 frames ahead at 60fps
            scrub_window: Duration::from_millis(35),
            max_in_flight_per_stream: 8,
        };
        let mut planner = WorkPlanner::new(policy);
        let render_plan = create_test_render_plan(10.0, 1, 100);

        let work_plan = planner.plan(
            &render_plan,
            PlaybackDirection::Forward,
            Instant::now() + Duration::from_millis(16),
        );

        assert!(!work_plan.is_empty());
        assert_eq!(work_plan.project_revision, 100);
        assert_eq!(work_plan.playback_generation, 1);

        // Check priorities: First request is Current
        let current_requests: Vec<_> = work_plan.current_frame_requests().collect();
        assert_eq!(current_requests.len(), 1);
        assert_eq!(current_requests[0].priority, MediaPriority::Current);
        assert_eq!(
            current_requests[0].source_time,
            MediaTime::from_secs_f64(10.0)
        );

        // Lookahead requests exist and start with Next priority
        let lookahead_requests: Vec<_> = work_plan.lookahead_requests().collect();
        assert!(!lookahead_requests.is_empty());
        assert_eq!(lookahead_requests[0].priority, MediaPriority::Next);
    }

    #[test]
    fn test_phase_f5_f6_direction_aware_prefetch() {
        let policy = PrefetchPolicy::default();
        let mut planner = WorkPlanner::new(policy);
        let render_plan = create_test_render_plan(5.0, 1, 1);

        // Forward: lookahead times are greater than current time
        let fwd_plan = planner.plan(&render_plan, PlaybackDirection::Forward, Instant::now());
        let fwd_lookahead: Vec<_> = fwd_plan.lookahead_requests().collect();
        assert!(fwd_lookahead[0].source_time > MediaTime::from_secs_f64(5.0));

        // Reverse: lookahead times are less than current time
        let rev_plan = planner.plan(&render_plan, PlaybackDirection::Reverse, Instant::now());
        let rev_lookahead: Vec<_> = rev_plan.lookahead_requests().collect();
        assert!(rev_lookahead[0].source_time < MediaTime::from_secs_f64(5.0));
    }

    #[test]
    fn test_phase_f10_stale_work_invalidation() {
        let mut planner = WorkPlanner::new(PrefetchPolicy::default());
        planner.set_version(100, 1);

        let req = MediaRequest {
            asset_id: "asset-1".to_string(),
            source_time: MediaTime::from_secs_f64(1.0),
            priority: MediaPriority::Current,
            decode_range: DecodeRange::exact(MediaTime::from_secs_f64(1.0)),
            project_revision: 100,
            playback_generation: 1,
        };

        // Current request is valid
        assert_eq!(planner.evaluate_request(&req), WorkResult::Submitted);

        // Advance seek generation -> Old request becomes obsolete!
        planner.set_version(100, 2);
        assert!(matches!(
            planner.evaluate_request(&req),
            WorkResult::Obsolete(_)
        ));

        // Advance project revision -> Old request becomes obsolete!
        planner.set_version(101, 2);
        let req_gen2 = MediaRequest {
            playback_generation: 2,
            project_revision: 100,
            ..req.clone()
        };
        assert!(matches!(
            planner.evaluate_request(&req_gen2),
            WorkResult::Obsolete(_)
        ));
    }

    #[test]
    fn test_phase_f4_fair_per_asset_queues() {
        let mut queue_mgr = PerAssetQueueManager::new();

        // Enqueue 2 requests for Track A and 2 requests for Track B with equal priority
        queue_mgr.enqueue(MediaRequest {
            asset_id: "track-a".to_string(),
            source_time: MediaTime::from_secs_f64(1.0),
            priority: MediaPriority::Current,
            decode_range: DecodeRange::exact(MediaTime::from_secs_f64(1.0)),
            project_revision: 1,
            playback_generation: 1,
        });
        queue_mgr.enqueue(MediaRequest {
            asset_id: "track-a".to_string(),
            source_time: MediaTime::from_secs_f64(1.016),
            priority: MediaPriority::Next,
            decode_range: DecodeRange::exact(MediaTime::from_secs_f64(1.016)),
            project_revision: 1,
            playback_generation: 1,
        });

        queue_mgr.enqueue(MediaRequest {
            asset_id: "track-b".to_string(),
            source_time: MediaTime::from_secs_f64(1.0),
            priority: MediaPriority::Current,
            decode_range: DecodeRange::exact(MediaTime::from_secs_f64(1.0)),
            project_revision: 1,
            playback_generation: 1,
        });
        queue_mgr.enqueue(MediaRequest {
            asset_id: "track-b".to_string(),
            source_time: MediaTime::from_secs_f64(1.016),
            priority: MediaPriority::Next,
            decode_range: DecodeRange::exact(MediaTime::from_secs_f64(1.016)),
            project_revision: 1,
            playback_generation: 1,
        });

        assert_eq!(queue_mgr.active_asset_count(), 2);
        assert_eq!(queue_mgr.total_pending(), 4);

        // Pop 1: must be Current priority (Track A or B)
        let r1 = queue_mgr.pop_next().unwrap();
        assert_eq!(r1.priority, MediaPriority::Current);

        // Pop 2: must be the OTHER track's Current priority (Fairness!)
        let r2 = queue_mgr.pop_next().unwrap();
        assert_eq!(r2.priority, MediaPriority::Current);
        assert_ne!(r1.asset_id, r2.asset_id);

        // Pop 3 & 4: Now Next priority requests pop
        let r3 = queue_mgr.pop_next().unwrap();
        assert_eq!(r3.priority, MediaPriority::Next);
        let r4 = queue_mgr.pop_next().unwrap();
        assert_eq!(r4.priority, MediaPriority::Next);
        assert_ne!(r3.asset_id, r4.asset_id);
    }

    #[test]
    fn test_phase_f7_f8_frame_cache_surface_pressure_eviction() {
        let mut cache = MediaFrameCache::new(10, 100 * 1024 * 1024);

        let frame_cur = create_test_video_frame(MediaTime::from_secs_f64(1.0), "asset-1");
        let frame_next = create_test_video_frame(MediaTime::from_secs_f64(1.016), "asset-1");
        let frame_lookahead = create_test_video_frame(MediaTime::from_secs_f64(1.050), "asset-1");
        let frame_bg = create_test_video_frame(MediaTime::from_secs_f64(10.0), "asset-1");

        cache.insert(
            FrameCacheKey::original("asset-1", MediaTime::from_secs_f64(1.0)),
            frame_cur,
            MediaPriority::Current,
        );
        cache.insert(
            FrameCacheKey::original("asset-1", MediaTime::from_secs_f64(1.016)),
            frame_next,
            MediaPriority::Next,
        );
        cache.insert(
            FrameCacheKey::original("asset-1", MediaTime::from_secs_f64(1.050)),
            frame_lookahead,
            MediaPriority::Lookahead,
        );
        cache.insert(
            FrameCacheKey::original("asset-1", MediaTime::from_secs_f64(10.0)),
            frame_bg,
            MediaPriority::Background,
        );

        assert_eq!(cache.len(), 4);

        // Surface pressure event triggered!
        let evicted = cache.on_surface_pressure();
        assert_eq!(evicted, 2); // Evicted Lookahead and Background

        // Current and Next frames MUST still be present in cache!
        assert!(cache
            .get(&FrameCacheKey::original(
                "asset-1",
                MediaTime::from_secs_f64(1.0)
            ))
            .is_some());
        assert!(cache
            .get(&FrameCacheKey::original(
                "asset-1",
                MediaTime::from_secs_f64(1.016)
            ))
            .is_some());

        // Lookahead and Background are gone
        assert!(cache
            .get(&FrameCacheKey::original(
                "asset-1",
                MediaTime::from_secs_f64(1.050)
            ))
            .is_none());
        assert!(cache
            .get(&FrameCacheKey::original(
                "asset-1",
                MediaTime::from_secs_f64(10.0)
            ))
            .is_none());
    }

    #[test]
    fn test_phase_f12_ready_frame_queue_and_timing() {
        let config = QueueConfig::derive_defaults(60.0, 2, 26);
        assert!(config.ready_frame_capacity >= 2);

        let mut queue = ReadyFrameQueue::new(config.ready_frame_capacity);
        let frame = create_test_video_frame(MediaTime::from_micros(16_667), "asset-1");
        let ready = ReadyFrame::new(frame, 1, 1, MediaTime::from_micros(16_667));

        queue.push(ready.clone());
        assert_eq!(queue.len(), 1);

        // Timing status check: arrived early (deadline is 16ms in future)
        let deadline = Instant::now() + Duration::from_millis(16);
        assert!(matches!(
            ready.timing_status(deadline, 1, 1),
            ReadyTimingStatus::Early(_)
        ));

        // Timing status check: arrived late (deadline was in past)
        let past_deadline = Instant::now() - Duration::from_millis(5);
        assert!(matches!(
            ready.timing_status(past_deadline, 1, 1),
            ReadyTimingStatus::Late(_)
        ));

        // Timing status check: obsolete generation
        assert_eq!(
            ready.timing_status(deadline, 1, 2),
            ReadyTimingStatus::Obsolete
        );
    }

    #[test]
    fn test_phase_f16_injected_100ms_decoder_stall_no_freeze() {
        let mut scheduler = PlaybackScheduler::new();

        // 1. Initial frame arrives on time and presents cleanly
        let frame_1 = create_test_video_frame(MediaTime::ZERO, "asset-1");
        let deadline_1 = FrameDeadline::new(
            MediaTime::ZERO,
            Instant::now() + Duration::from_millis(16),
            1,
        );
        let decision_1 = scheduler.schedule(Some(frame_1), &deadline_1);
        assert!(matches!(decision_1, FramePacingDecision::Present(_)));
        assert_eq!(scheduler.presented_count(), 1);

        // 2. Decoder stalls for 100 ms! Next frame is missing at deadline
        let deadline_2 = FrameDeadline::new(
            MediaTime::from_micros(16_667),
            Instant::now() - Duration::from_millis(100), // 100ms late / stalled!
            1,
        );

        // Scheduler receives None (frame missing due to stall)
        let decision_2 = scheduler.schedule(None, &deadline_2);

        // Invariant: Presenter does not freeze! It drops and repeats previous frame
        assert!(matches!(
            decision_2,
            FramePacingDecision::DropAndRepeatPrevious(_)
        ));
        assert_eq!(scheduler.dropped_count(), 1);

        // 3. Decoder recovers and delivers next frame on time
        let frame_3 = create_test_video_frame(MediaTime::from_micros(33_334), "asset-1");
        let deadline_3 = FrameDeadline::new(
            MediaTime::from_micros(33_334),
            Instant::now() + Duration::from_millis(16),
            1,
        );
        let decision_3 = scheduler.schedule(Some(frame_3), &deadline_3);
        assert!(matches!(decision_3, FramePacingDecision::Present(_)));
        assert_eq!(scheduler.presented_count(), 2);
    }
}
