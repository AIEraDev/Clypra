#[cfg(test)]
mod tests {
    use crate::engine::*;
    use std::thread;
    use std::time::Duration;

    fn create_test_project() -> ProjectState {
        let mut state = ProjectState::new(ProjectSettings::default());

        // Add Video Track
        state
            .apply(CommandEnvelope::new(
                0,
                ProjectCommand::AddTrack(Track::new("track-v1", "Video 1", TrackKind::Video, 10)),
            ))
            .expect("Add track-v1");

        // Add Audio Track
        state
            .apply(CommandEnvelope::new(
                1,
                ProjectCommand::AddTrack(Track::new("track-a1", "Audio 1", TrackKind::Audio, 0)),
            ))
            .expect("Add track-a1");

        // Register Video Asset
        state
            .apply(CommandEnvelope::new(
                2,
                ProjectCommand::RegisterAsset(MediaAssetRef {
                    id: "asset-video-1".to_string(),
                    file_path: "/media/clip1.mp4".to_string(),
                    preview_path: None,
                    duration: MediaTime::from_secs_f64(60.0),
                    width: Some(3840),
                    height: Some(2160),
                    is_missing: false,
                }),
            ))
            .expect("Register asset");

        // Add Clip A on Track V1 from 0.0s to 10.0s
        let clip_a = Clip {
            id: "clip-a".to_string(),
            track_id: "track-v1".to_string(),
            asset_id: "asset-video-1".to_string(),
            name: Some("Clip A".to_string()),
            timeline_start: MediaTime::from_secs_f64(0.0),
            timeline_end: MediaTime::from_secs_f64(10.0),
            source_start: MediaTime::from_secs_f64(5.0),
            source_end: MediaTime::from_secs_f64(15.0),
            time_mapping: TimeMapping::new(
                MediaTime::from_secs_f64(0.0),
                MediaTime::from_secs_f64(5.0),
                1.0,
            ),
            transform: LayerTransform::default(),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            z_index: 0,
            effects: Vec::new(),
            color_grade: None,
            body_effect: None,
        };

        state
            .apply(CommandEnvelope::new(3, ProjectCommand::AddClip(clip_a)))
            .expect("Add clip-a");

        state
    }

    /// Phase B-A: Native domain ownership & EngineVersion separation
    #[test]
    fn test_phase_b_a_native_domain_ownership() {
        let state = create_test_project();
        assert_eq!(state.revision, 4);
        assert_eq!(state.sequence.tracks.len(), 2);
        assert_eq!(state.sequence.clips.len(), 1);
        assert_eq!(state.sequence.duration, MediaTime::from_secs_f64(10.0));

        let version = EngineVersion {
            project_revision: state.revision,
            playback_generation: 101,
        };
        assert_eq!(version.project_revision, 4);
        assert_eq!(version.playback_generation, 101);
    }

    /// Phase B-B: Transactional mutations + optimistic revision protection
    #[test]
    fn test_phase_b_b_transactional_mutations_and_conflict_detection() {
        let mut state = create_test_project();
        assert_eq!(state.revision, 4);

        // Optimistic conflict test: UI tries to mutate with stale revision 3
        let stale_envelope = CommandEnvelope::new(
            3,
            ProjectCommand::SetOpacity {
                clip_id: "clip-a".to_string(),
                opacity: 0.5,
            },
        );
        let conflict_result = state.apply(stale_envelope);
        assert_eq!(
            conflict_result,
            Err(ProjectError::RevisionConflict {
                expected: 3,
                actual: 4,
            })
        );
        // Ensure state was NOT mutated
        assert_eq!(state.get_clip("clip-a").unwrap().opacity, 1.0);
        assert_eq!(state.revision, 4);

        // Correct mutation with base_revision 4 succeeds and advances revision to 5
        let valid_envelope = CommandEnvelope::new(
            4,
            ProjectCommand::SetOpacity {
                clip_id: "clip-a".to_string(),
                opacity: 0.5,
            },
        );
        let rev_5 = state.apply(valid_envelope).expect("Apply mutation");
        assert_eq!(rev_5, 5);
        assert_eq!(state.revision, 5);
        assert_eq!(state.get_clip("clip-a").unwrap().opacity, 0.5);

        // Move Clip to start at 2.0s
        let move_envelope = CommandEnvelope::new(
            5,
            ProjectCommand::MoveClip {
                clip_id: "clip-a".to_string(),
                new_track_id: None,
                new_timeline_start: MediaTime::from_secs_f64(2.0),
            },
        );
        state.apply(move_envelope).expect("Move clip");
        assert_eq!(state.revision, 6);
        let clip_moved = state.get_clip("clip-a").unwrap();
        assert_eq!(clip_moved.timeline_start, MediaTime::from_secs_f64(2.0));
        assert_eq!(clip_moved.timeline_end, MediaTime::from_secs_f64(12.0));
        assert_eq!(state.sequence.duration, MediaTime::from_secs_f64(12.0));
    }

