use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use crate::native_audio::NativeAudioClock;
use crate::native_core::playback::{
    native_presentation_timing as decide_native_presentation_timing, VideoFrameTimingDecision,
};
use crate::native_core::{
    FrameRequest, FrameTime, NativeFrameService, PerformanceSample, PreviewMode,
};
use crate::sync_metrics::SYNC_METRICS;
use crate::filmstrip_engine::decoder::VideoColorMetadata;
use crate::filmstrip_engine::stream_actor::DecodedVideoPlanes;

pub(crate) type DecodedNativeVideoFrame = (DecodedVideoPlanes, u32, u32, VideoColorMetadata, u32);

#[derive(Debug, Default, Clone)]
pub(crate) struct NativeDecodeTimings {
    pub(crate) decode_time_us: u32,
    pub(crate) decoder_mutex_wait_us: u64,
    pub(crate) actor_wait_us: Option<u64>,
    pub(crate) demux_wait_us: Option<u64>,
    pub(crate) container_format: Option<String>,
    pub(crate) is_hardware_accelerated: Option<bool>,
    pub(crate) decoder_seek_count: Option<u32>,
    pub(crate) seek_time_us: Option<u32>,
    pub(crate) decoder_frames_decoded: Option<u32>,
    pub(crate) hardware_frame_download_us: Option<u64>,
    pub(crate) scale_colorspace_us: Option<u64>,
    pub(crate) source_width: Option<u32>,
    pub(crate) source_height: Option<u32>,
    pub(crate) source_bits_per_raw_sample: Option<u8>,
    pub(crate) source_frame_rate_milli: Option<u32>,
    pub(crate) codec_name: Option<String>,
    pub(crate) hardware_frames_downloaded: Option<u32>,
    pub(crate) served_from: Option<crate::native_core::performance::ServedFrom>,
    pub(crate) hw_device_type: Option<String>,
}

pub(crate) struct QueuedNativeFrame {
    pub(crate) frame_index: u64,
    pub(crate) decoded_frames: Vec<DecodedNativeVideoFrame>,
    pub(crate) decode_timings: NativeDecodeTimings,
    pub(crate) queued_at: Instant,
    pub(crate) ready_at: Instant,
    pub(crate) scheduler_wait_us: u64,
}

/// Never make a frame ready so far ahead that lookahead itself becomes a
/// visible latency buffer. This is intentionally a presentation-latency budget,
/// not a cache-capacity limit: the cache can retain decoded frames, but the
/// playback queue must stay close to the audio clock.
///
/// At 30fps (33ms budget) this allows up to ~9 frames of lookahead headroom,
/// which absorbs decode jitter without causing lookahead-misses on the first
/// decode-speed bump.
pub(crate) const MAX_LOOKAHEAD_RESIDENCY_US: u64 = 300_000;
pub(crate) const MAX_LOOKAHEAD_EXPIRATION_US: u64 = 600_000;
/// A preview is an interactive surface, not a throughput batch.
/// Lower framerates (<=30fps) maintain a tight 2-frame window to prevent latency.
/// High framerate streams (>=50fps, e.g. 60fps 4K) require a 4-frame buffer to absorb
/// decode jitter and prevent lookahead queue starvation.
pub(crate) const NATIVE_PREVIEW_QUEUE_CAPACITY: usize = 5;
pub(crate) const NATIVE_PREVIEW_LOOKAHEAD_FRAMES: usize = 2;

#[inline]
pub(crate) fn lookahead_frames_for_rate(frame_rate: u32) -> usize {
    if frame_rate >= 50 {
        4
    } else {
        NATIVE_PREVIEW_LOOKAHEAD_FRAMES
    }
}

