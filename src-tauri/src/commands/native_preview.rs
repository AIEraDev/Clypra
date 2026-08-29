use crate::commands::lut::LutCache;
use crate::commands::native_surface::NativeSurfaceRuntime;
use crate::diagnostics;
use crate::native_audio::NativeAudioClock;
use crate::native_core::playback::VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ;
use crate::native_core::{
    BodyEffectSnapshot, ColorGradeSnapshot, FramePacket, FrameRequest, FrameTime,
    NativeFrameService, NativeFrameServiceStats, NativeSurfacePresentation,
    NativeSurfacePresentationTimings, PerformanceSample, PixelFormat, PreviewMode,
    TextLayerSnapshot, TransitionSnapshot, NATIVE_CORE_CONTRACT_VERSION,
};
use crate::sync_metrics::SYNC_METRICS;
use crate::thumbnail_engine::decoder::{get_preview_decoder, VideoColorMetadata};
use crate::wgpu_compositor::multi_track_composer::TransitionUniforms;
use crate::wgpu_compositor::{
    BlendMode, BodyEffectUniforms, ChromaKeyUniforms, ColorGradeUniforms, ColorTransformUniforms,
    CompositeLayer, CropMargins, LayerTransform, NativePreviewSession, NativeWgpuRenderer,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;

type DecodedNativeVideoFrame = (Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata);
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
        diagnostics::error("native-font", "register-failed", format!("{font_id}: {error}"));
    }
    result
}

#[tauri::command]
pub fn list_native_fonts() -> Result<Vec<String>, String> {
    Ok(clypra_native_core::font_registry::global_font_registry().list_fonts())
}

#[derive(Debug, Default, Clone, Copy)]
struct NativeDecodeTimings {
    decode_time_us: u32,
    decoder_mutex_wait_us: u64,
}

struct QueuedNativeFrame {
    decoded_frames: Vec<DecodedNativeVideoFrame>,
    decode_timings: NativeDecodeTimings,
    queued_at: Instant,
    scheduler_wait_us: u64,
}

fn native_presentation_timing(
    app: &tauri::AppHandle,
    frame_ticks: i64,
    frame_timescale: u32,
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
    SYNC_METRICS
        .av_drift
        .record(frame_position_ticks.saturating_sub(status.audio_position_ticks as i64));
    let age = status.audio_position_ticks as i128 - frame_position_ticks as i128;
    let frame_age_ticks = age.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    (
        status.audio_position_ticks,
        frame_age_ticks,
        frame_age_ticks > VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ,
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
    let _ = native_presentation_timing(app, request.frame_time.ticks, request.frame_time.timescale);
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

fn record_native_surface_sample(
    app: &tauri::AppHandle,
    request: &FrameRequest,
    started_at: Instant,
    decode_timings: NativeDecodeTimings,
    queue_hit: bool,
    scheduler_wait_us: u64,
    conversion_upload_us: Option<u64>,
    compose_us: Option<u64>,
    surface_acquire_us: Option<u64>,
    submit_present_us: Option<u64>,
    dropped: bool,
    stale: bool,
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
        cancelled: false,
        stale,
        dropped,
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
        ipc_wait_us: None,
        decoder_mutex_wait_us: Some(decode_timings.decoder_mutex_wait_us),
        gpu_queue_wait_us: None,
        surface_acquire_us,
        submit_present_us,
    });
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
}

impl NativePreviewFrameQueue {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            pending: std::collections::HashSet::new(),
            max_entries: max_entries.max(1),
            latest_generation: Arc::new(AtomicU64::new(0)),
        }
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

    fn begin(&mut self, key: &str) -> bool {
        if self.contains(key) {
            return false;
        }
        self.pending.insert(key.to_string());
        true
    }

    fn complete(&mut self, key: String, frame: QueuedNativeFrame) {
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
    }

    fn fail(&mut self, key: &str) {
        self.pending.remove(key);
    }

    fn take(&mut self, key: &str) -> Option<QueuedNativeFrame> {
        let decoded = self.entries.remove(key)?;
        self.order.retain(|entry| entry != key);
        Some(decoded)
    }

    /// Reset all queued frames and generation counter. Call on project close so
    /// the next project's generation 0 is accepted immediately.
    pub fn reset(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.pending.clear();
        self.latest_generation.store(0, Ordering::Release);
    }
}

