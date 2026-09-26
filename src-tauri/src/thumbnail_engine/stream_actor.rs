//! Stream Decoder Actor
//!
//! Provides dedicated, serialized, GOP-aware decoding per media stream.
//! Eliminates lock thrashing and backward seek cascades between the visible
//! presentation thread and background lookahead predecoding.
//!
//! Architectural invariants:
//! 1. Exactly one actor per `(video_path, stream_id)` pair.
//! 2. Urgent presentation requests always preempt background lookahead.
//! 3. Opportunistic forward priming populates an in-memory prime cache
//!    ahead of the playback playhead, making sequential frames available
//!    at near-zero (<10µs) latency.
//! 4. In-flight background decodes are cancelled immediately when a newer
//!    urgent request or generation arrives.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use once_cell::sync::Lazy;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::thumbnail_engine::decoder::{
    get_preview_decoder_for_stream, preview_pool_key, DecodeFrameOptions, VideoColorMetadata,
    VideoDecoder,
};
use clypra_native_core::QualityTier;

const MAX_PRIME_CACHE_ENTRIES: usize = 4;
const DEFAULT_FRAME_DURATION_SECS: f64 = 1.0 / 30.0;

/// Global registry of active stream decoder actors.
static PREVIEW_ACTOR_POOL: Lazy<DashMap<String, Arc<StreamDecoderActorHandle>>> =
    Lazy::new(DashMap::new);

/// Video plane storage supporting both CPU memory slices and Windows zero-copy DXGI textures.
#[derive(Clone)]
pub enum DecodedVideoPlanes {
    Cpu {
        y: Arc<[u8]>,
        uv: Arc<[u8]>,
    },
    #[cfg(target_os = "windows")]
    D3d11(Arc<crate::wgpu_compositor::dxgi_import::D3d11SharedFrame>),
}

impl DecodedVideoPlanes {
    /// Returns CPU Y and UV slices if available.
    pub fn cpu_planes(&self) -> Option<(&Arc<[u8]>, &Arc<[u8]>)> {
        match self {
            Self::Cpu { y, uv } => Some((y, uv)),
            #[cfg(target_os = "windows")]
            Self::D3d11(_) => None,
        }
    }

    /// Check whether two decoded plane representations point to the exact same underlying GPU/CPU buffer.
    pub fn is_same_source(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Cpu { y: y1, .. }, Self::Cpu { y: y2, .. }) => Arc::ptr_eq(y1, y2),
            #[cfg(target_os = "windows")]
            (Self::D3d11(s1), Self::D3d11(s2)) => {
                Arc::ptr_eq(s1, s2) || s1.nt_handle == s2.nt_handle
            }
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }
}

/// Result of decoding a frame through the stream decoder actor.
#[derive(Clone)]
pub struct DecodedActorFrame {
    pub time_secs: f64,
    pub planes: DecodedVideoPlanes,
    pub width: u32,
    pub height: u32,
    /// Source orientation from container metadata (0, 90, 180, 270 degrees).
    /// The raw NV12 planes are in storage/encoded orientation; callers that
    /// composite at the pixel level (i.e. native preview) must rotate the
    /// pixel data by this amount before uploading to the GPU.
    pub source_rotation: u32,
    pub color: VideoColorMetadata,
    pub decode_us: u32,
    pub decoder_mutex_wait_us: u64,
    pub actor_wait_us: u64,
    pub from_prime_cache: bool,
    pub quality: QualityTier,
    pub is_approximate: bool,
    pub demux_us: u32,
    pub container_format: String,
    pub is_hardware_accelerated: bool,
}

impl DecodedActorFrame {
    pub fn into_native_video_frame(
        self,
    ) -> (DecodedVideoPlanes, u32, u32, VideoColorMetadata, u32) {
        (
            self.planes,
            self.width,
            self.height,
            self.color,
            self.source_rotation,
        )
    }