pub(crate) fn native_presentation_timing(
    app: &tauri::AppHandle,
    frame_ticks: i64,
    frame_timescale: u32,
    record_drift: bool,
) -> (u64, i64, bool) {
    let Some(clock_state) = app.try_state::<Arc<std::sync::Mutex<NativeAudioClock>>>() else {
        return (0, 0, false);
    };
    let Ok(clock) = clock_state.lock() else {
        return (0, 0, false);
    };
    let status = clock.status();
    if !status.running || frame_timescale == 0 {
        return (status.audio_position_ticks, 0, false);
    }

    // The audio clock is canonical 1 MHz. Convert the request timestamp once
    // at the boundary so the drop decision is independent of source timescale.
    let frame_position_ticks = (frame_ticks.max(0) as u128)
        .saturating_mul(1_000_000)
        .checked_div(frame_timescale as u128)
        .unwrap_or(0);
    let frame_position_ticks = frame_position_ticks.min(i64::MAX as u128) as i64;

    // Only record drift during active steady-state playback.
    // Manual scrub/seek requests and seek jumps across the timeline (> 1.5s gap)
    // reflect deliberate user playhead navigation where audio is re-anchoring,
    // not actual playback drift.
    if record_drift {
        let drift = frame_position_ticks.saturating_sub(status.audio_position_ticks as i64);
        if drift.abs() <= 1_500_000 {
            SYNC_METRICS.av_drift.record_with_freshness(
                drift,
                status.clock_freshness_us,
                status.median_callback_interval_us,
            );
        }
    }
    let age = status.audio_position_ticks as i128 - frame_position_ticks as i128;
    let frame_age_ticks = age.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    let decision = decide_native_presentation_timing(
        FrameTime::new(0, status.audio_position_ticks as i64, 1_000_000)
            .expect("native audio clock uses a non-zero timescale"),
        FrameTime::new(0, frame_position_ticks, 1_000_000)
            .expect("native frame timestamp uses a non-zero timescale"),
    )
    .unwrap_or(VideoFrameTimingDecision::OnTime);
    (
        status.audio_position_ticks,
        frame_age_ticks,
        matches!(decision, VideoFrameTimingDecision::LateForAudio),
    )
}

pub(crate) fn record_successful_readback_metrics(app: &tauri::AppHandle, request: &FrameRequest) {
    // Readback is the active fallback shown as "Native readback" in the
    // preview header. It still needs the same A/V and seek accounting as the
    // retained-surface path; otherwise the visible preview can report zeros
    // while the surface-only path reports real values.
    if request.mode.as_deref() == Some("prefetch") {
        return;
    }
    let is_playback = request.mode.as_deref() == Some("playback");
    let _ = native_presentation_timing(
        app,
        request.frame_time.ticks,
        request.frame_time.timescale,
        is_playback,
    );
    let presented_ticks = (request.frame_time.ticks.max(0) as i128 * 1_000_000i128
        / request.frame_time.timescale.max(1) as i128)
        .min(i64::MAX as i128) as i64;
    SYNC_METRICS.record_frame_presented_with_options(
        presented_ticks,
        1_000_000i64 / i64::from(request.project.frame_rate.max(1)),
        matches!(
            request.mode.as_deref(),
            Some("playback") | Some("playback-lookahead")
        ),
        request.mode.as_deref() != Some("playback-lookahead"),
    );
}

pub(crate) fn classify_surface_transfer_path(
    video_layer_count: usize,
    used_dxgi_zero_copy: bool,
    used_cpu_nv12: bool,
) -> &'static str {
    if video_layer_count == 0 {
        "gpu-raster"
    } else if used_dxgi_zero_copy && used_cpu_nv12 {
        "mixed"
    } else if used_dxgi_zero_copy {
        "dxgi-zero-copy"
    } else {
        "cpu-nv12"
    }
}

