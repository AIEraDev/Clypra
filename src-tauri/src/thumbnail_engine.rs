//! Thumbnail engine with multi-resolution cache and atlas-based storage.

pub mod decoder;
pub mod atlas;
pub mod pyramid;
pub mod geometry;

pub mod types;
pub mod cache;
pub mod queue;
pub mod retry;

// Re-export pyramid types at crate level for convenience
pub use pyramid::{
    SpatialTier, FrameContentHash, TierCacheKey, RenderArtifact, ArtifactSource,
    ExtractionProgressEvent, canonical_timestamp, downsample_pyramid, scale_rgba_lanczos,
    FRAME_CACHE, TIER_CACHE, IN_FLIGHT_TIER, tier_inflight_key,
};

// Re-export new submodule types at crate level for convenience
pub use types::{
    ExtractionError, ThumbnailTile, AtlasCoords, ResolutionTier, DensityLevel, Priority, CacheKey,
};

pub use cache::{
    CachedFrame, DensityCache, VideoCache, ThumbnailCache, GLOBAL_CACHE,
    get_video_cache, clear_video_thumbnail_cache, get_cache_stats,
};

pub use queue::{
    ExtractionJob, BatchExtractionRequest, ExtractionQueue, GLOBAL_QUEUE,
    ActiveExtractionTracker, ACTIVE_TRACKER, request_thumbnail, request_batch_thumbnails,
    preload_density_level, generate_timestamp_grid, PrioritizedJob,
};

pub use retry::{extract_frame, extract_with_retry};

/// Initialize the thumbnail system
pub async fn init_thumbnail_engine(app_cache_dir: std::path::PathBuf) -> Result<(), String> {
    GLOBAL_CACHE.init_cache_dir(app_cache_dir).await
}
