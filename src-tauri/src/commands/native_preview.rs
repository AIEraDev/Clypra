use crate::commands::lut::LutCache;
use crate::commands::native_surface::NativeSurfaceRuntime;
use crate::diagnostics;
use crate::native_audio::NativeAudioClock;
use crate::native_core::playback::{
    native_presentation_timing as decide_native_presentation_timing, VideoFrameTimingDecision,
};
use crate::native_core::{
    BodyEffectSnapshot, ColorGradeSnapshot, FramePacket, FrameRequest, FrameTime,
    NativeFrameService, NativeFrameServiceStats, NativePerformanceSampleBatch,
    NativeSurfacePresentation, NativeSurfacePresentationTimings, PerformanceSample, PixelFormat,
    PreviewMode, QualityTier, TextLayerSnapshot, TransitionSnapshot, DEFAULT_TIME_SCALE,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::sync_metrics::SYNC_METRICS;
#[cfg(target_os = "windows")]
use crate::thumbnail_engine::decoder::get_preview_decoder_for_stream;
use crate::thumbnail_engine::decoder::{
    get_preview_decoder, DecodeFrameOptions, VideoColorMetadata,
};
use crate::wgpu_compositor::multi_track_composer::TransitionUniforms;
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use crate::wgpu_compositor::DxgiImportState;
use crate::wgpu_compositor::{
    BlendMode, BodyEffectUniforms, ChromaKeyUniforms, ColorGradeUniforms, ColorTransformUniforms,
    CompositeLayer, CropMargins, FrameRenderPath, LayerTransform, NativePreviewSession,
    NativeWgpuRenderer,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{Emitter, Manager};

use crate::thumbnail_engine::stream_actor::DecodedVideoPlanes;

type DecodedNativeVideoFrame = (DecodedVideoPlanes, u32, u32, VideoColorMetadata, u32);
static NATIVE_SURFACE_PRESENTATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Register an editor font before a frame request references it. The native
/// renderer never substitutes a different family for an unregistered font.
#[tauri::command]
pub fn register_native_font(font_id: String, path: String) -> Result<u64, String> {
    if font_id.trim().is_empty() {
        return Err("Native font id must not be empty".to_string());
    }
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Native font registration requires an absolute filesystem path".to_string());
    }
    let bytes = std::fs::read(path).map_err(|error| {
        let message = format!("Unable to read native font '{}': {error}", path.display());
        diagnostics::error("native-font", "register-read-failed", message.clone());
        message
    })?;
    if bytes.len() > 32 * 1024 * 1024 {
        let message = "Native font exceeds the 32 MiB registration limit".to_string();
        diagnostics::error("native-font", "register-size-limit", message.clone());
        return Err(message);
    }
    register_native_font_bytes(font_id, bytes)
}

/// Register bundled/editor font bytes without requiring the WebView to expose
/// a filesystem path. This is the normal path for Vite-bundled WOFF2 assets.
#[tauri::command]
pub fn register_native_font_bytes(font_id: String, bytes: Vec<u8>) -> Result<u64, String> {
    if font_id.trim().is_empty() {
        return Err("Native font id must not be empty".to_string());
    }
    if bytes.is_empty() {
        return Err(format!("Native font '{}' has no bytes", font_id));
    }
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(format!(
            "Native font '{}' exceeds the 32 MiB registration limit",
            font_id
        ));
    }

    let result =
        clypra_native_core::font_registry::global_font_registry().register_font(&font_id, &bytes);
    if let Err(error) = &result {
        diagnostics::error(
            "native-font",
            "register-failed",
            format!("{font_id}: {error}"),
        );
    }
    result
}

#[tauri::command]
pub fn list_native_fonts() -> Result<Vec<String>, String> {
    Ok(clypra_native_core::font_registry::global_font_registry().list_fonts())
}

#[tauri::command]
pub fn get_native_font_warnings() -> Result<Vec<String>, String> {
    Ok(clypra_native_core::font_registry::global_font_registry().get_missing_font_warnings())
}

#[tauri::command]
pub fn clear_native_font_warnings() -> Result<(), String> {
    clypra_native_core::font_registry::global_font_registry().clear_missing_font_warnings();
    Ok(())
}

#[derive(Debug, Default, Clone)]
struct NativeDecodeTimings {
    decode_time_us: u32,
    decoder_mutex_wait_us: u64,
    actor_wait_us: Option<u64>,
    demux_wait_us: Option<u64>,
    container_format: Option<String>,
    is_hardware_accelerated: Option<bool>,
}

struct QueuedNativeFrame {
    frame_index: u64,
    decoded_frames: Vec<DecodedNativeVideoFrame>,
    decode_timings: NativeDecodeTimings,
    queued_at: Instant,
    /// Recorded after decode completes, so queue telemetry excludes decoder
    /// work and measures only the wait for a ready frame to be presented.
    ready_at: Instant,
    scheduler_wait_us: u64,
}

/// Never make a frame ready so far ahead that lookahead itself becomes a
/// visible latency buffer. This is intentionally a presentation-latency budget,
/// not a cache-capacity limit: the cache can retain decoded frames, but the
/// playback queue must stay close to the audio clock.
///
/// At 30fps (33ms budget) this allows up to ~9 frames of lookahead headroom,
/// which absorbs decode jitter without causing lookahead-misses on the first
/// decode-speed bump.
const MAX_LOOKAHEAD_RESIDENCY_US: u64 = 300_000;
const MAX_LOOKAHEAD_EXPIRATION_US: u64 = 600_000;
const MIN_LOOKAHEAD_FRAMES: usize = 2;

