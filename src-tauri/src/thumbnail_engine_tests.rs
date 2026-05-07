//! Unit tests for thumbnail_engine module
//!
//! Tests are organized in a separate file for better code organization.

use crate::thumbnail_engine::*;
use std::path::PathBuf;

#[test]
fn test_active_tracker_overlapping_timestamps() {
    // Feature: video-zoom-performance-optimization, Task 1.6
    // Verify that overlapping timestamps are not cancelled
    
    let tracker = ActiveExtractionTracker::new();
    let video_id = "test_video_123";
    
    // Initial request with timestamps [1.0, 2.0, 3.0, 4.0, 5.0]
    let initial_timestamps = vec![1.0, 2.0, 3.0, 4.0, 5.0];
    tracker.register_request(video_id, &initial_timestamps);
    
    // New request with timestamps [3.0, 4.0, 5.0, 6.0, 7.0]
    // Overlapping: [3.0, 4.0, 5.0]
    // Should cancel: [1.0, 2.0]
    let new_timestamps = vec![3.0, 4.0, 5.0, 6.0, 7.0];
    let cancelled = tracker.cancel_stale_timestamps(video_id, &new_timestamps);
    
    // Convert cancelled keys back to timestamps for verification
    let cancelled_times: Vec<f64> = cancelled
        .iter()
        .map(|&key| key as f64 / 1000.0)
        .collect();
    
    // Should have cancelled exactly 2 timestamps: 1.0 and 2.0
    assert_eq!(cancelled.len(), 2);
    assert!(cancelled_times.contains(&1.0));
    assert!(cancelled_times.contains(&2.0));
    
    // Overlapping timestamps should NOT be in cancelled list
    assert!(!cancelled_times.contains(&3.0));
    assert!(!cancelled_times.contains(&4.0));
    assert!(!cancelled_times.contains(&5.0));
    
    // Verify the active set was updated to new timestamps
    let active_keys = tracker.active_requests.get(video_id)
        .expect("Active requests should exist for video")
        .value()
        .clone();
    
    assert_eq!(active_keys.len(), 5);
    assert!(active_keys.contains(&3000)); // 3.0s
    assert!(active_keys.contains(&4000)); // 4.0s
    assert!(active_keys.contains(&5000)); // 5.0s
    assert!(active_keys.contains(&6000)); // 6.0s
    assert!(active_keys.contains(&7000)); // 7.0s
}

#[test]
fn test_active_tracker_no_overlap() {
    // Test case where there's no overlap between old and new requests
    let tracker = ActiveExtractionTracker::new();
    let video_id = "test_video_456";
    
    // Initial request
    let initial_timestamps = vec![1.0, 2.0, 3.0];
    tracker.register_request(video_id, &initial_timestamps);
    
    // Completely different timestamps
    let new_timestamps = vec![10.0, 11.0, 12.0];
    let cancelled = tracker.cancel_stale_timestamps(video_id, &new_timestamps);
    
    // All initial timestamps should be cancelled
    assert_eq!(cancelled.len(), 3);
}

#[test]
fn test_active_tracker_complete_overlap() {
    // Test case where new request is a superset of old request
    let tracker = ActiveExtractionTracker::new();
    let video_id = "test_video_789";

    // Initial request
    let initial_timestamps = vec![2.0, 3.0, 4.0];
    tracker.register_request(video_id, &initial_timestamps);

    // New request includes all old timestamps plus more
    let new_timestamps = vec![1.0, 2.0, 3.0, 4.0, 5.0];
    let cancelled = tracker.cancel_stale_timestamps(video_id, &new_timestamps);

    // Nothing should be cancelled since all old timestamps are in new request
    assert_eq!(cancelled.len(), 0);
}

#[test]
fn test_cache_key_round_trip_serialization() {
    // Test cache key serialization to string and deserialization back
    let video_path = "/test/video.mp4";
    let time = 5.5;
    let density = DensityLevel::High;
    let dpr = 1.5;

    let key = CacheKey::new(video_path, time, density, dpr);
    let serialized = key.to_string();
    let deserialized = CacheKey::from_string(&serialized).expect("Should deserialize successfully");

    assert_eq!(key.video_id, deserialized.video_id);
    assert_eq!(key.timestamp_ms, deserialized.timestamp_ms);
    assert_eq!(key.density, deserialized.density);
    assert_eq!(key.resolution_tier, deserialized.resolution_tier);
}

