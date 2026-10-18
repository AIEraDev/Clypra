//! Filmstrip engine — multi-resolution timeline tile streaming, atlas-backed spatial pyramid,
//! and seek-optimised frame decoding for the Clypra NLE timeline.
//!
//! # Subsystem Architecture
//! - `decoder/`      — FFmpeg-based video decoding with VideoToolbox HW acceleration
//! - `pyramid/`      — Multi-tier spatial downsampling (L0 → L3) driven by timeline zoom
//! - `atlas/`        — 2D texture atlas packer for timeline tile sheets
//! - `stream_actor/` — Async actor streaming frames during scrub \& playback
//! - `mmap_cache/`   — Memory-mapped on-disk tile cache for zero-latency reuse
//!
//! # Naming Note
//! This subsystem was previously named `thumbnail_engine`. A *thumbnail* is a single
//! poster frame for a media asset (see `commands::filmstrip::poster`). The timeline
//! tile stream is architecturally distinct: it is a continuous, zoom-driven, spatially
//! pyramidal renderer — a *filmstrip engine*.

pub mod atlas;
pub mod decoder;
pub mod demuxer;
pub mod geometry;
pub mod pyramid;
pub mod stream_actor;

pub mod cache;
pub mod metrics;
pub mod mmap_cache;
pub mod queue;
pub mod retry;
pub mod types;

pub use mmap_cache::MmapFrameCache;

#[cfg(test)]
mod proptest;
#[cfg(test)]
mod stress_test;
#[cfg(test)]
mod tests;

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

/// Initialize the filmstrip tile engine (atlas, disk cache, global queue).
pub async fn init_filmstrip_engine(app_cache_dir: std::path::PathBuf) -> Result<(), String> {
    GLOBAL_CACHE.init_cache_dir(app_cache_dir).await
}