fn default_clear_color() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

fn default_opacity() -> f32 {
    1.0
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
    pub rgba: Vec<u8>,
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
                    "body_outline" | "body_glow" | "body_segmentation_glow" | "body_particles"
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
                || !request
                    .raster_layers
                    .iter()
                    .any(|mask| mask.is_mask && mask.asset_id == effect.mask_asset_id)
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
                video_path: layer.video_path.clone(),
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
            display_width: Some(layer.width as f32 * scale_x),
            display_height: Some(layer.height as f32 * scale_y),
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
fn merge_color_metadata(
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

async fn render_native_video_project_frame_bytes(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<Vec<u8>, String> {
    Ok(render_native_video_project_frame_bytes_timed(app, request)
        .await?
        .0)
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

    // Decode before taking the GPU session lock so a slow seek cannot block
    // another already-decoded preview frame from submitting work.
    let (decoded_frames, decode_timings) = decode_native_video_layers(&request, None).await?;
    let decode_time_us = decode_timings.decode_time_us;

    let mut session = state.lock().await;
    let gpu = Arc::clone(&session.gpu);
    let conversion_started = Instant::now();
    let mut textures = Vec::with_capacity(
        request.layers.len() + request.raster_layers.len() + request.text_layers.len(),
    );
    let mut views = Vec::with_capacity(request.layers.len() + request.raster_layers.len());
    for (layer, (y_plane, uv_plane, width, height, color)) in
        request.layers.iter().zip(decoded_frames.iter())
    {
        let params = color_params(color)?;
        let texture = Arc::new(session.render_nv12_frame_to_texture(
            *width,
            *height,
            layer.width.max(1.0).round() as u32,
            layer.height.max(1.0).round() as u32,
            y_plane,
            uv_plane,
            &params,
        )?);
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }
    for layer in &request.raster_layers {
        let texture = session.get_or_upload_rgba_layer_to_texture(
            &layer.asset_id,
            layer.width,
            layer.height,
            layer.rgba.as_deref(),
        )?;
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
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
        .filter(|(layer, _)| layer.is_mask)
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
                .and_then(|effect| mask_views.get(effect.mask_asset_id.as_str()).copied()),
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
            decoder_mutex_wait_us: decode_timings.decoder_mutex_wait_us,
        },
    ))
}

async fn decode_native_video_layers(
    request: &NativeVideoProjectFrameRequest,
    cancellation: Option<(Arc<AtomicU64>, u64)>,
) -> Result<(Vec<DecodedNativeVideoFrame>, NativeDecodeTimings), String> {
    let mut decoded_frames = Vec::with_capacity(request.layers.len());
    let mut timings = NativeDecodeTimings::default();
    for layer in &request.layers {
        let decoder = get_preview_decoder(&layer.video_path).await?;
        let mutex_started = Instant::now();
        let (y_plane, uv_plane, width, height, color) = {
            let mut guard = decoder.lock().await;
            timings.decoder_mutex_wait_us = timings
                .decoder_mutex_wait_us
                .saturating_add(mutex_started.elapsed().as_micros() as u64);
            let decode_started = Instant::now();
            let stream_color = guard.metadata().color;
            let cancel = cancellation.clone();
            let (y_plane, uv_plane, width, height, frame_color) = guard
                .decode_frame_raw_nv12_with_cancel(layer.time_secs, || {
                    cancel
                        .as_ref()
                        .map(|(latest, generation)| latest.load(Ordering::Acquire) > *generation)
                        .unwrap_or(false)
                })?;
            let decoded = (
                y_plane,
                uv_plane,
                width,
                height,
                merge_color_metadata(frame_color, &stream_color),
            );
            timings.decode_time_us = timings
                .decode_time_us
                .saturating_add(decode_started.elapsed().as_micros().min(u32::MAX as u128) as u32);
            decoded
        };
        decoded_frames.push((y_plane, uv_plane, width, height, color));
    }
    Ok((decoded_frames, timings))
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
    let key = request.cache_key().map_err(|error| error.to_string())?;
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
        if !queue_state.begin(&key) {
            return Ok(());
        }
        cancellation_generation = queue_state.latest_generation.clone();
    }

    let cancellation = if is_prefetch {
        None
    } else {
        Some((cancellation_generation, generation))
    };
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
            let mut queue_state = queue.lock().await;
            if is_prefetch || queue_state.is_generation_current(generation) {
                queue_state.complete(
                    key,
                    QueuedNativeFrame {
                        decoded_frames,
                        decode_timings,
                        queued_at: command_started,
                        scheduler_wait_us,
                    },
                );
            } else {
                queue_state.fail(&key);
            }
            Ok(())
        }
        Err(error) => {
            queue.lock().await.fail(&key);
            Err(error)
        }
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
    let queue = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
        .ok_or_else(|| "Native preview frame queue is not initialized".to_string())?
        .inner()
        .clone();
    queue.lock().await.observe_generation(generation);
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
    let expected_bytes = (asset.width as usize)
        .checked_mul(asset.height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Native raster asset dimensions overflow".to_string())?;
    if asset.width == 0
        || asset.height == 0
        || asset.width > 8192
        || asset.height > 8192
        || asset.rgba.len() != expected_bytes
        || asset.rgba.len() > 64 * 1024 * 1024
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
            Some(&asset.rgba),
        )
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
#[tauri::command]
pub async fn present_native_frame(
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
    let generation = request.generation.unwrap_or(0);
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
    let legacy_request = to_video_project_request(&request)?;
    validate_video_project_request(&legacy_request)?;
    let surface_state = app
        .try_state::<Arc<std::sync::Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is unavailable".to_string())?;
    let presentation_epoch = surface_state
        .lock()
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())?
        .runtime_epoch();
    let queued_key = request.cache_key().map_err(|error| error.to_string())?;
    let queued_frame =
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
            queue.inner().clone().lock().await.take(&queued_key)
        } else {
            None
        };
    let (decoded_frames, decode_timings, scheduler_wait_us, request_started_at, queue_hit) =
        match queued_frame {
            Some(frame) => (
                frame.decoded_frames,
                frame.decode_timings,
                frame.scheduler_wait_us,
                frame.queued_at,
                true,
            ),
            None => {
                let (decoded_frames, decode_timings) =
                    decode_native_video_layers(&legacy_request, None).await?;
                (
                    decoded_frames,
                    decode_timings,
                    0,
                    presentation_started,
                    false,
                )
            }
        };
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
                decode_timings,
                queue_hit,
                scheduler_wait_us,
                None,
                None,
                None,
                None,
                false,
                true,
            );
            return Err("Native preview frame request is stale".to_string());
        }
    }

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let lut_cache = app
        .try_state::<Arc<LutCache>>()
        .map(|state| state.inner().clone());

    let mut session = preview_state.lock().await;
    let gpu = Arc::clone(&session.gpu);
    let mut surface = surface_state
        .lock()
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())?;
    if surface.runtime_epoch() != presentation_epoch {
        return Err("Native preview frame request is stale".to_string());
    }
    let target_format = surface
        .configured_format()
        .ok_or_else(|| "Native surface has not been configured".to_string())?;
    let probe = surface
        .probe()
        .ok_or_else(|| "Native surface lost its readiness probe".to_string())?;
    let (audio_position_ticks, frame_age_ticks, late_for_audio) =
        native_presentation_timing(&app, request.frame_time.ticks, request.frame_time.timescale);
    // Non-video frames (still images, text, stickers, canvas backgrounds) have 0
    // video decoder streams and compose on the GPU in ~0.05ms. Dropping them
    // for being "late for audio" causes multi-second freezes of the previous frame.
    // Only frames containing video decoding layers apply late_for_audio drops.
    let late_for_audio = late_for_audio && !legacy_request.layers.is_empty();
    if !surface.accept_presentation(presentation_sequence) {
        SYNC_METRICS.record_dropped_frame();
        drop(surface);
        drop(session);
        record_native_surface_sample(
            &app,
            &request,
            request_started_at,
            decode_timings,
            queue_hit,
            scheduler_wait_us,
            None,
            None,
            None,
            None,
            true,
            false,
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
            decode_timings,
            queue_hit,
            scheduler_wait_us,
            None,
            None,
            None,
            None,
            true,
            false,
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
            timings: None,
        });
    }
    if !matches!(
        target_format,
        wgpu::TextureFormat::Bgra8UnormSrgb | wgpu::TextureFormat::Rgba8UnormSrgb
    ) {
        return Err(format!(
            "Native direct presentation requires an sRGB surface format, got {target_format:?}"
        ));
    }
    let surface_acquire_started = Instant::now();
    let surface_texture = surface.acquire_current_texture(&gpu.device)?;
    let surface_acquire_us = surface_acquire_started.elapsed().as_micros() as u64;
    let target_view = surface_texture
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    let canvas_width = legacy_request.canvas_width as f32;
    let canvas_height = legacy_request.canvas_height as f32;
    let conversion_started = Instant::now();
    let mut textures =
        Vec::with_capacity(legacy_request.layers.len() + legacy_request.raster_layers.len());
    let mut views =
        Vec::with_capacity(legacy_request.layers.len() + legacy_request.raster_layers.len());
    for (layer, (y_plane, uv_plane, width, height, color)) in
        legacy_request.layers.iter().zip(decoded_frames.iter())
    {
        let params = color_params(color)?;
        let texture = Arc::new(session.render_nv12_frame_to_texture(
            *width,
            *height,
            layer.width.max(1.0).round() as u32,
            layer.height.max(1.0).round() as u32,
            y_plane,
            uv_plane,
            &params,
        )?);
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
    }
    for layer in &legacy_request.raster_layers {
        let texture = session.get_or_upload_rgba_layer_to_texture(
            &layer.asset_id,
            layer.width,
            layer.height,
            layer.rgba.as_deref(),
        )?;
        views.push(texture.create_view(&wgpu::TextureViewDescriptor::default()));
        textures.push(texture);
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
    let compose_started = Instant::now();
    let compositor = session.get_or_create_compositor(
        legacy_request.canvas_width,
        legacy_request.canvas_height,
        target_format,
    );
    let mut specs = Vec::with_capacity(
        legacy_request.layers.len()
            + legacy_request.raster_layers.len()
            + legacy_request.text_layers.len(),
    );
    let mask_views: HashMap<&str, &wgpu::TextureView> = legacy_request
        .raster_layers
        .iter()
        .zip(views.iter().skip(legacy_request.layers.len()))
        .filter(|(layer, _)| layer.is_mask)
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
                .and_then(|effect| mask_views.get(effect.mask_asset_id.as_str()).copied()),
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
    surface.show_surface()?;
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
        decode_timings,
        queue_hit,
        scheduler_wait_us,
        Some(conversion_upload_us),
        Some(compose_us),
        Some(surface_acquire_us),
        Some(submit_present_us),
        false,
        false,
    );

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
        timings: Some(NativeSurfacePresentationTimings {
            total_us: request_started_at.elapsed().as_micros() as u64,
            decode_us: decode_timings.decode_time_us,
            decoder_mutex_wait_us: decode_timings.decoder_mutex_wait_us,
            conversion_upload_us,
            compose_us,
            surface_acquire_us,
            submit_present_us,
            queue_hit,
        }),
    })
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
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        return Err(format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        ));
    }
    let generation = request.generation.unwrap_or(0);
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
                cancelled: false,
                stale: false,
                dropped: false,
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
                ipc_wait_us: None,
                decoder_mutex_wait_us: None,
                gpu_queue_wait_us: None,
                surface_acquire_us: None,
                submit_present_us: None,
            });
            record_successful_readback_metrics(&app, &request);
            return Ok(tauri::ipc::Response::new(packet.data));
        }
    }

    let legacy_request = to_video_project_request(&request)?;
    let (rgba, stage_timings) =
        render_native_video_project_frame_bytes_timed(app.clone(), legacy_request).await?;
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
            cancelled: false,
            stale: false,
            dropped: false,
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
            ipc_wait_us: None,
            decoder_mutex_wait_us: Some(stage_timings.decoder_mutex_wait_us),
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: None,
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
#[tauri::command]
pub async fn reset_native_preview_runtime(app: tauri::AppHandle) -> Result<(), String> {
    // 1+2. Reset the frame queue generation and drain pending/queued frames.
    if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
        queue.inner().clone().lock().await.reset();
    }

    // 3. Clear the readback frame cache.
    if let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        service.lock().await.reset();
    }

    // 4. Reset the surface presentation sequence.
    if let Some(surface) = app.try_state::<Arc<std::sync::Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>() {
        if let Ok(mut s) = surface.inner().clone().lock() {
            s.reset();
        }
    }

    // 5. Stop native audio and clear clip state.
    if let Some(clock) = app.try_state::<Arc<std::sync::Mutex<crate::native_audio::NativeAudioClock>>>() {
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        color_params, compute_text_layer_scale, merge_color_metadata, parse_blend_mode,
        project_layer_transform, validate_project_request, validate_video_project_request,
        NativeDecodeTimings, NativePreviewFrameQueue, NativeProjectFrameRequest,
        NativeVideoProjectFrameRequest, QueuedNativeFrame,
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
    fn full_range_rec601_selects_the_explicit_matrix() {
        let mut color = VideoColorMetadata::default();
        color.range = "full".to_string();
        color.matrix = "bt601_625".to_string();
        color.transfer = "bt709".to_string();

        let params = color_params(&color).expect("Rec.601 SDR should be supported");
        assert_eq!(params.color_space, 3);
        assert_eq!(params.range, 1);
    }

    #[test]
    fn unsupported_partial_metadata_is_rejected() {
        let mut color = VideoColorMetadata::default();
        color.matrix = "bt2020_ncl".to_string();
        color.transfer = "unspecified".to_string();

        assert!(color_params(&color).is_err());
    }

    #[test]
    fn frame_color_metadata_wins_with_stream_fallbacks() {
        let mut stream = VideoColorMetadata::default();
        stream.range = "full".to_string();
        stream.matrix = "bt601_625".to_string();
        stream.transfer = "bt709".to_string();

        let mut frame = VideoColorMetadata::default();
        frame.matrix = "bt709".to_string();

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
            decoded_frames: Vec::new(),
            decode_timings: NativeDecodeTimings::default(),
            queued_at: Instant::now(),
            scheduler_wait_us: 0,
        };
        assert!(queue.begin("frame-1"));
        assert!(!queue.begin("frame-1"));
        queue.complete("frame-1".to_string(), queued_frame());
        assert!(queue.contains("frame-1"));
        assert!(queue.take("frame-1").is_some());
        assert!(!queue.contains("frame-1"));

        assert!(queue.begin("frame-2"));
        queue.complete("frame-2".to_string(), queued_frame());
        assert!(queue.begin("frame-3"));
        queue.complete("frame-3".to_string(), queued_frame());
        assert!(queue.begin("frame-4"));
        queue.complete("frame-4".to_string(), queued_frame());
        assert!(!queue.contains("frame-2"));
        assert!(queue.contains("frame-3"));
        assert!(queue.contains("frame-4"));
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
                    asset_id: "text-1".to_string(),
                    rgba: None,
                    width: 480,
                    height: 120,
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
