#[cfg(test)]
mod tests {
    use crate::engine::*;
    use std::time::Instant;

    #[test]
    fn test_media_time_drift_free_arithmetic() {
        let t1 = MediaTime::from_secs_f64(1.5);
        assert_eq!(t1.as_micros(), 1_500_000);
        assert_eq!(t1.as_secs_f64(), 1.5);

        let t2 = MediaTime::from_micros(500_000);
        let sum = t1 + t2;
        assert_eq!(sum.as_micros(), 2_000_000);
        assert_eq!(sum.as_secs_f64(), 2.0);

        // Frame index conversions at 60 fps
        let frame_60 = MediaTime::from_frame_index(60, 60.0);
        assert_eq!(frame_60.as_micros(), 1_000_000);
        assert_eq!(frame_60.as_frame_index(60.0), 60);

        // Frame 1 at 60 fps: 16667 us
        let frame_1 = MediaTime::from_frame_index(1, 60.0);
        assert_eq!(frame_1.as_micros(), 16_667);
        assert_eq!(frame_1.as_frame_index(60.0), 1);
    }

    #[test]
    fn test_empty_render_plan_validity() {
        let plan = RenderPlan::empty(
            1,
            100,
            MediaTime::ZERO,
            CanvasSpec::default(),
            [0.0, 0.0, 0.0, 1.0],
        );
        assert!(plan.is_empty());
        assert_eq!(plan.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(plan.generation, 1);
        assert_eq!(plan.project_revision, 100);
    }

    #[test]
    fn test_decoder_surface_pool_capacity() {
        // HEVC requires at least 16 reference frames + pipeline depth + prefetch + 4
        let capacity_hevc = DecoderSurfacePool::calculate_capacity(CodecType::Hevc, 4, 4);
        assert_eq!(capacity_hevc, 16 + 4 + 4 + 4); // 28

        // AV1 requires at least 8 reference frames
        let capacity_av1 = DecoderSurfacePool::calculate_capacity(CodecType::Av1, 4, 4);
        assert_eq!(capacity_av1, 8 + 4 + 4 + 4); // 20
    }

    #[test]
    fn test_engine_clock_transitions() {
        let mut clock = EngineClock::new();
        assert_eq!(clock.now(), MediaTime::ZERO);
        assert!(!clock.is_running());

        // Seek to 5 seconds
        clock.set_time(MediaTime::from_secs_f64(5.0));
        assert_eq!(clock.now().as_secs_f64(), 5.0);

        // Update from audio callback
        clock.update_from_audio(MediaTime::from_secs_f64(5.016));
        assert_eq!(clock.mode(), ClockMode::AudioMaster);
        assert_eq!(clock.now().as_micros(), 5_016_000);
    }

    #[test]
    fn test_frame_deadline_and_planning() {
        let deadline = FrameDeadline::new(
            MediaTime::from_micros(16_667),
            Instant::now() + std::time::Duration::from_millis(16),
            1,
        );
        assert!(!deadline.is_expired());
        assert!(deadline.time_remaining().is_some());

        let planner = FramePlanner::new(4);
        let future_frames =
            planner.plan_ahead(MediaTime::ZERO, MediaTime::from_frame_index(1, 60.0), 4);
        assert_eq!(future_frames.len(), 4);
        assert_eq!(future_frames[0].as_micros(), 16_667);
        assert_eq!(future_frames[1].as_micros(), 33_334);
    }
}