    pub fn y_plane(&self) -> Option<&Arc<[u8]>> {
        match &self.planes {
            DecodedVideoPlanes::Cpu { y, .. } => Some(y),
            #[cfg(target_os = "windows")]
            DecodedVideoPlanes::D3d11(_) => None,
        }
    }

    pub fn uv_plane(&self) -> Option<&Arc<[u8]>> {
        match &self.planes {
            DecodedVideoPlanes::Cpu { uv, .. } => Some(uv),
            #[cfg(target_os = "windows")]
            DecodedVideoPlanes::D3d11(_) => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ActorDecodeRequest {
    pub time_secs: f64,
    pub options: DecodeFrameOptions,
    pub is_prefetch: bool,
    pub generation: u64,
}

pub struct StreamDecodeJob {
    pub request: ActorDecodeRequest,
    pub response_tx: oneshot::Sender<Result<DecodedActorFrame, String>>,
}

/// Handle to communicate with a stream decoder actor.
pub struct StreamDecoderActorHandle {
    key: String,
    urgent_tx: mpsc::Sender<StreamDecodeJob>,
    prefetch_tx: mpsc::Sender<StreamDecodeJob>,
    current_generation: Arc<AtomicU64>,
    cancel_in_flight: Arc<AtomicBool>,
    prime_cache: Arc<Mutex<VecDeque<DecodedActorFrame>>>,
    frame_duration_secs: f64,
}

impl StreamDecoderActorHandle {
    pub fn stream_key(&self) -> &str {
        &self.key
    }

    pub fn frame_duration_secs(&self) -> f64 {
        self.frame_duration_secs
    }

    /// Decode a frame with priority awareness and prime-cache acceleration.
    pub async fn decode_frame(
        &self,
        time_secs: f64,
        options: DecodeFrameOptions,
        is_prefetch: bool,
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
                }
                hit.from_prime_cache = true;
                hit.actor_wait_us = start.elapsed().as_micros().min(u64::MAX as u128) as u64;
                return Ok(hit);
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
        self.prime_cache.lock().await.clear();
    }
}

/// Actor loop running on a dedicated Tokio task.
struct StreamDecoderActor {
    decoder: Arc<Mutex<VideoDecoder>>,
    urgent_rx: mpsc::Receiver<StreamDecodeJob>,
    prefetch_rx: mpsc::Receiver<StreamDecodeJob>,
    current_generation: Arc<AtomicU64>,
    cancel_in_flight: Arc<AtomicBool>,
    prime_cache: Arc<Mutex<VecDeque<DecodedActorFrame>>>,
    frame_duration_secs: f64,
}

impl StreamDecoderActor {
    pub fn spawn(
        key: String,
        decoder: Arc<Mutex<VideoDecoder>>,
        frame_duration_secs: f64,
    ) -> Arc<StreamDecoderActorHandle> {
        let (urgent_tx, urgent_rx) = mpsc::channel(64);
        let (prefetch_tx, prefetch_rx) = mpsc::channel(64);
        let current_generation = Arc::new(AtomicU64::new(0));
        let cancel_in_flight = Arc::new(AtomicBool::new(false));
        let prime_cache = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_PRIME_CACHE_ENTRIES)));

        let handle = Arc::new(StreamDecoderActorHandle {
            key,
            urgent_tx,
            prefetch_tx,
            current_generation: current_generation.clone(),
            cancel_in_flight: cancel_in_flight.clone(),
            prime_cache: prime_cache.clone(),
            frame_duration_secs,
        });

        let mut actor = StreamDecoderActor {
            decoder,
            urgent_rx,
            prefetch_rx,
            current_generation,
            cancel_in_flight,
            prime_cache,
            frame_duration_secs,
        };

        tauri::async_runtime::spawn(async move {
            actor.run().await;
        });