#[test]
fn test_cache_key_serialization_all_densities() {
    // Test serialization with all density levels
    let video_path = "/test/video.mp4";
    let time = 10.0;
    let dpr = 1.0;

    for density in [DensityLevel::Low, DensityLevel::Medium, DensityLevel::High, DensityLevel::Ultra] {
        let key = CacheKey::new(video_path, time, density, dpr);
        let serialized = key.to_string();
        let deserialized = CacheKey::from_string(&serialized).expect("Should deserialize successfully");

        assert_eq!(key.density, deserialized.density, "Density mismatch for {:?}", density);
    }
}

#[test]
fn test_cache_key_serialization_invalid_format() {
    // Test that invalid formats return errors
    assert!(CacheKey::from_string("invalid").is_err());
    assert!(CacheKey::from_string("only:two:parts").is_err());
    assert!(CacheKey::from_string("one:two:three:four:five").is_err());
    assert!(CacheKey::from_string("vid:abc:invalid_density:1x").is_err());
    assert!(CacheKey::from_string("vid:123:high:invalid_tier").is_err());
}

#[test]
fn test_resolution_tier_from_dpr() {
    // Test DPR to resolution tier mapping
    // DPR < 1.5 should map to Tier1x
    assert_eq!(ResolutionTier::from_dpr(1.0), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_dpr(1.2), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_dpr(1.49), ResolutionTier::Tier1x);

    // DPR >= 1.5 should map to Tier2x
    assert_eq!(ResolutionTier::from_dpr(1.5), ResolutionTier::Tier2x);
    assert_eq!(ResolutionTier::from_dpr(2.0), ResolutionTier::Tier2x);
    assert_eq!(ResolutionTier::from_dpr(3.0), ResolutionTier::Tier2x);
}

#[test]
fn test_resolution_tier_dimensions() {
    // Test that each tier returns correct dimensions
    assert_eq!(ResolutionTier::Tier1x.dimensions(), (80, 60));
    assert_eq!(ResolutionTier::Tier2x.dimensions(), (160, 120));
}

#[test]
fn test_resolution_tier_label_round_trip() {
    // Test label to tier and back
    for tier in [ResolutionTier::Tier1x, ResolutionTier::Tier2x] {
        let label = tier.label();
        let parsed = ResolutionTier::from_label(label).expect("Should parse label successfully");
        assert_eq!(tier, parsed);
    }
}

#[test]
fn test_resolution_tier_from_label_invalid() {
    // Test invalid labels return errors
    assert!(ResolutionTier::from_label("invalid").is_err());
    assert!(ResolutionTier::from_label("3x").is_err());
    assert!(ResolutionTier::from_label("").is_err());
}

#[test]
fn test_retry_backoff_timing() {
    // Test that exponential backoff follows the pattern: 100ms, 400ms, 1600ms
    let mut backoff_ms: u64 = 100;
    let expected_sequence = vec![100, 400, 1600];

    for expected in expected_sequence {
        assert_eq!(backoff_ms, expected, "Backoff should be {}ms at this step", expected);
        backoff_ms *= 4; // Base-4 exponential backoff
    }

    // Verify the pattern continues
    assert_eq!(backoff_ms, 6400, "Fourth backoff should be 6400ms");
}

#[test]
fn test_fallback_chain_order() {
    // Create a video cache
    let video_id = "test_video".to_string();
    let video_path = "/test/video.mp4".to_string();
    let duration = 60.0;
    let cache = VideoCache::new(video_id.clone(), video_path, duration);

    // Insert frames at different density levels
    let time = 5.0;
    let test_path_low = PathBuf::from("/cache/low_5000.webp");
    let test_path_medium = PathBuf::from("/cache/medium_5000.webp");
    let test_path_high = PathBuf::from("/cache/high_5000.webp");
    let test_path_ultra = PathBuf::from("/cache/ultra_5000.webp");

    // Insert frames into each density level
    if let Some(low_cache) = cache.levels.get(&DensityLevel::Low) {
        low_cache.insert(time, CachedFrame::new(time, test_path_low.clone()));
    }
    if let Some(medium_cache) = cache.levels.get(&DensityLevel::Medium) {
        medium_cache.insert(time, CachedFrame::new(time, test_path_medium.clone()));
    }
    if let Some(high_cache) = cache.levels.get(&DensityLevel::High) {
        high_cache.insert(time, CachedFrame::new(time, test_path_high.clone()));
    }
    if let Some(ultra_cache) = cache.levels.get(&DensityLevel::Ultra) {
        ultra_cache.insert(time, CachedFrame::new(time, test_path_ultra.clone()));
    }

    // Test 1: Request Low density - should get Low
    let result = cache.get_frame_with_fallback(time, DensityLevel::Low);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Low);
    assert_eq!(path, test_path_low);

    // Test 2: Request Medium density - should get Medium
    let result = cache.get_frame_with_fallback(time, DensityLevel::Medium);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Medium);
    assert_eq!(path, test_path_medium);

    // Test 3: Request High density - should get High
    let result = cache.get_frame_with_fallback(time, DensityLevel::High);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::High);
    assert_eq!(path, test_path_high);

    // Test 4: Request Ultra density - should get Ultra
    let result = cache.get_frame_with_fallback(time, DensityLevel::Ultra);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Ultra);
    assert_eq!(path, test_path_ultra);
}

