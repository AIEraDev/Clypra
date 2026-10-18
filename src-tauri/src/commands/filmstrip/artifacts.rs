use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;

use crate::commands::filmstrip::cache_commands::{
    GLOBAL_ATLAS_HITS, GLOBAL_DECODES, GLOBAL_TIER_CACHE_HITS,
};
use crate::commands::filmstrip::in_flight::{
    preempt_lower_priority_batches, register_thumbnail_batch, ACTIVE_THUMBNAIL_BATCHES,
    BATCH_DECODE_GATES,
};
use crate::filmstrip_engine::decoder::{
    get_decoder, get_filmstrip_decoder_shard, BatchDecodeResult, MAX_FILMSTRIP_DECODER_SHARDS,
};
use crate::filmstrip_engine::pyramid::RawRgbaFrame;
use crate::filmstrip_engine::{
    downsample_pyramid, tier_inflight_key, ArtifactSource, DensityLevel, FrameContentHash,
    RenderArtifact, ResolutionTier, SpatialTier, TierCacheKey, FRAME_CACHE, GLOBAL_CACHE,
    IN_FLIGHT_TIER, TIER_CACHE,
};

/// Load RGBA data from atlas file at specified location.
pub async fn load_from_atlas(
    location: &crate::filmstrip_engine::atlas::AtlasLocation,
    thumb_width: u32,
    thumb_height: u32,
) -> Result<Vec<u8>, String> {
    crate::filmstrip_engine::atlas::load_from_atlas_resilient(location, thumb_width, thumb_height)
        .await
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

    let (max_w, max_h) = tiers
        .iter()
        .map(|t| t.dims())
        .fold((0u32, 0u32), |(mw, mh), (w, h)| (mw.max(w), mh.max(h)));

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
                dec.decode_frame_scaled(timestamp_secs, max_w, max_h)?
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
            if !IN_FLIGHT_TIER.contains_key(&inflight_key) {
                if let Some(f) = FRAME_CACHE.get(&content_hash) {
                    break f;
                }
                return Err(format!("Concurrent decode failed for {}", content_hash.0));
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
                log::warn!(
                    "[get_render_artifact] Downsample failed for {:?}: {}",
                    tier,
                    e
                );
            }
        }
    }

    Ok(())
}

/// Batch version of get_render_artifact for multiple timestamps.
/// Streams artifacts as they become available (atlas first, then tier cache, then decoded).
///
/// A successful IPC call does not necessarily mean every requested frame was
/// produced: P0 preview work may cooperatively stop a P2/P3 batch. The
/// frontend uses this explicit outcome to retain its viewport demand and retry
/// only after the preview-critical request has had a chance to run.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderArtifactsBatchOutcome {
    pub cancelled: bool,
}