        handle
    }

    async fn run(&mut self) {
        let mut last_decoded_time: Option<f64> = None;
        let mut last_decoded_options: Option<DecodeFrameOptions> = None;
        let mut pending_job: Option<StreamDecodeJob> = None;

        loop {
            // 1. Fetch next job with priority: urgent jobs always take precedence.
            let mut job = if let Some(j) = pending_job.take() {
                j
            } else {
                tokio::select! {
                    biased;
                    urgent = self.urgent_rx.recv() => match urgent {
                        Some(job) => job,
                        None => break, // Channel closed
                    },
                    prefetch = self.prefetch_rx.recv() => match prefetch {
                        Some(job) => job,
                        None => break, // Channel closed
                    },
                }
            };

            // DRAIN OBSOLETE URGENT JOBS:
            // In a seek-first architecture, if multiple urgent seek/scrub requests
            // arrived in rapid succession, older ones are superseded. Keep only the newest intent.
            if !job.request.is_prefetch {
                while let Ok(newer_job) = self.urgent_rx.try_recv() {
                    let _ = job
                        .response_tx
                        .send(Err("Request superseded by newer urgent intent".to_string()));
                    job = newer_job;
                }
            }

            // Reset cancel flag before starting decode for this job
            self.cancel_in_flight.store(false, Ordering::Release);

            // Check generation currency: skip obsolete requests
            let current_gen = self.current_generation.load(Ordering::Acquire);
            if job.request.generation > 0 && job.request.generation < current_gen {
                let _ = job
                    .response_tx
                    .send(Err("Request superseded by newer generation".to_string()));
                continue;
            }

            // If caller abandoned waiting, skip
            if job.response_tx.is_closed() {
                continue;
            }

            // Check prime cache before performing FFmpeg decode
            let tolerance = (self.frame_duration_secs * 0.95).max(0.001);
            let mut cache_hit = None;
            {
                let mut cache = self.prime_cache.lock().await;
                if let Some(pos) = cache.iter().position(|f| {
                    (!f.is_approximate || job.request.options.allow_keyframe_approx)
                        && (f.time_secs - job.request.time_secs).abs() <= tolerance
                        && f.quality == job.request.options.quality
                }) {
                    let mut hit = cache[pos].clone();
                    if pos != cache.len() - 1 {
                        let item = cache.remove(pos).unwrap();
                        cache.push_back(item);
                    }
                    hit.from_prime_cache = true;
                    cache_hit = Some(hit);
                }
            }

            if let Some(hit) = cache_hit {
                let _ = job.response_tx.send(Ok(hit));
                continue;
            }

            // Perform single decode
            let target_time = job.request.time_secs;
            let options = job.request.options;
            let res = self
                .decode_one(target_time, options, job.request.generation)
                .await;

            match res {
                Ok(frame) => {
                    last_decoded_time = Some(target_time);
                    last_decoded_options = Some(options);

                    // Insert into prime cache
                    {
                        let mut cache = self.prime_cache.lock().await;
                        if cache.len() >= MAX_PRIME_CACHE_ENTRIES {
                            cache.pop_front();
                        }
                        cache.push_back(frame.clone());
                    }

                    let _ = job.response_tx.send(Ok(frame));
                }
                Err(err) => {
                    let _ = job.response_tx.send(Err(err));
                }
            }

            // 2. Opportunistic Forward Priming:
            // When idle, prime the next 1-2 frames forward sequentially.
            // Any newly arrived job interrupts priming and is returned as pending_job.
            if let (Some(base_time), Some(opts)) = (last_decoded_time, last_decoded_options) {
                if !opts.allow_keyframe_approx {
                    pending_job = self.try_prime_forward(base_time, opts).await;
                }
            }
        }
    }

    /// Attempt to prime forward frames into the prime cache while the channel is idle.
    /// Returns any real job that arrived during priming so it can be handled immediately.
    async fn try_prime_forward(
        &mut self,
        base_time: f64,
        options: DecodeFrameOptions,
    ) -> Option<StreamDecodeJob> {
        let frame_duration = self.frame_duration_secs.max(0.001);
        let tolerance = (frame_duration * 0.95).max(0.001);

        for step in 1..=2 {
            // Check if a real job arrived
            match self.urgent_rx.try_recv() {
                Ok(urgent_job) => return Some(urgent_job),
                Err(mpsc::error::TryRecvError::Disconnected) => return None,
                Err(mpsc::error::TryRecvError::Empty) => {}
            }
            match self.prefetch_rx.try_recv() {
                Ok(prefetch_job) => return Some(prefetch_job),
                Err(mpsc::error::TryRecvError::Disconnected) => return None,
                Err(mpsc::error::TryRecvError::Empty) => {}
            }

            if self.cancel_in_flight.load(Ordering::Acquire) {
                return None;
            }

            let prime_time = base_time + step as f64 * frame_duration;

            // Check if already in cache
            {
                let cache = self.prime_cache.lock().await;
                if cache.iter().any(|f| {
                    (f.time_secs - prime_time).abs() <= tolerance && f.quality == options.quality
                }) {
                    continue;
                }
            }

            let current_gen = self.current_generation.load(Ordering::Acquire);
            match self.decode_one(prime_time, options, current_gen).await {
                Ok(frame) => {
                    let mut cache = self.prime_cache.lock().await;
                    if cache.len() >= MAX_PRIME_CACHE_ENTRIES {
                        cache.pop_front();
                    }
                    cache.push_back(frame);
                }
                Err(_) => {
                    // Stop priming on error or cancellation
                    return None;
                }
            }
        }

        None
    }

    async fn decode_one(
        &self,
        target_time: f64,
        options: DecodeFrameOptions,
        job_generation: u64,
    ) -> Result<DecodedActorFrame, String> {
        let decoder = Arc::clone(&self.decoder);
        let cancel_token = Arc::clone(&self.cancel_in_flight);
        let cancel_gen = Arc::clone(&self.current_generation);

        let is_cancelled = move || {
            cancel_token.load(Ordering::Acquire)
                || (job_generation > 0 && cancel_gen.load(Ordering::Acquire) > job_generation)
        };

        let result = tokio::task::spawn_blocking(move || {
            let mutex_started = Instant::now();
            let mut guard = decoder.blocking_lock();
            let mutex_wait_us = mutex_started.elapsed().as_micros() as u64;
            let decode_started = Instant::now();
            let stream_color = guard.metadata().color;
            let container_format = guard.container_format().to_string();
            let is_hardware_accelerated = guard.is_hardware_accelerated();
            let source_rotation = guard.rotation();

            #[cfg(target_os = "windows")]
            if crate::wgpu_compositor::adapter_selector::is_dxgi_runtime_enabled() {
                let mut frame_color = VideoColorMetadata::default();
                let mut width = 0u32;
                let mut height = 0u32;
                match guard.decode_frame_dxgi_windows(
                    target_time,
                    options,
                    &is_cancelled,
                    &mut frame_color,
                    &mut width,
                    &mut height,
                ) {
                    Ok(Some(shared)) => {
                        let decode_us =
                            decode_started.elapsed().as_micros().min(u32::MAX as u128) as u32;
                        let color = crate::commands::native_preview::merge_color_metadata(
                            frame_color,
                            &stream_color,
                        );
                        let is_approx = guard.is_last_frame_approximate();
                        let demux_us = guard.last_demux_us();
                        return Ok((
                            DecodedVideoPlanes::D3d11(Arc::new(shared)),
                            width,
                            height,
                            color,
                            decode_us,
                            mutex_wait_us,
                            is_approx,
                            demux_us,
                            container_format,
                            is_hardware_accelerated,
                            source_rotation,
                        ));
                    }
                    Ok(None) => {
                        // Software or non-D3D11 frame; proceed to CPU fallback below
                    }
                    Err(err) => return Err(err),
                }
            }

            let frame_res =
                guard.decode_frame_raw_nv12_with_options(target_time, options, is_cancelled);
            let is_approx = guard.is_last_frame_approximate();
            let demux_us = guard.last_demux_us();

            let decode_us = decode_started.elapsed().as_micros().min(u32::MAX as u128) as u32;

            match frame_res {
                Ok((y_plane, uv_plane, width, height, frame_color)) => {
                    let color = crate::commands::native_preview::merge_color_metadata(
                        frame_color,
                        &stream_color,
                    );
                    Ok((
                        DecodedVideoPlanes::Cpu {
                            y: y_plane,
                            uv: uv_plane,
                        },
                        width,
                        height,
                        color,
                        decode_us,
                        mutex_wait_us,
                        is_approx,
                        demux_us,
                        container_format,
                        is_hardware_accelerated,
                        source_rotation,
                    ))
                }
                Err(err) => Err(err),
            }
        })
        .await
        .map_err(|e| format!("Decode spawn_blocking panicked: {e}"))?;

        let (
            planes,
            width,
            height,
            color,
            decode_us,
            mutex_wait_us,
            is_approx,
            demux_us,
            container_format,
            is_hardware_accelerated,
            source_rotation,
        ) = result?;

        Ok(DecodedActorFrame {
            time_secs: target_time,
            planes,
            width,
            height,
            source_rotation,
            color,
            decode_us,
            decoder_mutex_wait_us: mutex_wait_us,
            actor_wait_us: 0,
            from_prime_cache: false,
            quality: options.quality,
            is_approximate: is_approx,
            demux_us,
            container_format,
            is_hardware_accelerated,
        })
    }
}

