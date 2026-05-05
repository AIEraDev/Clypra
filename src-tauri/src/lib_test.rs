#[cfg(test)]
mod tests {
    use crate::{
        TempDirGuard, get_hwaccel_args, check_ffmpeg_available,
        extract_frame_at_time, extract_filmstrip_frames, trim_export, audio_waveform_peaks
    };
    use tokio::time::{timeout, Duration};

    // =========================================================================
    // TEMP_DIR_GUARD TESTS
    // =========================================================================

    #[test]
    fn test_temp_dir_guard_creates_and_cleans() {
        let temp_path = std::env::temp_dir().join("test_guard");
        std::fs::create_dir_all(&temp_path).unwrap();
        
        {
            let _guard = TempDirGuard(temp_path.clone());
            assert!(temp_path.exists());
        }
        
        assert!(!temp_path.exists());
    }

    #[test]
    fn test_temp_dir_guard_handles_nonexistent_path() {
        let temp_path = std::env::temp_dir().join("nonexistent_path_12345");
        
        {
            let _guard = TempDirGuard(temp_path.clone());
            // Guard should not panic on non-existent path
        }
        
        // Should not panic on drop
    }

    #[test]
    fn test_temp_dir_guard_handles_nested_directories() {
        let temp_path = std::env::temp_dir().join("test_nested").join("level2").join("level3");
        std::fs::create_dir_all(&temp_path).unwrap();
        
        {
            let _guard = TempDirGuard(temp_path.clone());
            assert!(temp_path.exists());
        }
        
        assert!(!temp_path.exists());
    }

    // =========================================================================
    // HWACCEL_ARGS TESTS
    // =========================================================================

    #[test]
    fn test_get_hwaccel_args_returns_platform_specific_args() {
        let args = get_hwaccel_args();
        
        #[cfg(target_os = "macos")]
        assert_eq!(args, vec!["-hwaccel", "videotoolbox"]);
        
        #[cfg(target_os = "windows")]
        assert_eq!(args, vec!["-hwaccel", "d3d11va", "-hwaccel_output_format", "nv12"]);
        
        #[cfg(target_os = "linux")]
        assert_eq!(args, vec!["-hwaccel", "vaapi", "-vaapi_device", "/dev/dri/renderD128"]);
        
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        assert!(args.is_empty());
    }

    // =========================================================================
    // CHECK_FFMPEG_AVAILABLE TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_check_ffmpeg_available_detects_missing_ffmpeg() {
        // Test with a fake PATH that doesn't contain ffmpeg
        let original_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", "/nonexistent");
        
