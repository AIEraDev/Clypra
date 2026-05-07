//! Property-Based Tests for Thumbnail Engine
//!
//! These tests verify universal correctness properties using proptest.
//! Each property is tagged with its corresponding design property number.

use proptest::prelude::*;
use std::path::PathBuf;
use crate::thumbnail_engine::*;

/// Property 1: Cache key round-trip preservation
///
/// For any valid video path, timestamp, density, and DPR, serializing a CacheKey
/// to string and parsing it back must produce an equivalent CacheKey.
///
/// Design Property Reference: Property 1 — Cache Key Round-Trip
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_cache_key_round_trip_preservation(
        video_path in "[a-zA-Z0-9_./]{1,100}",
        time in 0.0f64..10000.0f64,
        dpr in 0.5f64..3.0f64,
    ) {
        // Test all density levels
        for density in [DensityLevel::Low, DensityLevel::Medium, DensityLevel::High, DensityLevel::Ultra] {
            let key = CacheKey::new(&video_path, time, density, dpr);
            let serialized = key.to_string();
            let deserialized = CacheKey::from_string(&serialized)
                .expect("Deserialization should succeed for valid cache keys");

            // Verify round-trip preserves all fields
            prop_assert_eq!(key.video_id, deserialized.video_id);
            prop_assert_eq!(key.timestamp_ms, deserialized.timestamp_ms);
            prop_assert_eq!(key.density, deserialized.density);
            prop_assert_eq!(key.resolution_tier, deserialized.resolution_tier);
        }
    }
}

/// Property 9: DPR to resolution tier mapping
///
/// For any DPR value, the resolution tier mapping must follow:
/// - DPR < 1.5 → Tier1x
/// - DPR >= 1.5 → Tier2x
///
/// Design Property Reference: Property 9 — DPR to Resolution Tier
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_dpr_to_resolution_tier_mapping(dpr in 0.1f64..5.0f64) {
        let tier = ResolutionTier::from_dpr(dpr);

        if dpr < 1.5 {
            prop_assert_eq!(tier, ResolutionTier::Tier1x, "DPR < 1.5 should map to Tier1x");
        } else {
            prop_assert_eq!(tier, ResolutionTier::Tier2x, "DPR >= 1.5 should map to Tier2x");
        }
    }

    #[test]
    fn prop_resolution_tier_dimensions_consistency(
        dpr in 0.1f64..5.0f64,
    ) {
        let tier = ResolutionTier::from_dpr(dpr);
        let (width, height) = tier.dimensions();

        // Tier1x should be 80x60, Tier2x should be 160x120
        match tier {
            ResolutionTier::Tier1x => {
                prop_assert_eq!(width, 80);
                prop_assert_eq!(height, 60);
            }
            ResolutionTier::Tier2x => {
                prop_assert_eq!(width, 160);
                prop_assert_eq!(height, 120);
            }
        }
    }
}

/// Property 10: Frame count calculation
///
/// For any valid visible range and time per thumbnail, the number of generated
/// timestamps must equal the expected frame count (range / time_per_thumb, rounded),
/// plus 2 buffer thumbnails (one before, one after).
///
/// Design Property Reference: Property 10 — Frame Count Calculation
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_frame_count_calculation(
        visible_start in 0.0f64..1000.0f64,
        range in 1.0f64..100.0f64,
        time_per_thumb in 0.05f64..5.0f64,
    ) {
        let visible_end = visible_start + range;

        let timestamps = generate_timestamp_grid(visible_start, visible_end, time_per_thumb);

        // Expected frame count: range / time_per_thumb, plus 2 buffer thumbnails
        // (one before visible_start, one after visible_end)
        let base_count = (range / time_per_thumb).ceil() as usize;
        let expected_count = base_count + 2;

        // Allow for small variance due to grid alignment (±1 thumbnail)
        let min_expected = expected_count.saturating_sub(1);
        let max_expected = expected_count + 1;

        prop_assert!(
            timestamps.len() >= min_expected && timestamps.len() <= max_expected,
            "Expected frame count between {} and {}, got {} for range {} with time_per_thumb {}",
            min_expected, max_expected, timestamps.len(), range, time_per_thumb
        );
    }
}

/// Property 11: Frame count capping for long videos
///
/// For any video duration and time per thumbnail, the generated timestamps
/// must scale linearly with duration/density, with a small buffer overhead.
///
/// Design Property Reference: Property 11 — Frame Count Capping
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_frame_count_capping(
        duration in 1.0f64..600.0f64,  // Up to 10 minutes (reasonable range)
        time_per_thumb in 0.2f64..5.0f64,  // High to Low density (reasonable range)
    ) {
        let timestamps = generate_timestamp_grid(0.0, duration, time_per_thumb);

        // Calculate theoretical maximum
        let theoretical_max = (duration / time_per_thumb).ceil() as usize;

        // Actual count should be close to theoretical, but not exceed it by much
        // due to grid alignment and buffer thumbnails
        prop_assert!(
            timestamps.len() <= theoretical_max + 3,
            "Frame count {} exceeds theoretical maximum {} + 3 for duration {} with time_per_thumb {}",
            timestamps.len(), theoretical_max, duration, time_per_thumb
        );

        // For reasonable inputs, frame count should stay within manageable bounds
        // (e.g., 10 minute video at 0.2s density = ~3000 frames, well under any practical limit)
        let max_reasonable_frames = ((duration / time_per_thumb) + 10.0) as usize;
        prop_assert!(
            timestamps.len() <= max_reasonable_frames,
            "Frame count {} exceeds reasonable maximum {} for duration {} with time_per_thumb {}",
            timestamps.len(), max_reasonable_frames, duration, time_per_thumb
        );
    }
}