/// Retrieve or spawn a dedicated stream decoder actor for the given stream.
pub async fn get_preview_decoder_actor_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<Arc<StreamDecoderActorHandle>, String> {
    let key = preview_pool_key(path, stream_id);
    if let Some(actor) = PREVIEW_ACTOR_POOL.get(&key) {
        return Ok(actor.value().clone());
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

    PREVIEW_ACTOR_POOL.insert(key, actor.clone());
    Ok(actor)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn test_prime_cache_direct_hit() {
        let dummy_key = "test_stream::dummy".to_string();
        let (urgent_tx, _urgent_rx) = mpsc::channel(1);
        let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
        let current_generation = Arc::new(AtomicU64::new(0));
        let cancel_in_flight = Arc::new(AtomicBool::new(false));
        let prime_cache = Arc::new(Mutex::new(VecDeque::new()));

        let cached_frame = DecodedActorFrame {
            time_secs: 1.0,
            planes: DecodedVideoPlanes::Cpu {
                y: Arc::from(vec![0u8; 16]),
                uv: Arc::from(vec![0u8; 8]),
            },
            width: 4,
            height: 4,
            source_rotation: 0,
            color: VideoColorMetadata::default(),
            decode_us: 100,
            decoder_mutex_wait_us: 50,
            actor_wait_us: 0,
            from_prime_cache: false,
            quality: QualityTier::Full,
            is_approximate: false,
            demux_us: 10,
            container_format: "mp4".to_string(),
            is_hardware_accelerated: false,
        };

        prime_cache.lock().await.push_back(cached_frame);

        let handle = StreamDecoderActorHandle {
            key: dummy_key,
            urgent_tx,
            prefetch_tx,
            current_generation,
            cancel_in_flight,
            prime_cache: prime_cache.clone(),
            frame_duration_secs: 1.0 / 30.0,
        };

        let opts = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
        };

        // Exact match
        let res = handle
            .decode_frame(1.0, opts, false, 0)
            .await
            .expect("should hit prime cache");
        assert!(res.from_prime_cache);
        assert_eq!(res.time_secs, 1.0);

        // Within tolerance match (frame duration is 0.0333s, diff 0.01s is within tolerance)
        let res_near = handle
            .decode_frame(1.01, opts, false, 0)
            .await
            .expect("should hit near match");
        assert!(res_near.from_prime_cache);

        // Insert an approximate frame into prime cache
        let approx_frame = DecodedActorFrame {
            time_secs: 2.0,
            planes: DecodedVideoPlanes::Cpu {
                y: Arc::from(vec![0u8; 16]),
                uv: Arc::from(vec![0u8; 8]),
            },
            width: 4,
            height: 4,
            source_rotation: 0,
            color: VideoColorMetadata::default(),
            decode_us: 10,
            decoder_mutex_wait_us: 5,
            actor_wait_us: 0,
            from_prime_cache: false,
            quality: QualityTier::Full,
            is_approximate: true,
            demux_us: 10,
            container_format: "mp4".to_string(),
            is_hardware_accelerated: false,
        };
        prime_cache.lock().await.push_back(approx_frame);

        // Approximate request hits prime cache
        let opts_approx = DecodeFrameOptions {
            allow_keyframe_approx: true,
            quality: QualityTier::Full,
        };
        let res_approx = handle
            .decode_frame(2.0, opts_approx, false, 0)
            .await
            .expect("approx request should hit approx cached frame");
        assert!(res_approx.from_prime_cache);

        // Exact request (allow_keyframe_approx: false) must NOT hit approximate cached frame!
        // Because channel is empty/closed, this will fail or skip cache rather than returning approx
        drop(_urgent_rx);
        drop(_prefetch_rx);
        let opts_exact = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
        };
        let err_exact = handle.decode_frame(2.0, opts_exact, false, 0).await;
        assert!(
            err_exact.is_err(),
            "Exact request must not return approximate cached frame"
        );

        let opts_half = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Half,
        };
        // Channel is closed, so decode_frame fails immediately
        let err = handle.decode_frame(1.0, opts_half, false, 0).await;
        assert!(err.is_err());
    }

    #[test]
    fn test_handle_invalidation() {
        let dummy_key = "test_stream::dummy".to_string();
        let (urgent_tx, _urgent_rx) = mpsc::channel(1);
        let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
        let current_generation = Arc::new(AtomicU64::new(0));
        let cancel_in_flight = Arc::new(AtomicBool::new(false));
        let prime_cache = Arc::new(Mutex::new(VecDeque::new()));

        let handle = StreamDecoderActorHandle {
            key: dummy_key,
            urgent_tx,
            prefetch_tx,
            current_generation: current_generation.clone(),
            cancel_in_flight: cancel_in_flight.clone(),
            prime_cache,
            frame_duration_secs: 1.0 / 30.0,
        };

        handle.invalidate(42);
        assert_eq!(current_generation.load(Ordering::Acquire), 42);
        assert!(cancel_in_flight.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn test_actor_with_real_video_asset_if_available() {
        let test_asset = "/Users/AIEraDev/Documents/clypra-testing-assets/Antler.mp4";
        if !Path::new(test_asset).exists() {
            eprintln!("[INFO] Skipping real asset test; {} not found", test_asset);
            return;
        }

        let actor = get_preview_decoder_actor_for_stream(test_asset, "test-stream-1")
            .await
            .expect("should create actor for stream");

        let opts = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
        };

        // Frame 0 decode
        let f0 = actor
            .decode_frame(0.0, opts, false, 1)
            .await
            .expect("decode frame 0");
        assert!(!f0.from_prime_cache);
        assert!(f0.width > 0);
        assert!(f0.height > 0);

        // Give actor task a brief moment to prime forward
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Next sequential frame should ideally hit the prime cache
        let frame_duration = actor.frame_duration_secs();
        let f1 = actor
            .decode_frame(frame_duration, opts, false, 1)
            .await
            .expect("decode frame 1");
        assert_eq!(f1.width, f0.width);
        assert_eq!(f1.height, f0.height);

        // Invalidate and seek
        actor.invalidate(2);
        let f_seek = actor
            .decode_frame(1.5, opts, false, 2)
            .await
            .expect("seek decode");
        assert_eq!(f_seek.width, f0.width);

        release_preview_decoder_actor_for_stream(test_asset, "test-stream-1");
    }
}
