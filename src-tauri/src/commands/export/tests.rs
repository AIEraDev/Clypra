#[cfg(test)]
mod tests {
    use crate::commands::export::*;

    #[test]
    fn volume_automation_expression_contains_rebased_linear_and_exponential_segments() {
        let expression = build_automation_volume_expression(&[
            ExportAudioKeyframe {
                time: 0.0,
                gain: 0.5,
                easing: Some("linear".to_string()),
            },
            ExportAudioKeyframe {
                time: 1.0,
                gain: 1.0,
                easing: Some("linear".to_string()),
            },
            ExportAudioKeyframe {
                time: 2.0,
                gain: 0.25,
                easing: Some("exponential".to_string()),
            },
        ])
        .expect("automation expression");

        assert!(expression.contains("if(lt(t\\,2.000000)"));
        assert!(expression.contains("pow("));
        assert!(expression.contains("0.500000"));
    }

    #[test]
    fn test_cly_bug_003_export_audio_amix_normalize_zero() {
        let clips = vec![
            ExportAudioClip {
                path: "/path/to/voice.mp3".to_string(),
                start_time: 0.0,
                duration: 5.0,
                volume: 1.0,
                trim_in: 0.0,
                fade_in: None,
                fade_out: None,
                fade_in_curve: None,
                fade_out_curve: None,
                eq_low: None,
                eq_mid: None,
                eq_high: None,
                pan: None,
                noise_suppression: None,
                volume_keyframes: None,
                channel_map: None,
                channel_mode: None,
                downmix: None,
            },
            ExportAudioClip {
                path: "/path/to/music.mp3".to_string(),
                start_time: 1.0,
                duration: 4.0,
                volume: 0.8,
                trim_in: 0.0,
                fade_in: None,
                fade_out: None,
                fade_in_curve: None,
                fade_out_curve: None,
                eq_low: None,
                eq_mid: None,
                eq_high: None,
                pan: None,
                noise_suppression: None,
                volume_keyframes: None,
                channel_map: None,
                channel_mode: None,
                downmix: None,
            },
        ];

        let filter_complex = build_export_audio_filter_complex(&clips, 5.0);

        // CLY-BUG-003: amix must specify normalize=0 to avoid automatic attenuation
        assert!(
            filter_complex.contains("amix=inputs=3:duration=longest:normalize=0[a]"),
            "Expected amix filter to specify normalize=0, but got: {}",
            filter_complex
        );
        assert!(
            !filter_complex.contains(":normalize=1"),
            "amix must never normalize=1 in Clypra export"
        );
    }

    fn base_test_config() -> ExportConfig {
        ExportConfig {
            output_path: "/tmp/test_export.mp4".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: 30.0,
            total_frames: 90,
            codec: "h264".to_string(),
            preset: "medium".to_string(),
            crf: 23,
            pixel_format: "yuv420p".to_string(),
            audio_clips: None,
        }
    }

    #[test]
    fn test_validate_compositor_export_config_valid() {
        let config = base_test_config();
        assert!(validate_compositor_export_config(&config).is_ok());
    }

    #[test]
    fn test_validate_compositor_export_config_invalid_dimensions() {
        let mut config = base_test_config();
        config.width = 0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid export dimensions"));

        config.width = 1920;
        config.height = 0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid export dimensions"));

        config.width = 8000;
        config.height = 1080;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Export dimensions too large"));
    }

    #[test]
    fn test_validate_compositor_export_config_invalid_frame_rate() {
        let mut config = base_test_config();
        config.frame_rate = 0.0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid frame rate"));

        config.frame_rate = -24.0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid frame rate"));

        config.frame_rate = f64::NAN;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid frame rate"));

        config.frame_rate = f64::INFINITY;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid frame rate"));

        config.frame_rate = 300.0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid frame rate"));
    }

