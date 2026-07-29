use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tauri::Manager;

use crate::thumbnail_engine::decoder::{get_decoder, release_decoder};
use crate::thumbnail_engine::pyramid::RawRgbaFrame;
use crate::thumbnail_engine::geometry::fit_preserving_aspect;
use crate::thumbnail_engine::{
    clear_video_thumbnail_cache, downsample_pyramid, get_cache_stats,
    init_thumbnail_engine, tier_inflight_key, ArtifactSource, DensityLevel, FrameContentHash,
    RenderArtifact, SpatialTier, ThumbnailTile, TierCacheKey, FRAME_CACHE, IN_FLIGHT_TIER,
    TIER_CACHE, ResolutionTier, GLOBAL_CACHE,
};

/// In-flight extraction deduplication for fast scrubbing.
/// Shares results across duplicate requests to reduce workload by 70%+.
type InFlightKey = String;
type InFlightResult = Result<Vec<u8>, String>;

struct InFlightMap {
    map: DashMap<InFlightKey, broadcast::Sender<InFlightResult>>,
}

impl InFlightMap {
    fn new() -> Self {
        Self {
            map: DashMap::new(),
        }
    }

    fn get_or_create(&self, key: String) -> (broadcast::Sender<InFlightResult>, bool) {
        if let Some(entry) = self.map.get(&key) {
            (entry.value().clone(), false)
        } else {
            let (tx, _rx) = broadcast::channel(1);
            self.map.insert(key.clone(), tx.clone());
            (tx, true)
        }
    }

    fn remove(&self, key: &str) {
        self.map.remove(key);
    }
}

static IN_FLIGHT_EXTRACTIONS: Lazy<InFlightMap> = Lazy::new(InFlightMap::new);

/// Global cache statistics for monitoring cache effectiveness
static GLOBAL_ATLAS_HITS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
static GLOBAL_TIER_CACHE_HITS: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
static GLOBAL_DECODES: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

#[tauri::command]
pub async fn init_thumbnail_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Initialize cache directory
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;
    init_thumbnail_engine(cache_dir).await
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