fn native_presentation_timing(
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

fn record_successful_readback_metrics(app: &tauri::AppHandle, request: &FrameRequest) {
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

fn classify_surface_transfer_path(
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

fn record_native_surface_sample(
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
    service.record_sample(PerformanceSample {
        request_id: request.request_id.clone(),
        frame_index: request.frame_time.frame_index,
        decode_time_us: decode_timings.decode_time_us,
        compose_time_us: compose_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        readback_time_us: 0,
        total_time_us: started_at.elapsed().as_micros().min(u32::MAX as u128) as u32,
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
        seek_time_us: decode_timings.decode_time_us,
        conversion_time_us: conversion_upload_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        upload_time_us: conversion_upload_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        present_time_us: submit_present_us.unwrap_or(0).min(u32::MAX as u64) as u32,
        decode_us: Some(u64::from(decode_timings.decode_time_us)),
        conversion_upload_us,
        compose_us,
        readback_us: None,
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
    });
}

/// A decoded lookahead frame can sit in the bounded preview queue while the
/// audio clock advances. That delay is neither decode time nor GPU time, yet
/// it is often the dominant contributor to a visibly slow preview.
fn queue_residency_us(ready_at: Instant, presentation_started: Instant) -> u64 {
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
    latest_generation: Arc<AtomicU64>,
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
            max_entries: max_entries.max(1),
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

    fn estimated_decode_us(&self) -> Option<u64> {
        self.decode_ewma_us
    }

    fn discard_before(&mut self, frame_index: u64) {
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

    fn discard_expired(&mut self, presentation_started: Instant) {
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

    fn lifecycle_epoch(&self) -> u64 {
        self.lifecycle_epoch
    }

    pub fn observe_frame_index(&mut self, frame_index: u64) {
        self.highest_frame_index = Some(
            self.highest_frame_index
                .map_or(frame_index, |m| m.max(frame_index)),
        );
    }

    fn observe_generation(&self, generation: u64) {
        self.latest_generation
            .fetch_max(generation, Ordering::AcqRel);
    }

    fn is_generation_current(&self, generation: u64) -> bool {
        generation >= self.latest_generation.load(Ordering::Acquire)
    }

    fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key) || self.pending.contains(key)
    }

    fn begin(&mut self, key: &str, frame_index: Option<u64>) -> bool {
        if self.contains(key) {
            return false;
        }
        self.pending.insert(key.to_string());
        if let Some(idx) = frame_index {
            self.highest_frame_index = Some(self.highest_frame_index.map_or(idx, |m| m.max(idx)));
        }
        true
    }

    fn complete(&mut self, key: String, frame: QueuedNativeFrame, lifecycle_epoch: u64) -> bool {
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

    fn fail(&mut self, key: &str) {
        self.pending.remove(key);
        self.notify.notify_waiters();
    }

    fn take(&mut self, key: &str) -> Option<QueuedNativeFrame> {
        let decoded = self.entries.remove(key)?;
        self.order.retain(|entry| entry != key);
        Some(decoded)
    }

    fn take_matching_or_closest(
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

fn deadline_aware_lookahead_count(
    frame_rate: u32,
    configured_count: usize,
    estimated_decode_us: Option<u64>,
) -> usize {
    let frame_budget_us = 1_000_000u64 / u64::from(frame_rate.max(1));
    // Presentation-latency budget: don't queue frames so far ahead that they
    // become stale before the audio clock reaches them.
    let latency_cap = (MAX_LOOKAHEAD_RESIDENCY_US / frame_budget_us).max(1) as usize;
    // Minimum frames needed to keep the sequential decode pipeline ahead of
    // the audio clock at the measured decode speed. This is a FLOOR: if decode
    // takes 80ms and the frame budget is 33ms, we need at least 3 frames ahead
    // to absorb a single slow decode without a miss. Using it as a ceiling
    // (the prior bug) guaranteed misses on any jitter.
    let decode_floor = estimated_decode_us
        .map(|decode_us| decode_us.div_ceil(frame_budget_us) as usize)
        .unwrap_or(MIN_LOOKAHEAD_FRAMES)
        .max(MIN_LOOKAHEAD_FRAMES);

    configured_count.min(latency_cap).max(decode_floor).max(1)
}

fn default_clear_color() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

fn default_opacity() -> f32 {
    1.0
}

/// Prepare the compositor graph before a render session is allowed to start.
///
/// This is intentionally awaited by playback configuration, not spawned from
/// surface configuration. On older Windows Intel drivers pipeline creation can
/// take seconds; allowing it to race the first visible presentation held the
/// shared session lock and let audio advance against a blank surface.
/// `NativePreviewSession` owns the graph cache, so the warm check and creation
/// are serialized under the same ownership boundary and duplicate callers are
/// no-ops after the first one completes.
pub(crate) async fn prepare_native_preview_pipelines(
    app: &tauri::AppHandle,
    width: u32,
    height: u32,
    target_format: wgpu::TextureFormat,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Native preview canvas dimensions must be non-zero".to_string());
    }
    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let preview_session = preview_state.inner().clone();
    let mut session = preview_session.lock().await;
    // The Windows native surface always presents Bgra8UnormSrgb. Do not warm
    // an RGBA readback graph as part of this latency-critical path: each graph
    // eagerly creates five blend/transition pipelines, and Intel D3D12 drivers
    // can spend seconds compiling every one. Readback creates its RGBA graph on
    // demand; native-surface startup compiles exactly the graph it presents.
    #[cfg(target_os = "windows")]
    {
        let _ = target_format;
        let surface_format = wgpu::TextureFormat::Bgra8UnormSrgb;
        if !session.has_compositor(width, height, surface_format) {
            session.warmup_native_surface_pipelines(width, height, surface_format);
        }
    }

    #[cfg(not(target_os = "windows"))]
    if !session.has_compositor(width, height, target_format) {
        session.warmup_native_surface_pipelines(width, height, target_format);
    }
    Ok(())
}

fn default_blend_mode() -> String {
    "normal".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectSolidLayer {
    pub color: [f32; 4],
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectVideoLayer {
    #[serde(default)]
    pub layer_id: String,
    pub video_path: String,
    pub time_secs: f64,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
    #[serde(default)]
    pub color_grade: Option<ColorGradeSnapshot>,
    #[serde(default)]
    pub body_effect: Option<BodyEffectSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectRasterLayer {
    #[serde(default)]
    pub asset_id: String,
    #[serde(default)]
    pub rgba: Option<Vec<u8>>,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub display_width: Option<f32>,
    #[serde(default)]
    pub display_height: Option<f32>,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String,
    #[serde(default)]
    pub is_mask: bool,
    #[serde(default)]
    pub is_text: bool,
}

impl NativeProjectRasterLayer {
    pub fn display_width(&self) -> f32 {
        self.display_width.unwrap_or(self.width as f32)
    }

    pub fn display_height(&self) -> f32 {
        self.display_height.unwrap_or(self.height as f32)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRasterAssetRegistration {
    pub asset_id: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub rgba: Vec<u8>,
    #[serde(default)]
    pub rgba_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVideoProjectFrameRequest {
    pub canvas_width: u32,
    pub canvas_height: u32,
    #[serde(default = "default_clear_color")]
    pub clear_color: [f32; 4],
    #[serde(default)]
    pub layers: Vec<NativeProjectVideoLayer>,
    #[serde(default)]
    pub raster_layers: Vec<NativeProjectRasterLayer>,
    #[serde(default)]
    pub text_layers: Vec<TextLayerSnapshot>,
    #[serde(default)]
    pub transition: Option<TransitionSnapshot>,
    #[serde(default)]
    pub quality: QualityTier,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub is_scrubbing: Option<bool>,
    #[serde(default)]
    pub allow_keyframe_approx: Option<bool>,
    #[serde(default)]
    pub generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectFrameRequest {
    pub canvas_width: u32,
    pub canvas_height: u32,
    #[serde(default = "default_clear_color")]
    pub clear_color: [f32; 4],
    #[serde(default)]
    pub layers: Vec<NativeProjectSolidLayer>,
}

fn parse_blend_mode(value: &str) -> Result<BlendMode, String> {
    match value.to_ascii_lowercase().as_str() {
        "normal" => Ok(BlendMode::Normal),
        "multiply" => Ok(BlendMode::Multiply),
        "screen" => Ok(BlendMode::Screen),
        "overlay" => Ok(BlendMode::Overlay),
        "additive" | "add" => Ok(BlendMode::Additive),
        "difference" => Ok(BlendMode::Difference),
        other => Err(format!("Unsupported native blend mode: {}", other)),
    }
}

fn validate_transition(
    transition: &TransitionSnapshot,
    layer_ids: &[String],
    raster_count: usize,
) -> Result<(), String> {
    if layer_ids.len() != 2 || raster_count != 0 {
        return Err(
            "Native transitions currently require exactly two video layers and no raster layers"
                .to_string(),
        );
    }
    if transition.outgoing_layer.trim().is_empty()
        || transition.incoming_layer.trim().is_empty()
        || transition.outgoing_layer == transition.incoming_layer
        || !layer_ids.iter().any(|id| id == &transition.outgoing_layer)
        || !layer_ids.iter().any(|id| id == &transition.incoming_layer)
        || !transition.progress.is_finite()
        || !transition.feather.is_finite()
        || !transition.intensity.is_finite()
        || transition
            .fade_color
            .map(|color| {
                color
                    .iter()
                    .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
            })
            .unwrap_or(false)
        || !(0.0..=1.0).contains(&transition.progress)
        || !(0.0..=1.0).contains(&transition.feather)
        || transition.intensity < 0.0
    {
        return Err(
            "Native transition contains invalid layer references or parameters".to_string(),
        );
    }
    let supported = matches!(
        transition.transition_type.as_str(),
        "cross-dissolve"
            | "fade-through-color"
            | "wipe-left"
            | "wipe-right"
            | "wipe-up"
            | "wipe-down"
            | "wipe-diagonal"
            | "wipe-clockwise"
            | "circle-wipe"
            | "diamond-wipe"
            | "rectangle-wipe"
            | "slide-left"
            | "slide-right"
            | "slide-up"
            | "slide-down"
            | "zoom-blur"
            | "zoom-in"
            | "zoom-out"
            | "blur-fade"
            | "glitch"
            | "rgb-split"
            | "chromatic"
            | "film-burn"
            | "light-leak"
            | "whip-pan"
            | "iris-wipe"
    );
    if !supported {
        return Err(format!(
            "Unsupported native transition type: {}",
            transition.transition_type
        ));
    }
    Ok(())
}

fn validate_project_request(request: &NativeProjectFrameRequest) -> Result<(), String> {
    if request.canvas_width == 0 || request.canvas_height == 0 {
        return Err("Project canvas dimensions must be non-zero".to_string());
    }
    if request.canvas_width > 8192 || request.canvas_height > 8192 {
        return Err("Project canvas dimensions exceed the native preview limit".to_string());
    }
    if request.layers.len() > 256 {
        return Err("Native preview supports at most 256 layers per frame".to_string());
    }
    if request.clear_color.iter().any(|value| !value.is_finite()) {
        return Err("Native project clear color contains invalid color data".to_string());
    }
    for layer in &request.layers {
        if !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.width.is_finite()
            || !layer.height.is_finite()
            || !layer.rotation.is_finite()
            || !layer.opacity.is_finite()
            || layer.width < 0.0
            || layer.height < 0.0
        {
            return Err("Native project layer contains invalid geometry".to_string());
        }
        if layer.color.iter().any(|value| !value.is_finite()) {
            return Err("Native project layer contains invalid color data".to_string());
        }
    }
    Ok(())
}

fn validate_video_project_request(request: &NativeVideoProjectFrameRequest) -> Result<(), String> {
    if request.canvas_width == 0 || request.canvas_height == 0 {
        return Err("Project canvas dimensions must be non-zero".to_string());
    }
    if request.canvas_width > 8192 || request.canvas_height > 8192 {
        return Err("Project canvas dimensions exceed the native preview limit".to_string());
    }
    if request.layers.len() > 256 {
        return Err("Native preview supports at most 256 layers per frame".to_string());
    }
    if request.raster_layers.len() > 64 {
        return Err("Native preview supports at most 64 raster layers per frame".to_string());
    }
    if request.clear_color.iter().any(|value| !value.is_finite()) {
        return Err("Native project clear color contains invalid color data".to_string());
    }
    for layer in &request.layers {
        if layer.video_path.trim().is_empty()
            || !layer.time_secs.is_finite()
            || layer.time_secs < 0.0
            || !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.width.is_finite()
            || !layer.height.is_finite()
            || !layer.rotation.is_finite()
            || !layer.opacity.is_finite()
            || layer.width <= 0.0
            || layer.height <= 0.0
        {
            return Err("Native project video layer contains invalid data".to_string());
        }
        parse_blend_mode(&layer.blend_mode)?;
        if let Some(effect) = &layer.body_effect {
            if effect.mask_asset_id.trim().is_empty()
                || !matches!(
                    effect.renderer.as_str(),
                    "body_outline"
                        | "body_glow"
                        | "body_segmentation_glow"
                        | "body_particles"
                        | "body_cutout"
                        | "subject_cutout"
                )
                || !effect.color_r.is_finite()
                || !effect.color_g.is_finite()
                || !effect.color_b.is_finite()
                || !effect.strength.is_finite()
                || !effect.radius.is_finite()
                || !effect.time.is_finite()
                || effect.color_r < 0.0
                || effect.color_r > 1.0
                || effect.color_g < 0.0
                || effect.color_g > 1.0
                || effect.color_b < 0.0
                || effect.color_b > 1.0
                || effect.strength < 0.0
                || effect.strength > 1.0
                || effect.radius < 0.0
                || effect.time < 0.0
                || {
                    let prefix = effect
                        .mask_asset_id
                        .split(':')
                        .next()
                        .unwrap_or(&effect.mask_asset_id);
                    !request.raster_layers.iter().any(|mask| {
                        mask.is_mask
                            && (mask.asset_id == effect.mask_asset_id
                                || mask.asset_id.starts_with(prefix))
                    })
                }
            {
                return Err(
                    "Native body effect contains an invalid or missing mask asset".to_string(),
                );
            }
        }
    }
    if let Some(transition) = request.transition.as_ref() {
        validate_transition(
            transition,
            &request
                .layers
                .iter()
                .map(|layer| layer.layer_id.clone())
                .collect::<Vec<_>>(),
            request.raster_layers.len(),
        )?;
    }
    let mut raster_bytes = 0usize;
    for layer in &request.raster_layers {
        let expected_bytes = (layer.width as usize)
            .checked_mul(layer.height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "Native project raster dimensions overflow".to_string())?;
        if let Some(rgba) = &layer.rgba {
            raster_bytes = raster_bytes.saturating_add(expected_bytes);
            if rgba.len() != expected_bytes || rgba.len() > 64 * 1024 * 1024 {
                return Err("Native project raster layer contains invalid data".to_string());
            }
        } else if layer.asset_id.trim().is_empty() {
            return Err("Native project raster layer is missing a registered asset".to_string());
        }
        if layer.width == 0
            || layer.height == 0
            || layer.width > 8192
            || layer.height > 8192
            || !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.rotation.is_finite()
            || !layer.opacity.is_finite()
        {
            return Err("Native project raster layer contains invalid data".to_string());
        }
        parse_blend_mode(&layer.blend_mode)?;
    }
    if raster_bytes > 128 * 1024 * 1024 {
        return Err("Native project raster layers exceed the byte limit".to_string());
    }
    Ok(())
}

fn frame_time_seconds(time: FrameTime) -> Result<f64, String> {
    if time.timescale == 0 || time.ticks < 0 {
        return Err("FrameTime must have a non-zero timescale and non-negative ticks".to_string());
    }
    let seconds = time.seconds();
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("FrameTime resolves to an invalid timestamp".to_string());
    }
    Ok(seconds)
}

fn to_video_project_request(
    request: &FrameRequest,
) -> Result<NativeVideoProjectFrameRequest, String> {
    request.validate().map_err(|error| error.to_string())?;
    if request.project.canvas_width == 0 || request.project.canvas_height == 0 {
        return Err("ProjectSnapshot canvas dimensions must be non-zero".to_string());
    }

    let scale_x = request.output_width as f32 / request.project.canvas_width as f32;
    let scale_y = request.output_height as f32 / request.project.canvas_height as f32;
    let layers = request
        .project
        .video_layers
        .iter()
        .map(|layer| {
            Ok(NativeProjectVideoLayer {
                layer_id: layer.layer_id.clone(),
                video_path: crate::commands::media::normalize_file_path(&layer.video_path),
                time_secs: frame_time_seconds(layer.source_time)?,
                x: layer.x * scale_x,
                y: layer.y * scale_y,
                width: layer.width * scale_x,
                height: layer.height * scale_y,
                rotation: layer.rotation,
                opacity: layer.opacity,
                z_index: layer.z_index,
                blend_mode: layer.blend_mode.clone(),
                color_grade: layer.color_grade.clone(),
                body_effect: layer.body_effect.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let raster_layers = request
        .project
        .raster_layers
        .iter()
        .map(|layer| NativeProjectRasterLayer {
            asset_id: layer.asset_id.clone(),
            rgba: layer.rgba.clone(),
            width: layer.width,
            height: layer.height,
            display_width: Some(layer.display_width.unwrap_or(layer.width as f32) * scale_x),
            display_height: Some(layer.display_height.unwrap_or(layer.height as f32) * scale_y),
            x: layer.x * scale_x,
            y: layer.y * scale_y,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: layer.blend_mode.clone(),
            is_mask: layer.is_mask,
            is_text: layer.is_text,
        })
        .collect();
    let text_layers = request
        .project
        .text_layers
        .iter()
        .map(|layer| {
            let mut l = layer.clone();
            l.x *= scale_x;
            l.y *= scale_y;
            if let Some(bw) = l.box_width.as_mut() {
                *bw *= scale_x;
            }
            if let Some(bh) = l.box_height.as_mut() {
                *bh *= scale_y;
            }
            l
        })
        .collect();

    Ok(NativeVideoProjectFrameRequest {
        canvas_width: request.output_width,
        canvas_height: request.output_height,
        clear_color: request.project.clear_color,
        layers,
        raster_layers,
        text_layers,
        transition: request.project.transition.clone(),
        quality: request.quality,
        mode: request.mode.clone(),
        is_scrubbing: request.is_scrubbing,
        allow_keyframe_approx: request.allow_keyframe_approx,
        generation: request.generation,
    })
}

fn project_layer_transform(
    layer: &NativeProjectSolidLayer,
    canvas_width: f32,
    canvas_height: f32,
) -> LayerTransform {
    project_layer_transform_values(
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.rotation,
        canvas_width,
        canvas_height,
    )
}

fn compute_text_layer_placement(
    text_layer: &TextLayerSnapshot,
    shaped_w: f32,
    shaped_h: f32,
) -> (f32, f32) {
    let (unrotated_center_x, unrotated_center_y) =
        match (text_layer.box_width, text_layer.box_height) {
            (Some(box_w), Some(box_h)) if box_w > 0.0 && box_h > 0.0 => {
                let cx = match text_layer.text_align.to_ascii_lowercase().as_str() {
                    "left" => text_layer.x + shaped_w * 0.5,
                    "right" => text_layer.x + box_w - shaped_w * 0.5,
                    _ => text_layer.x + box_w * 0.5, // "center" is default
                };
                let cy = match text_layer.vertical_align.to_ascii_lowercase().as_str() {
                    "top" => text_layer.y + shaped_h * 0.5,
                    "bottom" => text_layer.y + box_h - shaped_h * 0.5,
                    _ => text_layer.y + box_h * 0.5,
                };
                (cx, cy)
            }
            _ => (text_layer.x + shaped_w * 0.5, text_layer.y + shaped_h * 0.5),
        };

    let (final_center_x, final_center_y) = match (text_layer.box_width, text_layer.box_height) {
        (Some(box_w), Some(box_h)) if box_w > 0.0 && box_h > 0.0 && text_layer.rotation != 0.0 => {
            let box_cx = text_layer.x + box_w * 0.5;
            let box_cy = text_layer.y + box_h * 0.5;
            let rad = (-text_layer.rotation).to_radians();
            let dx = unrotated_center_x - box_cx;
            let dy = unrotated_center_y - box_cy;
            let rot_x = box_cx + dx * rad.cos() - dy * rad.sin();
            let rot_y = box_cy + dx * rad.sin() + dy * rad.cos();
            (rot_x, rot_y)
        }
        _ => (unrotated_center_x, unrotated_center_y),
    };

    (
        final_center_x - shaped_w * 0.5,
        final_center_y - shaped_h * 0.5,
    )
}

/// Fit the native text texture inside the editor's text box.
///
/// The texture is rasterized by the native font stack, so its bounds can be
/// wider than the browser's estimate (emoji fallback and synthetic italic are
/// the most common examples).  The text box remains the authoritative layout
/// constraint; scale only when the native texture would otherwise overflow it.
fn compute_text_layer_scale(text_layer: &TextLayerSnapshot, shaped_w: f32, shaped_h: f32) -> f32 {
    let (Some(box_w), Some(box_h)) = (text_layer.box_width, text_layer.box_height) else {
        return 1.0;
    };

    if !box_w.is_finite()
        || !box_h.is_finite()
        || !shaped_w.is_finite()
        || !shaped_h.is_finite()
        || box_w <= 0.0
        || box_h <= 0.0
        || shaped_w <= 0.0
        || shaped_h <= 0.0
    {
        return 1.0;
    }

    (box_w / shaped_w).min(box_h / shaped_h).clamp(0.0001, 1.0)
}

fn project_layer_transform_values(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    rotation: f32,
    canvas_width: f32,
    canvas_height: f32,
) -> LayerTransform {
    let center_x = x + width * 0.5;
    let center_y = y + height * 0.5;

    LayerTransform {
        translate_x: (center_x / canvas_width) * 2.0 - 1.0,
        translate_y: 1.0 - (center_y / canvas_height) * 2.0,
        scale_x: width / canvas_width,
        scale_y: height / canvas_height,
        rotation_rad: -rotation.to_radians(),
    }
}

struct NativeLayerSpec<'a> {
    view: &'a wgpu::TextureView,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    rotation: f32,
    opacity: f32,
    z_index: i32,
    blend_mode: &'a str,
    color_grade: ColorGradeUniforms,
    mask_view: Option<&'a wgpu::TextureView>,
    body_effect: BodyEffectUniforms,
    lut: Option<Arc<crate::wgpu_compositor::GpuLut3D>>,
    grain_seed: f32,
}

fn body_effect_from_snapshot(snapshot: Option<&BodyEffectSnapshot>) -> BodyEffectUniforms {
    let Some(effect) = snapshot else {
        return BodyEffectUniforms::default();
    };
    let renderer_type = match effect.renderer.as_str() {
        "body_outline" => 1.0,
        "body_glow" | "body_segmentation_glow" => 2.0,
        "body_particles" => 3.0,
        "body_cutout" | "subject_cutout" => 4.0,
        _ => 0.0,
    };
    BodyEffectUniforms {
        color: [effect.color_r, effect.color_g, effect.color_b, 0.0],
        params: [renderer_type, effect.strength, effect.radius, effect.time],
    }
}

fn color_grade_from_snapshot(snapshot: Option<&ColorGradeSnapshot>) -> ColorGradeUniforms {
    snapshot.map_or_else(ColorGradeUniforms::default, |grade| ColorGradeUniforms {
        exposure: grade.exposure,
        contrast: grade.contrast,
        saturation: grade.saturation,
        temperature: grade.temperature,
        tint: grade.tint,
        brightness: grade.brightness,
        sepia: grade.sepia,
        grayscale: grade.grayscale,
        hue_rotate: grade.hue_rotate,
        vignette: grade.vignette,
        invert: grade.invert,
        grain_intensity: grade.grain_intensity,
        grain_size: grade.grain_size,
        lut_intensity: grade.lut_intensity,
        lut_size: grade.lut_size,
        blur_strength: grade.blur_strength,
        blur_radius: grade.blur_radius,
        pixelate_size: grade.pixelate_size,
        scanline_count: grade.scanline_count,
        scanline_intensity: grade.scanline_intensity,
        rgb_split_x: grade.rgb_split_x,
        rgb_split_y: grade.rgb_split_y,
        vibrance_amount: grade.vibrance_amount,
        vibrance_protected_hue_r: grade.vibrance_protected_hue_r,
        vibrance_protected_hue_g: grade.vibrance_protected_hue_g,
        vibrance_protected_hue_b: grade.vibrance_protected_hue_b,
        lift: grade.lift,
        cross_process_amount: grade.cross_process_amount,
        channel_mix: [
            grade.channel_mix_r,
            grade.channel_mix_g,
            grade.channel_mix_b,
            grade.channel_mix_enabled,
        ],
        duotone_dark: [
            grade.duotone_dark_r,
            grade.duotone_dark_g,
            grade.duotone_dark_b,
            grade.duotone_enabled,
        ],
        duotone_light: [
            grade.duotone_light_r,
            grade.duotone_light_g,
            grade.duotone_light_b,
            0.0,
        ],
        shadow_tint: [
            grade.shadow_tint_r,
            grade.shadow_tint_g,
            grade.shadow_tint_b,
            grade.shadow_tint_strength,
        ],
        highlight_tint: [
            grade.highlight_tint_r,
            grade.highlight_tint_g,
            grade.highlight_tint_b,
            grade.highlight_tint_strength,
        ],
        split_params: [grade.split_balance, 0.0, 0.0, 0.0],
        glow_color_strength: [
            grade.glow_color_r,
            grade.glow_color_g,
            grade.glow_color_b,
            grade.glow_strength,
        ],
        glow_params: [grade.glow_radius, 0.0, 0.0, 0.0],
        flash_color_strength: [
            grade.flash_color_r,
            grade.flash_color_g,
            grade.flash_color_b,
            grade.flash_strength,
        ],
        temporal_effects: [
            grade.flicker_strength,
            grade.strobe_frequency,
            grade.strobe_time,
            grade.strobe_strength,
        ],
        light_leak_color_strength: [
            grade.light_leak_color_r,
            grade.light_leak_color_g,
            grade.light_leak_color_b,
            grade.light_leak_strength,
        ],
        light_leak_params: [grade.light_leak_angle, grade.light_leak_time, 0.0, 0.0],
        glitch_params: [
            grade.glitch_intensity,
            grade.glitch_time,
            grade.glitch_slice_count,
            grade.glitch_color_shift,
        ],
        distortion_params: [
            grade.distortion_type,
            grade.distortion_strength,
            grade.distortion_time,
            grade.distortion_frequency,
        ],
        fire_params: grade.fire_params,
        fire_color_1: grade.fire_color_1,
        fire_color_2: grade.fire_color_2,
        fire_color_3: grade.fire_color_3,
        particle_params: grade.particle_params,
        particle_color: grade.particle_color,
        particle_time: [grade.particle_time, 0.0, 0.0, 0.0],
        chromatic_params: [
            grade.chromatic_amount,
            grade.chromatic_angle,
            grade.chromatic_edge_feather,
            if grade.chromatic_amount > 0.0 {
                1.0
            } else {
                0.0
            },
        ],
        ..ColorGradeUniforms::default()
    })
}

fn resolve_native_lut(
    snapshot: Option<&ColorGradeSnapshot>,
    cache: Option<&Arc<LutCache>>,
) -> Result<Option<Arc<crate::wgpu_compositor::GpuLut3D>>, String> {
    let Some(lut_id) = snapshot.and_then(|grade| grade.lut_id.as_deref()) else {
        return Ok(None);
    };
    let Some(cache) = cache else {
        return Err("Native LUT cache is unavailable".to_string());
    };
    cache
        .luts
        .get(lut_id)
        .map(|entry| Some(entry.value().clone()))
        .ok_or_else(|| format!("Native LUT asset is not loaded: {lut_id}"))
}

fn build_native_composite_layers<'a>(
    specs: &'a [NativeLayerSpec<'a>],
    canvas_width: f32,
    canvas_height: f32,
) -> Result<Vec<CompositeLayer<'a>>, String> {
    specs
        .iter()
        .map(|layer| {
            Ok(CompositeLayer {
                texture_view: layer.view,
                lut: layer.lut.as_deref(),
                z_index: layer.z_index,
                opacity: layer.opacity.clamp(0.0, 1.0),
                blend_mode: parse_blend_mode(layer.blend_mode)?,
                transform: project_layer_transform_values(
                    layer.x,
                    layer.y,
                    layer.width,
                    layer.height,
                    layer.rotation,
                    canvas_width,
                    canvas_height,
                ),
                crop: CropMargins::default(),
                color_grade: layer.color_grade,
                mask_view: layer.mask_view,
                body_effect: layer.body_effect,
                chroma_key: ChromaKeyUniforms {
                    _pad0: layer.grain_seed,
                    ..ChromaKeyUniforms::default()
                },
            })
        })
        .collect()
}

fn transition_uniforms(transition: &TransitionSnapshot) -> TransitionUniforms {
    let (transition_type, angle_rad) = match transition.transition_type.as_str() {
        "wipe-left" => (1, std::f32::consts::PI),
        "wipe-right" => (1, 0.0),
        "wipe-up" => (1, -std::f32::consts::FRAC_PI_2),
        "wipe-down" => (1, std::f32::consts::FRAC_PI_2),
        "wipe-diagonal" => (1, std::f32::consts::FRAC_PI_4),
        "slide-left" => (4, 0.0),
        "slide-right" => (5, 0.0),
        "slide-up" => (6, 0.0),
        "slide-down" => (7, 0.0),
        "zoom-blur" => (2, 0.0),
        "iris-wipe" => (3, 0.0),
        "fade-through-color" => (8, 0.0),
        "blur-fade" => (9, 0.0),
        "glitch" => (10, 0.0),
        "rgb-split" | "chromatic" => (11, 0.0),
        "film-burn" => (12, 0.0),
        "light-leak" => (13, 0.0),
        "whip-pan" => (14, 0.0),
        "wipe-clockwise" => (15, 0.0),
        "circle-wipe" => (16, 0.0),
        "diamond-wipe" => (17, 0.0),
        "rectangle-wipe" => (18, 0.0),
        "zoom-in" => (19, 0.0),
        "zoom-out" => (20, 0.0),
        _ => (0, 0.0),
    };
    TransitionUniforms {
        progress: transition.progress.clamp(0.0, 1.0),
        transition_type,
        feather: transition.feather.clamp(0.0, 1.0),
        angle_rad,
        blur_strength: transition.intensity.max(0.0),
        // Reuse the padding slot as the shader aspect-ratio uniform while
        // preserving the existing Rust struct/test field contract.
        _pad0: 16.0 / 9.0,
        fade_color: transition.fade_color.unwrap_or([0.0, 0.0, 0.0, 1.0]),
        ..TransitionUniforms::default()
    }
}

fn transition_source_layer<'a>(layer: &CompositeLayer<'a>) -> CompositeLayer<'a> {
    CompositeLayer {
        texture_view: layer.texture_view,
        lut: layer.lut,
        z_index: layer.z_index,
        // The evaluator already exposes transition opacity for the normal
        // compositor. Native transition shaders own the blend, so each source
        // must be rendered at full opacity to avoid double fading.
        opacity: 1.0,
        blend_mode: layer.blend_mode,
        transform: layer.transform,
        crop: layer.crop,
        color_grade: layer.color_grade,
        chroma_key: layer.chroma_key,
        mask_view: layer.mask_view,
        body_effect: layer.body_effect,
    }
}

fn build_transition_sources<'a>(
    request: &NativeVideoProjectFrameRequest,
    layers: &'a [CompositeLayer<'a>],
) -> Result<(CompositeLayer<'a>, CompositeLayer<'a>), String> {
    let transition = request.transition.as_ref().ok_or_else(|| {
        "Native transition source requested without transition metadata".to_string()
    })?;
    let outgoing_index = request
        .layers
        .iter()
        .position(|layer| layer.layer_id == transition.outgoing_layer)
        .ok_or_else(|| "Native transition outgoing layer is not present".to_string())?;
    let incoming_index = request
        .layers
        .iter()
        .position(|layer| layer.layer_id == transition.incoming_layer)
        .ok_or_else(|| "Native transition incoming layer is not present".to_string())?;
    let outgoing = layers
        .get(outgoing_index)
        .ok_or_else(|| "Native transition outgoing layer texture is not present".to_string())?;
    let incoming = layers
        .get(incoming_index)
        .ok_or_else(|| "Native transition incoming layer texture is not present".to_string())?;
    Ok((
        transition_source_layer(outgoing),
        transition_source_layer(incoming),
    ))
}

fn create_transition_source_texture(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    label: &'static str,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

/// Convert stream metadata into the explicit shader contract.
///
/// Completely unspecified metadata is common in older SDR files, so it uses
/// the established SDR default: limited-range Rec.709. Partially specified
/// unsupported metadata is rejected rather than silently guessed.
fn color_params(color: &VideoColorMetadata) -> Result<ColorTransformUniforms, String> {
    let color_space = match (color.matrix.as_str(), color.transfer.as_str()) {
        ("bt709", "bt709" | "srgb" | "unspecified") => 0,
        ("bt601_625" | "bt601_525", "bt709" | "srgb" | "unspecified") => 3,
        ("bt2020_ncl", "pq") => 1,
        ("bt2020_ncl", "hlg") => 2,
        ("unspecified", "unspecified") => 0,
        (matrix, transfer) => {
            return Err(format!(
                "Unsupported preview color metadata: matrix={} transfer={}",
                matrix, transfer
            ));
        }
    };

    Ok(ColorTransformUniforms {
        color_space,
        range: if color.range == "full" { 1 } else { 0 },
        // The HDR shader uses ACES for PQ/HLG and ignores this field for SDR.
        tonemap_operator: if color_space == 0 || color_space == 3 {
            0
        } else {
            1
        },
        target_peak_nits: 100.0,
    })
}

/// Prefer metadata attached to the decoded frame, while retaining stream-level
/// values when a decoder leaves an individual field unspecified.
pub(crate) fn merge_color_metadata(
    frame: VideoColorMetadata,
    stream: &VideoColorMetadata,
) -> VideoColorMetadata {
    let mut merged = frame;

    if merged.range == "unspecified" {
        merged.range = stream.range.clone();
        merged.range_code = stream.range_code;
    }
    if merged.matrix == "unspecified" {
        merged.matrix = stream.matrix.clone();
        merged.matrix_code = stream.matrix_code;
    }
    if merged.primaries == "unspecified" {
        merged.primaries = stream.primaries.clone();
        merged.primaries_code = stream.primaries_code;
    }
    if merged.transfer == "unspecified" {
        merged.transfer = stream.transfer.clone();
        merged.transfer_code = stream.transfer_code;
    }
    if merged.chroma_location == "unspecified" {
        merged.chroma_location = stream.chroma_location.clone();
        merged.chroma_location_code = stream.chroma_location_code;
    }

    merged
}

/// Decode and GPU-convert one source frame.
///
/// This is the first native preview proof. It returns the decoded source
/// dimensions and tightly packed RGBA8 bytes. Timeline compositing and a
/// persistent GPU surface are intentionally separate follow-up phases.
#[tauri::command]
pub async fn render_native_preview_frame(
    app: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
    output_width: Option<u32>,
    output_height: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    if !time_secs.is_finite() || time_secs < 0.0 {
        return Err("time_secs must be a finite non-negative number".to_string());
    }

    let video_path = crate::commands::media::normalize_file_path(&video_path);
    let decoder = get_preview_decoder(&video_path).await?;
    let (y_plane, uv_plane, width, height, color) = {
        let mut guard = decoder.lock().await;
        let stream_color = guard.metadata().color;
        let (y_plane, uv_plane, width, height, frame_color) =
            guard.decode_frame_raw_nv12(time_secs)?;
        (
            y_plane,
            uv_plane,
            width,
            height,
            merge_color_metadata(frame_color, &stream_color),
        )
    };

    let params = color_params(&color)?;
    let target_width = output_width.unwrap_or(width);
    let target_height = output_height.unwrap_or(height);
    let rgba = if let Some(state) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
    {
        let mut session = state.lock().await;
        session
            .render_nv12_frame(
                width,
                height,
                target_width,
                target_height,
                &y_plane,
                &uv_plane,
                &params,
            )
            .await?
    } else {
        if target_width != width || target_height != height {
            return Err("Native preview GPU session is unavailable for scaled output".to_string());
        }
        let renderer = NativeWgpuRenderer::new().await?;
        renderer
            .render_nv12_frame_with_color(width, height, &y_plane, &uv_plane, &params)
            .await?
    };

    Ok(tauri::ipc::Response::new(rgba))
}

/// Render a project-sized frame from deterministic solid layers.
///
/// This establishes the native timeline compositor contract independently of
/// media decoding. Video and image textures will use the same layer geometry
/// and ordering in the next migration step.
#[tauri::command]
pub async fn render_native_project_frame(
    app: tauri::AppHandle,
    request: NativeProjectFrameRequest,
) -> Result<tauri::ipc::Response, String> {
    validate_project_request(&request)?;

    let state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let mut session = state.lock().await;
    let gpu = Arc::clone(&session.gpu);
    let compositor = session.get_or_create_compositor(
        request.canvas_width,
        request.canvas_height,
        wgpu::TextureFormat::Rgba8Unorm,
    );
    let device = &gpu.device;
    let queue = &gpu.queue;

    let mut textures = Vec::with_capacity(request.layers.len());
    let mut views = Vec::with_capacity(request.layers.len());
    for (index, layer) in request.layers.iter().enumerate() {
        let rgba = [
            (layer.color[0].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[1].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[2].clamp(0.0, 1.0) * 255.0).round() as u8,
            (layer.color[3].clamp(0.0, 1.0) * 255.0).round() as u8,
        ];
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Native Solid Layer {}", index)),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }

    let canvas_width = request.canvas_width as f32;
    let canvas_height = request.canvas_height as f32;
    let layers: Result<Vec<CompositeLayer<'_>>, String> = request
        .layers
        .iter()
        .zip(views.iter())
        .map(|(layer, view)| {
            Ok(CompositeLayer {
                texture_view: view,
                lut: None,
                z_index: layer.z_index,
                opacity: layer.opacity.clamp(0.0, 1.0),
                blend_mode: parse_blend_mode(&layer.blend_mode)?,
                transform: project_layer_transform(layer, canvas_width, canvas_height),
                crop: CropMargins::default(),
                color_grade: ColorGradeUniforms::default(),
                mask_view: None,
                body_effect: BodyEffectUniforms::default(),
                chroma_key: ChromaKeyUniforms::default(),
            })
        })
        .collect();
    let layers = layers?;

    // Keep texture ownership alive until the compositor has completed readback.
    let _textures = textures;
    let rgba = compositor
        .render_to_rgba_bytes_with_size(
            device,
            queue,
            request.canvas_width,
            request.canvas_height,
            &layers,
            Some(wgpu::Color {
                r: request.clear_color[0].clamp(0.0, 1.0) as f64,
                g: request.clear_color[1].clamp(0.0, 1.0) as f64,
                b: request.clear_color[2].clamp(0.0, 1.0) as f64,
                a: request.clear_color[3].clamp(0.0, 1.0) as f64,
            }),
        )
        .await?;

    Ok(tauri::ipc::Response::new(rgba))
}

#[tauri::command]
pub async fn get_video_scopes(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
    scope_type: Option<crate::wgpu_compositor::scopes::ScopeType>,
) -> Result<crate::wgpu_compositor::scopes::VideoScopePayload, String> {
    let rgba = render_native_video_project_frame_bytes(app, request.clone()).await?;
    crate::wgpu_compositor::scopes::compute_video_scopes(
        &rgba,
        request.canvas_width,
        request.canvas_height,
        scope_type.unwrap_or(crate::wgpu_compositor::scopes::ScopeType::All),
    )
}

/// Decode, color-convert, and composite real video layers in native Rust/wgpu.
/// This internal function returns bytes so versioned frame-service commands can
/// add caching and stale-request handling without duplicating the renderer.
#[derive(Debug, Default, Clone, Copy)]
struct NativeRenderStageTimings {
    decode_time_us: u32,
    conversion_time_us: u32,
    compose_time_us: u32,
    readback_time_us: u32,
    decoder_mutex_wait_us: u64,
}

fn resolve_mask_view<'a>(
    effect: &BodyEffectSnapshot,
    mask_views: &'a HashMap<&'a str, &'a wgpu::TextureView>,
    is_continuous: bool,
) -> Option<&'a wgpu::TextureView> {
    if let Some(view) = mask_views.get(effect.mask_asset_id.as_str()).copied() {
        return Some(view);
    }
    if let Some((matched_id, view)) = mask_views.iter().find(|(k, _)| {
        k.starts_with(&effect.mask_asset_id) || effect.mask_asset_id.starts_with(**k)
    }) {
        if !is_continuous {
            diagnostics::info(
                "wgpu_compositor",
                "cutout_mask_prefix_match",
                format!(
                    "Bound mask via asset prefix match (target: '{}', matched: '{}')",
                    effect.mask_asset_id, matched_id
                ),
            );
        }
        return Some(*view);
    }
    if let Some(prefix) = effect.mask_asset_id.split(':').next() {
        if let Some((matched_id, view)) = mask_views.iter().find(|(k, _)| k.starts_with(prefix)) {
            if !is_continuous {
                diagnostics::info(
                    "wgpu_compositor",
                    "cutout_mask_prefix_match",
                    format!(
                        "Bound mask via prefix '{}' (target: '{}', matched: '{}')",
                        prefix, effect.mask_asset_id, matched_id
                    ),
                );
            }
            return Some(*view);
        }
    }
    diagnostics::warn(
        "wgpu_compositor",
        "cutout_mask_missing",
        format!(
            "Mask asset '{}' not found in raster layers (available: {}). Falling back to transparent cutout.",
            effect.mask_asset_id,
            mask_views.keys().copied().collect::<Vec<_>>().join(", ")
        ),
    );
    None
}

async fn render_native_video_project_frame_bytes(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<Vec<u8>, String> {
    Ok(render_native_video_project_frame_bytes_timed(app, request)
        .await?
        .0)
}

pub(crate) async fn render_frame_request_rgba(
    app: &tauri::AppHandle,
    request: &FrameRequest,
) -> Result<Vec<u8>, String> {
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        return Err(format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        ));
    }
    let legacy_request = to_video_project_request(request)?;
    let (rgba, _timings) =
        render_native_video_project_frame_bytes_timed(app.clone(), legacy_request).await?;
    Ok(rgba)
}

async fn render_native_video_project_frame_bytes_timed(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<(Vec<u8>, NativeRenderStageTimings), String> {
    validate_video_project_request(&request)?;

    let state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let lut_cache = app
        .try_state::<Arc<LutCache>>()
        .map(|state| state.inner().clone());
    let canvas_width = request.canvas_width as f32;
    let canvas_height = request.canvas_height as f32;

    let mut textures = Vec::with_capacity(
        request.layers.len() + request.raster_layers.len() + request.text_layers.len(),
    );
    let mut views = Vec::with_capacity(request.layers.len() + request.raster_layers.len());
    let mut decode_time_us = 0u32;
    let mut decoder_mutex_wait_us = 0u64;

    // ── Capability-Negotiated Render Path Selection ───────────────────────────
    // Before decoding, inspect the session's negotiated DXGI state. If zero-copy
    // has previously failed or was disabled, immediately bypass DXGI extraction
    // and proceed directly via the GpuUploadRing / CPU transfer fallback.
    #[cfg(target_os = "windows")]
    let can_attempt_dxgi = !request.layers.is_empty() && {
        let session = state.lock().await;
        session.dxgi_state.is_usable()
    };

    #[cfg(target_os = "windows")]
    let dxgi_env_disabled = std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
        || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1");

    #[cfg(target_os = "windows")]
    let dxgi_frames_result = if can_attempt_dxgi && !dxgi_env_disabled {
        use crate::thumbnail_engine::decoder::DecodeFrameOptions;
        let decode_options = DecodeFrameOptions {
            allow_keyframe_approx: request.allow_keyframe_approx.unwrap_or(false)
                || request.is_scrubbing.unwrap_or(false)
                || request.mode.as_deref() == Some("scrub"),
            quality: request.quality,
        };

        let mut frames = Vec::with_capacity(request.layers.len());
        let mut all_succeeded = true;
        let mut max_dec_us = 0u32;
        let mut total_wait_us = 0u64;

        for layer in &request.layers {
            let stream_id = if !layer.layer_id.is_empty() {
                &layer.layer_id
            } else {
                ""
            };
            let lock_started = Instant::now();
            let decoder = match get_preview_decoder_for_stream(&layer.video_path, stream_id).await {
                Ok(d) => d,
                Err(_) => {
                    all_succeeded = false;
                    break;
                }
            };
            let mut guard = decoder.lock().await;
            let wait_us = lock_started.elapsed().as_micros() as u64;
            total_wait_us = total_wait_us.saturating_add(wait_us);

            let mut frame_color = VideoColorMetadata::default();
            let mut width = 0u32;
            let mut height = 0u32;
            let decode_started = Instant::now();
            match guard.decode_frame_dxgi_windows(
                layer.time_secs,
                decode_options,
                || false,
                &mut frame_color,
                &mut width,
                &mut height,
            ) {
                Ok(Some(shared)) => {
                    let dec_us = decode_started.elapsed().as_micros().min(u32::MAX as u128) as u32;
                    max_dec_us = max_dec_us.max(dec_us);
                    let stream_color = guard.metadata().color;
                    let color = merge_color_metadata(frame_color, &stream_color);
                    frames.push((shared, width, height, color));
                }
                _ => {
                    all_succeeded = false;
                    break;
                }
            }
        }

        if all_succeeded && frames.len() == request.layers.len() {
            Some((frames, max_dec_us, total_wait_us))
        } else {
            None
        }
    } else {
        None
    };

    let mut session = state.lock().await;
    let gpu = Arc::clone(&session.gpu);
    let conversion_started = Instant::now();

    #[allow(unused_mut)]
    let mut render_path = FrameRenderPath::GpuUploadRing;

    #[cfg(target_os = "windows")]
    let can_use_dxgi = session.gpu.capabilities.zero_copy_available()
        && session.dxgi_state.is_usable()
        && !dxgi_env_disabled;

    #[cfg(target_os = "windows")]
    if can_use_dxgi {
        if let Some((frames, max_dec_us, total_wait_us)) = dxgi_frames_result {
            if !session.gpu.capabilities.wgpu_nv12 {
                session
                    .mark_dxgi_failed(crate::wgpu_compositor::DxgiFailureReason::UnsupportedFormat);
            } else {
                use crate::wgpu_compositor::dxgi_import;
                let mut import_all_ok = true;
                for (layer, (shared, width, height, color)) in
                    request.layers.iter().zip(frames.into_iter())
                {
                    let layer_key = if !layer.layer_id.is_empty() {
                        &layer.layer_id
                    } else {
                        &layer.video_path
                    };
                    let params = match color_params(&color) {
                        Ok(p) => p,
                        Err(_) => {
                            session.mark_dxgi_failed(
                                crate::wgpu_compositor::DxgiFailureReason::ImportFailed,
                            );
                            import_all_ok = false;
                            break;
                        }
                    };
                    match dxgi_import::import_into_wgpu(&session.gpu.device, shared) {
                        Ok(imported) => {
                            match session.render_nv12_from_imported_texture(
                                layer_key, width, height, &imported, &params,
                            ) {
                                Ok(texture) => {
                                    views.push(
                                        texture
                                            .create_view(&wgpu::TextureViewDescriptor::default()),
                                    );
                                    textures.push(texture);
                                }
                                Err(render_error) => {
                                    match render_error {
                                        crate::wgpu_compositor::PreviewRenderError::UnsupportedFeature(_) => {
                                            session.mark_dxgi_disabled(crate::wgpu_compositor::DisableReason::UnsupportedFeature);
                                        }
                                        crate::wgpu_compositor::PreviewRenderError::DimensionMismatch { .. } => {
                                            session.mark_dxgi_failed(crate::wgpu_compositor::DxgiFailureReason::DimensionMismatch);
                                        }
                                        _ => {
                                            session.mark_dxgi_failed(crate::wgpu_compositor::DxgiFailureReason::ImportFailed);
                                        }
                                    }
                                    import_all_ok = false;
                                    break;
                                }
                            }
                        }
                        Err(reason) => {
                            session.mark_dxgi_failed(reason);
                            import_all_ok = false;
                            break;
                        }
                    }
                }

                if import_all_ok {
                    session.mark_dxgi_supported();
                    decode_time_us = max_dec_us;
                    decoder_mutex_wait_us = total_wait_us;
                    render_path = FrameRenderPath::ZeroCopyDxgi;
                } else {
                    views.clear();
                    textures.clear();
                    render_path = FrameRenderPath::GpuUploadRing;
                }
            }
        }
    }

    let need_cpu_decode = render_path != FrameRenderPath::ZeroCopyDxgi;

    if need_cpu_decode {
        // Decode before taking the GPU session lock so a slow seek cannot block
        // another already-decoded preview frame from submitting work.
        drop(session);
        let (decoded_frames, decode_timings) = decode_native_video_layers(&request, None).await?;
        decode_time_us = decode_timings.decode_time_us;
        decoder_mutex_wait_us = decode_timings.decoder_mutex_wait_us;

        session = state.lock().await;
        for (layer, (planes, width, height, color, source_rotation)) in
            request.layers.iter().zip(decoded_frames.iter())
        {
            let params = color_params(color)?;
            let layer_key = if !layer.layer_id.is_empty() {
                &layer.layer_id
            } else {
                &layer.video_path
            };

            #[allow(unused_mut)]
            let mut layer_texture: Option<Arc<wgpu::Texture>> = None;
            #[cfg(target_os = "windows")]
            if let DecodedVideoPlanes::D3d11(ref shared_arc) = planes {
                if session.gpu.capabilities.zero_copy_available()
                    && session.dxgi_state.is_usable()
                    && crate::wgpu_compositor::adapter_selector::is_dxgi_runtime_enabled()
                {
                    if let Some(duped_shared) = shared_arc.duplicate() {
                        if let Ok(imported) = crate::wgpu_compositor::dxgi_import::import_into_wgpu(
                            &session.gpu.device,
                            duped_shared,
                        ) {
                            if let Ok(texture) = session.render_nv12_from_imported_texture(
                                layer_key, *width, *height, &imported, &params,
                            ) {
                                session.mark_dxgi_supported();
                                layer_texture = Some(texture);
                            }
                        }
                    }
                }
            }

            let texture = match layer_texture {
                Some(t) => t,
                None => {
                    let (y_plane, uv_plane) = planes.cpu_planes().ok_or_else(|| {
                        "CPU fallback planes unavailable for preview rendering".to_string()
                    })?;

                    // Rotate NV12 pixels to upright orientation when the source has a
                    // non-zero display rotation (e.g. portrait Pixel video stored landscape).
                    // This matches the thumbnail path's rotate_rgba step so the GPU compositor
                    // always receives an already-upright texture and applies only the
                    // user/author rotation via the transform matrix.
                    let (tex_w, tex_h);
                    if *source_rotation != 0 {
                        let (ry, ruv, rw, rh) = crate::thumbnail_engine::decoder::rotate_nv12(
                            y_plane,
                            uv_plane,
                            *width,
                            *height,
                            *source_rotation,
                        );
                        tex_w = rw;
                        tex_h = rh;
                        session.render_nv12_frame_to_texture(
                            layer_key, tex_w, tex_h, tex_w, tex_h, &ry, &ruv, &params,
                        )?
                    } else {
                        tex_w = *width;
                        tex_h = *height;
                        session.render_nv12_frame_to_texture(
                            layer_key, tex_w, tex_h, tex_w, tex_h, y_plane, uv_plane, &params,
                        )?
                    }
                }
            };
            views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
            textures.push(texture);
        }
    }
    let mut evicted_mask_ids: Vec<String> = Vec::new();
    let mut evicted_raster_ids: Vec<String> = Vec::new();
    for layer in &request.raster_layers {
        let texture = if layer.rgba.is_none() && !session.is_rgba_layer_resident(&layer.asset_id) {
            if layer.is_mask {
                // Mask is missing from GPU LRU. Only treat as an eviction if it was
                // ever registered previously. Otherwise, it is a cold start or an in-flight
                // segmentation mask that hasn't completed registration yet.
                if session.was_mask_ever_registered(&layer.asset_id) {
                    evicted_mask_ids.push(layer.asset_id.clone());
                    session.forget_mask_registration(&layer.asset_id);
                }
            } else {
                evicted_raster_ids.push(layer.asset_id.clone());
            }
            // Substitute a transparent placeholder so the frame still renders without crashing —
            // the missing layer will be restored upon re-registration.
            session.transparent_mask_placeholder()
        } else {
            session
                .get_or_upload_rgba_layer_to_texture(
                    &layer.asset_id,
                    layer.width,
                    layer.height,
                    layer.rgba.as_deref(),
                )
                .map_err(|e| e.to_string())?
        };
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }
    if !evicted_mask_ids.is_empty() {
        let _ = app.emit("native-mask-evicted", &evicted_mask_ids);
    }
    if !evicted_raster_ids.is_empty() {
        let _ = app.emit("native-raster-evicted", &evicted_raster_ids);
    }
    let mut text_views = Vec::with_capacity(request.text_layers.len());
    let mut text_dims = Vec::with_capacity(request.text_layers.len());
    for text_layer in &request.text_layers {
        let (texture, view, width, height) = session.get_or_render_text_layer(text_layer)?;
        text_views.push(view);
        text_dims.push((width as f32, height as f32));
        textures.push(texture);
    }
    let conversion_time_us = conversion_started
        .elapsed()
        .as_micros()
        .min(u32::MAX as u128) as u32;

    let compositor = session.get_or_create_compositor(
        request.canvas_width,
        request.canvas_height,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );
    let mut specs = Vec::with_capacity(
        request.layers.len() + request.raster_layers.len() + request.text_layers.len(),
    );
    let mask_views: HashMap<&str, &wgpu::TextureView> = request
        .raster_layers
        .iter()
        .zip(views.iter().skip(request.layers.len()))
        .filter(|(layer, _)| {
            layer.is_mask && !evicted_mask_ids.iter().any(|id| id == &layer.asset_id)
        })
        .map(|(layer, view)| (layer.asset_id.as_str(), view))
        .collect();
    for (layer, view) in request.layers.iter().zip(views.iter()) {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: color_grade_from_snapshot(layer.color_grade.as_ref()),
            mask_view: layer
                .body_effect
                .as_ref()
                .and_then(|effect| resolve_mask_view(effect, &mask_views, false)),
            body_effect: body_effect_from_snapshot(layer.body_effect.as_ref()),
            lut: resolve_native_lut(layer.color_grade.as_ref(), lut_cache.as_ref())?,
            grain_seed: ((layer.time_secs.max(0.0) * 60.0).floor() * 0.37) as f32,
        });
    }
    let raster_views = views.iter().skip(request.layers.len());
    for (layer, view) in request
        .raster_layers
        .iter()
        .zip(raster_views)
        .filter(|(layer, _)| !layer.is_mask)
    {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.display_width(),
            height: layer.display_height(),
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    for (text_layer, (view, (width, height))) in request
        .text_layers
        .iter()
        .zip(text_views.iter().zip(text_dims.iter()))
    {
        let scale = compute_text_layer_scale(text_layer, *width, *height);
        let display_width = *width * scale;
        let display_height = *height * scale;
        let (layer_x, layer_y) =
            compute_text_layer_placement(text_layer, display_width, display_height);
        specs.push(NativeLayerSpec {
            view: view.as_ref(),
            x: layer_x,
            y: layer_y,
            width: display_width,
            height: display_height,
            rotation: text_layer.rotation,
            opacity: text_layer.opacity,
            z_index: text_layer.z_index,
            blend_mode: &text_layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    let layers = build_native_composite_layers(&specs, canvas_width, canvas_height)?;
    // Keep both decoded textures and their views alive through GPU readback.
    let _textures = textures;
    let clear_color = wgpu::Color {
        r: request.clear_color[0].clamp(0.0, 1.0) as f64,
        g: request.clear_color[1].clamp(0.0, 1.0) as f64,
        b: request.clear_color[2].clamp(0.0, 1.0) as f64,
        a: request.clear_color[3].clamp(0.0, 1.0) as f64,
    };
    let (rgba, compose_time_us, readback_time_us) =
        if let Some(transition) = request.transition.as_ref() {
            let (from_layer, to_layer) = build_transition_sources(&request, &layers)?;
            let from_texture = create_transition_source_texture(
                &gpu.device,
                request.canvas_width,
                request.canvas_height,
                wgpu::TextureFormat::Rgba8UnormSrgb,
                "Native Transition From Texture",
            );
            let to_texture = create_transition_source_texture(
                &gpu.device,
                request.canvas_width,
                request.canvas_height,
                wgpu::TextureFormat::Rgba8UnormSrgb,
                "Native Transition To Texture",
            );
            let from_view = from_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let to_view = to_texture.create_view(&wgpu::TextureViewDescriptor::default());
            compositor.composite_layers(
                &gpu.device,
                &gpu.queue,
                &from_view,
                std::slice::from_ref(&from_layer),
                Some(clear_color),
            )?;
            compositor.composite_layers(
                &gpu.device,
                &gpu.queue,
                &to_view,
                std::slice::from_ref(&to_layer),
                Some(clear_color),
            )?;
            let overlays = if layers.len() > 2 { &layers[2..] } else { &[] };
            let (rgba, compositor_compose_us, readback_us) = compositor
                .render_transition_with_overlays_to_rgba_bytes_timed(
                    &gpu.device,
                    &gpu.queue,
                    request.canvas_width,
                    request.canvas_height,
                    &from_view,
                    &to_view,
                    &transition_uniforms(transition),
                    overlays,
                    Some(clear_color),
                )
                .await?;
            (rgba, compositor_compose_us, readback_us)
        } else {
            compositor
                .render_to_rgba_bytes_with_size_timed(
                    &gpu.device,
                    &gpu.queue,
                    request.canvas_width,
                    request.canvas_height,
                    &layers,
                    Some(clear_color),
                )
                .await?
        };
    Ok((
        rgba,
        NativeRenderStageTimings {
            decode_time_us,
            conversion_time_us,
            compose_time_us: compose_time_us.min(u32::MAX as u64) as u32,
            readback_time_us: readback_time_us.min(u32::MAX as u64) as u32,
            decoder_mutex_wait_us,
        },
    ))
}

async fn decode_native_video_layers(
    request: &NativeVideoProjectFrameRequest,
    cancellation: Option<(Arc<AtomicU64>, u64)>,
) -> Result<(Vec<DecodedNativeVideoFrame>, NativeDecodeTimings), String> {
    if request.layers.is_empty() {
        return Ok((Vec::new(), NativeDecodeTimings::default()));
    }

    let decode_options = DecodeFrameOptions {
        allow_keyframe_approx: request.allow_keyframe_approx.unwrap_or(false)
            || request.is_scrubbing.unwrap_or(false)
            || request.mode.as_deref() == Some("scrub"),
        quality: request.quality,
    };

    let is_prefetch = request.mode.as_deref() == Some("prefetch");
    let generation = cancellation
        .as_ref()
        .map(|(_, g)| *g)
        .or(request.generation)
        .unwrap_or(0);

    if request.layers.len() == 1 {
        let layer = &request.layers[0];
        let stream_id = if !layer.layer_id.is_empty() {
            &layer.layer_id
        } else {
            ""
        };
        let actor = crate::thumbnail_engine::stream_actor::get_preview_decoder_actor_for_stream(
            &layer.video_path,
            stream_id,
        )
        .await?;
        let actor_frame = actor
            .decode_frame(layer.time_secs, decode_options, is_prefetch, generation)
            .await?;
        let decode_us = actor_frame.decode_us;
        let mutex_wait_us = actor_frame.decoder_mutex_wait_us;
        let actor_wait_us = actor_frame.actor_wait_us;
        let demux_us = actor_frame.demux_us;
        let container_format = actor_frame.container_format.clone();
        let is_hw = actor_frame.is_hardware_accelerated;
        let decoded = actor_frame.into_native_video_frame();
        return Ok((
            vec![decoded],
            NativeDecodeTimings {
                decode_time_us: decode_us,
                decoder_mutex_wait_us: mutex_wait_us,
                actor_wait_us: Some(actor_wait_us),
                demux_wait_us: Some(u64::from(demux_us)),
                container_format: Some(container_format),
                is_hardware_accelerated: Some(is_hw),
            },
        ));
    }

    // Professional NLE concurrent multi-stream decoding:
    // Each distinct layer is assigned an isolated stream decoder reader so stacked clips
    // decode independently in parallel without GOP thrashing.
    // Layers sharing the exact same video file and timestamp (such as synthesized
    // :subject-cutout foreground layers) share the decoded NV12 planes without leasing
    // a second FFmpeg decoder.
    let mut unique_tasks = Vec::new();
    let mut layer_to_unique_idx = Vec::with_capacity(request.layers.len());

    for (layer_idx, layer) in request.layers.iter().enumerate() {
        let duplicate_of = request.layers[..layer_idx].iter().position(|prev| {
            prev.video_path == layer.video_path && (prev.time_secs - layer.time_secs).abs() < 0.0001
        });

        if let Some(prev_idx) = duplicate_of {
            let unique_idx = layer_to_unique_idx[prev_idx];
            layer_to_unique_idx.push(unique_idx);
        } else {
            let unique_idx = unique_tasks.len();
            layer_to_unique_idx.push(unique_idx);

            let video_path = layer.video_path.clone();
            let layer_id = layer.layer_id.clone();
            let time_secs = layer.time_secs;

            unique_tasks.push(tauri::async_runtime::spawn(async move {
                let stream_id = if !layer_id.is_empty() {
                    layer_id.as_str()
                } else {
                    ""
                };
                let actor =
                    crate::thumbnail_engine::stream_actor::get_preview_decoder_actor_for_stream(
                        &video_path,
                        stream_id,
                    )
                    .await?;
                let actor_frame = actor
                    .decode_frame(time_secs, decode_options, is_prefetch, generation)
                    .await?;
                let decode_us = actor_frame.decode_us;
                let mutex_wait_us = actor_frame.decoder_mutex_wait_us;
                let actor_wait_us = actor_frame.actor_wait_us;
                let demux_us = actor_frame.demux_us;
                let container_format = actor_frame.container_format.clone();
                let is_hw = actor_frame.is_hardware_accelerated;
                let decoded = actor_frame.into_native_video_frame();
                Ok::<_, String>((
                    decoded,
                    decode_us,
                    mutex_wait_us,
                    actor_wait_us,
                    demux_us,
                    container_format,
                    is_hw,
                    layer_id,
                ))
            }));
        }
    }

    let mut unique_results = Vec::with_capacity(unique_tasks.len());
    let mut max_decode_us = 0u32;
    let mut total_mutex_wait_us = 0u64;
    let mut max_actor_wait_us = 0u64;
    let mut max_demux_us = 0u64;
    let mut primary_container = None;
    let mut all_hw = true;

    for task in unique_tasks {
        let res = task
            .await
            .map_err(|e| format!("Decode worker task failed: {e}"))??;
        max_decode_us = max_decode_us.max(res.1);
        total_mutex_wait_us = total_mutex_wait_us.saturating_add(res.2);
        max_actor_wait_us = max_actor_wait_us.max(res.3);
        max_demux_us = max_demux_us.max(u64::from(res.4));
        if primary_container.is_none() && !res.5.is_empty() {
            primary_container = Some(res.5.clone());
        }
        if !res.6 {
            all_hw = false;
        }
        unique_results.push(res);
    }

    let mut decoded_frames = Vec::with_capacity(request.layers.len());
    for &unique_idx in &layer_to_unique_idx {
        let (ref frame, ..) = unique_results[unique_idx];
        decoded_frames.push(frame.clone());
    }

    Ok((
        decoded_frames,
        NativeDecodeTimings {
            decode_time_us: max_decode_us,
            decoder_mutex_wait_us: total_mutex_wait_us,
            actor_wait_us: Some(max_actor_wait_us),
            demux_wait_us: Some(max_demux_us),
            container_format: primary_container,
            is_hardware_accelerated: Some(all_hw),
        },
    ))
}

/// Decode a frame into the bounded native playback queue without presenting
/// it. The following presentation command can then reuse the decoded planes
/// and spend its critical path only on GPU conversion/compositing/surface
/// submission.
#[tauri::command]
pub async fn queue_native_frame(
    app: tauri::AppHandle,
    request: FrameRequest,
) -> Result<(), String> {
    let command_started = Instant::now();
    request.validate().map_err(|error| error.to_string())?;
    let key = request
        .decode_cache_key()
        .map_err(|error| error.to_string())?;
    let legacy_request = to_video_project_request(&request)?;
    validate_video_project_request(&legacy_request)?;

    let queue = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
        .ok_or_else(|| "Native preview frame queue is not initialized".to_string())?
        .inner()
        .clone();
    // Prefetch work is deliberately outside the visible generation fence. Its
    // cache key still contains the project revision and exact frame, so stale
    // work can never be presented as a different frame, while allowing a
    // look-ahead decode started at play time to survive subsequent clock ticks.
    let is_prefetch = request.mode.as_deref() == Some("prefetch");
    let generation = request.generation.unwrap_or(0);
    let cancellation_generation;
    let lifecycle_epoch;
    let scheduler_wait_started = Instant::now();
    let scheduler_wait_us;
    {
        let mut queue_state = queue.lock().await;
        scheduler_wait_us = scheduler_wait_started.elapsed().as_micros() as u64;
        if !is_prefetch {
            queue_state.observe_generation(generation);
            if !queue_state.is_generation_current(generation) {
                return Ok(());
            }
        }
        if !queue_state.begin(&key, Some(request.frame_time.frame_index)) {
            return Ok(());
        }
        lifecycle_epoch = queue_state.lifecycle_epoch();
        cancellation_generation = queue_state.latest_generation.clone();
    }

    struct PendingKeyGuard {
        queue: Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>,
        key: Option<String>,
    }

    impl Drop for PendingKeyGuard {
        fn drop(&mut self) {
            if let Some(key) = self.key.take() {
                let queue = self.queue.clone();
                tauri::async_runtime::spawn(async move {
                    queue.lock().await.fail(&key);
                });
            }
        }
    }

    let mut pending_guard = PendingKeyGuard {
        queue: queue.clone(),
        key: Some(key.clone()),
    };

    let cancellation = Some((cancellation_generation, generation));
    if is_prefetch && !legacy_request.text_layers.is_empty() {
        // Warm text before the potentially expensive FFmpeg seek. Otherwise a
        // future boundary can finish decoding only after the text SDF compile
        // has missed the presentation deadline.
        if let Some(preview_state) =
            app.try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        {
            let mut session = preview_state.lock().await;
            for text_layer in &legacy_request.text_layers {
                session.get_or_render_text_layer(text_layer)?;
            }
        }
    }
    match decode_native_video_layers(&legacy_request, cancellation).await {
        Ok((decoded_frames, decode_timings)) => {
            // Start this clock as soon as decoding is complete, before taking
            // the queue lock. A contended producer lock should be visible as
            // part of the time the decoded result is unavailable to present.
            let ready_at = Instant::now();
            let mut queue_state = queue.lock().await;
            if is_prefetch || queue_state.is_generation_current(generation) {
                pending_guard.key = None;
                let _ = queue_state.complete(
                    key,
                    QueuedNativeFrame {
                        frame_index: request.frame_time.frame_index,
                        decoded_frames,
                        decode_timings,
                        queued_at: command_started,
                        ready_at,
                        scheduler_wait_us,
                    },
                    lifecycle_epoch,
                );
            } else {
                pending_guard.key = None;
                queue_state.fail(&key);
            }
            Ok(())
        }
        Err(error) => {
            pending_guard.key = None;
            queue.lock().await.fail(&key);
            Err(error)
        }
    }
}

struct LookaheadWorkerState {
    handle: tauri::async_runtime::JoinHandle<()>,
    generation: u64,
    finished: Arc<std::sync::atomic::AtomicBool>,
}

static LOOKAHEAD_WORKER: std::sync::Mutex<Option<LookaheadWorkerState>> =
    std::sync::Mutex::new(None);

/// Read the capability-probe-selected quality tier from the active render session.
///
/// The startup probe in `configure_native_playback_render` writes the chosen
/// tier into `render_session.snapshot.quality` via `set_preview_quality()`.
/// This helper propagates that decision into the lookahead worker so that
/// pre-decode frames use the same scaled resolution as foreground frames —
/// critical on constrained iGPUs where `Proxy` (÷4) is chosen at probe time.
///
/// Returns `None` if no render session is active, letting the caller fall back
/// to the per-request quality embedded in the frame request itself.
fn current_lookahead_quality(
    app: &tauri::AppHandle,
) -> Option<crate::native_core::QualityTier> {
    let playback = app.try_state::<Arc<std::sync::Mutex<
        crate::commands::native_playback::NativePlaybackRuntime,
    >>>()?;
    let runtime_arc = playback.inner().clone();
    let runtime = runtime_arc.lock().ok()?;
    runtime.render_session_quality()
}

/// Non-blocking lookahead pre-decode worker.
/// Pre-decodes upcoming frames sequentially into `NativePreviewFrameQueue`
/// ahead of the presentation playhead. Because sequential forward decoding in FFmpeg
/// requires no seeking, each frame decodes in 1-3ms.
pub(crate) fn schedule_lookahead_predecode(
    app: tauri::AppHandle,
    base_request: FrameRequest,
    lookahead_count: usize,
    quality_override: Option<crate::native_core::QualityTier>,
) {
    if base_request.project.video_layers.is_empty() || lookahead_count == 0 {
        return;
    }

    let generation = base_request.generation.unwrap_or(0);
    let frame_rate = base_request.project.frame_rate.max(1);
    let fps = frame_rate as f64;

    let mut worker_guard = match LOOKAHEAD_WORKER.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    // If an active worker for the SAME generation is already busy pre-decoding upcoming frames,
    // do NOT abort it! Let it continue its sequential decoding pipeline uninterrupted.
    if let Some(active) = worker_guard.as_ref() {
        if active.generation == generation
            && !active.finished.load(std::sync::atomic::Ordering::Acquire)
        {
            return;
        }
    }

    // If generation changed (seek or project edit), abort previous worker to free decoders immediately.
    if let Some(prev) = worker_guard.take() {
        if prev.generation != generation {
            prev.handle.abort();
        }
    }

    // Anchor current audio playback position
    let (current_audio_frame, _current_audio_secs) = if let Ok(audio_time) =
        crate::commands::native_playback::audio_clock_time(&app, true, false)
    {
        let audio_secs = (audio_time.ticks as f64) / (audio_time.timescale.max(1) as f64);
        let audio_frame = (audio_secs * fps).round() as u64;
        (audio_frame, audio_secs)
    } else {
        let base_time_secs = (base_request.frame_time.ticks as f64)
            / (base_request.frame_time.timescale.max(1) as f64);
        (base_request.frame_time.frame_index, base_time_secs)
    };

    let _base_timeline_secs =
        (base_request.frame_time.ticks as f64) / (base_request.frame_time.timescale.max(1) as f64);

    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_finished = finished.clone();

    let handle = tauri::async_runtime::spawn(async move {
        // Determine the next forward frame range that needs decoding:
        // NEVER decode backwards during playback!
        // If highest_frame_index >= current_audio_frame, start at highest_frame_index + 1
        // so the decoder moves strictly FORWARD in 11ms sequential steps.
        let (start_frame_index, target_end_frame_index) = {
            let queue_opt = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>();
            let (highest, effective_lookahead_count) = if let Some(queue) = &queue_opt {
                let queue_state = queue.lock().await;
                (
                    queue_state.highest_frame_index(),
                    deadline_aware_lookahead_count(
                        frame_rate,
                        lookahead_count,
                        queue_state.estimated_decode_us(),
                    ),
                )
            } else {
                (
                    None,
                    deadline_aware_lookahead_count(frame_rate, lookahead_count, None),
                )
            };

            let target_end = current_audio_frame.saturating_add(effective_lookahead_count as u64);
            let start = match highest {
                Some(max_idx) if max_idx >= current_audio_frame => max_idx.saturating_add(1),
                _ => current_audio_frame,
            };

            (start, target_end)
        };

        if start_frame_index > target_end_frame_index {
            return;
        }

        for target_frame_index in start_frame_index..=target_end_frame_index {
            // Check generation currency before each frame
            if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
            {
                let queue_state = queue.lock().await;
                if !queue_state.is_generation_current(generation) {
                    break;
                }
            }

            // A decode that has fallen behind the advancing audio clock is
            // guaranteed to increase queue residency rather than help the
            // visible frame. Skip it and let the next scheduler pass target
            // the current playhead instead.
            if let Ok(audio_time) =
                crate::commands::native_playback::audio_clock_time(&app, true, false)
            {
                let live_frame = ((audio_time.ticks as f64 / audio_time.timescale.max(1) as f64)
                    * fps)
                    .round() as u64;
                if target_frame_index < live_frame {
                    continue;
                }
            }

            let base_frame_index = base_request.frame_time.frame_index;
            let frame_delta = target_frame_index as i64 - base_frame_index as i64;
            let target_time_secs = target_frame_index as f64 / fps;

            let mut req = base_request.clone();
            req.mode = Some("prefetch".to_string());
            req.generation = Some(generation);
            req.request_id = format!("predecode:{target_frame_index}");
            req.frame_time.frame_index = target_frame_index;
            req.frame_time.ticks = (target_time_secs * DEFAULT_TIME_SCALE as f64).round() as i64;
            req.frame_time.timescale = DEFAULT_TIME_SCALE;

            for layer in &mut req.project.video_layers {
                let base_source_frame = layer.source_time.frame_index;
                let target_source_frame = (base_source_frame as i64 + frame_delta).max(0) as u64;
                let target_source_secs = target_source_frame as f64 / fps;
                let ticks = (target_source_secs * DEFAULT_TIME_SCALE as f64).round() as i64;
                if let Ok(ft) = FrameTime::new(target_source_frame, ticks, DEFAULT_TIME_SCALE) {
                    layer.source_time = ft;
                }
            }

            // If already in queue or pending, skip
            if let Ok(key) = req.decode_cache_key() {
                if let Some(queue) =
                    app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
                {
                    let queue_state = queue.lock().await;
                    if queue_state.contains(&key) {
                        continue;
                    }
                }
            }

            // Apply quality tier override from the capability probe. The probe
            // runs at session start and selects Half/Quarter when the decoder
            // cannot sustain full-quality decode within the frame deadline.
            if let Some(quality) = quality_override {
                req.quality = quality;
            }

            let res = queue_native_frame(app.clone(), req).await;
            if res.is_err() {
                break;
            }
        }
        worker_finished.store(true, std::sync::atomic::Ordering::Release);
    });

    *worker_guard = Some(LookaheadWorkerState {
        handle,
        generation,
        finished,
    });
}

/// End a playback queue lifetime. Any asynchronous decode reserved before this
/// call is rejected on completion, so it cannot be presented after a pause or
/// render-worker replacement.
pub(crate) async fn reset_native_preview_queue(app: &tauri::AppHandle) {
    if let Ok(mut worker) = LOOKAHEAD_WORKER.lock() {
        if let Some(previous) = worker.take() {
            previous.handle.abort();
        }
    }
    if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
        queue.inner().clone().lock().await.reset();
    }
}

/// Mark all older native preview work stale. Decoder calls that cannot be
/// interrupted at an FFmpeg boundary are still prevented from entering the
/// bounded queue or presentation path when they return.
#[tauri::command]
pub async fn cancel_native_preview_requests(
    app: tauri::AppHandle,
    generation: u64,
) -> Result<(), String> {
    if let Ok(mut worker) = LOOKAHEAD_WORKER.lock() {
        if let Some(prev) = worker.take() {
            prev.handle.abort();
        }
    }
    let queue = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
        .ok_or_else(|| "Native preview frame queue is not initialized".to_string())?
        .inner()
        .clone();
    queue.lock().await.observe_generation(generation);
    if let Some(playback) = app.try_state::<Arc<std::sync::Mutex<crate::commands::native_playback::NativePlaybackRuntime>>>() {
        if let Ok(runtime) = playback.inner().clone().lock() {
            runtime.invalidate_render_generation(generation);
        }
    }
    Ok(())
}

/// Register immutable browser-rendered pixels in the native GPU asset cache.
/// Subsequent versioned frame requests may reference the asset by id without
/// retransmitting its RGBA payload over IPC.
#[tauri::command]
pub async fn register_native_raster_asset(
    app: tauri::AppHandle,
    asset: NativeRasterAssetRegistration,
) -> Result<(), String> {
    if asset.asset_id.trim().is_empty() {
        return Err("Native raster asset id must be non-empty".to_string());
    }
    let raw_rgba = if let Some(b64) = &asset.rgba_base64 {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        BASE64
            .decode(b64)
            .map_err(|e| format!("Failed to decode base64 rgba: {e}"))?
    } else {
        asset.rgba
    };
    let expected_bytes = (asset.width as usize)
        .checked_mul(asset.height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native raster asset dimensions overflow".to_string())?;
    if asset.width == 0
        || asset.height == 0
        || asset.width > 8192
        || asset.height > 8192
        || raw_rgba.len() != expected_bytes
        || raw_rgba.len() > 64 * 1024 * 1024
    {
        return Err("Native raster asset payload is invalid".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(
            &asset.asset_id,
            asset.width,
            asset.height,
            Some(&raw_rgba),
        )
        .map(|_| ())
}

/// High-performance raw binary raster asset registration.
/// Accepts raw RGBA bytes directly from the IPC request body, avoiding base64
/// expansion and JSON array serialization. Headers:
/// - asset-id: string
/// - width: u32
/// - height: u32
#[tauri::command]
pub async fn register_native_raster_asset_raw(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let headers = request.headers();
    let asset_id = headers
        .get("asset-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing asset-id header".to_string())?
        .to_string();

    if asset_id.trim().is_empty() {
        return Err("Native raster asset id must be non-empty".to_string());
    }

    let width: u32 = headers
        .get("width")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "Missing or invalid width header".to_string())?;

    let height: u32 = headers
        .get("height")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "Missing or invalid height header".to_string())?;

    let tauri::ipc::InvokeBody::Raw(raw_rgba) = request.body() else {
        return Err("Expected raw binary payload for raster asset".to_string());
    };

    let expected_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native raster asset dimensions overflow".to_string())?;

    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || raw_rgba.len() != expected_bytes
        || raw_rgba.len() > 64 * 1024 * 1024
    {
        return Err("Native raster asset payload is invalid".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(&asset_id, width, height, Some(raw_rgba))
        .map(|_| ())
}

/// Decode and upload a still-image asset without returning its pixels through
/// the WebView. This keeps first-use image activation off the JS main thread
/// and makes the native GPU cache the sole owner of the decoded raster.
#[tauri::command]
pub async fn register_native_image_asset(
    app: tauri::AppHandle,
    asset_id: String,
    path: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if asset_id.trim().is_empty() {
        return Err("Native image asset id must be non-empty".to_string());
    }
    let expected_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native image dimensions overflow".to_string())?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || expected_bytes > 64 * 1024 * 1024
    {
        return Err("Native image dimensions are outside the native limit".to_string());
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;

    {
        let mut session = preview_state.lock().await;
        if session.has_rgba_layer(&asset_id, width, height) {
            return Ok(());
        }
    }

    let rgba = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::media::decode_image_rgba_bytes(&path, width, height)
    })
    .await
    .map_err(|error| format!("Native image decode task failed: {}", error))??;

    let mut session = preview_state.lock().await;
    session
        .get_or_upload_rgba_layer_to_texture(&asset_id, width, height, Some(&rgba))
        .map(|_| ())
}

/// Present a versioned frame directly to the retained native surface.
///
/// This is deliberately a sibling of the readback renderer rather than a
/// second composition implementation: decode, color conversion, layer
/// transforms, blend modes, and clear color are identical. The only changed
/// target is the final wgpu texture view, which removes the CPU RGBA bridge
/// when an embedded native surface is available.
pub(crate) async fn present_native_frame_internal(
    app: tauri::AppHandle,
    request: FrameRequest,
) -> Result<NativeSurfacePresentation, String> {
    let presentation_started = Instant::now();
    let presentation_sequence =
        NATIVE_SURFACE_PRESENTATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        return Err(format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        ));
    }
    if let Some(generation) = request.generation {
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
            if !queue
                .inner()
                .clone()
                .lock()
                .await
                .is_generation_current(generation)
            {
                return Err("Native preview frame request is stale".to_string());
            }
        }
    }
    let legacy_request = to_video_project_request(&request)?;
    validate_video_project_request(&legacy_request)?;
    let surface_state = app
        .try_state::<Arc<std::sync::Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is unavailable".to_string())?;
    let presentation_epoch = surface_state
        .lock()
        .unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.handle_poison_recovery("present_native_frame_internal:request_check");
            state
        })
        .runtime_epoch();
    let queued_key = request
        .decode_cache_key()
        .map_err(|error| error.to_string())?;
    let is_playback_mode = request.mode.as_deref() == Some("playback");
    let mut playback_lookahead_miss = false;
    let lookahead_wait_us: u64 = 0;
    let queued_frame =
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
            let queue_arc = queue.inner().clone();
            let mut q = queue_arc.lock().await;
            // A visible request establishes the current playback floor. Keep
            // at most the two-frame tolerance used by the closest-frame
            // fallback; older entries can never be presented and only turn a
            // full queue into latency.
            q.discard_before(request.frame_time.frame_index.saturating_sub(2));
            // Frame proximity alone is insufficient after a pause, startup
            // stall, or worker restart. Never present a frame that missed its
            // wall-clock presentation deadline.
            q.discard_expired(presentation_started);
            if let Some(frame) = q.take(&queued_key) {
                Some(frame)
            } else if is_playback_mode {
                // A presentation tick is a deadline, not a decode request.
                // Never wait for in-flight lookahead and never start a second
                // foreground decode here: either use a recent completed frame
                // or explicitly drop this tick. The worker keeps decoding the
                // latest demand and will refill the queue for the next tick.
                let frame = q.take_matching_or_closest(&queued_key, request.frame_time.frame_index);
                playback_lookahead_miss = frame.is_none();
                frame
            } else {
                None
            }
        } else {
            None
        };
    if playback_lookahead_miss {
        // A miss is intentionally non-blocking, but it must never become a
        // terminal queue state. The normal refill call lives after a
        // successful presentation, which this early return bypasses. Ensure
        // the single bounded worker is running before reporting the drop so
        // the next audio deadline can consume newly ready work. The scheduler
        // coalesces an already-running worker for this generation.
        schedule_lookahead_predecode(app.clone(), request.clone(), 16, current_lookahead_quality(&app));
        let probe = surface_state
            .lock()
            .unwrap_or_else(|poisoned| {
                let mut state = poisoned.into_inner();
                state.handle_poison_recovery("present_native_frame_internal:lookahead_miss");
                state
            })
            .probe()
            .ok_or_else(|| "Native surface lost its readiness probe".to_string())?;
        let is_playback = request.mode.as_deref() == Some("playback");
        let (audio_position_ticks, frame_age_ticks, _) = native_presentation_timing(
            &app,
            request.frame_time.ticks,
            request.frame_time.timescale,
            is_playback,
        );
        SYNC_METRICS.record_lookahead_miss();
        record_native_surface_sample(
            &app,
            &request,
            presentation_started,
            &NativeDecodeTimings::default(),
            false,
            0,
            Some(0),
            None,
            None,
            None,
            None,
            None,
            None,
            true,
            false,
            Some("lookahead-miss"),
            None,
            None,
            None,
        );
        return Ok(NativeSurfacePresentation {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request.request_id,
            frame_index: request.frame_time.frame_index,
            presented: false,
            dropped: true,
            audio_position_ticks,
            frame_age_ticks,
            surface: probe,
            generation: request.generation,
            mode: request.mode,
            stale: false,
            cancelled: false,
            drop_reason: Some("lookahead-miss".to_string()),
            timings: None,
        });
    }
    let (
        decoded_frames,
        decode_timings,
        scheduler_lock_wait_us,
        ready_at,
        request_started_at,
        queue_hit,
    ) = match queued_frame {
        Some(frame) => (
            frame.decoded_frames,
            frame.decode_timings,
            frame.scheduler_wait_us,
            Some(frame.ready_at),
            presentation_started,
            true,
        ),
        None => {
            let (decoded_frames, decode_timings) =
                decode_native_video_layers(&legacy_request, None).await?;
            if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
            {
                queue
                    .lock()
                    .await
                    .observe_frame_index(request.frame_time.frame_index);
            }
            (
                decoded_frames,
                decode_timings,
                0,
                None,
                presentation_started,
                false,
            )
        }
    };
    let queue_residency_us =
        ready_at.map(|ready_at| queue_residency_us(ready_at, presentation_started));
    let scheduler_wait_us = scheduler_lock_wait_us;
    if let Some(generation) = request.generation {
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
            if !queue
                .inner()
                .clone()
                .lock()
                .await
                .is_generation_current(generation)
            {
                record_native_surface_sample(
                    &app,
                    &request,
                    request_started_at,
                    &decode_timings,
                    queue_hit,
                    scheduler_wait_us,
                    Some(lookahead_wait_us),
                    None,
                    queue_residency_us,
                    None,
                    None,
                    None,
                    None,
                    false,
                    true,
                    Some("stale"),
                    None,
                    None,
                    None,
                );
                return Err("Native preview frame request is stale".to_string());
            }
        }
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let lut_cache = app
        .try_state::<Arc<LutCache>>()
        .map(|state| state.inner().clone());

    let session_lock_started = Instant::now();
    let mut session = preview_state.lock().await;
    let session_lock_wait_us = session_lock_started
        .elapsed()
        .as_micros()
        .min(u64::MAX as u128) as u64;
    // Carry the session decision on each sampled frame. The frontend samples
    // nominal frames adaptively, so a one-shot field can otherwise disappear.
    let (capability_policy_value, capability_probe_us_value) = session.capability_probe();
    let capability_policy_str = capability_policy_value.map(|p| p.as_str().to_string());
    let gpu = Arc::clone(&session.gpu);
    let mut surface = surface_state.lock().unwrap_or_else(|poisoned| {
        let mut state = poisoned.into_inner();
        state.handle_poison_recovery("present_native_frame_internal:present");
        state
    });
    if surface.runtime_epoch() != presentation_epoch {
        return Err("Native preview frame request is stale".to_string());
    }
    let target_format = surface
        .configured_format()
        .ok_or_else(|| "Native surface has not been configured".to_string())?;
    let probe = surface
        .probe()
        .ok_or_else(|| "Native surface lost its readiness probe".to_string())?;
    let is_playback = request.mode.as_deref() == Some("playback");
    let (audio_position_ticks, frame_age_ticks, late_for_audio) = native_presentation_timing(
        &app,
        request.frame_time.ticks,
        request.frame_time.timescale,
        is_playback,
    );
    // Non-video frames (still images, text, stickers, canvas backgrounds) have 0
    // video decoder streams and compose on the GPU in ~0.05ms. Dropping them
    // for being "late for audio" causes multi-second freezes of the previous frame.
    // In continuous playback, already-decoded frames must never be thrown away:
    // the heavy CPU decode cost has already been paid and GPU presentation takes <0.5ms.
    // Frame skipping occurs naturally at the scheduler boundary on the next tick.
    let late_for_audio = late_for_audio && !legacy_request.layers.is_empty() && !is_playback;
    if !surface.accept_presentation(presentation_sequence) {
        drop(surface);
        drop(session);
        // A newer request already owns the retained surface. This frame was
        // intentionally superseded, not missed by the user, so keep it out of
        // visual-drop totals while preserving it as a stale diagnostic sample.
        record_native_surface_sample(
            &app,
            &request,
            request_started_at,
            &decode_timings,
            queue_hit,
            scheduler_wait_us,
            Some(lookahead_wait_us),
            None,
            queue_residency_us,
            None,
            None,
            None,
            None,
            false,
            true,
            Some("superseded"),
            capability_policy_str.clone(),
            capability_probe_us_value,
            None,
        );
        return Ok(NativeSurfacePresentation {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request.request_id,
            frame_index: request.frame_time.frame_index,
            presented: false,
            dropped: false,
            audio_position_ticks,
            frame_age_ticks,
            surface: probe,
            generation: request.generation,
            mode: request.mode.clone(),
            stale: true,
            cancelled: false,
            drop_reason: Some("superseded".to_string()),
            timings: None,
        });
    }
    if late_for_audio {
        SYNC_METRICS.record_dropped_frame();
        drop(surface);
        drop(session);
        record_native_surface_sample(
            &app,
            &request,
            request_started_at,
            &decode_timings,
            queue_hit,
            scheduler_wait_us,
            Some(lookahead_wait_us),
            None,
            queue_residency_us,
            None,
            None,
            None,
            None,
            true,
            false,
            Some("late-for-audio"),
            capability_policy_str.clone(),
            capability_probe_us_value,
            None,
        );
        return Ok(NativeSurfacePresentation {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request.request_id,
            frame_index: request.frame_time.frame_index,
            presented: false,
            dropped: true,
            audio_position_ticks,
            frame_age_ticks,
            surface: probe,
            generation: request.generation,
            mode: request.mode.clone(),
            stale: false,
            cancelled: false,
            drop_reason: Some("late-for-audio".to_string()),
            timings: None,
        });
    }
    if !matches!(
        target_format,
        wgpu::TextureFormat::Bgra8UnormSrgb
            | wgpu::TextureFormat::Rgba8UnormSrgb
            | wgpu::TextureFormat::Bgra8Unorm
            | wgpu::TextureFormat::Rgba8Unorm
    ) {
        return Err(format!(
            "Native direct presentation requires an 8-bit RGBA/BGRA surface format, got {target_format:?}"
        ));
    }
    // Warn once if we are presenting to a non-sRGB surface — colours will be
    // slightly different from the sRGB path but the preview will be visible.
    // This commonly occurs on Windows with certain WDDM drivers that do not
    // advertise Bgra8UnormSrgb as a supported swapchain format.
    // On Windows/WebView2, an owned native window can reject its first DXGI
    // back-buffer acquisition while it is hidden. Reveal it before acquiring
    // the swapchain texture so the production first frame follows the same
    // path as subsequent frames.
    surface.show_surface()?;
    let surface_acquire_started = Instant::now();
    let surface_texture = surface.acquire_current_texture(&gpu.device)?;
    let surface_acquire_us = surface_acquire_started.elapsed().as_micros() as u64;
    let target_view = surface_texture
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    let canvas_width = legacy_request.canvas_width as f32;
    let canvas_height = legacy_request.canvas_height as f32;
    let conversion_started = Instant::now();
    let mut textures: Vec<Arc<wgpu::Texture>> =
        Vec::with_capacity(legacy_request.layers.len() + legacy_request.raster_layers.len());
    let mut views: Vec<wgpu::TextureView> =
        Vec::with_capacity(legacy_request.layers.len() + legacy_request.raster_layers.len());
    let mut used_dxgi_zero_copy = false;
    let mut used_cpu_nv12 = false;
    for (layer_idx, (layer, (planes, width, height, color, source_rotation))) in legacy_request
        .layers
        .iter()
        .zip(decoded_frames.iter())
        .enumerate()
    {
        let duplicate_of = legacy_request.layers[..layer_idx]
            .iter()
            .enumerate()
            .position(|(prev_idx, prev)| {
                prev.video_path == layer.video_path
                    && (prev.time_secs - layer.time_secs).abs() < 0.0001
                    && decoded_frames[prev_idx].0.is_same_source(planes)
            });

        if let Some(prev_idx) = duplicate_of {
            views.push(views[prev_idx].clone());
            textures.push(textures[prev_idx].clone());
        } else {
            let params = color_params(color)?;
            let layer_key = if !layer.layer_id.is_empty() {
                &layer.layer_id
            } else {
                &layer.video_path
            };

            #[allow(unused_mut)]
            let mut layer_texture: Option<Arc<wgpu::Texture>> = None;

            #[cfg(target_os = "windows")]
            if let DecodedVideoPlanes::D3d11(ref shared_arc) = planes {
                if session.gpu.capabilities.zero_copy_available()
                    && session.dxgi_state.is_usable()
                    && crate::wgpu_compositor::adapter_selector::is_dxgi_runtime_enabled()
                {
                    if let Some(duped_shared) = shared_arc.duplicate() {
                        match crate::wgpu_compositor::dxgi_import::import_into_wgpu(
                            &session.gpu.device,
                            duped_shared,
                        ) {
                            Ok(imported) => {
                                match session.render_nv12_from_imported_texture(
                                    layer_key, *width, *height, &imported, &params,
                                ) {
                                    Ok(texture) => {
                                        session.mark_dxgi_supported();
                                        layer_texture = Some(texture);
                                    }
                                    Err(render_error) => {
                                        log::warn!(
                                            "[NativePreviewSession] render_nv12_from_imported_texture failed: {render_error:?}"
                                        );
                                        match render_error {
                                            crate::wgpu_compositor::PreviewRenderError::UnsupportedFeature(_) => {
                                                session.mark_dxgi_disabled(crate::wgpu_compositor::DisableReason::UnsupportedFeature);
                                            }
                                            crate::wgpu_compositor::PreviewRenderError::DimensionMismatch { .. } => {
                                                session.mark_dxgi_failed(crate::wgpu_compositor::DxgiFailureReason::DimensionMismatch);
                                            }
                                            _ => {
                                                session.mark_dxgi_failed(crate::wgpu_compositor::DxgiFailureReason::ImportFailed);
                                            }
                                        }
                                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
                                    }
                                }
                            }
                            Err(reason) => {
                                log::warn!(
                                    "[NativePreviewSession] import_into_wgpu failed: {reason:?}"
                                );
                                session.mark_dxgi_failed(reason);
                                crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
                            }
                        }
                    }
                }
            }

            let texture = match layer_texture {
                Some(t) => {
                    used_dxgi_zero_copy = true;
                    t
                }
                None => match planes.cpu_planes() {
                    Some((y_plane, uv_plane)) => {
                        used_cpu_nv12 = true;
                        let (tex_w, tex_h);
                        if *source_rotation != 0 {
                            let (ry, ruv, rw, rh) = crate::thumbnail_engine::decoder::rotate_nv12(
                                y_plane,
                                uv_plane,
                                *width,
                                *height,
                                *source_rotation,
                            );
                            tex_w = rw;
                            tex_h = rh;
                            session.render_nv12_frame_to_texture(
                                layer_key, tex_w, tex_h, tex_w, tex_h, &ry, &ruv, &params,
                            )?
                        } else {
                            tex_w = *width;
                            tex_h = *height;
                            session.render_nv12_frame_to_texture(
                                layer_key, tex_w, tex_h, tex_w, tex_h, y_plane, uv_plane, &params,
                            )?
                        }
                    }
                    None => {
                        crate::wgpu_compositor::adapter_selector::mark_dxgi_runtime_disabled();
                        return Err(
                            "DXGI zero-copy texture import failed and no CPU planes cached"
                                .to_string(),
                        );
                    }
                },
            };
            views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
            textures.push(texture);
        }
    }
    let mut evicted_mask_ids: Vec<String> = Vec::new();
    let mut evicted_raster_ids: Vec<String> = Vec::new();
    for layer in &legacy_request.raster_layers {
        let texture = if layer.rgba.is_none() && !session.is_rgba_layer_resident(&layer.asset_id) {
            if layer.is_mask {
                // Mask is missing from GPU LRU. Only treat as an eviction if it was
                // ever registered previously. Otherwise, it is a cold start or an in-flight
                // segmentation mask that hasn't completed registration yet.
                if session.was_mask_ever_registered(&layer.asset_id) {
                    evicted_mask_ids.push(layer.asset_id.clone());
                    session.forget_mask_registration(&layer.asset_id);
                }
            } else {
                evicted_raster_ids.push(layer.asset_id.clone());
            }
            // Substitute a transparent placeholder so the frame still renders without crashing —
            // the missing layer will be restored upon re-registration.
            session.transparent_mask_placeholder()
        } else {
            session
                .get_or_upload_rgba_layer_to_texture(
                    &layer.asset_id,
                    layer.width,
                    layer.height,
                    layer.rgba.as_deref(),
                )
                .map_err(|e| e.to_string())?
        };
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }
    if !evicted_mask_ids.is_empty() {
        let _ = app.emit("native-mask-evicted", &evicted_mask_ids);
    }
    if !evicted_raster_ids.is_empty() {
        let _ = app.emit("native-raster-evicted", &evicted_raster_ids);
    }
    let mut text_views = Vec::with_capacity(legacy_request.text_layers.len());
    let mut text_dims = Vec::with_capacity(legacy_request.text_layers.len());
    for text_layer in &legacy_request.text_layers {
        let (texture, view, width, height) = session.get_or_render_text_layer(text_layer)?;
        text_views.push(view);
        text_dims.push((width as f32, height as f32));
        textures.push(texture);
    }

    let conversion_upload_us = conversion_started.elapsed().as_micros() as u64;
    let transfer_path = classify_surface_transfer_path(
        legacy_request.layers.len(),
        used_dxgi_zero_copy,
        used_cpu_nv12,
    );
    let compose_started = Instant::now();
    let compositor_was_warm = session.has_compositor(
        legacy_request.canvas_width,
        legacy_request.canvas_height,
        target_format,
    );
    let compositor_init_started = Instant::now();
    let compositor = session.get_or_create_compositor(
        legacy_request.canvas_width,
        legacy_request.canvas_height,
        target_format,
    );
    let compositor_init_us = compositor_init_started
        .elapsed()
        .as_micros()
        .min(u64::MAX as u128) as u64;
    // This is intentionally reported only when a visible frame paid a
    // first-use cost. Normal session mutex contention belongs elsewhere and
    // should not pollute cold-start diagnostics.
    let cold_start_init_us = (!compositor_was_warm || session_lock_wait_us >= 1_000)
        .then_some(session_lock_wait_us.saturating_add(compositor_init_us));
    let mut specs = Vec::with_capacity(
        legacy_request.layers.len()
            + legacy_request.raster_layers.len()
            + legacy_request.text_layers.len(),
    );
    let mask_views: HashMap<&str, &wgpu::TextureView> = legacy_request
        .raster_layers
        .iter()
        .zip(views.iter().skip(legacy_request.layers.len()))
        .filter(|(layer, _)| {
            layer.is_mask && !evicted_mask_ids.iter().any(|id| id == &layer.asset_id)
        })
        .map(|(layer, view)| (layer.asset_id.as_str(), view))
        .collect();
    for (layer, view) in legacy_request.layers.iter().zip(views.iter()) {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: color_grade_from_snapshot(layer.color_grade.as_ref()),
            mask_view: layer
                .body_effect
                .as_ref()
                .and_then(|effect| resolve_mask_view(effect, &mask_views, true)),
            body_effect: body_effect_from_snapshot(layer.body_effect.as_ref()),
            lut: resolve_native_lut(layer.color_grade.as_ref(), lut_cache.as_ref())?,
            grain_seed: ((layer.time_secs.max(0.0) * 60.0).floor() * 0.37) as f32,
        });
    }
    let raster_views = views.iter().skip(legacy_request.layers.len());
    for (layer, view) in legacy_request
        .raster_layers
        .iter()
        .zip(raster_views)
        .filter(|(layer, _)| !layer.is_mask)
    {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.display_width(),
            height: layer.display_height(),
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    for (text_layer, (view, (width, height))) in legacy_request
        .text_layers
        .iter()
        .zip(text_views.iter().zip(text_dims.iter()))
    {
        let scale = compute_text_layer_scale(text_layer, *width, *height);
        let display_width = *width * scale;
        let display_height = *height * scale;
        let (layer_x, layer_y) =
            compute_text_layer_placement(text_layer, display_width, display_height);
        specs.push(NativeLayerSpec {
            view: view.as_ref(),
            x: layer_x,
            y: layer_y,
            width: display_width,
            height: display_height,
            rotation: text_layer.rotation,
            opacity: text_layer.opacity,
            z_index: text_layer.z_index,
            blend_mode: &text_layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    let layers = build_native_composite_layers(&specs, canvas_width, canvas_height)?;
    let clear_color = wgpu::Color {
        r: legacy_request.clear_color[0].clamp(0.0, 1.0) as f64,
        g: legacy_request.clear_color[1].clamp(0.0, 1.0) as f64,
        b: legacy_request.clear_color[2].clamp(0.0, 1.0) as f64,
        a: legacy_request.clear_color[3].clamp(0.0, 1.0) as f64,
    };
    if let Some(transition) = legacy_request.transition.as_ref() {
        let (from_layer, to_layer) = build_transition_sources(&legacy_request, &layers)?;
        let from_texture = create_transition_source_texture(
            &gpu.device,
            legacy_request.canvas_width,
            legacy_request.canvas_height,
            target_format,
            "Native Surface Transition From Texture",
        );
        let to_texture = create_transition_source_texture(
            &gpu.device,
            legacy_request.canvas_width,
            legacy_request.canvas_height,
            target_format,
            "Native Surface Transition To Texture",
        );
        let from_view = from_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let to_view = to_texture.create_view(&wgpu::TextureViewDescriptor::default());
        compositor.composite_layers(
            &gpu.device,
            &gpu.queue,
            &from_view,
            std::slice::from_ref(&from_layer),
            Some(clear_color),
        )?;
        compositor.composite_layers(
            &gpu.device,
            &gpu.queue,
            &to_view,
            std::slice::from_ref(&to_layer),
            Some(clear_color),
        )?;
        compositor.composite_transition(
            &gpu.device,
            &gpu.queue,
            &target_view,
            &from_view,
            &to_view,
            &transition_uniforms(transition),
            Some(clear_color),
        )?;
    } else {
        compositor.composite_layers(
            &gpu.device,
            &gpu.queue,
            &target_view,
            &layers,
            Some(clear_color),
        )?;
    }
    let compose_us = compose_started.elapsed().as_micros() as u64;
    // Keep decoded textures and views alive until after queue submission.
    let _textures = textures;
    let submit_present_started = Instant::now();
    surface_texture.present();
    let submit_present_us = submit_present_started.elapsed().as_micros() as u64;
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
    drop(surface);
    drop(session);
    record_native_surface_sample(
        &app,
        &request,
        request_started_at,
        &decode_timings,
        queue_hit,
        scheduler_wait_us,
        Some(lookahead_wait_us),
        cold_start_init_us,
        queue_residency_us,
        Some(conversion_upload_us),
        Some(compose_us),
        Some(surface_acquire_us),
        Some(submit_present_us),
        false,
        false,
        None,
        capability_policy_str,
        capability_probe_us_value,
        Some(transfer_path),
    );

    if request.mode.as_deref() != Some("prefetch") && request.mode.as_deref() != Some("scrub") {
        schedule_lookahead_predecode(app.clone(), request.clone(), 16, current_lookahead_quality(&app));
    }

    Ok(NativeSurfacePresentation {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: request.request_id,
        frame_index: request.frame_time.frame_index,
        presented: true,
        dropped: false,
        audio_position_ticks,
        frame_age_ticks,
        surface: probe,
        generation: request.generation,
        mode: request.mode,
        stale: false,
        cancelled: false,
        drop_reason: None,
        timings: Some(NativeSurfacePresentationTimings {
            total_us: request_started_at.elapsed().as_micros() as u64,
            decode_us: decode_timings.decode_time_us,
            decoder_mutex_wait_us: decode_timings.decoder_mutex_wait_us,
            actor_wait_us: decode_timings.actor_wait_us.unwrap_or(0),
            demux_wait_us: decode_timings.demux_wait_us.unwrap_or(0),
            conversion_upload_us,
            compose_us,
            surface_acquire_us,
            submit_present_us,
            lookahead_wait_us,
            cold_start_init_us: cold_start_init_us.unwrap_or(0),
            queue_residency_us: queue_residency_us.unwrap_or(0),
            queue_hit,
        }),
    })
}

/// Compatibility command for paused/readback recovery and older callers.
/// Continuous Native playback uses the persistent Rust render session above
/// and never invokes this command once per frame.
#[tauri::command]
pub async fn present_native_frame(
    app: tauri::AppHandle,
    request: FrameRequest,
) -> Result<NativeSurfacePresentation, String> {
    present_native_frame_internal(app, request).await
}

/// Legacy-shaped command retained as a compatibility boundary while callers
/// migrate to `render_native_frame` and the versioned native-core contract.
#[tauri::command]
pub async fn render_native_video_project_frame(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(
        render_native_video_project_frame_bytes(app, request).await?,
    ))
}

/// Versioned native frame-service boundary.
///
/// The renderer below is shared with the compatibility command, but all new
/// callers use this contract so cache identity, frame addressing, and policy
/// versions cannot drift between preview, thumbnails, and export.
#[tauri::command]
pub async fn render_native_frame(
    app: tauri::AppHandle,
    request: FrameRequest,
) -> Result<tauri::ipc::Response, String> {
    let started = Instant::now();
    eprintln!(
        "[preview-diag][rust] render_native_frame called: frame={} mode={:?} quality={:?}",
        request.frame_time.frame_index, request.mode, request.quality,
    );
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        let err = format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        );
        eprintln!(
            "[preview-diag][rust] render_native_frame contract version mismatch: {}",
            err
        );
        return Err(err);
    }
    if request.mode.as_deref() != Some("frameStep") {
        if let Some(generation) = request.generation {
            if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
            {
                if !queue
                    .inner()
                    .clone()
                    .lock()
                    .await
                    .is_generation_current(generation)
                {
                    return Err("Native preview frame request is stale".to_string());
                }
            }
        }
    }
    if let Some(cache) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        let mut cache = cache.lock().await;
        if let Some(packet) = cache
            .get_cached(&request)
            .map_err(|error| error.to_string())?
        {
            cache.record_sample(PerformanceSample {
                request_id: request.request_id.clone(),
                frame_index: request.frame_time.frame_index,
                decode_time_us: 0,
                compose_time_us: 0,
                readback_time_us: started.elapsed().as_micros().min(u32::MAX as u128) as u32,
                total_time_us: started.elapsed().as_micros().min(u32::MAX as u128) as u32,
                bytes_transferred: packet.data.len() as u64,
                cache_hit: true,
                generation: request.generation,
                mode: PreviewMode::from_request_mode(request.mode.as_deref()),
                quality: Some(format!("{:?}", request.quality)),
                strategy: Some("HOT".to_string()),
                transfer_path: Some("cpu-rgba".to_string()),
                cancelled: false,
                stale: false,
                dropped: false,
                drop_reason: None,
                seek_time_us: 0,
                conversion_time_us: 0,
                upload_time_us: 0,
                present_time_us: 0,
                decode_us: None,
                conversion_upload_us: None,
                compose_us: None,
                readback_us: None,
                present_us: None,
                scheduler_wait_us: None,
                lookahead_wait_us: None,
                cold_start_init_us: None,
                queue_residency_us: None,
                ipc_wait_us: None,
                decoder_mutex_wait_us: None,
                actor_wait_us: None,
                gpu_queue_wait_us: None,
                surface_acquire_us: None,
                submit_present_us: None,
                capability_policy: None,
                capability_probe_us: None,
                demux_wait_us: None,
                container_format: None,
                is_hardware_accelerated: None,
            });
            record_successful_readback_metrics(&app, &request);
            return Ok(tauri::ipc::Response::new(packet.data));
        }
    }

    let legacy_request = match to_video_project_request(&request) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[preview-diag][rust] to_video_project_request FAILED: {}",
                e
            );
            return Err(e);
        }
    };
    eprintln!(
        "[preview-diag][rust] rendering legacy video request: layers={}, rasters={}, texts={}, clear_color={:?}",
        legacy_request.layers.len(),
        legacy_request.raster_layers.len(),
        legacy_request.text_layers.len(),
        legacy_request.clear_color,
    );
    let (rgba, stage_timings) =
        match render_native_video_project_frame_bytes_timed(app.clone(), legacy_request).await {
            Ok(res) => {
                eprintln!(
                "[preview-diag][rust] render_native_video_project_frame_bytes_timed OK: bytes={}",
                res.0.len()
            );
                res
            }
            Err(e) => {
                eprintln!(
                    "[preview-diag][rust] render_native_video_project_frame_bytes_timed FAILED: {}",
                    e
                );
                return Err(e);
            }
        };
    if request.mode.as_deref() != Some("frameStep") {
        if let Some(generation) = request.generation {
            if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
            {
                if !queue
                    .inner()
                    .clone()
                    .lock()
                    .await
                    .is_generation_current(generation)
                {
                    return Err("Native preview frame request is stale".to_string());
                }
            }
        }
    }
    let packet = FramePacket {
        contract_version: request.contract_version,
        request_id: request.request_id.clone(),
        frame_time: request.frame_time,
        width: request.output_width,
        height: request.output_height,
        stride: request.output_width.saturating_mul(4),
        format: PixelFormat::Rgba8Srgb,
        data: rgba.clone(),
    };

    if let Some(cache) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        let mut cache = cache.lock().await;
        let _ = cache.insert(&request, packet);
        let total_time_us = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
        cache.record_sample(PerformanceSample {
            request_id: request.request_id.clone(),
            frame_index: request.frame_time.frame_index,
            decode_time_us: stage_timings.decode_time_us,
            compose_time_us: stage_timings.compose_time_us,
            readback_time_us: 0,
            total_time_us,
            bytes_transferred: rgba.len() as u64,
            cache_hit: false,
            generation: request.generation,
            mode: PreviewMode::from_request_mode(request.mode.as_deref()),
            quality: Some(format!("{:?}", request.quality)),
            strategy: Some("COLD".to_string()),
            transfer_path: Some("cpu-rgba".to_string()),
            cancelled: false,
            stale: false,
            dropped: false,
            drop_reason: None,
            seek_time_us: stage_timings.decode_time_us,
            conversion_time_us: stage_timings.conversion_time_us,
            upload_time_us: 0,
            present_time_us: 0,
            decode_us: Some(u64::from(stage_timings.decode_time_us)),
            conversion_upload_us: Some(u64::from(stage_timings.conversion_time_us)),
            compose_us: Some(u64::from(stage_timings.compose_time_us)),
            readback_us: Some(u64::from(stage_timings.readback_time_us)),
            present_us: None,
            scheduler_wait_us: None,
            lookahead_wait_us: None,
            cold_start_init_us: None,
            queue_residency_us: None,
            ipc_wait_us: None,
            decoder_mutex_wait_us: Some(stage_timings.decoder_mutex_wait_us),
            actor_wait_us: None,
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: None,
            capability_policy: None,
            capability_probe_us: None,
            demux_wait_us: None,
            container_format: None,
            is_hardware_accelerated: None,
        });
    }

    record_successful_readback_metrics(&app, &request);
    Ok(tauri::ipc::Response::new(rgba))
}