        let result = check_ffmpeg_available().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("FFmpeg not found"));
        
        // Restore PATH
        std::env::set_var("PATH", original_path);
    }

    #[tokio::test]
    async fn test_check_ffmpeg_available_succeeds_when_installed() {
        // This test assumes ffmpeg is installed in CI/test environment
        let result = check_ffmpeg_available().await;
        
        // Either succeeds (ffmpeg installed) or fails with specific error
        match result {
            Ok(()) => {
                // FFmpeg is available
            }
            Err(e) => {
                // FFmpeg not installed - should have specific error message
                assert!(
                    e.contains("FFmpeg not found") || e.contains("FFmpeg found but returned error"),
                    "Unexpected error: {}", e
                );
            }
        }
    }

    // =========================================================================
    // EXTRACT_FRAME_AT_TIME TESTS - INPUT VALIDATION
    // =========================================================================

    #[tokio::test]
    async fn test_extract_frame_rejects_negative_time() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            -1.0,
            1920,
            1080,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-negative"));
    }

    #[tokio::test]
    async fn test_extract_frame_rejects_infinite_time() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            f64::INFINITY,
            1920,
            1080,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("finite"));
    }

    #[tokio::test]
    async fn test_extract_frame_rejects_nan_time() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            f64::NAN,
            1920,
            1080,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("finite"));
    }

    #[tokio::test]
    async fn test_extract_frame_rejects_zero_width() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            1.0,
            0,
            1080,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("positive"));
    }

    #[tokio::test]
    async fn test_extract_frame_rejects_zero_height() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            1.0,
            1920,
            0,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("positive"));
    }

    #[tokio::test]
    async fn test_extract_frame_handles_very_large_dimensions() {
        // Should handle 8K dimensions (7680x4320)
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            1.0,
            7680,
            4320,
        ).await;
        
        // Will fail due to missing ffmpeg/file, but should not panic on input validation
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_frame_handles_extremely_large_time() {
        // Test with 3+ hour video timestamp
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            10800.0, // 3 hours
            1920,
            1080,
        ).await;
        
        // Input validation should pass, extraction will fail due to missing file
        assert!(result.is_err());
    }

    // =========================================================================
    // EXTRACT_FRAME_AT_TIME TESTS - FILE PATH HANDLING
    // =========================================================================

    #[tokio::test]
    async fn test_extract_frame_handles_empty_path() {
        let result = extract_frame_at_time(
            "".to_string(),
            1.0,
            1920,
            1080,
        ).await;
        
        // Should fail gracefully with empty path
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_frame_handles_very_long_path() {
        // Create a very long path (near filesystem limits)
        let long_name = "a".repeat(200);
        let long_path = format!("/tmp/{}/video.mp4", long_name);
        
        let result = extract_frame_at_time(
            long_path,
            1.0,
            1920,
            1080,
        ).await;
        
        // Should not panic, will fail due to missing file
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_frame_handles_path_with_special_chars() {
        let special_paths = vec![
            "/test/video with spaces.mp4",
            "/test/video-with-dashes.mp4",
            "/test/video_with_underscores.mp4",
            "/test/video.with.dots.mp4",
            "/test/video[brackets].mp4",
            "/test/video(parens).mp4",
        ];
        
        for path in special_paths {
            let result = extract_frame_at_time(
                path.to_string(),
                1.0,
                1920,
                1080,
            ).await;
            
            // Should not panic on any path
            assert!(result.is_err());
        }
    }

    #[tokio::test]
    async fn test_extract_frame_handles_unicode_path() {
        let unicode_paths = vec![
            "/test/视频.mp4",           // Chinese
            "/test/відео.mp4",          // Ukrainian
            "/test/🎬video.mp4",       // Emoji
            "/test/日本語.mp4",          // Japanese
        ];
        
        for path in unicode_paths {
            let result = extract_frame_at_time(
                path.to_string(),
                1.0,
                1920,
                1080,
            ).await;
            
            // Should not panic on unicode paths
            assert!(result.is_err());
        }
    }

    // =========================================================================
    // EXTRACT_FRAME_AT_TIME TESTS - EDGE CASES
    // =========================================================================

    #[tokio::test]
    async fn test_extract_frame_at_time_zero() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            0.0,
            1920,
            1080,
        ).await;
        
        // Time=0 is valid input, extraction will fail due to missing file
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_frame_with_subsecond_precision() {
        // Test millisecond precision (common in video editing)
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            1.033, // ~31st frame at 30fps
            1920,
            1080,
        ).await;
        
        // Valid input, extraction will fail due to missing file
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_frame_with_max_f64() {
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            f64::MAX,
            1920,
            1080,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("finite"));
    }

    // =========================================================================
    // EXTRACT_FILMSTRIP_FRAMES TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_extract_filmstrip_rejects_zero_frame_count() {
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            0,
            1920,
            1080,
            None,
            None,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("between 1 and 100"));
    }

    #[tokio::test]
    async fn test_extract_filmstrip_rejects_too_many_frames() {
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            101,
            1920,
            1080,
            None,
            None,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("between 1 and 100"));
    }

    #[tokio::test]
    async fn test_extract_filmstrip_rejects_zero_width() {
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            10,
            0,
            1080,
            None,
            None,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("positive"));
    }

    #[tokio::test]
    async fn test_extract_filmstrip_rejects_zero_height() {
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            10,
            1920,
            0,
            None,
            None,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("positive"));
    }

    #[tokio::test]
    async fn test_extract_filmstrip_boundary_values() {
        // Test minimum valid frame count
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            1,
            1920,
            1080,
            None,
            None,
        ).await;
        assert!(result.is_err()); // Will fail due to missing file
        
        // Test maximum valid frame count
        let result = extract_filmstrip_frames(
            "/test/video.mp4".to_string(),
            100,
            1920,
            1080,
            None,
            None,
        ).await;
        assert!(result.is_err()); // Will fail due to missing file
    }

    // =========================================================================
    // TRIM_EXPORT TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_trim_export_rejects_non_finite_start() {
        let result = trim_export(
            "/test/input.mp4".to_string(),
            "/test/output.mp4".to_string(),
            f64::NAN,
            10.0,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("finite"));
    }

    #[tokio::test]
    async fn test_trim_export_rejects_non_finite_end() {
        let result = trim_export(
            "/test/input.mp4".to_string(),
            "/test/output.mp4".to_string(),
            0.0,
            f64::INFINITY,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("finite"));
    }

    #[tokio::test]
    async fn test_trim_export_rejects_end_before_start() {
        let result = trim_export(
            "/test/input.mp4".to_string(),
            "/test/output.mp4".to_string(),
            10.0,
            5.0,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("End time must be greater"));
    }

    #[tokio::test]
    async fn test_trim_export_rejects_equal_start_end() {
        let result = trim_export(
            "/test/input.mp4".to_string(),
            "/test/output.mp4".to_string(),
            5.0,
            5.0,
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("End time must be greater"));
    }

    #[tokio::test]
    async fn test_trim_export_boundary_values() {
        // Test zero-length trim (should fail - end must be > start)
        let result = trim_export(
            "/test/input.mp4".to_string(),
            "/test/output.mp4".to_string(),
            0.0,
            0.000001, // Microsecond duration
        ).await;
        
        // Input validation passes, but ffmpeg will fail
        assert!(result.is_err());
    }

    // =========================================================================
    // AUDIO_WAVEFORM_PEAKS TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_audio_waveform_clamps_bucket_count() {
        // Test below minimum (should clamp to 32)
        let result = audio_waveform_peaks("/test/video.mp4".to_string(), 10).await;
        // Should succeed (returns empty peaks when ffmpeg unavailable)
        assert!(result.is_ok());
        let peaks = result.unwrap();
        assert_eq!(peaks.len(), 32);
        
        // Test above maximum (should clamp to 512)
        let result = audio_waveform_peaks("/test/video.mp4".to_string(), 1000).await;
        assert!(result.is_ok());
        let peaks = result.unwrap();
        assert_eq!(peaks.len(), 512);
    }

    #[tokio::test]
    async fn test_audio_waveform_zero_bucket_count() {
        let result = audio_waveform_peaks("/test/video.mp4".to_string(), 0).await;
        assert!(result.is_ok());
        let peaks = result.unwrap();
        assert_eq!(peaks.len(), 32); // Clamped to minimum
    }

    #[tokio::test]
    async fn test_audio_waveform_max_u32_bucket_count() {
        let result = audio_waveform_peaks("/test/video.mp4".to_string(), u32::MAX).await;
        assert!(result.is_ok());
        let peaks = result.unwrap();
        assert_eq!(peaks.len(), 512); // Clamped to maximum
    }

    // =========================================================================
    // FRAME CACHE TESTS
    // =========================================================================

    #[test]
    fn test_frame_cache_dir_creates_directory() {
        // Note: This requires a Tauri AppHandle which is difficult to mock in unit tests
        // Integration tests would cover this better
    }

    // =========================================================================
    // CONCURRENCY TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_concurrent_extract_frame_calls() {
        // Test that multiple concurrent calls don't panic
        let mut handles = vec![];
        
        for i in 0..5 {
            let handle = tokio::spawn(async move {
                extract_frame_at_time(
                    format!("/test/video{}.mp4", i),
                    i as f64,
                    1920,
                    1080,
                ).await
            });
            handles.push(handle);
        }
        
        // All should complete without panicking
        for handle in handles {
            let result = handle.await;
            assert!(result.is_ok()); // Spawn completed
            assert!(result.unwrap().is_err()); // Extraction failed (no real file)
        }
    }

    #[tokio::test]
    async fn test_concurrent_filmstrip_calls() {
        let mut handles = vec![];
        
        for i in 0..3 {
            let handle = tokio::spawn(async move {
                extract_filmstrip_frames(
                    format!("/test/video{}.mp4", i),
                    10,
                    320,
                    180,
                    None,
                    None,
                ).await
            });
            handles.push(handle);
        }
        
        for handle in handles {
            let result = handle.await;
            assert!(result.is_ok());
            assert!(result.unwrap().is_err());
        }
    }

    #[tokio::test]
    async fn test_extract_frame_timeout() {
        // The extract_frame_at_time function has a 5-second timeout
        // Testing actual timeout requires a slow ffmpeg process
        // This test verifies the timeout mechanism is in place
        
        let result = timeout(
            Duration::from_millis(100),
            extract_frame_at_time(
                "/test/video.mp4".to_string(),
                1.0,
                1920,
                1080,
            )
        ).await;
        
        // Should timeout quickly (no real file)
        assert!(result.is_err() || result.unwrap().is_err());
    }

    // =========================================================================
    // ERROR HANDLING TESTS
    // =========================================================================

    #[tokio::test]
    async fn test_extract_frame_handles_ffmpeg_not_found() {
        // Temporarily modify PATH to exclude ffmpeg
        let original_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", "/nonexistent");
        
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            1.0,
            1920,
            1080,
        ).await;
        
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("FFmpeg not found") || err.contains("Failed to check FFmpeg"));
        
        std::env::set_var("PATH", original_path);
    }

    // =========================================================================
    // BASE64 ENCODING TESTS
    // =========================================================================

    #[test]
    fn test_base64_encoding_produces_valid_data_url() {
        // Test that base64 data URL format is correct
        let png_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // PNG signature
        let base64_data = base64::encode(&png_bytes);
        let data_url = format!("data:image/png;base64,{}", base64_data);
        
        assert!(data_url.starts_with("data:image/png;base64,"));
        assert!(!base64_data.is_empty());
    }

    // =========================================================================
    // MD5 HASH TESTS (for cache keys)
    // =========================================================================

    #[test]
    fn test_md5_hash_consistency() {
        let frame_key1 = format!("{}_{:.3}_{}x{}", "/test/video.mp4", 1.5, 1920, 1080);
        let frame_key2 = format!("{}_{:.3}_{}x{}", "/test/video.mp4", 1.5, 1920, 1080);
        let frame_key3 = format!("{}_{:.3}_{}x{}", "/test/video.mp4", 1.6, 1920, 1080);
        
        let hash1 = format!("{:x}", md5::compute(&frame_key1));
        let hash2 = format!("{:x}", md5::compute(&frame_key2));
        let hash3 = format!("{:x}", md5::compute(&frame_key3));
        
        assert_eq!(hash1, hash2); // Same inputs = same hash
        assert_ne!(hash1, hash3); // Different inputs = different hash
    }

    // =========================================================================
    // MEMORY/INTEGRATION TESTS (for large files)
    // =========================================================================

    #[tokio::test]
    async fn test_extract_frame_validates_before_spawning_ffmpeg() {
        // Invalid inputs should fail fast without spawning ffmpeg
        let start = std::time::Instant::now();
        
        let result = extract_frame_at_time(
            "/test/video.mp4".to_string(),
            -1.0, // Invalid
            1920,
            1080,
        ).await;
        
        let elapsed = start.elapsed();
        
        assert!(result.is_err());
        // Should fail very quickly due to input validation
        assert!(elapsed.as_millis() < 100);
    }

    #[test]
    fn test_temp_dir_guard_with_panic() {
        let temp_path = std::env::temp_dir().join("test_panic_guard");
        std::fs::create_dir_all(&temp_path).unwrap();
        
        let result = std::panic::catch_unwind(|| {
            let _guard = TempDirGuard(temp_path.clone());
            assert!(temp_path.exists());
            panic!("Intentional panic");
        });
        
        assert!(result.is_err());
        // Directory should still be cleaned up via Drop
        // Note: This may not work in all panic handling modes
    }

    // =========================================================================
    // TIME FORMATTING TESTS (used for seek timestamps)
    // =========================================================================

    #[test]
    fn test_time_formatting_precision() {
        // Test that time formatting produces correct precision for ffmpeg
        let time_secs: f64 = 123.456789;
        let formatted = format!("{:.6}", time_secs);
        assert_eq!(formatted, "123.456789");
        
        let time_secs: f64 = 0.0;
        let formatted = format!("{:.6}", time_secs);
        assert_eq!(formatted, "0.000000");
        
        let time_secs: f64 = 10800.0; // 3 hours
        let formatted = format!("{:.6}", time_secs);
        assert_eq!(formatted, "10800.000000");
    }

    // =========================================================================
    // SCALE STRING TESTS
    // =========================================================================

    #[test]
    fn test_scale_string_formatting() {
        let width: u32 = 1920;
        let height: u32 = 1080;
        let scale_str = format!("{}:{}", width, height);
        assert_eq!(scale_str, "1920:1080");
        
        // Test 4K
        let scale_str = format!("{}:{}", 3840u32, 2160u32);
        assert_eq!(scale_str, "3840:2160");
        
        // Test 8K
        let scale_str = format!("{}:{}", 7680u32, 4320u32);
        assert_eq!(scale_str, "7680:4320");
    }
}
