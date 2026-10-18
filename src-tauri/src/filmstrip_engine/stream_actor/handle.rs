use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use once_cell::sync::Lazy;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::filmstrip_engine::decoder::{
    get_preview_decoder_for_stream, preview_pool_key, DecodeFrameOptions,
};
use crate::filmstrip_engine::stream_actor::types::{
    ActorDecodeRequest, DecodedActorFrame, StreamDecodeJob, DEFAULT_FRAME_DURATION_SECS,
    MAX_PREVIEW_ACTOR_POOL_SIZE, PRODUCER_DOWNLOADS_WASTED,
};
use crate::filmstrip_engine::stream_actor::worker::StreamDecoderActor;

/// Global registry of active stream decoder actors.
pub(crate) static PREVIEW_ACTOR_POOL: Lazy<DashMap<String, Arc<StreamDecoderActorHandle>>> =
    Lazy::new(DashMap::new);

/// Handle to communicate with a stream decoder actor.
pub struct StreamDecoderActorHandle {
    pub(crate) key: String,
    pub(crate) urgent_tx: mpsc::Sender<StreamDecodeJob>,
    pub(crate) prefetch_tx: mpsc::Sender<StreamDecodeJob>,
    pub(crate) current_generation: Arc<AtomicU64>,
    pub(crate) cancel_in_flight: Arc<AtomicBool>,
    pub(crate) prime_cache: Arc<Mutex<VecDeque<DecodedActorFrame>>>,
    pub(crate) frame_duration_secs: f64,
    pub(crate) last_accessed_ms: Arc<AtomicU64>,
}

impl StreamDecoderActorHandle {
    pub fn stream_key(&self) -> &str {
        &self.key
    }

    pub fn frame_duration_secs(&self) -> f64 {
        self.frame_duration_secs
    }

    pub fn touch(&self) {
        self.last_accessed_ms
            .store(crate::filmstrip_engine::decoder::current_timestamp_ms(), Ordering::Relaxed);
    }

    /// Decode a frame with priority awareness and prime-cache acceleration.
    pub async fn decode_frame(
        &self,
        time_secs: f64,
        mut options: DecodeFrameOptions,
        is_prefetch: bool,
        generation: u64,
    ) -> Result<DecodedActorFrame, String> {
        options.is_playback = false;
        self.decode_frame_with_policy(time_secs, options, is_prefetch, false, generation)
            .await
    }

    /// Playback is a forward-only stream, not an exact-frame query. If the
    /// WebView asks for an older timestamp after a decode stall, serve the
    /// newest already-decoded eligible frame instead of seeking backwards and
    /// re-decoding an entire GOP. Exact seek/scrub continues through
    /// `decode_frame` above.
    pub async fn decode_playback_frame(
        &self,
        time_secs: f64,
        mut options: DecodeFrameOptions,
        generation: u64,
    ) -> Result<DecodedActorFrame, String> {
        options.is_playback = true;
        self.decode_frame_with_policy(time_secs, options, false, true, generation)
            .await
    }

    async fn decode_frame_with_policy(
        &self,
        time_secs: f64,
        options: DecodeFrameOptions,
        is_prefetch: bool,
        playback_latest_frame_wins: bool,
        generation: u64,
    ) -> Result<DecodedActorFrame, String> {
        let start = Instant::now();
        let frame_duration = self.frame_duration_secs.max(0.001);
        let tolerance = (frame_duration * 0.95).max(0.001);

        // 1. Fast path: check if the frame is already resident in the actor's prime cache.
        {
            let mut cache = self.prime_cache.lock().await;
            if let Some(pos) = cache.iter().position(|f| {
                (!f.is_approximate || options.allow_keyframe_approx)
                    && (f.time_secs - time_secs).abs() <= tolerance
                    && f.quality == options.quality
            }) {
                let mut hit = cache[pos].clone();
                if pos != cache.len() - 1 {
                    let item = cache.remove(pos).unwrap();
                    cache.push_back(item);
                } else {
                    // Increment served_count on the item still in the cache
                    if let Some(back) = cache.back_mut() {
                        back.served_count += 1;
                    }
                }
                hit.from_prime_cache = true;
                hit.served_count = hit.served_count.saturating_add(1);
                // These timings describe the frame's original decode. The
                // presentation request consumed an already-ready frame, so
                // reporting them here would falsely inflate live playback
                // seek/amplification metrics.
                hit.decode_us = 0;
                hit.decoder_seek_count = 0;
                hit.decoder_frames_decoded = 0;
                hit.hardware_frame_download_us = None;
                hit.scale_colorspace_us = 0;
                hit.actor_wait_us = start.elapsed().as_micros().min(u64::MAX as u128) as u64;
                return Ok(hit);
            }

            // A completion that arrives late during playback must never force
            // the decoder backwards merely to satisfy an obsolete clock tick.
            // The ring is tiny by design, so choose only a frame that is at
            // least as new as the requested time (within one frame) and keep
            // exact requests on the strict branch above.
            if playback_latest_frame_wins {
                if let Some((pos, _)) = cache
                    .iter()
                    .enumerate()
                    .filter(|(_, frame)| {
                        !frame.is_approximate
                            && frame.quality == options.quality
                            && frame.time_secs + tolerance >= time_secs
                    })
                    .max_by(|(_, left), (_, right)| left.time_secs.total_cmp(&right.time_secs))
                {
                    let mut hit = cache[pos].clone();
                    if pos != cache.len() - 1 {
                        let item = cache.remove(pos).unwrap();
                        cache.push_back(item);
                    } else {
                        if let Some(back) = cache.back_mut() {
                            back.served_count += 1;
                        }
                    }
                    hit.from_prime_cache = true;
                    hit.served_count = hit.served_count.saturating_add(1);
                    hit.decode_us = 0;
                    hit.decoder_seek_count = 0;
                    hit.decoder_frames_decoded = 0;
                    hit.hardware_frame_download_us = None;
                    hit.scale_colorspace_us = 0;
                    hit.actor_wait_us = start.elapsed().as_micros().min(u64::MAX as u128) as u64;
                    return Ok(hit);
                }
            }
        }

        // 2. Urgent presentation requests preempt any background lookahead in flight.
        if !is_prefetch {
            self.cancel_in_flight.store(true, Ordering::Release);
        }

        let (response_tx, response_rx) = oneshot::channel();
        let job = StreamDecodeJob {
            request: ActorDecodeRequest {
                time_secs,
                options,
                is_prefetch,
                generation,
            },
            response_tx,
        };

        if is_prefetch {
            self.prefetch_tx
                .send(job)
                .await
                .map_err(|_| "Stream decoder actor is shut down".to_string())?;
        } else {
            self.urgent_tx
                .send(job)
                .await
                .map_err(|_| "Stream decoder actor is shut down".to_string())?;
        }

        let mut res = response_rx
            .await
            .map_err(|_| "Decoder actor dropped response channel".to_string())??;
        res.actor_wait_us = start.elapsed().as_micros().min(u64::MAX as u128) as u64;
        Ok(res)
    }

