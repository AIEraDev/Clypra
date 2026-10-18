use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tokio::sync::{mpsc, Mutex};

use crate::filmstrip_engine::decoder::{DecodeFrameOptions, VideoDecoder};
use crate::filmstrip_engine::stream_actor::handle::StreamDecoderActorHandle;
use crate::filmstrip_engine::stream_actor::types::{
    calculate_download_stride, record_producer_idle_us, DecodedActorFrame, DecodedVideoPlanes,
    StreamDecodeJob, MAX_PRIME_CACHE_ENTRIES, PRODUCER_DOWNLOADS_WASTED,
    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED,
};

/// Actor loop running on a dedicated Tokio task.
pub(crate) struct StreamDecoderActor {
    pub(crate) decoder: Arc<Mutex<VideoDecoder>>,
    pub(crate) urgent_rx: mpsc::Receiver<StreamDecodeJob>,
    pub(crate) prefetch_rx: mpsc::Receiver<StreamDecodeJob>,
    pub(crate) current_generation: Arc<AtomicU64>,
    pub(crate) cancel_in_flight: Arc<AtomicBool>,
    pub(crate) prime_cache: Arc<Mutex<VecDeque<DecodedActorFrame>>>,
    pub(crate) frame_duration_secs: f64,
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
        let last_accessed_ms = Arc::new(AtomicU64::new(
            crate::filmstrip_engine::decoder::current_timestamp_ms(),
        ));

        let handle = Arc::new(StreamDecoderActorHandle {
            key,
            urgent_tx,
            prefetch_tx,
            current_generation: current_generation.clone(),
            cancel_in_flight: cancel_in_flight.clone(),
            prime_cache: prime_cache.clone(),
            frame_duration_secs,
            last_accessed_ms,
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
                                    dxgi_latched_off: None,
                                    dxgi_latch_reason: None,
                                    dxgi_latch_context: None,
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
                let mut frame_color =
                    crate::filmstrip_engine::decoder::VideoColorMetadata::default();
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
                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled_with_context(
                            crate::wgpu_compositor::adapter_selector::DxgiLatchReasonCode::NonD3d11Surface,
                            crate::wgpu_compositor::adapter_selector::DxgiLatchContext {
                                codec: Some(source_metadata.codec_name.clone()),
                                bit_depth: Some(source_metadata.bits_per_raw_sample),
                                source_width: Some(source_metadata.width),
                                source_height: Some(source_metadata.height),
                                hw_device_type: guard.hw_device_type().map(|s| s.to_string()),
                                latched_at_ms: crate::native_core::performance::now_ms(),
                                latch_kind: crate::wgpu_compositor::adapter_selector::latch_kind_for(
                                    crate::wgpu_compositor::adapter_selector::DxgiLatchReasonCode::NonD3d11Surface,
                                ),
                            },
                        );
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
                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled_with_context(
                            crate::wgpu_compositor::adapter_selector::DxgiLatchReasonCode::DxgiDecodeFailed,
                            crate::wgpu_compositor::adapter_selector::DxgiLatchContext {
                                codec: Some(source_metadata.codec_name.clone()),
                                bit_depth: Some(source_metadata.bits_per_raw_sample),
                                source_width: Some(source_metadata.width),
                                source_height: Some(source_metadata.height),
                                hw_device_type: guard.hw_device_type().map(|s| s.to_string()),
                                latched_at_ms: crate::native_core::performance::now_ms(),
                                latch_kind: crate::wgpu_compositor::adapter_selector::latch_kind_for(
                                    crate::wgpu_compositor::adapter_selector::DxgiLatchReasonCode::DxgiDecodeFailed,
                                ),
                            },
                        );
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
            source_metadata,
            served_from,
            hw_device_type: hw_device_type.map(|s| s.to_string()),
            served_count: 0,
        })
    }
}
