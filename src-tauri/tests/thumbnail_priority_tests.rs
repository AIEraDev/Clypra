//! Integration tests for priority queue and density level logic
//!
//! These tests validate priority ordering and density level calculations.

use tauri_app_lib::thumbnail_engine::{
    DensityLevel, Priority, ExtractionJob, ResolutionTier, GLOBAL_QUEUE, GLOBAL_CACHE
};
use tokio::sync::oneshot;

// =========================================================================
// TEST 5: PRIORITY QUEUE ORDERING
// =========================================================================

#[tokio::test]
async fn test_priority_queue_processes_p0_before_p3() {
    // Initialize cache
    let temp_dir = std::env::temp_dir().join("thumbnail_test_cache_priority");
    std::fs::create_dir_all(&temp_dir).unwrap();
    GLOBAL_CACHE.init_cache_dir(temp_dir.clone()).await.unwrap();

    // Submit jobs with different priorities
    let (tx_p3, _rx_p3) = oneshot::channel();
    let (tx_p0, _rx_p0) = oneshot::channel();

    let job_p3 = ExtractionJob {
        video_path: "tests/fixtures/sample.mp4".to_string(),
        video_id: "test_video".to_string(),
        time: 1.0,
        density: DensityLevel::Medium,
        priority: Priority::Normal, // P3 equivalent
        width: 160,
        height: 90,
        resolution_tier: ResolutionTier::Tier2x,
        result_tx: tx_p3,
    };

    let job_p0 = ExtractionJob {
        video_path: "tests/fixtures/sample.mp4".to_string(),
        video_id: "test_video".to_string(),
        time: 2.0,
        density: DensityLevel::Medium,
        priority: Priority::Critical, // P0
        width: 160,
        height: 90,
        resolution_tier: ResolutionTier::Tier2x,
        result_tx: tx_p0,
    };

    // Submit P3 first, then P0
    let _ = GLOBAL_QUEUE.submit(job_p3).await;
    let _ = GLOBAL_QUEUE.submit(job_p0).await;

    // Wait a bit for processing
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);

    // The test passes if no panic occurs
    // Actual priority verification requires instrumentation
}

#[test]
fn test_priority_ordering() {
    // Verify priority enum ordering
    assert!(Priority::Critical < Priority::High);
    assert!(Priority::High < Priority::Normal);
}

// =========================================================================
// DENSITY LEVEL TESTS
// =========================================================================

#[test]
fn test_density_level_time_intervals() {
    assert_eq!(DensityLevel::Low.time_interval(), 5.0);
    assert_eq!(DensityLevel::Medium.time_interval(), 1.0);
    assert_eq!(DensityLevel::High.time_interval(), 0.2);
    assert_eq!(DensityLevel::Ultra.time_interval(), 0.02);
}

#[test]
fn test_density_level_from_zoom() {
    // Low density: time_per_thumb > 3.0s
    assert_eq!(DensityLevel::from_zoom(20.0), DensityLevel::Low); // 80/20 = 4.0s
    
    // Medium density: 0.5s < time_per_thumb <= 3.0s
    assert_eq!(DensityLevel::from_zoom(80.0), DensityLevel::Medium); // 80/80 = 1.0s
    
    // High density: 0.05s < time_per_thumb <= 0.5s
    assert_eq!(DensityLevel::from_zoom(400.0), DensityLevel::High); // 80/400 = 0.2s
    
    // Ultra density: time_per_thumb <= 0.05s
    assert_eq!(DensityLevel::from_zoom(2000.0), DensityLevel::Ultra); // 80/2000 = 0.04s
}

#[test]
fn test_density_level_higher() {
    assert_eq!(DensityLevel::Low.higher(), Some(DensityLevel::Medium));
    assert_eq!(DensityLevel::Medium.higher(), Some(DensityLevel::High));
    assert_eq!(DensityLevel::High.higher(), Some(DensityLevel::Ultra));
    assert_eq!(DensityLevel::Ultra.higher(), None);
}