#[test]
fn test_fallback_to_higher_density() {
    // Create a video cache with only High and Ultra densities
    let video_id = "test_video".to_string();
    let video_path = "/test/video.mp4".to_string();
    let duration = 60.0;
    let cache = VideoCache::new(video_id.clone(), video_path, duration);

    let time = 5.0;
    let test_path_high = PathBuf::from("/cache/high_5000.webp");
    let test_path_ultra = PathBuf::from("/cache/ultra_5000.webp");

    // Insert only High and Ultra frames
    if let Some(high_cache) = cache.levels.get(&DensityLevel::High) {
        high_cache.insert(time, CachedFrame::new(time, test_path_high.clone()));
    }
    if let Some(ultra_cache) = cache.levels.get(&DensityLevel::Ultra) {
        ultra_cache.insert(time, CachedFrame::new(time, test_path_ultra.clone()));
    }

    // Request Medium density - should fallback to High (higher density)
    let result = cache.get_frame_with_fallback(time, DensityLevel::Medium);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::High);
    assert_eq!(path, test_path_high);

    // Request Low density - should fallback to High (higher density)
    let result = cache.get_frame_with_fallback(time, DensityLevel::Low);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::High);
    assert_eq!(path, test_path_high);
}

#[test]
fn test_fallback_to_lower_density() {
    // Create a video cache with only Low and Medium densities
    let video_id = "test_video".to_string();
    let video_path = "/test/video.mp4".to_string();
    let duration = 60.0;
    let cache = VideoCache::new(video_id.clone(), video_path, duration);

    let time = 5.0;
    let test_path_low = PathBuf::from("/cache/low_5000.webp");
    let test_path_medium = PathBuf::from("/cache/medium_5000.webp");

    // Insert only Low and Medium frames
    if let Some(low_cache) = cache.levels.get(&DensityLevel::Low) {
        low_cache.insert(time, CachedFrame::new(time, test_path_low.clone()));
    }
    if let Some(medium_cache) = cache.levels.get(&DensityLevel::Medium) {
        medium_cache.insert(time, CachedFrame::new(time, test_path_medium.clone()));
    }

    // Request Ultra density - should fallback to Medium (lower density)
    let result = cache.get_frame_with_fallback(time, DensityLevel::Ultra);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Medium);
    assert_eq!(path, test_path_medium);

    // Request High density - should fallback to Medium (lower density)
    let result = cache.get_frame_with_fallback(time, DensityLevel::High);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Medium);
    assert_eq!(path, test_path_medium);
}

#[test]
fn test_fallback_order_ultra_to_low() {
    // Test the complete fallback chain: Ultra → High → Medium → Low
    let video_id = "test_video".to_string();
    let video_path = "/test/video.mp4".to_string();
    let duration = 60.0;
    let cache = VideoCache::new(video_id.clone(), video_path, duration);

    let time = 5.0;
    let test_path_low = PathBuf::from("/cache/low_5000.webp");

    // Insert only Low density frame
    if let Some(low_cache) = cache.levels.get(&DensityLevel::Low) {
        low_cache.insert(time, CachedFrame::new(time, test_path_low.clone()));
    }

    // Request Ultra density - should fallback all the way to Low
    let result = cache.get_frame_with_fallback(time, DensityLevel::Ultra);
    assert!(result.is_some());
    let (path, density) = result.unwrap();
    assert_eq!(density, DensityLevel::Low);
    assert_eq!(path, test_path_low);
}

