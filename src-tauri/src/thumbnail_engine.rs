//! Thumbnail engine with multi-resolution cache and atlas-based storage.

pub mod atlas;
pub mod decoder;
pub mod geometry;
pub mod pyramid;

pub mod cache;
pub mod queue;
pub mod retry;
pub mod types;

// Re-export pyramid types at crate level for convenience
pub use pyramid::{
    canonical_timestamp, downsample_pyramid, scale_rgba_lanczos, tier_inflight_key, ArtifactSource,
    ExtractionProgressEvent, FrameContentHash, RenderArtifact, SpatialTier, TierCacheKey,
    FRAME_CACHE, IN_FLIGHT_TIER, TIER_CACHE,
};

// Re-export new submodule types at crate level for convenience
pub use types::{
    AtlasCoords, CacheKey, DensityLevel, ExtractionError, Priority, ResolutionTier, ThumbnailTile,
};

pub use cache::{
    clear_video_thumbnail_cache, get_cache_stats, get_video_cache, CachedFrame, DensityCache,
    ThumbnailCache, VideoCache, GLOBAL_CACHE,
};

pub use queue::{
    generate_timestamp_grid, preload_density_level, request_batch_thumbnails, request_thumbnail,
    ActiveExtractionTracker, BatchExtractionRequest, ExtractionJob, ExtractionQueue,
    PrioritizedJob, ACTIVE_TRACKER, GLOBAL_QUEUE,
};

pub use retry::{extract_frame, extract_with_retry};

/// Initialize the thumbnail system
pub async fn init_thumbnail_engine(app_cache_dir: std::path::PathBuf) -> Result<(), String> {
    GLOBAL_CACHE.init_cache_dir(app_cache_dir).await
}