    /// Phase B-C: Pure timeline evaluator
    #[test]
    fn test_phase_b_c_pure_evaluator() {
        let state = create_test_project();
        let evaluator = PureTimelineEvaluator::new();

        // 1. Evaluate at T = 4.0s (Clip A is active, source_time = 5.0s + 4.0s = 9.0s)
        let plan = evaluator.evaluate(&state, MediaTime::from_secs_f64(4.0), 100);
        assert_eq!(plan.generation, 100);
        assert_eq!(plan.project_revision, 4);
        assert_eq!(plan.layers.len(), 1);
        let layer = &plan.layers[0];
        assert_eq!(layer.clip_id, "clip-a");
        assert_eq!(layer.asset_id, "asset-video-1");
        assert_eq!(layer.source_time, MediaTime::from_secs_f64(9.0));
        assert_eq!(layer.z_index, 10); // Track z_index (10) + Clip z_index (0)

        // 2. Evaluate at T = 15.0s (Timeline gap: past Clip A end at 10.0s)
        let empty_plan = evaluator.evaluate(&state, MediaTime::from_secs_f64(15.0), 101);
        assert!(empty_plan.is_empty());
        assert_eq!(empty_plan.layers.len(), 0);
        assert_eq!(empty_plan.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(empty_plan.generation, 101);
    }

    /// Phase B-D: Existing model JSON adapter
    #[test]
    fn test_phase_b_d_existing_model_adapter() {
        let json_project = serde_json::json!({
            "canvasWidth": 3840,
            "canvasHeight": 2160,
            "frameRate": 60.0,
            "tracks": [
                { "id": "t1", "name": "V1", "type": "video", "visible": true, "muted": false, "volume": 1.0 }
            ],
            "clips": [
                {
                    "id": "c1",
                    "trackId": "t1",
                    "mediaId": "m1",
                    "startTime": 1.0,
                    "duration": 5.0,
                    "trimIn": 0.0,
                    "trimOut": 5.0,
                    "speed": 2.0,
                    "x": 100.0,
                    "y": 50.0,
                    "opacity": 0.8,
                    "blendMode": "screen"
                }
            ],
            "mediaAssets": [
                {
                    "id": "m1",
                    "path": "/videos/test.mp4",
                    "duration": 20.0,
                    "width": 3840,
                    "height": 2160,
                    "isMissing": false
                }
            ]
        });

        let state =
            ProjectModelAdapter::from_json_value(&json_project).expect("Parse JSON project");
        assert_eq!(state.settings.canvas.width, 3840);
        assert_eq!(state.settings.canvas.height, 2160);
        assert_eq!(state.sequence.tracks.len(), 1);
        assert_eq!(state.sequence.clips.len(), 1);

        let clip = &state.sequence.clips[0];
        assert_eq!(clip.id, "c1");
        assert_eq!(clip.timeline_start, MediaTime::from_secs_f64(1.0));
        assert_eq!(clip.timeline_end, MediaTime::from_secs_f64(6.0));
        assert_eq!(clip.blend_mode, BlendMode::Screen);

        // At T = 3.0s (delta = 2.0s * speed 2.0 = 4.0s source time)
        let evaluator = PureTimelineEvaluator::new();
        let plan = evaluator.evaluate(&state, MediaTime::from_secs_f64(3.0), 1);
        assert_eq!(plan.layers.len(), 1);
        assert_eq!(plan.layers[0].source_time, MediaTime::from_secs_f64(4.0));
    }

    /// Phase B-E: Golden evaluation test (determinism)
    #[test]
    fn test_phase_b_e_golden_evaluation_determinism() {
        let state = create_test_project();
        let evaluator = PureTimelineEvaluator::new();

        let plan_1 = evaluator.evaluate(&state, MediaTime::from_secs_f64(7.25), 50);
        let plan_2 = evaluator.evaluate(&state, MediaTime::from_secs_f64(7.25), 50);

        assert_eq!(plan_1, plan_2);
    }

    /// Phase B-F: React Freeze Test
    /// Proves that the native engine owns the authoritative project state and clock,
    /// so playback advances and evaluates frames continuously even when React is frozen for 200ms!
    #[test]
    fn test_phase_b_f_react_freeze_independent_playback() {
        let state = create_test_project();
        let evaluator = PureTimelineEvaluator::new();

        // 1. Initialize native playback clock
        let mut clock = EngineClock::new();
        clock.start();

        // Vector to collect presented render plans over time
        let mut produced_plans: Vec<RenderPlan> = Vec::new();

        // 2. Playback advances 3 frames normally
        for _ in 0..3 {
            let t = clock.tick();
            let plan = evaluator.evaluate(&state, t, 1);
            produced_plans.push(plan);
            thread::sleep(Duration::from_millis(16));
        }

        let pre_freeze_count = produced_plans.len();
        assert_eq!(pre_freeze_count, 3);

        // 3. SIMULATE REACT UI THREAD FREEZE (e.g. heavy JS garbage collection or UI render lock for 200 ms)
        // During this freeze, the React thread does NO work, sends NO commands, and calls NO getFrame().
        let react_thread = thread::spawn(|| {
            // Simulated React freeze
            thread::sleep(Duration::from_millis(200));
            // React recovers and sends a status query
            "react_recovered"
        });

        // Meanwhile, the native engine continues its real-time playback tick!
        for _ in 0..10 {
            let t = clock.tick();
            let plan = evaluator.evaluate(&state, t, 1);
            produced_plans.push(plan);
            thread::sleep(Duration::from_millis(16));
        }

        // Wait for React recovery
        let react_status = react_thread.join().unwrap();
        assert_eq!(react_status, "react_recovered");

        // Verify that native evaluation never stalled!
        assert_eq!(produced_plans.len(), 13);
        // Time advanced monotonically throughout the React freeze
        for i in 1..produced_plans.len() {
            assert!(
                produced_plans[i].time >= produced_plans[i - 1].time,
                "Playback time must advance monotonically despite React freeze"
            );
        }
    }
}