    #[test]
    fn test_validate_compositor_export_config_zero_frames() {
        let mut config = base_test_config();
        config.total_frames = 0;
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("total_frames must be greater than 0"));
    }

    #[test]
    fn test_validate_compositor_export_config_empty_output_path() {
        let mut config = base_test_config();
        config.output_path = "   ".to_string();
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("output_path cannot be empty"));
    }

    #[test]
    fn test_validate_compositor_export_config_audio_bounds() {
        let mut config = base_test_config();
        config.audio_clips = Some(vec![ExportAudioClip {
            path: "/tmp/audio.mp3".to_string(),
            start_time: 0.0,
            duration: -1.0,
            trim_in: 0.0,
            volume: 1.0,
            fade_in: None,
            fade_out: None,
            fade_in_curve: None,
            fade_out_curve: None,
            pan: None,
            eq_low: None,
            eq_mid: None,
            eq_high: None,
            noise_suppression: None,
            volume_keyframes: None,
            channel_mode: None,
            downmix: None,
            channel_map: None,
        }]);
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid audio clip duration"));

        let mut config = base_test_config();
        config.audio_clips = Some(vec![ExportAudioClip {
            path: "/tmp/audio.mp3".to_string(),
            start_time: -0.5,
            duration: 1.0,
            trim_in: 0.0,
            volume: 1.0,
            fade_in: None,
            fade_out: None,
            fade_in_curve: None,
            fade_out_curve: None,
            pan: None,
            eq_low: None,
            eq_mid: None,
            eq_high: None,
            noise_suppression: None,
            volume_keyframes: None,
            channel_mode: None,
            downmix: None,
            channel_map: None,
        }]);
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid audio clip start_time"));

        let mut config = base_test_config();
        config.audio_clips = Some(vec![ExportAudioClip {
            path: "/tmp/audio.mp3".to_string(),
            start_time: 0.0,
            duration: 1.0,
            trim_in: 0.0,
            volume: 1.0,
            fade_in: None,
            fade_out: None,
            fade_in_curve: None,
            fade_out_curve: None,
            pan: Some(2.5),
            eq_low: None,
            eq_mid: None,
            eq_high: None,
            noise_suppression: None,
            volume_keyframes: None,
            channel_mode: None,
            downmix: None,
            channel_map: None,
        }]);
        assert!(validate_compositor_export_config(&config)
            .unwrap_err()
            .contains("Invalid audio clip pan"));
    }

    #[tokio::test]
    async fn test_atomic_or_copy_commit_success() {
        let dir = std::env::temp_dir().join(format!("clypra-test-commit-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let src = dir.join("test_src.tmp");
        let dst = dir.join("subdir").join("test_dst.mp4");

        tokio::fs::write(&src, b"video_data_123").await.unwrap();
        assert!(src.exists());

        let res = atomic_or_copy_commit(&src, &dst).await;
        assert!(res.is_ok(), "Commit failed: {:?}", res);
        assert!(!src.exists(), "Source should have been renamed or removed");
        assert!(dst.exists(), "Destination should exist");
        let data = tokio::fs::read(&dst).await.unwrap();
        assert_eq!(data, b"video_data_123");

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[test]
    fn test_smoke_test_normalized_t_underflow_guard() {
        let total_frames = 1u32;
        let t = if total_frames > 1 {
            0.0 / (total_frames - 1) as f64
        } else {
            0.0
        };
        assert_eq!(t, 0.0);

        let total_frames = 0u32;
        let t = if total_frames > 1 {
            0.0 / (total_frames - 1) as f64
        } else {
            0.0
        };
        assert_eq!(t, 0.0);

        let total_frames = 5u32;
        let t0 = 0.0 / (total_frames - 1) as f64;
        let t_last = 4.0 / (total_frames - 1) as f64;
        assert_eq!(t0, 0.0);
        assert_eq!(t_last, 1.0);
    }

    /// GPU rendering tests — require a real hardware adapter.
    /// Run locally with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_run_wgpu_smoke_test() {
        let test_output = std::env::temp_dir().join("wgpu_smoke_test.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result = run_wgpu_smoke_test(path_str.clone()).await;
        assert!(result.is_ok(), "wgpu smoke test failed: {:?}", result.err());

        let metadata = std::fs::metadata(&test_output);
        assert!(metadata.is_ok(), "Exported MP4 file does not exist");
        assert!(metadata.unwrap().len() > 0, "Exported MP4 file is 0 bytes");

        println!(
            "Successfully generated native single-rectangle MP4 at: {}",
            path_str
        );
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_native_document_wgpu_export() {
        let fixture_json = include_str!("../../fixtures/basic_rectangle_doc.json");
        let test_output = std::env::temp_dir().join("native_doc_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(fixture_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Native OverlayDocument wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported MP4 file from OverlayDocument does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported MP4 file from OverlayDocument is 0 bytes"
        );

        println!(
            "Successfully rendered & exported OverlayDocument fixture to MP4: {}",
            path_str
        );
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_revenue_data_story_wgpu_export() {
        let fixture_json = include_str!("../../fixtures/revenue_data_story_doc.json");
        let test_output = std::env::temp_dir().join("revenue_story_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(fixture_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Native Revenue Data Story wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported Revenue Data Story MP4 file does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported Revenue Data Story MP4 file is 0 bytes"
        );

        println!("Successfully rendered & exported Revenue Data Story OverlayDocument fixture to MP4: {}", path_str);
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_published_artifact_wgpu_export() {
        let artifact_json = include_str!("../../fixtures/published_revenue_story.json");
        let test_output = std::env::temp_dir().join("published_artifact_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(artifact_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Published OverlayArtifact wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported Published OverlayArtifact MP4 file does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported Published OverlayArtifact MP4 file is 0 bytes"
        );

        println!(
            "Successfully extracted & rendered PublishedOverlayArtifact (rev 17) to MP4: {}",
            path_str
        );
    }
}