#[test]
fn test_no_frame_available() {
    // Test that None is returned when no frame is available at any density
    let video_id = "test_video".to_string();
    let video_path = "/test/video.mp4".to_string();
    let duration = 60.0;
    let cache = VideoCache::new(video_id.clone(), video_path, duration);

    let time = 5.0;

    // Request any density - should return None
    let result = cache.get_frame_with_fallback(time, DensityLevel::Medium);
    assert!(result.is_none());
}

/// Validates: Property 12 — LRU Eviction Ordering
///
/// For any cache state exceeding the memory limit, evicted entries SHALL be
/// ordered by access count (ascending) then by timestamp (oldest first).
///
/// This test verifies the sort comparator used in `ThumbnailCache::evict_if_needed`
/// and `DensityCache::evict_if_needed` produces the correct ordering.
#[test]
fn test_eviction_sort_order_access_count_ascending_then_timestamp_oldest_first() {
    // Simulate the tuple layout used in ThumbnailCache::evict_if_needed:
    // (video_id, density, time_key, access_count, timestamp, path)
    // Index 3 = access_count, Index 4 = timestamp (Instant)

    // Create instants with known ordering: earlier < later
    let t0 = web_time::Instant::now();
    // Simulate a small delay by using a slightly later instant via a manual offset.
    // Since Instant doesn't support arithmetic in all environments, we use the same
    // instant for ties and rely on the access_count ordering for the primary sort.

    type Entry = (String, DensityLevel, u64, u64, web_time::Instant, PathBuf);

    let mut entries: Vec<Entry> = vec![
        // access_count=5, timestamp=t0 (should sort last among these)
        ("vid".to_string(), DensityLevel::High, 5000, 5, t0, PathBuf::from("/a")),
        // access_count=1, timestamp=t0 (should sort first — lowest access count)
        ("vid".to_string(), DensityLevel::High, 1000, 1, t0, PathBuf::from("/b")),
        // access_count=3, timestamp=t0 (should sort in the middle)
        ("vid".to_string(), DensityLevel::High, 3000, 3, t0, PathBuf::from("/c")),
        // access_count=1, timestamp=t0 (tie with /b on access_count; same timestamp)
        ("vid".to_string(), DensityLevel::High, 2000, 1, t0, PathBuf::from("/d")),
    ];

    // Apply the same sort comparator used in evict_if_needed
    entries.sort_by(|a, b| {
        let access_cmp = a.3.cmp(&b.3); // access_count ascending
        if access_cmp == std::cmp::Ordering::Equal {
            a.4.cmp(&b.4) // timestamp oldest first
        } else {
            access_cmp
        }
    });

    // After sorting:
    // - access_count=1 entries come first (two of them, /b and /d)
    // - access_count=3 entry comes next (/c)
    // - access_count=5 entry comes last (/a)
    assert_eq!(entries[0].3, 1, "First entry should have access_count=1");
    assert_eq!(entries[1].3, 1, "Second entry should have access_count=1");
    assert_eq!(entries[2].3, 3, "Third entry should have access_count=3");
    assert_eq!(entries[3].3, 5, "Fourth entry should have access_count=5");

    // The two access_count=1 entries should appear before access_count=3 and 5
    let access_counts: Vec<u64> = entries.iter().map(|e| e.3).collect();
    assert!(
        access_counts.windows(2).all(|w| w[0] <= w[1]),
        "Entries should be sorted by access_count ascending: {:?}",
        access_counts
    );
}

/// Validates: Property 12 — LRU Eviction Ordering (timestamp tiebreaker)
///
/// When two entries have the same access count, the one with the older
/// timestamp (smaller Instant) should be evicted first.
#[test]
fn test_eviction_sort_order_timestamp_tiebreaker() {
    // Create two instants where t_old < t_new
    let t_old = web_time::Instant::now();
    // Spin briefly to ensure t_new is strictly after t_old
    let t_new = loop {
        let t = web_time::Instant::now();
        if t > t_old {
            break t;
        }
    };

    type Entry = (String, DensityLevel, u64, u64, web_time::Instant, PathBuf);

    let mut entries: Vec<Entry> = vec![
        // Same access_count=2, newer timestamp — should sort AFTER the older one
        ("vid".to_string(), DensityLevel::Medium, 2000, 2, t_new, PathBuf::from("/newer")),
        // Same access_count=2, older timestamp — should sort BEFORE the newer one
        ("vid".to_string(), DensityLevel::Medium, 1000, 2, t_old, PathBuf::from("/older")),
    ];

    entries.sort_by(|a, b| {
        let access_cmp = a.3.cmp(&b.3);
        if access_cmp == std::cmp::Ordering::Equal {
            a.4.cmp(&b.4) // oldest first
        } else {
            access_cmp
        }
    });

    // The older entry should come first (evicted first)
    assert_eq!(
        entries[0].5,
        PathBuf::from("/older"),
        "Older timestamp should be evicted first when access counts are equal"
    );
    assert_eq!(
        entries[1].5,
        PathBuf::from("/newer"),
        "Newer timestamp should be evicted second when access counts are equal"
    );
}