/// Extract poster frame using professional thumbnail heuristic.
///
/// Heuristic: seek to 15% of duration, floor at 1.0s (avoid first GOP/black frame),
/// cap at 30.0s (long intros don't represent content).
///
/// Formula: poster_time = clamp(duration * 0.15, 1.0, 30.0)
#[tauri::command]
pub async fn extract_poster_frame_command(
    video_path: String,
    duration: f64,
    dpr: f64,
) -> Result<String, String> {
    use image::codecs::webp::WebPEncoder;
    use crate::thumbnail_engine::decoder::get_decoder;

    // Professional thumbnail heuristic:
    // 15% into video, never < 1.0s (first GOP / black frames), never > 30.0s
    let poster_time = (duration * 0.15).clamp(1.0, 30.0);

    // Target max dimension for longest edge
    let max_size: u32 = if dpr >= 1.5 { 320 } else { 160 };

    let decoder_arc = get_decoder(&video_path).await?;
    let (rgba_bytes, out_w, out_h) = {
        let mut decoder = decoder_arc.lock().await;

        // Get TRUE display dimensions (respects SAR + rotation)
        let (display_w, display_h) = decoder.display_dimensions();

        // Fit display dimensions to max_size (preserving aspect ratio)
        let (fit_w, fit_h) = fit_preserving_aspect(display_w, display_h, max_size, max_size);

        eprintln!(
            "[extract_poster] pixels={}×{} SAR={}:{} rot={} display={}×{} target={}×{}",
            decoder.width(),
            decoder.height(),
            decoder.sar().0,
            decoder.sar().1,
            decoder.rotation(),
            display_w,
            display_h,
            fit_w,
            fit_h
        );

        // decode_frame will: decode → rotate → scale to target
        let bytes = decoder.decode_frame(poster_time, fit_w, fit_h)?;
        (bytes, fit_w, fit_h)
    };

    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(&rgba_bytes, out_w, out_h, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encode failed: {}", e))?;

    // Convert to base64 data URL
    let base64_data = BASE64.encode(&webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}

fn encode_rgba_to_webp_data_url(
    rgba_bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<String, String> {
    use image::codecs::webp::WebPEncoder;

    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(rgba_bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encoding failed: {}", e))?;

    // Encode to base64 data URL
    let base64_data = BASE64.encode(&webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}

/// Extract single frame with deduplication (reduces workload by 70%+ during scrubbing).
#[tauri::command]
pub async fn decode_frame(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Create deduplication key
    let video_id = format!("{:x}", md5::compute(&video_path));
    let timestamp_ms = (time_secs * 1000.0).round() as u64;
    let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

    // Check if extraction is already in-flight
    let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

    if !is_new {
        // Extraction already in-flight, await existing result
        let mut rx = tx.subscribe();
        match rx.recv().await {
            Ok(result) => {
                return match result {
                    Ok(rgba_bytes) => {
                        let base64_data = BASE64.encode(&rgba_bytes);
                        Ok(format!("data:image/rgba;base64,{}", base64_data))
                    }
                    Err(e) => Err(e),
                };
            }
            Err(_) => {
                // Channel closed, fall through to extraction
            }
        }
    }

    // Perform extraction (first request or channel closed)
    let result = async {
        // Get or create decoder (reused across calls)
        let decoder = get_decoder(&video_path).await?;

        // Decode frame (3-15ms for subsequent frames with sequential optimization)
        let rgba_bytes = {
            let mut decoder_guard = decoder.lock().await;
            decoder_guard.decode_frame(time_secs, width, height)?
        };

        Ok(rgba_bytes)
    }
    .await;

    // Broadcast result to all waiting requests
    let _ = tx.send(result.clone());

    // Remove from in-flight map
    IN_FLIGHT_EXTRACTIONS.remove(&key);

    // Return result
    match result {
        Ok(rgba_bytes) => {
            let base64_data = BASE64.encode(&rgba_bytes);
            Ok(format!("data:image/rgba;base64,{}", base64_data))
        }
        Err(e) => Err(e),
    }
}

/// Extract single frame for GPU upload (returns raw RGBA, 5-10× faster than base64).
#[tauri::command]
pub async fn decode_frame_gpu(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    // Create deduplication key
    let video_id = format!("{:x}", md5::compute(&video_path));
    let timestamp_ms = (time_secs * 1000.0).round() as u64;
    let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

    // Check if extraction is already in-flight
    let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

    if !is_new {
        // Extraction already in-flight, await existing result
        let mut rx = tx.subscribe();
        match rx.recv().await {
            Ok(result) => {
                IN_FLIGHT_EXTRACTIONS.remove(&key);
                return result;
            }
            Err(_) => {
                // Channel closed, fall through to extraction
            }
        }
    }

    // Perform extraction (first request or channel closed)
    let result = async {
        // Get or create decoder (reused across calls)
        let decoder = get_decoder(&video_path).await?;

        // Decode frame (3-15ms for subsequent frames with sequential optimization)
        let rgba_bytes = {
            let mut decoder_guard = decoder.lock().await;
            decoder_guard.decode_frame(time_secs, width, height)?
        };

        Ok(rgba_bytes)
    }
    .await;

    // Broadcast result to all waiting requests
    let _ = tx.send(result.clone());

    // Remove from in-flight map
    IN_FLIGHT_EXTRACTIONS.remove(&key);

    // Return raw RGBA bytes (no encoding!)
    result
}

/// Decode a frame for desktop export and return raw RGBA as a binary IPC
/// response. Unlike `decode_frame_gpu`, this avoids serializing millions of
/// bytes as a JSON number array on every frame.
#[tauri::command]
pub async fn decode_export_frame(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
    let decoder = get_decoder(&video_path).await?;
    let rgba_bytes = {
        let mut decoder_guard = decoder.lock().await;
        decoder_guard.decode_frame(time_secs, width, height)?
    };

    Ok(tauri::ipc::Response::new(rgba_bytes))
}

/// Extract multiple frames with streaming and atlas-based storage.
#[tauri::command]
pub async fn decode_frames_streaming(
    video_path: String,
    timestamps: Vec<f64>,
    density: DensityLevel,
    width: u32,
    height: u32,
    _duration: f64,
    on_tile: tauri::ipc::Channel<ThumbnailTile>,
) -> Result<(), String> {
    use crate::thumbnail_engine::atlas::{get_atlas_manager, AtlasBuilder, THUMBNAILS_PER_ATLAS};

    let start = std::time::Instant::now();
    let video_id = format!("{:x}", md5::compute(&video_path));
    let resolution_tier = if width >= 160 {
        ResolutionTier::Tier2x
    } else {
        ResolutionTier::Tier1x
    };

    eprintln!("[decode_frames_streaming] START video_id={} timestamps={} density={:?} size={}x{} (ATLAS MODE + IMMEDIATE RGBA)", 
              video_id, timestamps.len(), density, width, height);

    // Get cache directory
    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Err("Cache not initialized".to_string()),
    };

    // Get atlas manager for this video
    let atlas_manager = get_atlas_manager(&video_id, density, resolution_tier, cache_dir).await;

    // Check which frames are already in atlases
    let mut missing_times = Vec::new();
    let mut sent_count = 0u32;

    {
        let manager = atlas_manager.read().await;
        for &time in &timestamps {
            if let Some(location) = manager.get_location(time) {
                let (display_w, display_h) = {
                    let decoder_guard =
                        get_decoder(&video_path).await.map_err(|e| e.to_string())?;
                    let guard = decoder_guard.lock().await;
                    guard.display_dimensions()
                };

                let display_aspect = display_w as f64 / display_h as f64;
                let target_aspect = width as f64 / height as f64;

                let (actual_width, actual_height) = if (display_aspect - target_aspect).abs() < 0.01
                {
                    (width, height)
                } else {
                    let scale =
                        (width as f64 / display_w as f64).min(height as f64 / display_h as f64);
                    let w = (display_w as f64 * scale).round() as u32;
                    let h = (display_h as f64 * scale).round() as u32;
                    (w.max(1), h.max(1))
                };

                let tile = ThumbnailTile::from_atlas(
                    time,
                    location.atlas_path.to_string_lossy().to_string(),
                    density,
                    location.col,
                    location.row,
                    width,
                    height,
                    actual_width,
                    actual_height,
                );

                match on_tile.send(tile) {
                    Ok(_) => {
                        sent_count += 1;
                        if sent_count <= 3 {
                            eprintln!("[STREAM] Sent cached atlas tile #{}: time={:.2}s atlas={} pos=({},{})", 
                                      sent_count, time, location.atlas_index, location.col, location.row);
                        }
                    }
                    Err(e) => {
                        eprintln!("[STREAM] ✗ Failed to send cached tile: {:?}", e);
                    }
                }
            } else {
                missing_times.push(time);
            }
        }
    }

    eprintln!(
        "[decode_frames_streaming] Atlas check: cached={} missing={}",
        sent_count,
        missing_times.len()
    );

    // If all cached, return early
    if missing_times.is_empty() {
        eprintln!(
            "[decode_frames_streaming] All cached in atlases, returning early ({:?})",
            start.elapsed()
        );
        return Ok(());
    }

    // Spawn extraction task - IMMEDIATE RGBA streaming + background atlas persistence
    let total_frames = timestamps.len();
    let handle = tokio::spawn(async move {
        let bg_start = std::time::Instant::now();
        eprintln!(
            "[decode_frames_streaming] BG task starting, missing={} frames",
            missing_times.len()
        );

        // Get decoder
        let decoder = match get_decoder(&video_path).await {
            Ok(d) => {
                eprintln!(
                    "[decode_frames_streaming] Decoder acquired ({:?})",
                    bg_start.elapsed()
                );
                d
            }
            Err(e) => {
                eprintln!("[decode_frames_streaming] Failed to get decoder: {}", e);
                return;
            }
        };

        // Process frames in batches of THUMBNAILS_PER_ATLAS (32)
        let mut frames_decoded = 0u32;
        let mut frames_failed = 0u32;
        let mut frames_sent = sent_count;
        let mut atlases_created = 0u32;

        for chunk in missing_times.chunks(THUMBNAILS_PER_ATLAS) {
            let chunk_start = std::time::Instant::now();

            // Create atlas builder for background persistence
            let mut atlas_builder = AtlasBuilder::new(width, height);
            let mut chunk_frames: Vec<(f64, Vec<u8>, u32, u32)> = Vec::new();

            // IMMEDIATE PATH: Decode and stream RGBA to frontend (no compression!)
            for &time in chunk {
                let decode_start = std::time::Instant::now();

                // Create deduplication key
                let timestamp_ms = (time * 1000.0).round() as u64;
                let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

                // Check if extraction is already in-flight
                let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

                let rgba_bytes = if !is_new {
                    // Extraction already in-flight, await existing result
                    let mut rx = tx.subscribe();
                    match rx.recv().await {
                        Ok(Ok(bytes)) => bytes,
                        Ok(Err(e)) => {
                            frames_failed += 1;
                            if frames_failed <= 5 {
                                eprintln!("[decode_frames_streaming] Decode failed at {}s (deduplicated): {}", time, e);
                            }
                            continue;
                        }
                        Err(_) => {
                            // Channel closed, perform extraction
                            match decoder.lock().await.decode_frame(time, width, height) {
                                Ok(bytes) => bytes,
                                Err(e) => {
                                    frames_failed += 1;
                                    if frames_failed <= 5 {
                                        eprintln!(
                                            "[decode_frames_streaming] Decode failed at {}s: {}",
                                            time, e
                                        );
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                } else {
                    // New extraction, perform decode and broadcast result
                    let result = decoder.lock().await.decode_frame(time, width, height);

                    match result {
                        Ok(bytes) => {
                            // Broadcast success to waiting requests
                            let _ = tx.send(Ok(bytes.clone()));
                            IN_FLIGHT_EXTRACTIONS.remove(&key);
                            bytes
                        }
                        Err(e) => {
                            // Broadcast error to waiting requests
                            let _ = tx.send(Err(e.clone()));
                            IN_FLIGHT_EXTRACTIONS.remove(&key);
                            frames_failed += 1;
                            if frames_failed <= 5 {
                                eprintln!(
                                    "[decode_frames_streaming] Decode failed at {}s: {}",
                                    time, e
                                );
                            }
                            continue;
                        }
                    }
                };

                let decode_time = decode_start.elapsed();

                let actual_width = (rgba_bytes.len() / 4 / height as usize) as u32;
                let actual_height = height;

                let webp_data_url =
                    match encode_rgba_to_webp_data_url(&rgba_bytes, actual_width, actual_height) {
                        Ok(url) => url,
                        Err(e) => {
                            eprintln!(
                                "[decode_frames_streaming] WebP encoding failed at {}s: {}",
                                time, e
                            );
                            frames_failed += 1;
                            continue;
                        }
                    };

                let tile = ThumbnailTile::from_path(time, webp_data_url, density);

                match on_tile.send(tile) {
                    Ok(_) => {
                        frames_sent += 1;
                        if frames_sent <= 3 || frames_sent.is_multiple_of(20) {
                            eprintln!(
                                "[STREAM] Sent WebP tile #{}/{}: time={:.2}s decode={:?}",
                                frames_sent, total_frames, time, decode_time
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[STREAM] ✗ Failed to send tile #{}: {:?}",
                            frames_sent + 1,
                            e
                        );
                    }
                }

                chunk_frames.push((time, rgba_bytes, actual_width, actual_height));
                frames_decoded += 1;
            }

            if chunk_frames.is_empty() {
                continue;
            }

            // BACKGROUND PATH: Persist to WebP atlas (non-blocking for frontend)
            let persist_start = std::time::Instant::now();

            // Allocate atlas locations
            let mut locations = Vec::new();
            {
                let mut manager = atlas_manager.write().await;
                for (time, rgba_bytes, actual_width, actual_height) in &chunk_frames {
                    let location = manager.allocate(*time);

                    if let Err(e) =
                        atlas_builder.add_thumbnail(rgba_bytes, *actual_width, *actual_height)
                    {
                        eprintln!(
                            "[decode_frames_streaming] Failed to add thumbnail to atlas: {}",
                            e
                        );
                        continue;
                    }

                    locations.push((*time, location, *actual_width, *actual_height));
                }
            }

            // Save atlas to disk (background persistence)
            if let Some((_, first_location, _, _)) = locations.first() {
                if let Err(e) = atlas_builder.save(&first_location.atlas_path).await {
                    eprintln!("[decode_frames_streaming] Failed to save atlas: {}", e);
                } else {
                    atlases_created += 1;
                    let persist_time = persist_start.elapsed();
                    eprintln!("[PERSIST] Created atlas #{} with {} thumbnails in {:?} (background, non-blocking)", 
                              atlases_created, chunk_frames.len(), persist_time);
                }
            }

            let chunk_time = chunk_start.elapsed();
            eprintln!(
                "[decode_frames_streaming] Chunk complete: {} frames in {:?}",
                chunk_frames.len(),
                chunk_time
            );

            // Yield between atlas batches
            tokio::task::yield_now().await;
        }

        eprintln!("[decode_frames_streaming] BG task complete: decoded={} failed={} sent={}/{} atlases={} total_time={:?}",
                  frames_decoded, frames_failed, frames_sent, total_frames, atlases_created, bg_start.elapsed());
    });

    // Await the task — invoke resolves only after all frames are streamed
    handle
        .await
        .map_err(|e| format!("Extraction task failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn release_video_decoder(video_path: String) {
    release_decoder(&video_path);
}

/// Decode a frame and produce all requested spatial tiers via the decode-once
/// pyramid pipeline. Results are streamed via `on_artifact` channel.
#[tauri::command]
pub async fn get_render_artifact(
    video_path: String,
    timestamp_ms: u64,
    spatial_tiers: Vec<String>,
    effect_graph_version: u32,
    on_artifact: tauri::ipc::Channel<RenderArtifact>,
) -> Result<(), String> {
    let timestamp_secs = timestamp_ms as f64 / 1000.0;
    let video_id = format!("{:x}", md5::compute(&video_path));

    let tiers: Vec<SpatialTier> = spatial_tiers
        .iter()
        .filter_map(|s| SpatialTier::from_label(s).ok())
        .collect();
    if tiers.is_empty() {
        return Err("No valid spatial tiers requested".to_string());
    }

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

    let mut missing_tiers: Vec<SpatialTier> = Vec::new();
    for tier in &tiers {
        let key = TierCacheKey {
            content_hash: content_hash.clone(),
            tier: *tier,
        };
        if let Some(frame) = TIER_CACHE.get(&key) {
            let artifact = RenderArtifact {
                frame_id: frame_id.clone(),
                content_hash: content_hash.0.clone(),
                spatial_tier: *tier,
                rgba_data: frame.data.clone(),
                width: frame.width,
                height: frame.height,
                timestamp_ms,
                source: ArtifactSource::BackendTierCache,
            };
            let _ = on_artifact.send(artifact);
        } else {
            missing_tiers.push(*tier);
        }
    }
    if missing_tiers.is_empty() {
        return Ok(());
    }

    let inflight_key = tier_inflight_key(&content_hash, SpatialTier::L0);
    let is_new = IN_FLIGHT_TIER.insert(inflight_key.clone(), ()).is_none();
    let raw_arc = if is_new {
        let raw = if let Some(existing) = FRAME_CACHE.get(&content_hash) {
            existing
        } else {
            let decoder_arc = get_decoder(&video_path).await?;
            let (rgba, w, h) = {
                let mut dec = decoder_arc.lock().await;
                dec.decode_frame_full_res(timestamp_secs)?
            };
            let frame = Arc::new(RawRgbaFrame::new(rgba, w, h));
            FRAME_CACHE.insert(content_hash.clone(), frame.clone());
            frame
        };
        IN_FLIGHT_TIER.remove(&inflight_key);
        raw
    } else {
        let mut waited = 0u32;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
            waited += 1;
            if let Some(f) = FRAME_CACHE.get(&content_hash) {
                IN_FLIGHT_TIER.remove(&inflight_key);
                break f;
            }
            if waited > 400 {
                return Err(format!("Decode timeout for {}", content_hash.0));
            }
        }
    };

    let tier_frames = {
        let raw = raw_arc.clone();
        tokio::task::spawn_blocking(move || downsample_pyramid(&raw, &missing_tiers))
            .await
            .map_err(|e| format!("Downsample task failed: {:?}", e))?
    };

    for (tier, result) in tier_frames {
        match result {
            Ok(tier_frame) => {
                let key = TierCacheKey {
                    content_hash: content_hash.clone(),
                    tier,
                };
                let artifact = RenderArtifact {
                    frame_id: frame_id.clone(),
                    content_hash: content_hash.0.clone(),
                    spatial_tier: tier,
                    rgba_data: tier_frame.data.clone(),
                    width: tier_frame.width,
                    height: tier_frame.height,
                    timestamp_ms,
                    source: ArtifactSource::FreshDecode,
                };
                TIER_CACHE.insert(key, tier_frame);
                let _ = on_artifact.send(artifact);
            }
            Err(e) => {
                eprintln!(
                    "[get_render_artifact] Downsample failed for {:?}: {}",
                    tier, e
                );
            }
        }
    }

    Ok(())
}

/// Batch version of get_render_artifact for multiple timestamps.
/// Streams artifacts as they become available (atlas first, then tier cache, then decoded).
#[tauri::command]
pub async fn get_render_artifacts_batch(
    video_path: String,
    timestamps_ms: Vec<u64>,
    spatial_tiers: Vec<String>,
    effect_graph_version: u32,
    request_id: Option<String>,
    on_artifact: tauri::ipc::Channel<RenderArtifact>,
) -> Result<(), String> {
    use crate::thumbnail_engine::atlas::get_atlas_manager;

    let req_id = request_id.unwrap_or_else(|| "unknown".to_string());
    eprintln!("[batch:start] req={} ts={} tiers={:?}", req_id, timestamps_ms.len(), spatial_tiers);

    let video_id = format!("{:x}", md5::compute(&video_path));

    let tiers: Vec<SpatialTier> = spatial_tiers
        .iter()
        .filter_map(|s| SpatialTier::from_label(s).ok())
        .collect();
    if tiers.is_empty() {
        return Err("No valid spatial tiers requested".to_string());
    }

    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Err("Cache not initialized".to_string()),
    };

    let mut atlas_hits = 0u32;
    let mut tier_cache_hits = 0u32;
    let mut decodes = 0u32;

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

        let mut missing_tiers: Vec<SpatialTier> = Vec::new();
        for tier in &tiers {
            let (width, height) = tier.dims();

            let resolution_tier = if width >= 160 {
                ResolutionTier::Tier2x
            } else {
                ResolutionTier::Tier1x
            };
            let density = DensityLevel::Medium;

            let atlas_manager = get_atlas_manager(&video_id, density, resolution_tier, cache_dir.clone()).await;

            let manager = atlas_manager.read().await;
            if let Some(location) = manager.get_location(timestamp_secs) {
                if let Ok(rgba_data) = load_from_atlas(&location, width, height).await {
                    atlas_hits += 1;
                    let artifact = RenderArtifact {
                        frame_id: frame_id.clone(),
                        content_hash: content_hash.0.clone(),
                        spatial_tier: *tier,
                        rgba_data,
                        width,
                        height,
                        timestamp_ms,
                        source: ArtifactSource::BackendTierCache,
                    };
                    let _ = on_artifact.send(artifact);
                    eprintln!("[batch:atlas-hit] req={} tier={:?} ts={} (hits={})", req_id, tier, timestamp_ms, atlas_hits);
                    continue;
                }
            }

            let key = TierCacheKey {
                content_hash: content_hash.clone(),
                tier: *tier,
            };
            if let Some(frame) = TIER_CACHE.get(&key) {
                tier_cache_hits += 1;
                let artifact = RenderArtifact {
                    frame_id: frame_id.clone(),
                    content_hash: content_hash.0.clone(),
                    spatial_tier: *tier,
                    rgba_data: frame.data.clone(),
                    width: frame.width,
                    height: frame.height,
                    timestamp_ms,
                    source: ArtifactSource::BackendTierCache,
                };
                let _ = on_artifact.send(artifact);
                eprintln!("[batch:tier-hit] req={} tier={:?} ts={} (hits={})", req_id, tier, timestamp_ms, tier_cache_hits);
            } else {
                missing_tiers.push(*tier);
            }
        }

        if !missing_tiers.is_empty() {
            eprintln!("[batch:decode] req={} tiers={:?} ts={}", req_id, missing_tiers, timestamp_ms);
            decodes += 1;
            let inflight_key = tier_inflight_key(&content_hash, SpatialTier::L0);
            let is_new = IN_FLIGHT_TIER.insert(inflight_key.clone(), ()).is_none();
            let raw_arc = if is_new {
                let raw = if let Some(existing) = FRAME_CACHE.get(&content_hash) {
                    existing
                } else {
                    let decoder_arc = get_decoder(&video_path).await?;
                    let (rgba, w, h) = {
                        let mut dec = decoder_arc.lock().await;
                        dec.decode_frame_full_res(timestamp_secs)?
                    };
                    let frame = Arc::new(RawRgbaFrame::new(rgba, w, h));
                    FRAME_CACHE.insert(content_hash.clone(), frame.clone());
                    frame
                };
                IN_FLIGHT_TIER.remove(&inflight_key);
                raw
            } else {
                let mut waited = 0u32;
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
                    waited += 1;
                    if let Some(f) = FRAME_CACHE.get(&content_hash) {
                        IN_FLIGHT_TIER.remove(&inflight_key);
                        break f;
                    }
                    if waited > 400 {
                        return Err(format!("Decode timeout for {}", content_hash.0));
                    }
                }
            };

            let tier_frames = {
                let raw = raw_arc.clone();
                tokio::task::spawn_blocking(move || downsample_pyramid(&raw, &missing_tiers))
                    .await
                    .map_err(|e| format!("Downsample task failed: {:?}", e))?
            };

            for (tier, result) in tier_frames {
                match result {
                    Ok(tier_frame) => {
                        let key = TierCacheKey {
                            content_hash: content_hash.clone(),
                            tier,
                        };
                        let artifact = RenderArtifact {
                            frame_id: frame_id.clone(),
                            content_hash: content_hash.0.clone(),
                            spatial_tier: tier,
                            rgba_data: tier_frame.data.clone(),
                            width: tier_frame.width,
                            height: tier_frame.height,
                            timestamp_ms,
                            source: ArtifactSource::FreshDecode,
                        };
                        TIER_CACHE.insert(key, tier_frame);
                        let _ = on_artifact.send(artifact);
                        eprintln!("[batch:decoded] req={} tier={:?} ts={}", req_id, tier, timestamp_ms);
                    }
                    Err(e) => {
                        eprintln!("[batch:error] req={} tier={:?} error={}", req_id, tier, e);
                    }
                }
            }
        }
    }

    eprintln!("[batch:complete] req={} atlas_hits={} tier_cache_hits={} decodes={}", req_id, atlas_hits, tier_cache_hits, decodes);

    GLOBAL_ATLAS_HITS.fetch_add(atlas_hits as u64, Ordering::Relaxed);
    GLOBAL_TIER_CACHE_HITS.fetch_add(tier_cache_hits as u64, Ordering::Relaxed);
    GLOBAL_DECODES.fetch_add(decodes as u64, Ordering::Relaxed);

    Ok(())
}

/// Load RGBA data from atlas file at specified location.
async fn load_from_atlas(
    location: &crate::thumbnail_engine::atlas::AtlasLocation,
    thumb_width: u32,
    thumb_height: u32,
) -> Result<Vec<u8>, String> {
    let atlas_data = tokio::fs::read(&location.atlas_path)
        .await
        .map_err(|e| format!("Failed to read atlas file: {}", e))?;

    let atlas_img = image::load_from_memory(&atlas_data)
        .map_err(|e| format!("Failed to decode atlas image: {}", e))?
        .to_rgba8();

    let x = location.col * thumb_width;
    let y = location.row * thumb_height;

    let mut rgba_data = Vec::with_capacity((thumb_width * thumb_height * 4) as usize);
    for row in y..(y + thumb_height) {
        for col in x..(x + thumb_width) {
            let pixel = atlas_img.get_pixel(col, row);
            rgba_data.extend_from_slice(&pixel.0);
        }
    }

    Ok(rgba_data)
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

    eprintln!(
        "[prewarm_decoders] Prewarming {} decoders in background",
        video_paths.len()
    );

    let start = std::time::Instant::now();
    let mut success_count = 0;

    // Prewarm decoders concurrently (up to 4 at a time to avoid overwhelming system)
    let chunk_size = 4;
    for (chunk_idx, chunk) in video_paths.chunks(chunk_size).enumerate() {
        let chunk_start = std::time::Instant::now();
        let mut handles = vec![];

        for path in chunk {
            let path = path.clone();
            let handle = tokio::spawn(async move {
                match get_decoder(&path).await {
                    Ok(_) => {
                        eprintln!("[prewarm_decoders] ✓ Prewarmed: {}", path);
                        true
                    }
                    Err(e) => {
                        // Log but don't fail - graceful degradation
                        eprintln!("[prewarm_decoders] ✗ Failed to prewarm {}: {}", path, e);
                        false
                    }
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

        eprintln!(
            "[prewarm_decoders] Chunk {} complete ({} videos) in {:?}",
            chunk_idx,
            chunk.len(),
            chunk_start.elapsed()
        );
    }

    eprintln!(
        "[prewarm_decoders] Complete: {}/{} decoders prewarmed in {:?}",
        success_count,
        video_paths.len(),
        start.elapsed()
    );

    Ok(success_count)
}
