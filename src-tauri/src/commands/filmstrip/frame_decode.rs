use crate::commands::filmstrip::in_flight::IN_FLIGHT_EXTRACTIONS;
use crate::commands::filmstrip::poster::encode_rgba_to_webp_data_url;
use crate::filmstrip_engine::decoder::{get_decoder, release_decoder};
use crate::filmstrip_engine::{DensityLevel, ResolutionTier, ThumbnailTile, GLOBAL_CACHE};

/// Extract single frame with deduplication (reduces workload by 70%+ during scrubbing).
/// Returns raw RGBA bytes as a binary IPC response — zero base64 overhead, ~3× less memory.
#[tauri::command]
pub async fn decode_frame(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
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
                return result.map(tauri::ipc::Response::new);
            }
            Err(_) => {
                // Channel closed, fall through to extraction
            }
        }
    }

    // Perform extraction (first request or channel closed)
    let result = async {
        let decoder = get_decoder(&video_path).await?;
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

    // Return raw RGBA bytes as binary IPC response — no base64 allocation
    result.map(tauri::ipc::Response::new)
}

/// Extract single frame for GPU upload (returns raw RGBA binary response, 5-10× faster than base64/JSON array).
#[tauri::command]
pub async fn decode_frame_gpu(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
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
                return result.map(tauri::ipc::Response::new);
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

    // Return raw RGBA as binary IPC response (zero-copy)
    result.map(tauri::ipc::Response::new)
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
    use crate::filmstrip_engine::atlas::{get_atlas_manager, AtlasBuilder, THUMBNAILS_PER_ATLAS};

    let video_id = format!("{:x}", md5::compute(&video_path));
    let resolution_tier = if width >= 160 {
        ResolutionTier::Tier2x
    } else {
        ResolutionTier::Tier1x
    };

    // Get cache directory
    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Err("Cache not initialized".to_string()),
    };

    // Get atlas manager for this video
    let atlas_manager = get_atlas_manager(&video_id, density, resolution_tier, cache_dir).await;

    // Check which frames are already in atlases
    let mut missing_times = Vec::new();

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

                let _ = on_tile.send(tile);
            } else {
                missing_times.push(time);
            }
        }
    }

    // If all cached, return early
    if missing_times.is_empty() {
        return Ok(());
    }

    // Spawn extraction task - IMMEDIATE RGBA streaming + background atlas persistence
    let handle = tokio::spawn(async move {
        // Get decoder
        let decoder = match get_decoder(&video_path).await {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[decode_frames_streaming] Failed to get decoder: {}", e);
                return;
            }
        };

        // Process frames in batches of THUMBNAILS_PER_ATLAS (32)
        let mut frames_failed = 0u32;

        for chunk in missing_times.chunks(THUMBNAILS_PER_ATLAS) {
            // Create atlas builder for background persistence
            let mut atlas_builder = AtlasBuilder::new(width, height);
            let mut chunk_frames: Vec<(f64, Vec<u8>, u32, u32)> = Vec::new();

            // IMMEDIATE PATH: Decode and stream RGBA to frontend (no compression!)
            for &time in chunk {
                // Deduplicate extraction across concurrent requests
                let key = format!(
                    "{}:{}:{}x{}",
                    video_id,
                    (time * 1000.0).round() as u64,
                    width,
                    height
                );
                let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

                let rgba_bytes = if !is_new {
                    // Extraction already in-flight, await existing result
                    let mut rx = tx.subscribe();
                    match rx.recv().await {
                        Ok(Ok(bytes)) => bytes,
                        Ok(Err(e)) => {
                            frames_failed += 1;
                            if frames_failed <= 5 {
                                log::debug!("[decode_frames_streaming] Decode failed at {}s (deduplicated): {}", time, e);
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
                                        log::debug!(
                                            "[decode_frames_streaming] Decode failed at {}s: {}",
                                            time,
                                            e
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
                                log::debug!(
                                    "[decode_frames_streaming] Decode failed at {}s: {}",
                                    time,
                                    e
                                );
                            }
                            continue;
                        }
                    }
                };

                let actual_width = (rgba_bytes.len() / 4 / height as usize) as u32;
                let actual_height = height;

                let webp_data_url =
                    match encode_rgba_to_webp_data_url(&rgba_bytes, actual_width, actual_height) {
                        Ok(url) => url,
                        Err(e) => {
                            log::warn!(
                                "[decode_frames_streaming] WebP encoding failed at {}s: {}",
                                time,
                                e
                            );
                            continue;
                        }
                    };

                let tile = ThumbnailTile::from_path(time, webp_data_url, density);
                let _ = on_tile.send(tile);

                chunk_frames.push((time, rgba_bytes, actual_width, actual_height));
            }

            if chunk_frames.is_empty() {
                continue;
            }

            // BACKGROUND PATH: Persist to WebP atlas (non-blocking for frontend)
            // Allocate atlas locations
            let mut locations = Vec::new();
            {
                let mut manager = atlas_manager.write().await;
                for (time, rgba_bytes, actual_width, actual_height) in &chunk_frames {
                    let location = manager.allocate(*time);

                    if let Err(e) =
                        atlas_builder.add_thumbnail(rgba_bytes, *actual_width, *actual_height)
                    {
                        log::warn!(
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
                    log::warn!("[decode_frames_streaming] Failed to save atlas: {}", e);
                }
            }

            // Yield between atlas batches
            tokio::task::yield_now().await;
        }
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

/// Stream timeline frames directly as raw binary responses via a Tauri Channel.
/// Completely bypasses JSON/Base64 serialization for zero-copy IPC throughput.
#[tauri::command]
pub async fn stream_timeline_frames_binary(
    video_path: String,
    timestamps: Vec<f64>,
    width: u32,
    height: u32,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<(), String> {
    let decoder = get_decoder(&video_path).await?;

    tokio::spawn(async move {
        for ts in timestamps {
            let rgba_res = {
                let mut decoder_guard = decoder.lock().await;
                decoder_guard.decode_frame(ts, width, height)
            };
            if let Ok(bytes) = rgba_res {
                if on_frame
                    .send(tauri::ipc::InvokeResponseBody::Raw(bytes))
                    .is_err()
                {
                    break;
                }
            }
        }
    });

    Ok(())
}