pub(crate) fn record_native_surface_sample(
    app: &tauri::AppHandle,
    request: &FrameRequest,
    started_at: Instant,
    decode_timings: &NativeDecodeTimings,
    queue_hit: bool,
    scheduler_wait_us: u64,
    lookahead_wait_us: Option<u64>,
    cold_start_init_us: Option<u64>,
    queue_residency_us: Option<u64>,
    conversion_upload_us: Option<u64>,
    compose_us: Option<u64>,
    surface_acquire_us: Option<u64>,
    submit_present_us: Option<u64>,
    dropped: bool,
    stale: bool,
    drop_reason: Option<&str>,
    capability_policy: Option<String>,
    capability_probe_us: Option<u64>,
    transfer_path: Option<&str>,
) {
    let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() else {
        return;
    };
    // Diagnostics must never make the presentation future wait on the frame
    // service mutex. A busy stats reader may therefore miss a sample.
    let Ok(mut service) = service.try_lock() else {
        return;
    };
    if let Some(session_collector) =
        app.try_state::<Arc<crate::wgpu_compositor::SessionTelemetryCollector>>()
    {
        if let Some(path) = transfer_path {
            session_collector.record_frame_source(path);
        }
    }
    let total_time_us = started_at.elapsed().as_micros().min(u32::MAX as u128) as u32;
    let stages_sum = u64::from(decode_timings.decode_time_us)
        + conversion_upload_us.unwrap_or(0)
        + compose_us.unwrap_or(0)
        + submit_present_us.unwrap_or(0)
        + scheduler_wait_us;
    let unaccounted_us = u64::from(total_time_us).saturating_sub(stages_sum);
    let stage_overlap_us = stages_sum.saturating_sub(u64::from(total_time_us));
    service.record_sample(PerformanceSample {
        request_id: request.request_id.clone(),
        frame_index: request.frame_time.frame_index,
        decode_time_us: decode_timings.decode_time_us,
        compose_time_us: compose_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        readback_time_us: 0,
        total_time_us,
        bytes_transferred: 0,
        // A queued decode is a playback staging hit, not a NativeFrameService
        // cache hit. Keep cache-rate telemetry scoped to the RGBA cache.
        cache_hit: false,
        generation: request.generation,
        mode: PreviewMode::from_request_mode(request.mode.as_deref()),
        quality: Some(format!("{:?}", request.quality)),
        strategy: Some(
            if queue_hit {
                "SURFACE_WARM"
            } else {
                "SURFACE_COLD"
            }
            .to_string(),
        ),
        transfer_path: transfer_path.map(str::to_string),
        cancelled: false,
        stale,
        dropped,
        drop_reason: drop_reason.map(str::to_string),
        seek_time_us: decode_timings.seek_time_us.unwrap_or(0),
        conversion_time_us: conversion_upload_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        upload_time_us: conversion_upload_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        present_time_us: submit_present_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        decode_us: Some(u64::from(decode_timings.decode_time_us)),
        conversion_upload_us,
        compose_us,
        readback_us: None,
        map_wait_us: None,
        timestamp_query_available: None,
        present_us: submit_present_us,
        scheduler_wait_us: Some(scheduler_wait_us),
        lookahead_wait_us,
        cold_start_init_us,
        queue_residency_us,
        ipc_wait_us: None,
        decoder_mutex_wait_us: Some(decode_timings.decoder_mutex_wait_us),
        actor_wait_us: decode_timings.actor_wait_us,
        gpu_queue_wait_us: None,
        surface_acquire_us,
        submit_present_us,
        capability_policy,
        capability_probe_us,
        demux_wait_us: decode_timings.demux_wait_us,
        container_format: decode_timings.container_format.clone(),
        is_hardware_accelerated: decode_timings.is_hardware_accelerated,
        decoder_seek_count: decode_timings.decoder_seek_count,
        decoder_frames_decoded: decode_timings.decoder_frames_decoded,
        hardware_frame_download_us: decode_timings.hardware_frame_download_us,
        scale_colorspace_us: decode_timings.scale_colorspace_us,
        source_width: decode_timings.source_width,
        source_height: decode_timings.source_height,
        source_bits_per_raw_sample: decode_timings.source_bits_per_raw_sample,
        source_frame_rate_milli: decode_timings.source_frame_rate_milli,
        unaccounted_us: Some(unaccounted_us),
        codec_name: decode_timings.codec_name.clone(),
        hardware_frames_downloaded: decode_timings.hardware_frames_downloaded,
        stage_overlap_us: Some(stage_overlap_us),
        served_from: if queue_hit {
            Some(crate::native_core::performance::ServedFrom::ReadyCache)
        } else {
            decode_timings.served_from
        },
        hw_device_type: decode_timings.hw_device_type.clone(),
        cache_lock_wait_us: None,
        cache_insert_us: None,
        dxgi_latched_off: None,
        dxgi_latch_reason: None,
                dxgi_latch_context: None,
    });
}

/// A decoded lookahead frame can sit in the bounded preview queue while the
/// audio clock advances. That delay is neither decode time nor GPU time, yet
/// it is often the dominant contributor to a visibly slow preview.
pub(crate) fn queue_residency_us(ready_at: Instant, presentation_started: Instant) -> u64 {
    presentation_started
        .saturating_duration_since(ready_at)
        .as_micros()
        .min(u64::MAX as u128) as u64
}