/// Read-only diagnostics for the native frame service. This is intentionally
/// separate from rendering so production callers do not need to inspect cache
/// internals or enable verbose logging.
#[tauri::command]
pub async fn get_native_frame_service_stats(
    app: tauri::AppHandle,
) -> Result<NativeFrameServiceStats, String> {
    let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() else {
        return Err("Native frame service is not initialized".to_string());
    };
    let stats = service.lock().await.stats();
    Ok(stats)
}

/// Read native samples after a caller-owned cursor. This is a read-only
/// diagnostics operation; it does not create or mutate telemetry samples.
#[tauri::command]
pub async fn get_native_frame_service_samples(
    app: tauri::AppHandle,
    after_sequence: u64,
    limit: Option<usize>,
) -> Result<NativePerformanceSampleBatch, String> {
    let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() else {
        return Err("Native frame service is not initialized".to_string());
    };
    let batch = service
        .lock()
        .await
        .samples_since(after_sequence, limit.unwrap_or(256));
    Ok(batch)
}

/// Reset all per-project native preview state on project close.
///
/// This atomically:
/// 1. Resets the frame queue generation counter to 0 so the next project's
///    seek controller (which starts at generation 0) is never stale-rejected.
/// 2. Drains all queued and pending decode frames from the previous project.
/// 3. Clears the readback frame cache and performance window samples.
/// 4. Clears the presentation sequence on the native surface so out-of-order
///    frame rejection does not carry over to the next project.
/// 5. Stops and resets the native audio clock clip state.
/// 6. Stops and resets the native playback session.
/// 7. Resets the DXGI import state so a fresh project does not inherit a
///    sticky `DxgiImportState::Failed` from the previous session.
#[tauri::command]
pub async fn reset_native_preview_runtime(app: tauri::AppHandle) -> Result<(), String> {
    if let Ok(mut worker) = LOOKAHEAD_WORKER.lock() {
        if let Some(prev) = worker.take() {
            prev.handle.abort();
        }
    }

    // 1+2. Reset the frame queue generation and drain pending/queued frames.
    if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
        queue.inner().clone().lock().await.reset();
    }

    // 3. Clear the readback frame cache.
    if let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        service.lock().await.reset();
    }

    // 4. Reset the surface presentation sequence.
    if let Some(surface) = app
        .try_state::<Arc<std::sync::Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()
    {
        if let Ok(mut s) = surface.inner().clone().lock() {
            s.reset();
        }
    }

    // 5. Stop native audio and clear clip state.
    if let Some(clock) =
        app.try_state::<Arc<std::sync::Mutex<crate::native_audio::NativeAudioClock>>>()
    {
        if let Ok(mut c) = clock.inner().clone().lock() {
            c.stop();
        }
    }

    // 6. Reset the native playback session.
    if let Some(playback) = app.try_state::<Arc<std::sync::Mutex<crate::commands::native_playback::NativePlaybackRuntime>>>() {
        if let Ok(mut p) = playback.inner().clone().lock() {
            p.reset();
        }
    }

    // 7. Reset the DXGI import state so the next project does not inherit a
    //    sticky DxgiImportState::Failed from this session.
    if let Some(preview_session) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
    {
        preview_session
            .inner()
            .clone()
            .lock()
            .await
            .reset_dxgi_state();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        classify_surface_transfer_path, color_params, compute_text_layer_scale,
        deadline_aware_lookahead_count, merge_color_metadata, parse_blend_mode,
        project_layer_transform, queue_residency_us, validate_project_request,
        validate_video_project_request, NativeDecodeTimings, NativePreviewFrameQueue,
        NativeProjectFrameRequest, NativeVideoProjectFrameRequest, QueuedNativeFrame,
        MAX_LOOKAHEAD_EXPIRATION_US,
    };
    use crate::native_core::TextLayerSnapshot;
    use crate::thumbnail_engine::decoder::VideoColorMetadata;
    use std::time::Instant;

    #[test]
    fn unspecified_sdr_metadata_uses_limited_rec709_defaults() {
        let params =
            color_params(&VideoColorMetadata::default()).expect("default should be supported");
        assert_eq!(params.color_space, 0);
        assert_eq!(params.range, 0);
        assert_eq!(params.tonemap_operator, 0);
    }

    #[test]
    fn lookahead_is_bounded_by_the_presentation_latency_budget() {
        // decode_coverage is now a FLOOR (minimum frames to keep the pipeline
        // ahead of the audio clock), not a ceiling. The actual count is capped
        // by the presentation-latency budget (MAX_LOOKAHEAD_RESIDENCY_US).
        //
        // At 30 fps: frame_budget_us = 33_333, latency_cap = 300_000/33_333 = 9.
        // decode_us=40_000 → decode_floor = ceil(40_000/33_333) = 2
        //   configured(16).min(9).max(2) = 9
        assert_eq!(deadline_aware_lookahead_count(30, 16, Some(40_000)), 9);
        // decode_us=500_000 → decode_floor = ceil(500_000/33_333) = 16
        //   configured(16).min(9)=9, 9.max(16)=16; decode_floor wins because
        //   the decoder is so slow it needs 16 frames of headroom to keep up.
        assert_eq!(deadline_aware_lookahead_count(30, 16, Some(500_000)), 16);
    }

    #[test]
    fn classifies_surface_transfer_paths_without_guessing() {
        assert_eq!(
            classify_surface_transfer_path(0, false, false),
            "gpu-raster"
        );
        assert_eq!(
            classify_surface_transfer_path(1, true, false),
            "dxgi-zero-copy"
        );
        assert_eq!(classify_surface_transfer_path(1, false, true), "cpu-nv12");
        assert_eq!(classify_surface_transfer_path(2, true, true), "mixed");
    }

    #[test]
    fn full_range_rec601_selects_the_explicit_matrix() {
        let color = VideoColorMetadata {
            range: "full".to_string(),
            matrix: "bt601_625".to_string(),
            transfer: "bt709".to_string(),
            ..Default::default()
        };

        let params = color_params(&color).expect("Rec.601 SDR should be supported");
        assert_eq!(params.color_space, 3);
        assert_eq!(params.range, 1);
    }

    #[test]
    fn unsupported_partial_metadata_is_rejected() {
        let color = VideoColorMetadata {
            matrix: "bt2020_ncl".to_string(),
            transfer: "unspecified".to_string(),
            ..Default::default()
        };

        assert!(color_params(&color).is_err());
    }

    #[test]
    fn frame_color_metadata_wins_with_stream_fallbacks() {
        let stream = VideoColorMetadata {
            range: "full".to_string(),
            matrix: "bt601_625".to_string(),
            transfer: "bt709".to_string(),
            ..Default::default()
        };

        let frame = VideoColorMetadata {
            matrix: "bt709".to_string(),
            ..Default::default()
        };

        let merged = merge_color_metadata(frame, &stream);
        assert_eq!(merged.range, "full");
        assert_eq!(merged.matrix, "bt709");
        assert_eq!(merged.transfer, "bt709");
    }

    #[test]
    fn project_request_defaults_are_stable() {
        let request: NativeProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"color":[1,0,0,1],"x":0,"y":0,"width":100,"height":50}]}"#,
        )
        .expect("project request should deserialize");

        assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(request.layers[0].opacity, 1.0);
        assert_eq!(request.layers[0].blend_mode, "normal");
        validate_project_request(&request).expect("default request should validate");
    }

    #[test]
    fn project_request_rejects_invalid_geometry_and_blend_modes() {
        let mut request = NativeProjectFrameRequest {
            canvas_width: 320,
            canvas_height: 180,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            layers: Vec::new(),
        };
        request.layers.push(super::NativeProjectSolidLayer {
            color: [1.0, 0.0, 0.0, 1.0],
            x: 0.0,
            y: 0.0,
            width: -1.0,
            height: 10.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
        });

        assert!(validate_project_request(&request).is_err());
        assert!(parse_blend_mode("unsupported").is_err());
    }

    #[test]
    fn project_pixels_map_to_top_left_ndc() {
        let layer = super::NativeProjectSolidLayer {
            color: [1.0, 0.0, 0.0, 1.0],
            x: 0.0,
            y: 0.0,
            width: 160.0,
            height: 90.0,
            rotation: 90.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
        };

        let transform = project_layer_transform(&layer, 320.0, 180.0);

        assert!((transform.translate_x + 0.5).abs() < f32::EPSILON);
        assert!((transform.translate_y - 0.5).abs() < f32::EPSILON);
        assert!((transform.scale_x - 0.5).abs() < f32::EPSILON);
        assert!((transform.scale_y - 0.5).abs() < f32::EPSILON);
        assert!((transform.rotation_rad + std::f32::consts::FRAC_PI_2).abs() < 1e-6);
    }

    fn text_layer_with_box(box_width: Option<f32>, box_height: Option<f32>) -> TextLayerSnapshot {
        TextLayerSnapshot {
            layer_id: None,
            text: "Hello".to_string(),
            font_id: "inter".to_string(),
            font_size: 48.0,
            font_weight: "normal".to_string(),
            font_style: "normal".to_string(),
            letter_spacing: 0.0,
            line_height: 1.2,
            color: [1.0, 1.0, 1.0, 1.0],
            text_align: "left".to_string(),
            vertical_align: "top".to_string(),
            x: 10.0,
            y: 20.0,
            box_width,
            box_height,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
            stroke_color: None,
            stroke_width: None,
            shadow_color: None,
            shadow_offset: None,
            shadow_blur: None,
            background: None,
            runs: Vec::new(),
            template_id: None,
            template_data: None,
            effect: None,
        }
    }

    #[test]
    fn native_text_scale_fits_rasterized_bounds_inside_text_box() {
        let layer = text_layer_with_box(Some(100.0), Some(40.0));

        assert_eq!(compute_text_layer_scale(&layer, 200.0, 80.0), 0.5);
        assert_eq!(compute_text_layer_scale(&layer, 80.0, 30.0), 1.0);
    }

    #[test]
    fn native_text_scale_does_not_scale_without_a_valid_text_box() {
        let layer = text_layer_with_box(None, None);
        assert_eq!(compute_text_layer_scale(&layer, 200.0, 80.0), 1.0);
        assert_eq!(compute_text_layer_scale(&layer, f32::NAN, 80.0), 1.0);
    }

    #[test]
    fn video_project_request_defaults_are_stable() {
        let request: NativeVideoProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[{"videoPath":"/tmp/clip.mp4","timeSecs":1.0,"x":0,"y":0,"width":320,"height":180}]}"#,
        )
        .expect("video project request should deserialize");

        assert_eq!(request.clear_color, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(request.layers[0].opacity, 1.0);
        assert_eq!(request.layers[0].blend_mode, "normal");
        validate_video_project_request(&request).expect("default request should validate");
    }

    #[test]
    fn video_project_rejects_invalid_raster_payloads() {
        let mut request: NativeVideoProjectFrameRequest = serde_json::from_str(
            r#"{"canvasWidth":320,"canvasHeight":180,"layers":[],"rasterLayers":[{"rgba":[255,255,255,255],"width":2,"height":2,"x":0,"y":0}]}"#,
        )
        .expect("video project request should deserialize");

        assert!(validate_video_project_request(&request).is_err());
        request.raster_layers[0].rgba = Some(vec![255; 16]);
        validate_video_project_request(&request).expect("valid raster payload should validate");
    }

    #[test]
    fn native_preview_queue_is_bounded_and_consumable() {
        let mut queue = NativePreviewFrameQueue::new(2);
        let queued_frame = || QueuedNativeFrame {
            frame_index: 0,
            decoded_frames: Vec::new(),
            decode_timings: NativeDecodeTimings::default(),
            queued_at: Instant::now(),
            ready_at: Instant::now(),
            scheduler_wait_us: 0,
        };
        assert!(queue.begin("frame-1", None));
        assert!(!queue.begin("frame-1", None));
        queue.complete(
            "frame-1".to_string(),
            queued_frame(),
            queue.lifecycle_epoch(),
        );
        assert!(queue.contains("frame-1"));
        assert!(queue.take("frame-1").is_some());
        assert!(!queue.contains("frame-1"));

        assert!(queue.begin("frame-2", None));
        queue.complete(
            "frame-2".to_string(),
            queued_frame(),
            queue.lifecycle_epoch(),
        );
        assert!(queue.begin("frame-3", None));
        queue.complete(
            "frame-3".to_string(),
            queued_frame(),
            queue.lifecycle_epoch(),
        );
        assert!(queue.begin("frame-4", None));
        queue.complete(
            "frame-4".to_string(),
            queued_frame(),
            queue.lifecycle_epoch(),
        );
        assert!(!queue.contains("frame-2"));
        assert!(queue.contains("frame-3"));
        assert!(queue.contains("frame-4"));
    }

    #[test]
    fn queue_residency_measures_only_ready_frame_wait() {
        let ready_at = Instant::now();
        let presentation_started = ready_at + std::time::Duration::from_micros(400_000);

        assert_eq!(queue_residency_us(ready_at, presentation_started), 400_000);
    }

    #[test]
    fn queue_residency_is_zero_when_a_ready_frame_is_immediately_presented() {
        let now = Instant::now();
        assert_eq!(queue_residency_us(now, now), 0);
    }

    #[test]
    fn queue_rejects_entries_from_an_earlier_playback_lifetime() {
        let mut queue = NativePreviewFrameQueue::new(2);
        let stale_epoch = queue.lifecycle_epoch();
        queue.reset();

        assert!(!queue.complete(
            "old-frame".to_string(),
            QueuedNativeFrame {
                frame_index: 1,
                decoded_frames: Vec::new(),
                decode_timings: NativeDecodeTimings::default(),
                queued_at: Instant::now(),
                ready_at: Instant::now(),
                scheduler_wait_us: 0,
            },
            stale_epoch,
        ));
        assert!(queue.is_empty());
    }

    #[test]
    fn queue_discards_ready_frames_that_missed_the_latency_deadline() {
        let mut queue = NativePreviewFrameQueue::new(2);
        let epoch = queue.lifecycle_epoch();
        let now = Instant::now();
        assert!(queue.complete(
            "expired-frame".to_string(),
            QueuedNativeFrame {
                frame_index: 1,
                decoded_frames: Vec::new(),
                decode_timings: NativeDecodeTimings::default(),
                queued_at: now,
                ready_at: now,
                scheduler_wait_us: 0,
            },
            epoch,
        ));

        queue.discard_expired(
            now + std::time::Duration::from_micros(MAX_LOOKAHEAD_EXPIRATION_US + 1),
        );
        assert!(queue.is_empty());
    }

    #[test]
    fn to_video_project_request_scales_raster_layers_proportionally_to_output_resolution() {
        use crate::native_core::contracts::{
            ColorPolicy, FrameRequest, FrameTime, ProjectSnapshot, QualityTier,
            RasterLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
        };

        let request = FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "test-raster-scale".to_string(),
            frame_time: FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap(),
            project: ProjectSnapshot {
                schema_version: 1,
                project_revision: "rev-1".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: vec![],
                raster_layers: vec![RasterLayerSnapshot {
                    layer_id: None,
                    asset_id: "text-1".to_string(),
                    rgba: None,
                    width: 480,
                    height: 120,
                    display_width: None,
                    display_height: None,
                    x: 720.0,
                    y: 480.0,
                    rotation: 0.0,
                    opacity: 1.0,
                    z_index: 0,
                    blend_mode: "normal".to_string(),
                    color_grade: None,
                    is_mask: false,
                    is_text: true,
                }],
                text_layers: vec![],
                transition: None,
            },
            output_width: 320,
            output_height: 180,
            quality: QualityTier::Half,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
        };

        let legacy = super::to_video_project_request(&request).expect("request should convert");
        assert_eq!(legacy.canvas_width, 320);
        assert_eq!(legacy.canvas_height, 180);
        assert_eq!(legacy.raster_layers.len(), 1);

        let raster = &legacy.raster_layers[0];
        // Raw texture pixel dimensions are preserved for GPU upload
        assert_eq!(raster.width, 480);
        assert_eq!(raster.height, 120);
        // Position and display dimensions are scaled to the output surface coordinate system
        assert_eq!(raster.x, 120.0);
        assert_eq!(raster.y, 80.0);
        assert_eq!(raster.display_width(), 80.0);
        assert_eq!(raster.display_height(), 20.0);
    }
}

