#[cfg(test)]
mod tests {
    use super::super::cache::BackendTierCache;
    use super::super::downsample::{aspect_preserving_tier_dims, downsample_pyramid};
    use super::super::frame::{RawRgbaFrame, TierRgbaFrame};
    use super::super::hash::{FrameContentHash, TierCacheKey};
    use super::super::tiers::SpatialTier;
    use std::sync::Arc;

    fn solid_rgba(width: u32, height: u32) -> Vec<u8> {
        vec![128; (width * height * 4) as usize]
    }

    fn assert_aspect_close(width: u32, height: u32, expected: f64) {
        let actual = width as f64 / height as f64;
        assert!(
            (actual - expected).abs() < 0.03,
            "aspect {}x{} = {}, expected {}",
            width,
            height,
            actual,
            expected
        );
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_landscape_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1920, 1080, SpatialTier::L2);

        assert_eq!((width, height), (320, 180));
        assert_aspect_close(width, height, 16.0 / 9.0);
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_portrait_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1080, 1920, SpatialTier::L2);

        assert_eq!((width, height), (180, 320));
        assert_ne!((width, height), SpatialTier::L2.dims());
        assert_aspect_close(width, height, 9.0 / 16.0);
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_square_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1000, 1000, SpatialTier::L1);

        assert_eq!((width, height), (240, 240));
        assert_aspect_close(width, height, 1.0);
    }

    #[test]
    fn downsample_pyramid_reports_actual_aspect_preserved_dimensions() {
        ffmpeg_next::init().expect("ffmpeg init");
        let raw = RawRgbaFrame::new(solid_rgba(18, 32), 18, 32);
        let results = downsample_pyramid(&raw, &[SpatialTier::L0]);
        let frame = results
            .into_iter()
            .next()
            .expect("tier result")
            .1
            .expect("downsample result");

        assert_eq!((frame.width, frame.height), (92, 160));
        assert_eq!(frame.data.len(), (frame.width * frame.height * 4) as usize);
        assert_aspect_close(frame.width, frame.height, 18.0 / 32.0);
    }

    #[test]
    fn tier_cache_replace_does_not_double_count_bytes() {
        let cache = BackendTierCache::new();
        let hash = FrameContentHash::compute("vid", 1000, 1, 1.0, 0, u64::MAX, false);
        let key = TierCacheKey {
            content_hash: hash,
            tier: SpatialTier::L2,
        };
        cache.insert(
            key.clone(),
            Arc::new(TierRgbaFrame::new(vec![0; 400], 10, 10, SpatialTier::L2)),
        );
        cache.insert(
            key,
            Arc::new(TierRgbaFrame::new(vec![1; 400], 10, 10, SpatialTier::L2)),
        );
        assert_eq!(cache.current_bytes_for_test(), 400);
    }

    #[test]
    fn tier_cache_evicts_dense_tiers_before_l0() {
        let cache = BackendTierCache::new();
        let l0_key = TierCacheKey {
            content_hash: FrameContentHash::compute("vid", 0, 1, 1.0, 0, u64::MAX, false),
            tier: SpatialTier::L0,
        };
        let l2_key = TierCacheKey {
            content_hash: FrameContentHash::compute("vid", 1000, 1, 1.0, 0, u64::MAX, false),
            tier: SpatialTier::L2,
        };
        cache.insert(
            l0_key.clone(),
            Arc::new(TierRgbaFrame::new(vec![0; 800], 10, 20, SpatialTier::L0)),
        );
        cache.insert(
            l2_key.clone(),
            Arc::new(TierRgbaFrame::new(vec![0; 800], 10, 20, SpatialTier::L2)),
        );
        cache.evict_down_to_for_test(800);
        assert!(cache.contains(&l0_key));
        assert!(!cache.contains(&l2_key));
    }
}