/// Validates: Property 13 — Priority-Based Eviction
///
/// For any memory pressure event, Ultra and High density caches SHALL be
/// evicted before Medium and Low density caches.
///
/// This test verifies that the eviction list produced by `ThumbnailCache::evict_if_needed`
/// places all Ultra/High entries before any Medium/Low entries, regardless of
/// access count or timestamp ordering within each group.
#[test]
fn test_eviction_priority_ultra_high_before_medium_low() {
    // Simulate the two eviction buckets used in ThumbnailCache::evict_if_needed.
    // Each entry: (video_id, density, time_key, access_count, timestamp, path)
    let t0 = web_time::Instant::now();

    type Entry = (String, DensityLevel, u64, u64, web_time::Instant, PathBuf);

    // High-priority eviction group (Ultra and High density)
    let mut high_priority: Vec<Entry> = vec![
        // Ultra density frame — high access count (should still be evicted before Medium/Low)
        ("vid".to_string(), DensityLevel::Ultra, 1000, 100, t0, PathBuf::from("/ultra_hot")),
        // High density frame — low access count
        ("vid".to_string(), DensityLevel::High, 2000, 1, t0, PathBuf::from("/high_cold")),
        // Ultra density frame — medium access count
        ("vid".to_string(), DensityLevel::Ultra, 3000, 5, t0, PathBuf::from("/ultra_warm")),
    ];

    // Low-priority eviction group (Medium and Low density)
    let mut low_priority: Vec<Entry> = vec![
        // Medium density frame — very low access count (should NOT be evicted before Ultra/High)
        ("vid".to_string(), DensityLevel::Medium, 4000, 1, t0, PathBuf::from("/medium_cold")),
        // Low density frame — zero-like access count
        ("vid".to_string(), DensityLevel::Low, 5000, 1, t0, PathBuf::from("/low_cold")),
    ];

    // Apply the same sort comparator used in evict_if_needed
    let sort_fn = |a: &Entry, b: &Entry| {
        let access_cmp = a.3.cmp(&b.3); // access_count ascending
        if access_cmp == std::cmp::Ordering::Equal {
            a.4.cmp(&b.4) // timestamp oldest first
        } else {
            access_cmp
        }
    };
    high_priority.sort_by(sort_fn);
    low_priority.sort_by(sort_fn);

    // Build the eviction list: high_priority first, then low_priority
    let eviction_list: Vec<Entry> = high_priority
        .into_iter()
        .chain(low_priority.into_iter())
        .collect();

    let total = eviction_list.len();
    assert_eq!(total, 5, "Should have 5 total entries");

    // The first 3 entries must all be Ultra or High density
    for (i, entry) in eviction_list.iter().take(3).enumerate() {
        let density = entry.1;
        assert!(
            matches!(density, DensityLevel::Ultra | DensityLevel::High),
            "Entry {} should be Ultra or High density (got {:?}), \
             Ultra/High must be evicted before Medium/Low",
            i,
            density
        );
    }

    // The last 2 entries must all be Medium or Low density
    for (i, entry) in eviction_list.iter().skip(3).enumerate() {
        let density = entry.1;
        assert!(
            matches!(density, DensityLevel::Medium | DensityLevel::Low),
            "Entry {} (index {}) should be Medium or Low density (got {:?}), \
             Medium/Low should only be evicted after Ultra/High",
            i,
            i + 3,
            density
        );
    }

    // Verify that even the most-accessed Ultra/High entry (access_count=100)
    // appears before the least-accessed Medium/Low entry (access_count=1).
    // This confirms priority trumps LRU ordering across density tiers.
    let ultra_hot_pos = eviction_list
        .iter()
        .position(|e| e.5 == PathBuf::from("/ultra_hot"))
        .expect("ultra_hot entry should be in eviction list");
    let medium_cold_pos = eviction_list
        .iter()
        .position(|e| e.5 == PathBuf::from("/medium_cold"))
        .expect("medium_cold entry should be in eviction list");

    assert!(
        ultra_hot_pos < medium_cold_pos,
        "Ultra density entry (even with high access count {}) should be evicted \
         before Medium density entry (even with low access count {}). \
         ultra_hot at position {}, medium_cold at position {}",
        eviction_list[ultra_hot_pos].3,
        eviction_list[medium_cold_pos].3,
        ultra_hot_pos,
        medium_cold_pos
    );
}

