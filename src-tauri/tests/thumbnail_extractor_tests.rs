//! Integration tests for FFmpeg frame extraction
//!
//! These tests validate that FFmpeg extraction works correctly and handles errors gracefully.

use tauri_app_lib::thumbnail_engine::{DensityLevel, Priority, request_thumbnail, GLOBAL_CACHE};

// =========================================================================
// TEST 3: FFMPEG EXTRACTION RETURNS VALID DATA
// =========================================================================

#[tokio::test]
async fn test_extract_single_frame_returns_valid_webp() {
    // This test requires a real video file
    // Place a short test video at: src-tauri/tests/fixtures/sample.mp4
    let test_video = "tests/fixtures/sample.mp4";
    
    // Skip test if fixture doesn't exist
    if !std::path::Path::new(test_video).exists() {
        eprintln!("⚠️  Skipping FFmpeg test - no test fixture at {}", test_video);
        eprintln!("   To run this test, add a short video file to tests/fixtures/sample.mp4");
        return;
    }

    // Initialize cache directory
    let temp_dir = std::env::temp_dir().join("thumbnail_test_cache");
    std::fs::create_dir_all(&temp_dir).unwrap();
    GLOBAL_CACHE.init_cache_dir(temp_dir.clone()).await.unwrap();

    // Request thumbnail extraction
    let result = request_thumbnail(
        test_video,
        1.0,
        DensityLevel::Medium,
        Priority::Critical,
        160,
        90,
        1.0,
    ).await;

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Verify result
    assert!(result.is_ok(), "FFmpeg extraction should succeed with valid video");
    
    let path = result.unwrap();
    assert!(path.exists(), "Extracted frame should exist on disk");
    
    // Verify it's a valid WebP file
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.is_empty(), "Frame file should not be empty");
    
    // WebP magic bytes: "RIFF" at start, "WEBP" at offset 8
    assert_eq!(&bytes[0..4], b"RIFF", "Should have RIFF header");
    if bytes.len() >= 12 {
        assert_eq!(&bytes[8..12], b"WEBP", "Should have WEBP signature");
    }
}

#[tokio::test]
async fn test_extract_frame_with_invalid_video_path() {
    // Initialize cache
    let temp_dir = std::env::temp_dir().join("thumbnail_test_cache_invalid");
    std::fs::create_dir_all(&temp_dir).unwrap();
    GLOBAL_CACHE.init_cache_dir(temp_dir.clone()).await.unwrap();

    // Try to extract from non-existent video
    let result = request_thumbnail(
        "/nonexistent/video.mp4",
        1.0,
        DensityLevel::Medium,
        Priority::Critical,
        160,
        90,
        1.0,
    ).await;

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Should fail gracefully
    assert!(result.is_err(), "Should fail with invalid video path");
}

// =========================================================================
// TEST 4: OUT OF BOUNDS TIMESTAMP IS HANDLED GRACEFULLY
// =========================================================================

#[tokio::test]
async fn test_extract_frame_beyond_duration_returns_error() {
    // This test requires a real video file
    let test_video = "tests/fixtures/sample.mp4";
    
    // Skip test if fixture doesn't exist
    if !std::path::Path::new(test_video).exists() {
        eprintln!("⚠️  Skipping out-of-bounds test - no test fixture at {}", test_video);
        return;
    }

    // Initialize cache
    let temp_dir = std::env::temp_dir().join("thumbnail_test_cache_oob");
    std::fs::create_dir_all(&temp_dir).unwrap();
    GLOBAL_CACHE.init_cache_dir(temp_dir.clone()).await.unwrap();

    // Try to extract frame way beyond video duration (9999 seconds)
    let result = request_thumbnail(
        test_video,
        9999.0,
        DensityLevel::Medium,
        Priority::Critical,
        160,
        90,
        1.0,
    ).await;

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Should fail gracefully (FFmpeg will error on out-of-bounds seek)
    assert!(result.is_err(), "Should fail when seeking beyond video duration");
}

#[tokio::test]
async fn test_extract_frame_at_negative_time() {
    // Initialize cache
    let temp_dir = std::env::temp_dir().join("thumbnail_test_cache_negative");
    std::fs::create_dir_all(&temp_dir).unwrap();
    GLOBAL_CACHE.init_cache_dir(temp_dir.clone()).await.unwrap();

    // Negative time should be handled by FFmpeg (clamped to 0)
    let result = request_thumbnail(
        "tests/fixtures/sample.mp4",
        -1.0,
        DensityLevel::Medium,
        Priority::Critical,
        160,
        90,
        1.0,
    ).await;

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);

    // FFmpeg will clamp negative seek to 0, so this might succeed or fail
    // The important thing is it doesn't panic
    let _ = result;
}