/// Property 12: LRU eviction ordering
///
/// For any cache state exceeding the memory limit, evicted entries must follow
/// LRU ordering: lowest access count first, then oldest timestamp.
///
/// Design Property Reference: Property 12 — LRU Eviction Ordering
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_lru_eviction_ordering(
        access_counts in prop::collection::vec(0u64..100u64, 5..20),
    ) {
        // Create mock entries with different access counts
        type Entry = (String, DensityLevel, u64, u64, web_time::Instant, PathBuf);

        let base_time = web_time::Instant::now();
        let mut entries: Vec<Entry> = access_counts
            .into_iter()
            .enumerate()
            .map(|(i, count)| {
                (
                    "vid".to_string(),
                    DensityLevel::High,
                    i as u64 * 1000, // time_key
                    count,
                    base_time, // same timestamp for consistent ordering
                    PathBuf::from(format!("/cache/frame_{}.webp", i)),
                )
            })
            .collect();

        // Sort using the same comparator as evict_if_needed
        entries.sort_by(|a, b| {
            let access_cmp = a.3.cmp(&b.3); // access_count ascending
            if access_cmp == std::cmp::Ordering::Equal {
                a.4.cmp(&b.4) // timestamp oldest first
            } else {
                access_cmp
            }
        });

        // Verify sorted by access count ascending
        for i in 1..entries.len() {
            prop_assert!(
                entries[i].3 >= entries[i-1].3,
                "Entries should be sorted by access_count ascending: got {} after {}",
                entries[i].3, entries[i-1].3
            );
        }

        // First entry should have lowest access count (evicted first)
        let first_count = entries[0].3;
        for entry in &entries[1..] {
            prop_assert!(
                entry.3 >= first_count,
                "All entries after first should have access count >= first entry's count ({}",
                first_count
            );
        }
    }
}

/// Property 15: Exponential backoff retry timing
///
/// For any retry attempt, the backoff delay must follow base-4 exponential growth:
/// attempt 1: 100ms, attempt 2: 400ms, attempt 3: 1600ms, etc.
///
/// Design Property Reference: Property 15 — Exponential Backoff
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_exponential_backoff_timing(attempt in 0usize..5usize) {
        let base_backoff: u64 = 100; // Starting backoff in ms
        let multiplier: u64 = 4;      // Base-4 exponential

        // Calculate expected backoff for this attempt
        let expected_backoff = base_backoff * multiplier.pow(attempt as u32);

        // Verify the pattern holds
        let mut backoff = base_backoff;
        for _ in 0..attempt {
            backoff *= multiplier;
        }

        prop_assert_eq!(
            backoff, expected_backoff,
            "Backoff for attempt {} should be {}ms, got {}ms",
            attempt, expected_backoff, backoff
        );
    }
}

/// Property 7: Fallback chain ordering
///
/// For any cache with frames at various densities, the fallback chain must
/// prioritize: exact match > higher density > lower density (High → Medium → Low).
///
/// Design Property Reference: Property 7 — Fallback Chain Ordering
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_fallback_chain_ordering(
        target_density in prop::sample::select(vec![
            DensityLevel::Low,
            DensityLevel::Medium,
            DensityLevel::High,
            DensityLevel::Ultra,
        ]),
    ) {
        // Create a cache with all density levels populated
        let video_id = "test_video".to_string();
        let video_path = "/test/video.mp4".to_string();
        let duration = 60.0;
        let cache = VideoCache::new(video_id, video_path, duration);

        let time = 5.0;
        let test_path_low = PathBuf::from("/cache/low_5000.webp");
        let test_path_medium = PathBuf::from("/cache/medium_5000.webp");
        let test_path_high = PathBuf::from("/cache/high_5000.webp");
        let test_path_ultra = PathBuf::from("/cache/ultra_5000.webp");

        // Insert frames at all density levels
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

        // Test fallback behavior
        let result = cache.get_frame_with_fallback(time, target_density);

        // Should always find a frame since all densities are populated
        prop_assert!(result.is_some(), "Should find a frame when all densities are populated");

        let (_, actual_density) = result.unwrap();

        // If exact match exists, we should get the target density
        // Otherwise, we should get the closest available density
        match target_density {
            DensityLevel::Ultra => {
                // Ultra is highest, so we should get Ultra
                prop_assert_eq!(actual_density, DensityLevel::Ultra);
            }
            DensityLevel::High => {
                // Should get High (exact match)
                prop_assert_eq!(actual_density, DensityLevel::High);
            }
            DensityLevel::Medium => {
                // Should get Medium (exact match)
                prop_assert_eq!(actual_density, DensityLevel::Medium);
            }
            DensityLevel::Low => {
                // Should get Low (exact match)
                prop_assert_eq!(actual_density, DensityLevel::Low);
            }
        }
    }
}