#[tauri::command]
pub async fn get_render_artifacts_batch(
    video_path: String,
    timestamps_ms: Vec<u64>,
    spatial_tiers: Vec<String>,
    effect_graph_version: u32,
    request_id: Option<String>,
    priority: Option<u8>,
    on_artifact: tauri::ipc::Channel<RenderArtifact>,
) -> Result<RenderArtifactsBatchOutcome, String> {
    use crate::filmstrip_engine::atlas::get_atlas_manager;

    let req_id = request_id.as_deref().unwrap_or("unknown");
    let priority = priority.unwrap_or(10);
    let video_id = format!("{:x}", md5::compute(&video_path));

    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(ref id) = request_id {
        let preempted = preempt_lower_priority_batches(&video_path, priority);
        crate::filmstrip_engine::metrics::METRICS
            .source
            .preemptions
            .fetch_add(preempted, Ordering::Relaxed);
        register_thumbnail_batch(
            id.clone(),
            video_path.clone(),
            priority,
            cancel_flag.clone(),
        );
    }

    struct BatchGuard<'a>(&'a Option<String>);
    impl<'a> Drop for BatchGuard<'a> {
        fn drop(&mut self) {
            if let Some(ref id) = self.0 {
                ACTIVE_THUMBNAIL_BATCHES.remove(id);
            }
        }
    }
    let _guard = BatchGuard(&request_id);

    let tiers: Vec<SpatialTier> = spatial_tiers
        .iter()
        .filter_map(|s| SpatialTier::from_label(s).ok())
        .collect();
    if tiers.is_empty() {
        return Err("No valid spatial tiers requested".to_string());
    }

    let (max_w, max_h) = tiers
        .iter()
        .map(|t| t.dims())
        .fold((0u32, 0u32), |(mw, mh), (w, h)| (mw.max(w), mh.max(h)));

    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Err("Cache not initialized".to_string()),
    };

    let mut atlas_hits = 0u32;
    let mut tier_cache_hits = 0u32;
    let mut decodes = 0u32;

    let mut missing_timestamps: Vec<u64> = Vec::new();

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

            let atlas_manager =
                get_atlas_manager(&video_id, density, resolution_tier, cache_dir.clone()).await;

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
                    continue;
                }
            }

            let key = TierCacheKey {
                content_hash: content_hash.clone(),
                tier: *tier,
            };
            if let Some(frame) = TIER_CACHE.get(&key) {
                tier_cache_hits += 1;
                crate::filmstrip_engine::metrics::METRICS
                    .for_tier(*tier)
                    .tier_cache_hits
                    .fetch_add(1, Ordering::Relaxed);
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

        if !missing_tiers.is_empty() {
            missing_timestamps.push(timestamp_ms);
        }
    }

    if missing_timestamps.is_empty() {
        return Ok(RenderArtifactsBatchOutcome {
            cancelled: cancel_flag.load(Ordering::Relaxed),
        });
    }

    // Sort missing timestamps chronologically for forward GOP packet scanning
    missing_timestamps.sort_unstable();
    missing_timestamps.dedup();

    // A concurrent batch may have filled TIER_CACHE while we waited for a
    // previous timestamp. Recheck it before decoding so cancelled or obsolete
    // work does not consume the decoder.
    let mut still_missing: Vec<u64> = Vec::new();
    for timestamp_ms in missing_timestamps {
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
        let mut any_missing = false;
        for tier in &tiers {
            let key = TierCacheKey {
                content_hash: content_hash.clone(),
                tier: *tier,
            };
            if let Some(frame) = TIER_CACHE.get(&key) {
                tier_cache_hits += 1;
                crate::filmstrip_engine::metrics::METRICS
                    .for_tier(*tier)
                    .tier_cache_hits
                    .fetch_add(1, Ordering::Relaxed);
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
                any_missing = true;
            }
        }
        if any_missing {
            still_missing.push(timestamp_ms);
        }
    }
    missing_timestamps = still_missing;

    if missing_timestamps.is_empty() {
        GLOBAL_ATLAS_HITS.fetch_add(atlas_hits as u64, Ordering::Relaxed);
        GLOBAL_TIER_CACHE_HITS.fetch_add(tier_cache_hits as u64, Ordering::Relaxed);
        GLOBAL_DECODES.fetch_add(decodes as u64, Ordering::Relaxed);
        return Ok(RenderArtifactsBatchOutcome {
            cancelled: cancel_flag.load(Ordering::Relaxed),
        });
    }

    // P2 visible work with enough independent timestamps gets at most two
    // source-local cursors. P3 remains single-cursor: parallel background
    // work wastes hardware decode capacity and risks competing with preview.
    let timestamp_count = missing_timestamps.len();
    let shard_count = filmstrip_decoder_shard_count(priority, timestamp_count);
    if shard_count > 1 {
        crate::filmstrip_engine::metrics::METRICS
            .source
            .parallel_decode_batches
            .fetch_add(1, Ordering::Relaxed);
        crate::filmstrip_engine::metrics::METRICS
            .source
            .parallel_decoder_shards
            .fetch_add(shard_count as u64, Ordering::Relaxed);
    }
    let mut decoders = Vec::with_capacity(shard_count);
    let mut gates = Vec::with_capacity(shard_count);
    for shard in 0..shard_count {
        decoders.push(get_filmstrip_decoder_shard(&video_path, shard).await?);
        let gate_key = format!("{video_path}::filmstrip-shard:{shard}");
        gates.push(
            BATCH_DECODE_GATES
                .entry(gate_key)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone(),
        );
    }

    // One long-lived worker per shard is intentional. Do not enqueue every
    // timestamp behind a shard mutex: a new viewport/P0 cancellation would
    // otherwise leave stale work resident in FIFO order for seconds.
    let (batch_sender, mut batch_receiver) =
        tokio::sync::mpsc::channel::<Result<BatchDecodeResult, String>>(shard_count * 2);
    let mut decode_tasks = tokio::task::JoinSet::new();
    let timestamps_per_shard = timestamp_count.div_ceil(shard_count);
    for (shard, shard_timestamps) in missing_timestamps
        .chunks(timestamps_per_shard)
        .enumerate()
    {
        let decoder = decoders[shard].clone();
        let gate = gates[shard].clone();
        let cancelled = cancel_flag.clone();
        let sender = batch_sender.clone();
        let shard_timestamps = shard_timestamps.to_vec();
        decode_tasks.spawn(async move {
            let mut dropped = 0u64;
            for (index, timestamp_ms) in shard_timestamps.iter().copied().enumerate() {
                if cancelled.load(Ordering::Relaxed) {
                    dropped = (shard_timestamps.len() - index) as u64;
                    break;
                }
                let gate_wait_started = Instant::now();
                let frame_gate = gate.lock().await;
                crate::filmstrip_engine::metrics::METRICS
                    .source
                    .queue_wait
                    .record(gate_wait_started.elapsed());
                if cancelled.load(Ordering::Relaxed) {
                    drop(frame_gate);
                    dropped = (shard_timestamps.len() - index) as u64;
                    break;
                }
                let decoded = {
                    let mut decoder = decoder.lock().await;
                    decoder.decode_frames_batch_scaled(&[timestamp_ms as f64 / 1000.0], max_w, max_h)
                };
                drop(frame_gate);
                match decoded {
                    Ok(batch) => {
                        if sender.send(Ok(batch)).await.is_err() {
                            dropped = (shard_timestamps.len() - index - 1) as u64;
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error)).await;
                        break;
                    }
                }
            }
            Ok::<u64, String>(dropped)
        });
    }
    drop(batch_sender);

    let mut completed_turns = 0usize;
    while let Some(result) = batch_receiver.recv().await {
        if cancel_flag.load(Ordering::Relaxed) {
            decode_tasks.abort_all();
            crate::filmstrip_engine::metrics::METRICS
                .source
                .latest_only_dropped_timestamps
                .fetch_add((timestamp_count - completed_turns) as u64, Ordering::Relaxed);
            return Ok(RenderArtifactsBatchOutcome { cancelled: true });
        }
        let decoded_batch = result?;
        if !decoded_batch.frames.is_empty() {
            let per_frame_decode = decoded_batch.decode_elapsed / decoded_batch.frames.len() as u32;
            let source_metrics = &crate::filmstrip_engine::metrics::METRICS.source;
            source_metrics.decode.record(per_frame_decode);
            if decoded_batch.seek_elapsed > std::time::Duration::ZERO {
                source_metrics.seek.record(decoded_batch.seek_elapsed);
            }
        }

        if stream_decoded_batch(
            decoded_batch,
            &cancel_flag,
            &video_id,
            effect_graph_version,
            &tiers,
            &on_artifact,
            &mut decodes,
            req_id,
        )
        .await?
        {
            decode_tasks.abort_all();
            return Ok(RenderArtifactsBatchOutcome { cancelled: cancel_flag.load(Ordering::Relaxed) });
        }
        completed_turns += 1;
        if completed_turns < timestamp_count && !cancel_flag.load(Ordering::Relaxed) {
            crate::filmstrip_engine::metrics::METRICS
                .source
                .cooperative_yields
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    while let Some(result) = decode_tasks.join_next().await {
        let dropped = result
            .map_err(|error| format!("Filmstrip decoder shard failed: {error}"))??;
        crate::filmstrip_engine::metrics::METRICS
            .source
            .latest_only_dropped_timestamps
            .fetch_add(dropped, Ordering::Relaxed);
    }

    GLOBAL_ATLAS_HITS.fetch_add(atlas_hits as u64, Ordering::Relaxed);
    GLOBAL_TIER_CACHE_HITS.fetch_add(tier_cache_hits as u64, Ordering::Relaxed);
    GLOBAL_DECODES.fetch_add(decodes as u64, Ordering::Relaxed);

    Ok(RenderArtifactsBatchOutcome {
        cancelled: cancel_flag.load(Ordering::Relaxed),
    })
}

const VISIBLE_FILMSTRIP_PRIORITY: u8 = 10;
const MIN_PARALLEL_FILMSTRIP_TIMESTAMPS: usize = 4;

fn filmstrip_decoder_shard_count(priority: u8, timestamp_count: usize) -> usize {
    if priority >= VISIBLE_FILMSTRIP_PRIORITY
        && timestamp_count >= MIN_PARALLEL_FILMSTRIP_TIMESTAMPS
    {
        MAX_FILMSTRIP_DECODER_SHARDS
    } else {
        1
    }
}

async fn stream_decoded_batch(
    decoded_batch: BatchDecodeResult,
    cancel_flag: &Arc<std::sync::atomic::AtomicBool>,
    video_id: &str,
    effect_graph_version: u32,
    tiers: &[SpatialTier],
    on_artifact: &tauri::ipc::Channel<RenderArtifact>,
    decodes: &mut u32,
    req_id: &str,
) -> Result<bool, String> {
    for decoded_frame in decoded_batch.frames {
        if cancel_flag.load(Ordering::Relaxed) {
            return Ok(false);
        }
        *decodes += 1;
        let timestamp_ms = (decoded_frame.target_ts_secs * 1000.0).round() as u64;
        let content_hash = FrameContentHash::compute(
            video_id,
            timestamp_ms,
            effect_graph_version,
            1.0,
            0,
            u64::MAX,
            false,
        );
        let frame_id = format!("{}-{}", content_hash.0, timestamp_ms);
        let source_metrics = &crate::filmstrip_engine::metrics::METRICS.source;
        source_metrics.convert.record(decoded_frame.convert_elapsed);
        if decoded_frame.conversion_fast_path {
            source_metrics.convert_fast_path.fetch_add(1, Ordering::Relaxed);
        } else {
            source_metrics.convert_slow_path.fetch_add(1, Ordering::Relaxed);
        }
        let raw_arc = Arc::new(RawRgbaFrame::new(
            decoded_frame.rgba,
            decoded_frame.width,
            decoded_frame.height,
        ));
        FRAME_CACHE.insert(content_hash.clone(), raw_arc.clone());
        let tiers_for_frame = tiers.to_vec();
        let tier_frames = tokio::task::spawn_blocking(move || {
            downsample_pyramid(&raw_arc, &tiers_for_frame)
        })
        .await
        .map_err(|error| format!("Downsample task failed: {error}"))?;

        for (tier, result) in tier_frames {
            match result {
                Ok(tier_frame) => {
                    let key = TierCacheKey { content_hash: content_hash.clone(), tier };
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
                    let serialize_timer = crate::filmstrip_engine::metrics::Timer::start();
                    let send_res = on_artifact.send(artifact);
                    if let Some(elapsed) = serialize_timer.elapsed() {
                        crate::filmstrip_engine::metrics::METRICS
                            .for_tier(tier)
                            .serialize
                            .record(elapsed);
                    }
                    crate::filmstrip_engine::metrics::METRICS
                        .for_tier(tier)
                        .decodes
                        .fetch_add(1, Ordering::Relaxed);
                    if send_res.is_err() {
                        return Ok(true);
                    }
                }
                Err(error) => log::warn!(
                    "[batch:error] req={} tier={:?} error={}",
                    req_id,
                    tier,
                    error
                ),
            }
        }
    }
    Ok(false)
}

/// Retrieve a snapshot of the current cumulative decode/convert/downsample metrics.
#[tauri::command]
pub fn get_decode_metrics_snapshot(
) -> Result<crate::filmstrip_engine::metrics::FullDecodeMetricsSnapshot, String> {
    Ok(crate::filmstrip_engine::metrics::get_metrics_snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_large_visible_batches_receive_two_decoder_shards() {
        assert_eq!(filmstrip_decoder_shard_count(10, 4), 2);
        assert_eq!(filmstrip_decoder_shard_count(10, 3), 1);
        assert_eq!(filmstrip_decoder_shard_count(1, 12), 1);
    }
}