    /// Invalidate in-flight and queued decodes from older generations.
    pub fn invalidate(&self, generation: u64) {
        self.current_generation
            .fetch_max(generation, Ordering::AcqRel);
        self.cancel_in_flight.store(true, Ordering::Release);
    }

    /// Clear the prime cache (e.g. on seek boundary).
    pub async fn clear_prime_cache(&self) {
        let mut cache = self.prime_cache.lock().await;
        for frame in cache.drain(..) {
            if frame.served_count == 0 {
                PRODUCER_DOWNLOADS_WASTED.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// Retrieve or spawn a dedicated stream decoder actor for the given stream.
pub async fn get_preview_decoder_actor_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<Arc<StreamDecoderActorHandle>, String> {
    let key = preview_pool_key(path, stream_id);
    if let Some(actor) = PREVIEW_ACTOR_POOL.get(&key) {
        actor.touch();
        return Ok(actor.value().clone());
    }

    // LRU eviction when actor pool reaches capacity
    if PREVIEW_ACTOR_POOL.len() >= MAX_PREVIEW_ACTOR_POOL_SIZE {
        let oldest = PREVIEW_ACTOR_POOL
            .iter()
            .map(|kv| {
                (
                    kv.key().clone(),
                    kv.value().last_accessed_ms.load(Ordering::Relaxed),
                )
            })
            .min_by_key(|(_, ts)| *ts);

        if let Some((oldest_key, _)) = oldest {
            PREVIEW_ACTOR_POOL.remove(&oldest_key);
        }
    }

    let decoder = get_preview_decoder_for_stream(path, stream_id).await?;
    let frame_duration_secs = {
        let guard = decoder.lock().await;
        guard.frame_duration_secs()
    };

    let actor = StreamDecoderActor::spawn(
        key.clone(),
        decoder,
        if frame_duration_secs > 0.0 {
            frame_duration_secs
        } else {
            DEFAULT_FRAME_DURATION_SECS
        },
    );

    use dashmap::mapref::entry::Entry;
    let final_actor = match PREVIEW_ACTOR_POOL.entry(key) {
        Entry::Occupied(occ) => {
            let existing = occ.get().clone();
            existing.touch();
            existing
        }
        Entry::Vacant(vac) => {
            vac.insert(actor.clone());
            actor
        }
    };

    Ok(final_actor)
}

/// Release a specific stream decoder actor from the global pool.
pub fn release_preview_decoder_actor_for_stream(path: &str, stream_id: &str) {
    let key = preview_pool_key(path, stream_id);
    PREVIEW_ACTOR_POOL.remove(&key);
}

/// Release all stream decoder actors associated with a video file path.
pub fn release_all_preview_decoder_actors_for_path(path: &str) {
    let keys_to_remove: Vec<String> = PREVIEW_ACTOR_POOL
        .iter()
        .filter(|kv| kv.key() == path || kv.key().starts_with(&format!("{path}::stream::")))
        .map(|kv| kv.key().clone())
        .collect();
    for key in keys_to_remove {
        PREVIEW_ACTOR_POOL.remove(&key);
    }
}