// ── Phase 5: Session performance telemetry ───────────────────────────────────

/// Return a snapshot of the session-level rendering performance statistics.
///
/// This aggregates every frame that passed through [`PerformanceManager::record`]
/// since the session started (or the last `reset_session` call). Unlike the
/// rolling [`FrameTelemetryRing`] (which holds ~300 samples), the session
/// snapshot accumulates lifetime totals: frames produced, dropped, deadline
/// misses, peak latencies, source-path breakdown, and policy events.
///
/// All latency values are in **microseconds**.
///
/// # Frontend usage
/// ```ts
/// const stats = await invoke<SessionSnapshot>('get_session_telemetry');
/// console.log(`${stats.frames_produced} frames, miss rate ${stats.miss_rate_pct?.toFixed(2)}%`);
/// ```
#[tauri::command]
pub async fn get_session_telemetry(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use crate::wgpu_compositor::SessionTelemetryCollector;

    // The SessionTelemetryCollector is managed Tauri state registered at startup.
    // If not yet registered (headless test environments), return an empty snapshot.
    let snapshot = if let Some(state) = app.try_state::<std::sync::Arc<SessionTelemetryCollector>>()
    {
        state.snapshot()
    } else {
        SessionTelemetryCollector::new().snapshot()
    };

    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

/// Reset the session-level telemetry accumulator.
///
/// Clears all lifetime totals and restarts the session clock. Call on project
/// open when you want per-project (rather than per-app-session) statistics.
/// Does NOT affect the rolling [`FrameTelemetryRing`] or [`PolicyState`].
#[tauri::command]
pub async fn reset_session_telemetry(app: tauri::AppHandle) -> Result<(), String> {
    use crate::wgpu_compositor::SessionTelemetryCollector;

    if let Some(state) = app.try_state::<std::sync::Arc<SessionTelemetryCollector>>() {
        state.reset_session();
    }
    Ok(())
}
