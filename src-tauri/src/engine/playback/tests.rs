#[cfg(test)]
mod tests {
    use crate::engine::*;
    use crossbeam::channel::bounded;
    use std::thread;
    use std::time::Duration;

    fn setup_test_controller() -> (PlaybackController, crossbeam::channel::Receiver<RenderPlan>) {
        let mut state = ProjectState::new(ProjectSettings::default());

        state
            .apply(CommandEnvelope::new(
                0,
                ProjectCommand::AddTrack(Track::new("v1", "Video 1", TrackKind::Video, 0)),
            ))
            .expect("Add track");

        state
            .apply(CommandEnvelope::new(
                1,
                ProjectCommand::RegisterAsset(MediaAssetRef {
                    id: "asset-1".to_string(),
                    file_path: "/test/v1.mp4".to_string(),
                    preview_path: None,
                    duration: MediaTime::from_secs_f64(30.0),
                    width: Some(1920),
                    height: Some(1080),
                    is_missing: false,
                }),
            ))
            .expect("Register asset");

        let clip = Clip {
            id: "clip-1".to_string(),
            track_id: "v1".to_string(),
            asset_id: "asset-1".to_string(),
            name: None,
            timeline_start: MediaTime::ZERO,
            timeline_end: MediaTime::from_secs_f64(20.0),
            source_start: MediaTime::ZERO,
            source_end: MediaTime::from_secs_f64(20.0),
            time_mapping: TimeMapping::new(MediaTime::ZERO, MediaTime::ZERO, 1.0),
            transform: LayerTransform::default(),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            z_index: 0,
            effects: Vec::new(),
            color_grade: None,
            body_effect: None,
        };

        state
            .apply(CommandEnvelope::new(2, ProjectCommand::AddClip(clip)))
            .expect("Add clip");

        let (plan_tx, plan_rx) = bounded::<RenderPlan>(32);
        let controller = PlaybackController::spawn(state, plan_tx).expect("Spawn controller");
        (controller, plan_rx)
    }

    #[test]
    fn test_playback_controller_play_pause_and_continuous_frames() {
        let (controller, plan_rx) = setup_test_controller();

        // 1. Send Play command
        controller
            .send_playback_command(PlaybackCommand::Play)
            .expect("Send Play");

        // 2. Expect multiple RenderPlans to arrive on the plan channel
        let plan_1 = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv plan 1");
        assert_eq!(plan_1.generation, 1);

        let plan_2 = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv plan 2");
        assert!(plan_2.time >= plan_1.time);

        // 3. Send Pause command
        controller
            .send_playback_command(PlaybackCommand::Pause)
            .expect("Send Pause");

        thread::sleep(Duration::from_millis(60));
        let snapshot = controller.poll_state().expect("Poll snapshot");
        assert_eq!(snapshot.mode, PlaybackMode::Idle);
        assert!(!snapshot.is_playing);
    }

    #[test]
    fn test_playback_controller_seek_mode() {
        let (controller, plan_rx) = setup_test_controller();

        let seek_target = MediaTime::from_secs_f64(5.5);
        controller
            .send_playback_command(PlaybackCommand::Seek {
                target_time: seek_target,
                generation: 201,
            })
            .expect("Send Seek");

        let plan = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv seek plan");
        assert_eq!(plan.generation, 201);
        assert_eq!(plan.time, seek_target);
        assert_eq!(plan.layers.len(), 1);
        assert_eq!(plan.layers[0].source_time, seek_target);

        thread::sleep(Duration::from_millis(50));
        let snapshot = controller.poll_state().expect("Poll state");
        assert_eq!(snapshot.mode, PlaybackMode::Seek);
        assert_eq!(snapshot.position, seek_target);
        assert_eq!(snapshot.generation, 201);
    }

    #[test]
    fn test_playback_controller_scrub_coalescing() {
        let (controller, plan_rx) = setup_test_controller();

        // Send 5 rapid scrub commands
        for i in 1..=5 {
            controller
                .send_playback_command(PlaybackCommand::Scrub {
                    target_time: MediaTime::from_secs_f64(i as f64),
                    generation: 300 + i,
                })
                .expect("Send scrub");
        }

        // Drain plans until latest
        let mut latest_plan = None;
        while let Ok(plan) = plan_rx.recv_timeout(Duration::from_millis(100)) {
            latest_plan = Some(plan);
        }

        let final_plan = latest_plan.expect("Expected at least one scrub plan");
        // Latest request wins: generation should be 305 and target time 5.0s
        assert_eq!(final_plan.generation, 305);
        assert_eq!(final_plan.time, MediaTime::from_secs_f64(5.0));
    }

    #[test]
    fn test_playback_controller_frame_step() {
        let (controller, plan_rx) = setup_test_controller();

        // Step forward 1 frame
        controller
            .send_playback_command(PlaybackCommand::Step {
                delta_frames: 1,
                generation: 401,
            })
            .expect("Send Step +1");

        let step_plan = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv step plan");
        assert_eq!(step_plan.generation, 401);
        // At 60 fps, 1 frame is 16,667 us
        assert_eq!(step_plan.time.as_micros(), 16_667);

        // Step forward 2 more frames
        controller
            .send_playback_command(PlaybackCommand::Step {
                delta_frames: 2,
                generation: 402,
            })
            .expect("Send Step +2");

        let step_plan_2 = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv step plan 2");
        assert_eq!(step_plan_2.generation, 402);
        assert_eq!(step_plan_2.time.as_micros(), 50_001); // 16667 + 33334
    }

    #[test]
    fn test_playback_controller_project_mutation_updates_frame() {
        let (controller, plan_rx) = setup_test_controller();

        // Currently at 0.0s, Clip 1 opacity is 1.0
        // Send a mutation to set Clip 1 opacity to 0.4
        controller
            .send_project_command(CommandEnvelope::new(
                3,
                ProjectCommand::SetOpacity {
                    clip_id: "clip-1".to_string(),
                    opacity: 0.4,
                },
            ))
            .expect("Send mutation");

        let mutated_plan = plan_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("Recv updated plan after mutation");

        assert_eq!(mutated_plan.project_revision, 4);
        assert_eq!(mutated_plan.layers.len(), 1);
        assert_eq!(mutated_plan.layers[0].opacity, 0.4);
    }
}
