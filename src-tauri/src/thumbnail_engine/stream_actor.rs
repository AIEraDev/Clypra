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
use tauri::Manager;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::thumbnail_engine::decoder::{
    get_preview_decoder_for_stream, preview_pool_key, DecodeFrameOptions, VideoColorMetadata,
    VideoDecoder, VideoStreamMetadata,
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
    pub decoder_seek_time_us: u32,
    pub decoder_seek_count: u32,
    pub decoder_frames_decoded: u32,
    pub hardware_frame_download_us: Option<u64>,
    pub scale_colorspace_us: u64,
    pub hardware_frames_downloaded: u32,
    pub source_metadata: VideoStreamMetadata,
    /// How this frame request was satisfied by the decoder.
    pub served_from: crate::native_core::performance::ServedFrom,
    pub hw_device_type: Option<String>,
    /// Number of times this frame was served to a playback or scrub request.
    /// If 0 when evicted from prime_cache, this was a wasted download.
    pub served_count: u32,
}

static PRODUCER_DOWNLOADS_WASTED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub fn producer_downloads_wasted() -> u64 {
    PRODUCER_DOWNLOADS_WASTED.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn reset_producer_downloads_wasted() {
    PRODUCER_DOWNLOADS_WASTED.store(0, std::sync::atomic::Ordering::Relaxed);
}

static PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

pub fn producer_lookahead_downloads_skipped() -> u64 {
    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn reset_producer_lookahead_downloads_skipped() {
    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.store(0, std::sync::atomic::Ordering::Relaxed);
}

pub use crate::native_core::performance::{
    lookahead_trigger_count, lookahead_trigger_dropped, producer_ahead_of_clock_ms,
    producer_idle_total_ms, record_lookahead_trigger, record_lookahead_trigger_dropped,
    record_producer_ahead_of_clock_ms, record_producer_idle_us,
};

/// Calculate the selective hardware download stride for lookahead priming (Arm 2b).
///
/// On hardware decoders during active playback, downloading every single frame over
/// PCIe on integrated GPUs (e.g. Intel HD 520) consumes 32–40 ms per frame, starving
/// the GPU and bus. By decoding intermediate frames on the GPU without host transfer
/// (`skip_hw_download: true`), the hardware DPB stays warm while host PCIe transfers
/// drop by 50%–66%.
///
/// Returns 1 when hardware acceleration is disabled, when not playing, or when manually forced.
pub fn calculate_download_stride(
    frame_duration_secs: f64,
    is_hw_accel: bool,
    is_playback: bool,
) -> usize {
    if !is_hw_accel || !is_playback {
        return 1;
    }

    if let Ok(val) = std::env::var("CLYPRA_PRODUCER_DOWNLOAD_STRIDE") {
        if let Ok(stride) = val.trim().parse::<usize>() {
            return stride.clamp(1, 6);
        }
    }

    let stream_fps = if frame_duration_secs > 0.0 {
        1.0 / frame_duration_secs
    } else {
        30.0
    };

    if stream_fps >= 48.0 {
        3 // 50/60 fps -> download every 3rd frame (~16-20 fps presentation)
    } else if stream_fps >= 23.0 {
        2 // 24/25/30 fps -> download every 2nd frame (~12-15 fps presentation)
    } else {
        1 // low fps stream -> download every frame
    }
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
                PRODUCER_DOWNLOADS_WASTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
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
                            if let Some(evicted) = cache.pop_front() {
                                if evicted.served_count == 0 {
                                    PRODUCER_DOWNLOADS_WASTED
                                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
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

        // PR4: record idle time between finishing one prime and starting this one
        let prime_start = std::time::Instant::now();

        let is_hw_accel = {
            let guard = self.decoder.lock().await;
            guard.is_hardware_accelerated()
        };
        let stride =
            calculate_download_stride(self.frame_duration_secs, is_hw_accel, options.is_playback);
        let lookahead_steps = (2 * stride).min(6);

        // PR4: record idle time (from call site to first actual work step)
        {
            let idle_us = prime_start.elapsed().as_micros().min(u64::MAX as u128) as u64;
            record_producer_idle_us(idle_us);
        }

        for step in 1..=lookahead_steps {
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
            let is_target = step % stride == 0;

            // Check if already in cache (only target display frames enter prime_cache)
            if is_target {
                let cache = self.prime_cache.lock().await;
                if cache.iter().any(|f| {
                    (f.time_secs - prime_time).abs() <= tolerance && f.quality == options.quality
                }) {
                    continue;
                }
            }

            let mut step_options = options;
            step_options.skip_hw_download = !is_target && is_hw_accel;

            let current_gen = self.current_generation.load(Ordering::Acquire);
            match self.decode_one(prime_time, step_options, current_gen).await {
                Ok(frame) => {
                    // Only target display frames (or software frames) are placed
                    // into prime_cache. Intermediate skipped frames have dummy planes
                    // and serve only to advance the hardware DPB on the GPU.
                    if is_target || !is_hw_accel {
                        let mut cache = self.prime_cache.lock().await;
                        if cache.len() >= MAX_PRIME_CACHE_ENTRIES {
                            if let Some(evicted) = cache.pop_front() {
                                if evicted.served_count == 0 {
                                    PRODUCER_DOWNLOADS_WASTED
                                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                        }
                        cache.push_back(frame.clone());
                    } else {
                        PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }

                    if let Some(app) = crate::diagnostics::app_handle() {
                        if let Some(service) = app.try_state::<tokio::sync::Mutex<crate::native_core::NativeFrameService>>() {
                            if let Ok(mut service) = service.try_lock() {
                                service.record_sample(crate::native_core::performance::PerformanceSample {
                                    request_id: format!("prime:{:.3}", frame.time_secs),
                                    frame_index: (frame.time_secs / frame_duration).round() as u64,
                                    decode_time_us: frame.decode_us,
                                    compose_time_us: 0,
                                    readback_time_us: 0,
                                    total_time_us: frame.decode_us,
                                    bytes_transferred: 0,
                                    cache_hit: false,
                                    generation: Some(current_gen),
                                    mode: Some(crate::native_core::performance::PreviewMode::PlaybackLookahead),
                                    quality: Some(format!("{:?}", options.quality)),
                                    strategy: Some(if step_options.skip_hw_download {
                                        "PRODUCER_PRIME_SKIP_DL".to_string()
                                    } else {
                                        "PRODUCER_PRIME".to_string()
                                    }),
                                    transfer_path: Some(if step_options.skip_hw_download {
                                        "gpu-dpb-only".to_string()
                                    } else {
                                        "prime-cache".to_string()
                                    }),
                                    cancelled: false,
                                    stale: false,
                                    dropped: false,
                                    drop_reason: None,
                                    seek_time_us: frame.decoder_seek_time_us,
                                    conversion_time_us: 0,
                                    upload_time_us: 0,
                                    present_time_us: 0,
                                    decode_us: Some(u64::from(frame.decode_us)),
                                    conversion_upload_us: None,
                                    compose_us: None,
                                    readback_us: None,
                                    map_wait_us: None,
                                    timestamp_query_available: None,
                                    present_us: None,
                                    scheduler_wait_us: None,
                                    lookahead_wait_us: None,
                                    cold_start_init_us: None,
                                    queue_residency_us: None,
                                    ipc_wait_us: None,
                                    decoder_mutex_wait_us: Some(frame.decoder_mutex_wait_us),
                                    actor_wait_us: None,
                                    gpu_queue_wait_us: None,
                                    surface_acquire_us: None,
                                    submit_present_us: None,
                                    capability_policy: None,
                                    capability_probe_us: None,
                                    demux_wait_us: Some(u64::from(frame.demux_us)),
                                    container_format: Some(frame.container_format.clone()),
                                    is_hardware_accelerated: Some(frame.is_hardware_accelerated),
                                    decoder_seek_count: Some(frame.decoder_seek_count),
                                    decoder_frames_decoded: Some(frame.decoder_frames_decoded),
                                    hardware_frame_download_us: if step_options.skip_hw_download {
                                        None
                                    } else {
                                        frame.hardware_frame_download_us
                                    },
                                    scale_colorspace_us: Some(if step_options.skip_hw_download {
                                        0
                                    } else {
                                        frame.scale_colorspace_us
                                    }),
                                    source_width: Some(frame.source_metadata.width),
                                    source_height: Some(frame.source_metadata.height),
                                    source_bits_per_raw_sample: Some(frame.source_metadata.bits_per_raw_sample),
                                    source_frame_rate_milli: frame.source_metadata.average_frame_rate_milli(),
                                    unaccounted_us: Some(0),
                                    codec_name: Some(frame.source_metadata.codec_name.clone()),
                                    hardware_frames_downloaded: Some(if step_options.skip_hw_download {
                                        0
                                    } else {
                                        frame.hardware_frames_downloaded
                                    }),
                                    stage_overlap_us: Some(0),
                                    served_from: Some(frame.served_from),
                                    hw_device_type: frame.hw_device_type.clone(),
                                    cache_lock_wait_us: None,
                                    cache_insert_us: None,
                                });
                            }
                        }
                    }
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
            let source_metadata = guard.metadata();
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
                        let (seek_count, seek_time_us, frames_decoded, download_us, scale_us, hw_downloaded_count, served_from, hw_device_type) =
                            guard.last_decode_activity();
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
                            seek_count,
                            seek_time_us,
                            frames_decoded,
                            download_us,
                            scale_us,
                            hw_downloaded_count,
                            served_from,
                            hw_device_type,
                            source_metadata,
                        ));
                    }
                    Ok(None) => {
                        // Software or non-D3D11 frame or unsupported zero-copy; disable runtime DXGI probing
                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
                    }
                    Err(err) => {
                        if err.contains("cancelled") {
                            return Err(err);
                        }
                        log::warn!(
                            "[StreamActor] DXGI decode failed at {}s: {}, attempting CPU NV12 fallback",
                            target_time,
                            err
                        );
                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
                        // Non-fatal: proceed to CPU NV12 fallback below
                    }
                }
            }

            let frame_res =
                guard.decode_frame_raw_nv12_with_options(target_time, options, is_cancelled);
            let is_approx = guard.is_last_frame_approximate();
            let demux_us = guard.last_demux_us();
            let (seek_count, seek_time_us, frames_decoded, download_us, scale_us, hw_downloaded_count, served_from, hw_device_type) =
                guard.last_decode_activity();

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
                        seek_count,
                        seek_time_us,
                        frames_decoded,
                        download_us,
                        scale_us,
                        hw_downloaded_count,
                        served_from,
                        hw_device_type,
                        source_metadata,
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
            decoder_seek_count,
            decoder_seek_time_us,
            decoder_frames_decoded,
            hardware_frame_download_us,
            scale_colorspace_us,
            hardware_frames_downloaded,
            served_from,
            hw_device_type,
            source_metadata,
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
            decoder_seek_time_us,
            decoder_seek_count,
            decoder_frames_decoded,
            hardware_frame_download_us,
            scale_colorspace_us,
            hardware_frames_downloaded,
            served_from,
            hw_device_type: hw_device_type.map(|s| s.to_string()),
            served_count: 0,
            source_metadata,
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
            decoder_seek_time_us: 0,
            decoder_seek_count: 0,
            decoder_frames_decoded: 0,
            hardware_frame_download_us: None,
            scale_colorspace_us: 0,
            hardware_frames_downloaded: 0,
            source_metadata: VideoStreamMetadata::default(),
            served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
            hw_device_type: None,
            served_count: 0,
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
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
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
            decoder_seek_time_us: 0,
            decoder_seek_count: 0,
            decoder_frames_decoded: 0,
            hardware_frame_download_us: None,
            scale_colorspace_us: 0,
            hardware_frames_downloaded: 0,
            source_metadata: VideoStreamMetadata::default(),
            served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
            hw_device_type: None,
            served_count: 0,
        };
        prime_cache.lock().await.push_back(approx_frame);

        // Approximate request hits prime cache
        let opts_approx = DecodeFrameOptions {
            allow_keyframe_approx: true,
            quality: QualityTier::Full,
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
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
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
        };
        let err_exact = handle.decode_frame(2.0, opts_exact, false, 0).await;
        assert!(
            err_exact.is_err(),
            "Exact request must not return approximate cached frame"
        );

        let opts_half = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Half,
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
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
    async fn playback_uses_newest_eligible_cached_frame_without_seeking_back() {
        let (urgent_tx, _urgent_rx) = mpsc::channel(1);
        let (prefetch_tx, _prefetch_rx) = mpsc::channel(1);
        let prime_cache = Arc::new(Mutex::new(VecDeque::new()));
        prime_cache.lock().await.push_back(DecodedActorFrame {
            time_secs: 2.0,
            planes: DecodedVideoPlanes::Cpu {
                y: Arc::from(vec![0u8; 16]),
                uv: Arc::from(vec![0u8; 8]),
            },
            width: 4,
            height: 4,
            source_rotation: 0,
            color: VideoColorMetadata::default(),
            decode_us: 99,
            decoder_mutex_wait_us: 0,
            actor_wait_us: 0,
            from_prime_cache: false,
            quality: QualityTier::Full,
            is_approximate: false,
            demux_us: 0,
            container_format: "mp4".to_string(),
            is_hardware_accelerated: false,
            decoder_seek_time_us: 0,
            decoder_seek_count: 1,
            decoder_frames_decoded: 99,
            hardware_frame_download_us: None,
            scale_colorspace_us: 0,
            hardware_frames_downloaded: 0,
            source_metadata: VideoStreamMetadata::default(),
            served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
            hw_device_type: None,
            served_count: 0,
        });
        let handle = StreamDecoderActorHandle {
            key: "playback-cache-test".to_string(),
            urgent_tx,
            prefetch_tx,
            current_generation: Arc::new(AtomicU64::new(0)),
            cancel_in_flight: Arc::new(AtomicBool::new(false)),
            prime_cache,
            frame_duration_secs: 1.0 / 30.0,
        };

        // The requested clock time is older than the decoded cursor. Exact
        // seek would re-seek here; playback must show the current frame.
        let frame = handle
            .decode_playback_frame(
                1.8,
                DecodeFrameOptions {
                    allow_keyframe_approx: false,
                    quality: QualityTier::Full,
                    is_playback: true,
                    skip_hw_download: false,
                    target_dimensions: None,
                },
                0,
            )
            .await
            .expect("latest playback cache frame should satisfy late request");

        assert_eq!(frame.time_secs, 2.0);
        assert!(frame.from_prime_cache);
        assert_eq!(frame.decode_us, 0);
        assert_eq!(frame.decoder_seek_count, 0);
        assert_eq!(frame.decoder_frames_decoded, 0);
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
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
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

    #[tokio::test]
    async fn test_wasted_download_accounting_and_reset() {
        reset_producer_downloads_wasted();
        assert_eq!(producer_downloads_wasted(), 0);

        let prime_cache = Arc::new(Mutex::new(VecDeque::new()));
        let (urgent_tx, _) = mpsc::channel(1);
        let (prefetch_tx, _) = mpsc::channel(1);
        let handle = StreamDecoderActorHandle {
            key: "test_wasted".to_string(),
            urgent_tx,
            prefetch_tx,
            current_generation: Arc::new(AtomicU64::new(0)),
            cancel_in_flight: Arc::new(AtomicBool::new(false)),
            prime_cache: prime_cache.clone(),
            frame_duration_secs: 0.04,
        };

        // Add 2 frames that were never served (served_count = 0)
        {
            let mut cache = prime_cache.lock().await;
            cache.push_back(DecodedActorFrame {
                time_secs: 0.0,
                decode_us: 1000,
                decoder_mutex_wait_us: 100,
                actor_wait_us: 50,
                demux_us: 200,
                container_format: "mp4".to_string(),
                is_hardware_accelerated: true,
                decoder_seek_count: 0,
                decoder_seek_time_us: 0,
                decoder_frames_decoded: 1,
                hardware_frame_download_us: Some(5000),
                hardware_frames_downloaded: 1,
                scale_colorspace_us: 100,
                source_metadata: VideoStreamMetadata::default(),
                planes: DecodedVideoPlanes::Cpu {
                    y: Arc::from(vec![0u8; 16]),
                    uv: Arc::from(vec![0u8; 8]),
                },
                width: 320,
                height: 180,
                color: VideoColorMetadata::default(),
                source_rotation: 0,
                served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
                from_prime_cache: false,
                quality: QualityTier::Full,
                is_approximate: false,
                hw_device_type: Some("d3d11va".to_string()),
                served_count: 0,
            });
            cache.push_back(DecodedActorFrame {
                time_secs: 0.04,
                decode_us: 1000,
                decoder_mutex_wait_us: 100,
                actor_wait_us: 50,
                demux_us: 200,
                container_format: "mp4".to_string(),
                is_hardware_accelerated: true,
                decoder_seek_count: 0,
                decoder_seek_time_us: 0,
                decoder_frames_decoded: 1,
                hardware_frame_download_us: Some(5000),
                hardware_frames_downloaded: 1,
                scale_colorspace_us: 100,
                source_metadata: VideoStreamMetadata::default(),
                planes: DecodedVideoPlanes::Cpu {
                    y: Arc::from(vec![0u8; 16]),
                    uv: Arc::from(vec![0u8; 8]),
                },
                width: 320,
                height: 180,
                color: VideoColorMetadata::default(),
                source_rotation: 0,
                served_from: crate::native_core::performance::ServedFrom::DecodedInRequest,
                from_prime_cache: false,
                quality: QualityTier::Full,
                is_approximate: false,
                hw_device_type: Some("d3d11va".to_string()),
                served_count: 0,
            });
        }

        // Clear cache should count both unserved frames as wasted downloads
        handle.clear_prime_cache().await;
        assert_eq!(producer_downloads_wasted(), 2);

        // Reset must return count to zero
        reset_producer_downloads_wasted();
        assert_eq!(producer_downloads_wasted(), 0);
    }

    #[test]
    fn test_calculate_download_stride_rules() {
        // 1. Software decode always downloads every frame
        assert_eq!(calculate_download_stride(1.0 / 25.0, false, true), 1);
        assert_eq!(calculate_download_stride(1.0 / 60.0, false, true), 1);

        // 2. Non-playback modes (seek, scrub, frame-step) always download every frame
        assert_eq!(calculate_download_stride(1.0 / 25.0, true, false), 1);
        assert_eq!(calculate_download_stride(1.0 / 60.0, true, false), 1);

        // 3. Hardware-accelerated playback adapts based on stream frame rate
        // Standard film / broadcast (24, 25, 30 fps) -> stride 2 (~12-15 fps presentation)
        assert_eq!(calculate_download_stride(1.0 / 24.0, true, true), 2);
        assert_eq!(calculate_download_stride(1.0 / 25.0, true, true), 2);
        assert_eq!(calculate_download_stride(1.0 / 30.0, true, true), 2);

        // High frame rate (50, 60 fps) -> stride 3 (~16-20 fps presentation)
        assert_eq!(calculate_download_stride(1.0 / 50.0, true, true), 3);
        assert_eq!(calculate_download_stride(1.0 / 60.0, true, true), 3);

        // Low frame rate (<= 15 fps) -> stride 1
        assert_eq!(calculate_download_stride(1.0 / 12.0, true, true), 1);
        assert_eq!(calculate_download_stride(1.0 / 15.0, true, true), 1);
    }

    #[test]
    fn test_producer_lookahead_downloads_skipped_accounting() {
        reset_producer_lookahead_downloads_skipped();
        assert_eq!(producer_lookahead_downloads_skipped(), 0);

        PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.fetch_add(5, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(producer_lookahead_downloads_skipped(), 5);

        reset_producer_lookahead_downloads_skipped();
        assert_eq!(producer_lookahead_downloads_skipped(), 0);
    }
}