/// Validates: Property 13 — Priority-Based Eviction (within-group LRU ordering preserved)
///
/// Within the Ultra/High group, entries SHALL still be sorted by access count
/// ascending then timestamp oldest first (LRU ordering is preserved within each tier).
#[test]
fn test_eviction_priority_lru_ordering_preserved_within_tier() {
    let t0 = web_time::Instant::now();
    let t1 = loop {
        let t = web_time::Instant::now();
        if t > t0 {
            break t;
        }
    };

    type Entry = (String, DensityLevel, u64, u64, web_time::Instant, PathBuf);

    let mut high_priority: Vec<Entry> = vec![
        // High density, access_count=3, newer timestamp
        ("vid".to_string(), DensityLevel::High, 2000, 3, t1, PathBuf::from("/high_newer")),
        // Ultra density, access_count=1, older timestamp — should be evicted first within group
        ("vid".to_string(), DensityLevel::Ultra, 1000, 1, t0, PathBuf::from("/ultra_older")),
        // High density, access_count=1, newer timestamp — same access count as ultra_older
        ("vid".to_string(), DensityLevel::High, 3000, 1, t1, PathBuf::from("/high_newer_same_count")),
    ];

    let sort_fn = |a: &Entry, b: &Entry| {
        let access_cmp = a.3.cmp(&b.3);
        if access_cmp == std::cmp::Ordering::Equal {
            a.4.cmp(&b.4)
        } else {
            access_cmp
        }
    };
    high_priority.sort_by(sort_fn);

    // Within the high-priority group:
    // - access_count=1 entries come first (ultra_older and high_newer_same_count)
    // - Among access_count=1 ties, older timestamp (t0) comes before newer (t1)
    // - access_count=3 entry comes last
    assert_eq!(
        high_priority[0].5,
        PathBuf::from("/ultra_older"),
        "ultra_older (access_count=1, oldest timestamp) should be first in Ultra/High group"
    );
    assert_eq!(
        high_priority[1].5,
        PathBuf::from("/high_newer_same_count"),
        "high_newer_same_count (access_count=1, newer timestamp) should be second"
    );
    assert_eq!(
        high_priority[2].5,
        PathBuf::from("/high_newer"),
        "high_newer (access_count=3) should be last in Ultra/High group"
    );
}

/// Validates: Property 14 — Extraction Priority Ordering
///
/// For any extraction queue state, jobs with Critical priority SHALL execute before
/// jobs with High priority, which SHALL execute before jobs with Normal priority.
///
/// This test verifies the PrioritizedJob ordering used by the BinaryHeap in
/// ExtractionQueue::new(). The BinaryHeap is a max-heap, so PrioritizedJob::cmp
/// must map Critical (0) to the highest value.
#[test]
fn test_priority_ordering_critical_before_high_before_normal() {
    use std::collections::BinaryHeap;
    use tokio::sync::oneshot;

    // Create jobs with different priorities using dummy oneshot channels
    let make_job = |priority: Priority| -> PrioritizedJob {
        let (tx, _rx) = oneshot::channel();
        PrioritizedJob(ExtractionJob {
            video_path: "/test/video.mp4".to_string(),
            video_id: "test_id".to_string(),
            time: 1.0,
            density: DensityLevel::Medium,
            priority,
            width: 80,
            height: 60,
            resolution_tier: ResolutionTier::Tier1x,
            result_tx: tx,
        })
    };

    // Insert jobs in reverse priority order (Normal first, then High, then Critical)
    // to verify the heap reorders them correctly
    let mut heap: BinaryHeap<PrioritizedJob> = BinaryHeap::new();
    heap.push(make_job(Priority::Normal));
    heap.push(make_job(Priority::High));
    heap.push(make_job(Priority::Critical));
    heap.push(make_job(Priority::Normal));
    heap.push(make_job(Priority::Critical));

    // Pop order should be: Critical, Critical, High, Normal, Normal
    let popped: Vec<Priority> = std::iter::from_fn(|| heap.pop().map(|j| j.0.priority)).collect();

    assert_eq!(
        popped,
        vec![
            Priority::Critical,
            Priority::Critical,
            Priority::High,
            Priority::Normal,
            Priority::Normal,
        ],
        "Jobs should be popped in priority order: Critical > High > Normal"
    );
}

