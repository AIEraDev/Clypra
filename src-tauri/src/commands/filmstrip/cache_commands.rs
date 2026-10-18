use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

use crate::commands::filmstrip::artifacts::load_from_atlas;
use crate::filmstrip_engine::decoder::{
    get_decoder, get_preview_decoder, get_preview_decoder_for_stream,
};
use crate::filmstrip_engine::{
    clear_video_thumbnail_cache, get_cache_stats, init_filmstrip_engine, ArtifactSource,
    DensityLevel, FrameContentHash, RenderArtifact, ResolutionTier, SpatialTier, TierCacheKey,
    FRAME_CACHE, GLOBAL_CACHE, TIER_CACHE,
};

/// Global cache statistics for monitoring cache effectiveness
pub static GLOBAL_ATLAS_HITS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
pub static GLOBAL_TIER_CACHE_HITS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
pub static GLOBAL_DECODES: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

#[tauri::command]
pub async fn init_thumbnail_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Initialize cache directory
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;
    init_filmstrip_engine(cache_dir).await
}

#[tauri::command]
pub fn get_thumbnail_cache_stats() -> serde_json::Value {
    get_cache_stats()
}

#[tauri::command]
pub fn get_render_cache_stats() -> serde_json::Value {
    serde_json::json!({
        "atlas_hits": GLOBAL_ATLAS_HITS.load(Ordering::Relaxed),
        "tier_cache_hits": GLOBAL_TIER_CACHE_HITS.load(Ordering::Relaxed),
        "decodes": GLOBAL_DECODES.load(Ordering::Relaxed),
        "total_requests": GLOBAL_ATLAS_HITS.load(Ordering::Relaxed) + GLOBAL_TIER_CACHE_HITS.load(Ordering::Relaxed) + GLOBAL_DECODES.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub async fn clear_thumbnail_cache(video_path: String) {
    clear_video_thumbnail_cache(&video_path).await;
}

/// Retrieve comprehensive statistics on the filmstrip & thumbnail disk cache.
#[tauri::command]
pub async fn get_disk_cache_stats() -> Result<serde_json::Value, String> {
    let limit_bytes = crate::filmstrip_engine::atlas::get_disk_cache_limit();
    let atlas_hits = GLOBAL_ATLAS_HITS.load(Ordering::Relaxed);
    let tier_cache_hits = GLOBAL_TIER_CACHE_HITS.load(Ordering::Relaxed);
    let decodes = GLOBAL_DECODES.load(Ordering::Relaxed);
    let total_reqs = atlas_hits + tier_cache_hits + decodes;
    let hit_rate_pct = if total_reqs > 0 {
        ((atlas_hits + tier_cache_hits) as f64 / total_reqs as f64) * 100.0
    } else {
        0.0
    };

    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => {
            return Ok(serde_json::json!({
                "total_bytes": 0,
                "atlas_count": 0,
                "cache_dir": "",
                "limit_bytes": limit_bytes,
                "atlas_hits": atlas_hits,
                "tier_cache_hits": tier_cache_hits,
                "decodes": decodes,
                "hit_rate_pct": hit_rate_pct,
            }))
        }
    };

    let (total_bytes, atlas_count) =
        crate::filmstrip_engine::atlas::get_disk_cache_stats_from_dir(&cache_dir).await;

    Ok(serde_json::json!({
        "total_bytes": total_bytes,
        "atlas_count": atlas_count,
        "cache_dir": cache_dir.to_string_lossy(),
        "limit_bytes": limit_bytes,
        "atlas_hits": atlas_hits,
        "tier_cache_hits": tier_cache_hits,
        "decodes": decodes,
        "hit_rate_pct": hit_rate_pct,
    }))
}

/// Purge all cached filmstrip atlases from disk and reset in-memory caches.
#[tauri::command]
pub async fn clear_disk_cache() -> Result<usize, String> {
    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Ok(0),
    };

    // Purge disk atlases
    let count = crate::filmstrip_engine::atlas::purge_all_disk_cache(&cache_dir).await?;

    // Clear in-memory caches
    (*FRAME_CACHE).clear();
    (*TIER_CACHE).clear();
    GLOBAL_CACHE.clear().await;

    log::info!(
        "[clear_disk_cache] Cleared {} atlas files and reset in-memory caches.",
        count
    );
    Ok(count)
}

/// Configure the maximum disk cache budget in bytes (0 = unlimited).
#[tauri::command]
pub async fn set_cache_size_limit(limit_bytes: u64) -> Result<(), String> {
    crate::filmstrip_engine::atlas::set_disk_cache_limit(limit_bytes);
    if let Some(cache_dir) = GLOBAL_CACHE.cache_dir().await {
        crate::filmstrip_engine::atlas::prune_disk_cache_if_needed(&cache_dir).await;
    }
    Ok(())
}

/// Get the current disk cache budget in bytes.
#[tauri::command]
pub fn get_cache_size_limit() -> u64 {
    crate::filmstrip_engine::atlas::get_disk_cache_limit()
}

/// Prewarm video decoders for improved first-frame latency.
///
/// Creates decoders in the pool before they're needed, eliminating
/// 50-100ms cold start time on first decode. Run this when:
/// - Project loads (prewarm all timeline videos)
/// - Clips added to timeline (prewarm new videos)
/// - Switching between sequences
///
/// This is non-blocking and runs in the background. Errors are logged
/// but don't fail the operation (graceful degradation).
///
/// Performance impact:
/// - First frame latency: -80% (5-10ms vs 50-100ms)
/// - Better perceived responsiveness
/// - Smoother timeline scrubbing on cold start
///
/// # Arguments
/// * `video_paths` - Absolute paths to video files to prewarm
///
/// # Returns
/// * `Ok(count)` - Number of decoders successfully prewarmed
/// * Never fails - errors are logged and ignored
#[tauri::command]
pub async fn prewarm_decoders(video_paths: Vec<String>) -> Result<usize, String> {
    if video_paths.is_empty() {
        return Ok(0);
    }
    let span = crate::cold_start::SpanGuard::start("c1_prewarm_decoders");

    let mut success_count = 0;

    // Prewarm decoders concurrently (up to 4 at a time to avoid overwhelming system)
    let chunk_size = 4;
    for chunk in video_paths.chunks(chunk_size) {
        let mut handles = vec![];

        for path in chunk {
            let path = path.clone();
            let handle = tokio::spawn(async move {
                if let Some((file_path, stream_id)) = path.split_once("::stream::") {
                    get_preview_decoder_for_stream(file_path, stream_id)
                        .await
                        .is_ok()
                } else {
                    let thumb_ok = get_decoder(&path).await.is_ok();
                    let preview_ok = get_preview_decoder(&path).await.is_ok();
                    thumb_ok || preview_ok
                }
            });
            handles.push(handle);
        }

        // Wait for chunk to complete
        for handle in handles {
            if let Ok(success) = handle.await {
                if success {
                    success_count += 1;
                }
            }
        }
    }

    if success_count > 0 {
        span.finish_ok();
    }
    Ok(success_count)
}

/// Check which coarse-baseline timestamps are already resident in the Rust-side caches.
///
/// Called by the TypeScript FilmstripCache on session restore. Returns `RenderArtifact`
/// items over the channel for every timestamp that is cache-warm (TIER_CACHE or atlas),
/// so the TypeScript layer can populate FilmstripTileCache without issuing decode requests.
/// Timestamps that are cache-cold receive no response — the caller falls through to decode.
#[tauri::command]
pub async fn check_coarse_baseline_cache(
    video_path: String,
    timestamps_ms: Vec<u64>,
    spatial_tier: String,
    effect_graph_version: u32,
    on_artifact: tauri::ipc::Channel<RenderArtifact>,
) -> Result<(), String> {
    use crate::filmstrip_engine::atlas::get_atlas_manager;

    let tier = SpatialTier::from_label(&spatial_tier)
        .map_err(|e| format!("Invalid spatial tier: {}", e))?;
    let (width, height) = tier.dims();

    let video_id = format!("{:x}", md5::compute(&video_path));

    let resolution_tier = if width >= 160 {
        ResolutionTier::Tier2x
    } else {
        ResolutionTier::Tier1x
    };
    let density = DensityLevel::Medium;

    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => {
            // Cache not initialized yet — return empty (all timestamps are cold)
            return Ok(());
        }
    };

    let atlas_manager = get_atlas_manager(&video_id, density, resolution_tier, cache_dir).await;

    for timestamp_ms in timestamps_ms {
        let timestamp_secs = timestamp_ms as f64 / 1000.0;

        let content_hash = FrameContentHash::compute(
            &video_id,
            timestamp_ms,
            effect_graph_version,
            1.0,
            0,
            u64::MAX,
            false,
        );

        let frame_id = format!("{}-{}", content_hash.0, timestamp_ms);

        // Fast path 1: check atlas file (disk-resident, zero-decode)
        {
            let manager = atlas_manager.read().await;
            if let Some(location) = manager.get_location(timestamp_secs) {
                if let Ok(rgba_data) = load_from_atlas(&location, width, height).await {
                    GLOBAL_ATLAS_HITS.fetch_add(1, Ordering::Relaxed);
                    let artifact = RenderArtifact {
                        frame_id: frame_id.clone(),
                        content_hash: content_hash.0.clone(),
                        spatial_tier: tier,
                        rgba_data,
                        width,
                        height,
                        timestamp_ms,
                        source: ArtifactSource::BackendTierCache,
                    };
                    let _ = on_artifact.send(artifact);
                    continue;
                }
            }
        }

        // Fast path 2: check in-memory tier cache (TIER_CACHE — 120MB budget)
        let key = TierCacheKey {
            content_hash: content_hash.clone(),
            tier,
        };
        if let Some(frame) = TIER_CACHE.get(&key) {
            GLOBAL_TIER_CACHE_HITS.fetch_add(1, Ordering::Relaxed);
            let artifact = RenderArtifact {
                frame_id,
                content_hash: content_hash.0.clone(),
                spatial_tier: tier,
                rgba_data: frame.data.clone(),
                width: frame.width,
                height: frame.height,
                timestamp_ms,
                source: ArtifactSource::BackendTierCache,
            };
            let _ = on_artifact.send(artifact);
        }
    }

    Ok(())
}