/// Bounded native decode-ahead storage for continuous preview playback.
///
/// The queue owns decoded NV12 planes, not GPU textures. Decoding can happen
/// ahead of the audio clock without holding the GPU session lock; presentation
/// consumes the entry and performs only color conversion/compositing/surface
/// submission.
pub struct NativePreviewFrameQueue {
    entries: HashMap<String, QueuedNativeFrame>,
    order: VecDeque<String>,
    pending: std::collections::HashSet<String>,
    max_entries: usize,
    pub(crate) latest_generation: Arc<AtomicU64>,
    notify: Arc<tokio::sync::Notify>,
    highest_frame_index: Option<u64>,
    decode_ewma_us: Option<u64>,
    /// Monotonically changes whenever playback ownership changes. Async
    /// decodes keep the epoch from their reservation and may only complete
    /// into the same queue lifetime.
    lifecycle_epoch: u64,
}

impl NativePreviewFrameQueue {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            pending: std::collections::HashSet::new(),
            // This is an architectural limit, rather than a caller policy:
            // no producer can accidentally turn native preview into an
            // unbounded decode/readback backlog.
            max_entries: max_entries.clamp(1, NATIVE_PREVIEW_QUEUE_CAPACITY),
            latest_generation: Arc::new(AtomicU64::new(0)),
            notify: Arc::new(tokio::sync::Notify::new()),
            highest_frame_index: None,
            decode_ewma_us: None,
            lifecycle_epoch: 0,
        }
    }

    pub fn notify(&self) -> Arc<tokio::sync::Notify> {
        self.notify.clone()
    }

    pub fn is_pending(&self, key: &str) -> bool {
        self.pending.contains(key)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn max_entries(&self) -> usize {
        self.max_entries
    }

    pub fn highest_frame_index(&self) -> Option<u64> {
        self.highest_frame_index
    }

    pub(crate) fn estimated_decode_us(&self) -> Option<u64> {
        self.decode_ewma_us
    }

    pub(crate) fn discard_before(&mut self, frame_index: u64) {
        let stale: Vec<String> = self
            .entries
            .iter()
            .filter(|&(_, frame)| frame.frame_index < frame_index)
            .map(|(key, _)| key.clone())
            .collect();
        for key in stale {
            self.entries.remove(&key);
            self.order.retain(|entry| entry != &key);
        }
    }

    pub(crate) fn discard_expired(&mut self, presentation_started: Instant) {
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter(|&(_, frame)| {
                queue_residency_us(frame.ready_at, presentation_started)
                    > MAX_LOOKAHEAD_EXPIRATION_US
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in expired {
            self.entries.remove(&key);
            self.order.retain(|entry| entry != &key);
        }
    }

    /// Discard stale future/past lookahead entries when a backward jump or seek discontinuity occurs.
    pub fn discard_discontinuity(&mut self, current_audio_frame: u64, lookahead_count: usize) {
        let max_valid_lookahead = current_audio_frame.saturating_add(lookahead_count as u64);
        let min_valid_frame = current_audio_frame.saturating_sub(2);

        let is_discontinuity = match self.highest_frame_index {
            Some(max_idx) => max_idx > max_valid_lookahead,
            None => false,
        };

        if is_discontinuity {
            let stale: Vec<String> = self
                .entries
                .iter()
                .filter(|&(_, frame)| {
                    frame.frame_index > max_valid_lookahead || frame.frame_index < min_valid_frame
                })
                .map(|(key, _)| key.clone())
                .collect();
            for key in stale {
                self.entries.remove(&key);
                self.order.retain(|entry| entry != &key);
            }
            self.highest_frame_index = self.entries.values().map(|frame| frame.frame_index).max();
        }
    }

    /// Invalidate all queued entries and generation state when transport ownership
    /// or project generation fences advance (e.g. seek, restart, edit).
    pub fn invalidate_generation(&mut self, generation: u64) {
        self.latest_generation
            .fetch_max(generation, Ordering::AcqRel);
        self.entries.clear();
        self.order.clear();
        self.pending.clear();
        self.highest_frame_index = None;
        self.lifecycle_epoch = self.lifecycle_epoch.wrapping_add(1);
        self.notify.notify_waiters();
    }

    pub(crate) fn lifecycle_epoch(&self) -> u64 {
        self.lifecycle_epoch
    }

    pub fn observe_frame_index(&mut self, frame_index: u64) {
        self.highest_frame_index = Some(match self.highest_frame_index {
            Some(m) if frame_index < m.saturating_sub(16) => frame_index,
            Some(m) => m.max(frame_index),
            None => frame_index,
        });
    }

    pub(crate) fn observe_generation(&self, generation: u64) {
        self.latest_generation
            .fetch_max(generation, Ordering::AcqRel);
    }

    pub(crate) fn is_generation_current(&self, generation: u64) -> bool {
        generation >= self.latest_generation.load(Ordering::Acquire)
    }

    pub(crate) fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key) || self.pending.contains(key)
    }

    pub(crate) fn begin(&mut self, key: &str, frame_index: Option<u64>) -> bool {
        if self.contains(key) {
            return false;
        }
        self.pending.insert(key.to_string());
        if let Some(idx) = frame_index {
            self.highest_frame_index = Some(self.highest_frame_index.map_or(idx, |m| m.max(idx)));
        }
        true
    }

    pub(crate) fn complete(&mut self, key: String, frame: QueuedNativeFrame, lifecycle_epoch: u64) -> bool {
        if lifecycle_epoch != self.lifecycle_epoch {
            return false;
        }
        let frame_idx = frame.frame_index;
        let elapsed_us = frame
            .ready_at
            .saturating_duration_since(frame.queued_at)
            .as_micros()
            .min(u64::MAX as u128) as u64;
        self.decode_ewma_us = Some(match self.decode_ewma_us {
            Some(previous) => previous.saturating_mul(7).saturating_add(elapsed_us) / 8,
            None => elapsed_us,
        });
        self.highest_frame_index = Some(
            self.highest_frame_index
                .map_or(frame_idx, |m| m.max(frame_idx)),
        );
        self.pending.remove(&key);
        self.order.retain(|entry| entry != &key);
        self.entries.insert(key.clone(), frame);
        self.order.push_back(key);
        while self.entries.len() > self.max_entries {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
        self.notify.notify_waiters();
        true
    }

    pub(crate) fn fail(&mut self, key: &str) {
        self.pending.remove(key);
        self.notify.notify_waiters();
    }

    pub(crate) fn take(&mut self, key: &str) -> Option<QueuedNativeFrame> {
        let decoded = self.entries.remove(key)?;
        self.order.retain(|entry| entry != key);
        Some(decoded)
    }

    pub(crate) fn take_matching_or_closest(
        &mut self,
        key: &str,
        target_frame_index: u64,
    ) -> Option<QueuedNativeFrame> {
        if let Some(frame) = self.take(key) {
            return Some(frame);
        }

        let mut best_key: Option<String> = None;
        let mut best_frame_index: u64 = 0;

        for (k, frame) in &self.entries {
            if frame.frame_index <= target_frame_index
                && target_frame_index.saturating_sub(frame.frame_index) <= 2
                && (best_key.is_none() || frame.frame_index > best_frame_index)
            {
                best_key = Some(k.clone());
                best_frame_index = frame.frame_index;
            }
        }

        if let Some(k) = best_key {
            return self.take(&k);
        }

        None
    }

    /// Reset all queued frames and generation counter. Call on project close so
    /// the next project's generation 0 is accepted immediately.
    pub fn reset(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.pending.clear();
        self.highest_frame_index = None;
        self.decode_ewma_us = None;
        self.lifecycle_epoch = self.lifecycle_epoch.wrapping_add(1);
        self.latest_generation.store(0, Ordering::Release);
    }
}

pub(crate) fn deadline_aware_lookahead_count(
    frame_rate: u32,
    configured_count: usize,
    estimated_decode_us: Option<u64>,
) -> usize {
    let frame_budget_us = 1_000_000u64 / u64::from(frame_rate.max(1));
    // Presentation-latency budget: don't queue frames so far ahead that they
    // become stale before the audio clock reaches them.
    let latency_cap = (MAX_LOOKAHEAD_RESIDENCY_US / frame_budget_us).max(1) as usize;
    // Decode speed can inform how much of the window we use, but it
    // cannot expand it beyond the rate-appropriate bound. On a weak adapter,
    // increasing speculative depth only queues more work behind the same stall.
    let decode_floor = estimated_decode_us
        .map(|decode_us| decode_us.div_ceil(frame_budget_us) as usize)
        .unwrap_or(1)
        .max(1);

    let rate_bound = lookahead_frames_for_rate(frame_rate);

    configured_count
        .min(latency_cap)
        .min(rate_bound)
        .max(decode_floor.min(rate_bound))
        .max(1)
}