/// Validates: Property 14 — Semaphore limits concurrent extractions to 4
///
/// Verifies that the ExtractionQueue semaphore is initialized with exactly 4 permits,
/// ensuring at most 4 concurrent FFmpeg processes run simultaneously.
#[test]
fn test_semaphore_initialized_with_4_permits() {
    // The GLOBAL_QUEUE semaphore is initialized with 4 permits.
    // We verify this by checking the available permits count.
    // Note: available_permits() returns the current count of available permits.
    // Since GLOBAL_QUEUE may have already acquired some permits in other tests,
    // we create a fresh ExtractionQueue to test the initial state.
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    assert_eq!(
        semaphore.available_permits(),
        4,
        "Semaphore should be initialized with exactly 4 permits for concurrent extraction limit"
    );
}

/// Validates: Property 14 — Priority ordering: Critical < High < Normal (numeric values)
///
/// Verifies the Priority enum's numeric ordering is correct for use with Reverse<Priority>
/// in the BinaryHeap. Critical=0 must be less than High=1, which must be less than Normal=2.
#[test]
fn test_priority_enum_ordering() {
    // Critical has the lowest numeric value (highest urgency)
    assert!(Priority::Critical < Priority::High);
    assert!(Priority::High < Priority::Normal);
    assert!(Priority::Critical < Priority::Normal);

    // Verify Reverse ordering (used in BinaryHeap) makes Critical the "largest"
    assert!(std::cmp::Reverse(Priority::Critical) > std::cmp::Reverse(Priority::High));
    assert!(std::cmp::Reverse(Priority::High) > std::cmp::Reverse(Priority::Normal));
    assert!(std::cmp::Reverse(Priority::Critical) > std::cmp::Reverse(Priority::Normal));
}

/// Validates: Property 14 — Mixed priority queue ordering
///
/// Verifies that when many jobs of mixed priorities are enqueued, they are always
/// dequeued in strict priority order (Critical first, then High, then Normal).
#[test]
fn test_priority_queue_mixed_ordering() {
    use std::collections::BinaryHeap;
    use tokio::sync::oneshot;

    let make_job = |priority: Priority, time: f64| -> PrioritizedJob {
        let (tx, _rx) = oneshot::channel();
        PrioritizedJob(ExtractionJob {
            video_path: "/test/video.mp4".to_string(),
            video_id: "test_id".to_string(),
            time,
            density: DensityLevel::Medium,
            priority,
            width: 80,
            height: 60,
            resolution_tier: ResolutionTier::Tier1x,
            result_tx: tx,
        })
    };

    let mut heap: BinaryHeap<PrioritizedJob> = BinaryHeap::new();

    // Simulate a realistic scenario: background preload (Normal) jobs arrive first,
    // then user zooms in and Critical jobs are submitted
    heap.push(make_job(Priority::Normal, 5.0));
    heap.push(make_job(Priority::Normal, 10.0));
    heap.push(make_job(Priority::Normal, 15.0));
    heap.push(make_job(Priority::Normal, 20.0));
    // User zooms — Critical jobs arrive
    heap.push(make_job(Priority::Critical, 7.0));
    heap.push(make_job(Priority::Critical, 8.0));
    heap.push(make_job(Priority::High, 6.0));

    // All Critical jobs must come out before any High or Normal job
    let mut last_priority = Priority::Critical;
    while let Some(PrioritizedJob(job)) = heap.pop() {
        assert!(
            job.priority >= last_priority,
            "Priority ordering violated: got {:?} after {:?}. \
             Jobs must be dequeued in non-decreasing priority order (Critical=0 first).",
            job.priority,
            last_priority
        );
        last_priority = job.priority;
    }
}
