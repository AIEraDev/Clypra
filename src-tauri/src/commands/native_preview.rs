use crate::native_core::{
    ColorGradeSnapshot, FramePacket, FrameRequest, FrameTime, NativeFrameService, NativeFrameServiceStats,
    NativeSurfacePresentation, PerformanceSample, PixelFormat, NATIVE_CORE_CONTRACT_VERSION,
};
use crate::native_audio::NativeAudioClock;
use crate::commands::lut::LutCache;
use crate::commands::native_surface::NativeSurfaceRuntime;
use crate::native_core::playback::VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ;
use crate::thumbnail_engine::decoder::{get_decoder, VideoColorMetadata};
use crate::wgpu_compositor::{
    BlendMode, ChromaKeyUniforms, ColorGradeUniforms, ColorTransformUniforms, CompositeLayer,
    CropMargins, LayerTransform, MultiTrackCompositor, NativePreviewSession, NativeWgpuRenderer,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;

type DecodedNativeVideoFrame = (Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata);
static NATIVE_SURFACE_PRESENTATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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
    let age = status.audio_position_ticks as i128 - frame_position_ticks as i128;
    let frame_age_ticks = age.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    (
        status.audio_position_ticks,
        frame_age_ticks,
        frame_age_ticks > VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ,
    )
}

/// Bounded native decode-ahead storage for continuous preview playback.
///
/// The queue owns decoded NV12 planes, not GPU textures. Decoding can happen
/// ahead of the audio clock without holding the GPU session lock; presentation
/// consumes the entry and performs only color conversion/compositing/surface
/// submission.
pub struct NativePreviewFrameQueue {
    entries: HashMap<String, Vec<DecodedNativeVideoFrame>>,
    order: VecDeque<String>,
    pending: std::collections::HashSet<String>,
    max_entries: usize,
}

impl NativePreviewFrameQueue {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            pending: std::collections::HashSet::new(),
            max_entries: max_entries.max(1),
        }
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

    fn complete(&mut self, key: String, decoded: Vec<DecodedNativeVideoFrame>) {
        self.pending.remove(&key);
        self.order.retain(|entry| entry != &key);
        self.entries.insert(key.clone(), decoded);
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

    fn take(&mut self, key: &str) -> Option<Vec<DecodedNativeVideoFrame>> {
        let decoded = self.entries.remove(key)?;
        self.order.retain(|entry| entry != key);
        Some(decoded)
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
            x: layer.x * scale_x,
            y: layer.y * scale_y,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: layer.blend_mode.clone(),
        })
        .collect();

    Ok(NativeVideoProjectFrameRequest {
        canvas_width: request.output_width,
        canvas_height: request.output_height,
        clear_color: request.project.clear_color,
        layers,
        raster_layers,
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
    lut: Option<Arc<crate::wgpu_compositor::GpuLut3D>>,
    grain_seed: f32,
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
                chroma_key: ChromaKeyUniforms {
                    _pad0: layer.grain_seed,
                    ..ChromaKeyUniforms::default()
                },
            })
        })
        .collect()
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

    let decoder = get_decoder(&video_path).await?;
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
    let session = state.lock().await;
    let device = &session.gpu.device;
    let queue = &session.gpu.queue;
    let compositor =
        MultiTrackCompositor::new(device, queue, request.canvas_width, request.canvas_height);

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

/// Decode, color-convert, and composite real video layers in native Rust/wgpu.
/// This internal function returns bytes so versioned frame-service commands can
/// add caching and stale-request handling without duplicating the renderer.
async fn render_native_video_project_frame_bytes(
    app: tauri::AppHandle,
    request: NativeVideoProjectFrameRequest,
) -> Result<Vec<u8>, String> {
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
    let decoded_frames = decode_native_video_layers(&request).await?;

    let mut session = state.lock().await;
    let mut textures = Vec::with_capacity(request.layers.len() + request.raster_layers.len());
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

    let compositor = MultiTrackCompositor::new_with_target_format(
        &session.gpu.device,
        &session.gpu.queue,
        request.canvas_width,
        request.canvas_height,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );
    let mut specs = Vec::with_capacity(request.layers.len() + request.raster_layers.len());
    for (layer, view) in request.layers.iter().zip(views.iter()) {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.width as f32,
            height: layer.height as f32,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: color_grade_from_snapshot(layer.color_grade.as_ref()),
            lut: resolve_native_lut(layer.color_grade.as_ref(), lut_cache.as_ref())?,
            grain_seed: ((layer.time_secs.max(0.0) * 60.0).floor() * 0.37) as f32,
        });
    }
    let raster_views = views.iter().skip(request.layers.len());
    for (layer, view) in request.raster_layers.iter().zip(raster_views) {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.width as f32,
            height: layer.height as f32,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    let layers = build_native_composite_layers(&specs, canvas_width, canvas_height)?;
    // Keep both decoded textures and their views alive through GPU readback.
    let _textures = textures;
    let rgba = compositor
        .render_to_rgba_bytes_with_size(
            &session.gpu.device,
            &session.gpu.queue,
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

    Ok(rgba)
}

async fn decode_native_video_layers(
    request: &NativeVideoProjectFrameRequest,
) -> Result<Vec<DecodedNativeVideoFrame>, String> {
    let mut decoded_frames = Vec::with_capacity(request.layers.len());
    for layer in &request.layers {
        let decoder = get_decoder(&layer.video_path).await?;
        let (y_plane, uv_plane, width, height, color) = {
            let mut guard = decoder.lock().await;
            let stream_color = guard.metadata().color;
            let (y_plane, uv_plane, width, height, frame_color) =
                guard.decode_frame_raw_nv12(layer.time_secs)?;
            (
                y_plane,
                uv_plane,
                width,
                height,
                merge_color_metadata(frame_color, &stream_color),
            )
        };
        decoded_frames.push((y_plane, uv_plane, width, height, color));
    }
    Ok(decoded_frames)
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
    request.validate().map_err(|error| error.to_string())?;
    let key = request.cache_key().map_err(|error| error.to_string())?;
    let legacy_request = to_video_project_request(&request)?;
    validate_video_project_request(&legacy_request)?;

    let queue = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
        .ok_or_else(|| "Native preview frame queue is not initialized".to_string())?
        .inner()
        .clone();
    {
        let mut queue_state = queue.lock().await;
        if !queue_state.begin(&key) {
            return Ok(());
        }
    }

    match decode_native_video_layers(&legacy_request).await {
        Ok(decoded_frames) => {
            queue.lock().await.complete(key, decoded_frames);
            Ok(())
        }
        Err(error) => {
            queue.lock().await.fail(&key);
            Err(error)
        }
    }
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
    let presentation_sequence =
        NATIVE_SURFACE_PRESENTATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        return Err(format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        ));
    }
    let legacy_request = to_video_project_request(&request)?;
    validate_video_project_request(&legacy_request)?;
    let queued_key = request.cache_key().map_err(|error| error.to_string())?;
    let queued_frames = if let Some(queue) =
        app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>()
    {
        queue.inner().clone().lock().await.take(&queued_key)
    } else {
        None
    };
    let decoded_frames = match queued_frames {
        Some(decoded_frames) => decoded_frames,
        None => decode_native_video_layers(&legacy_request).await?,
    };

    let preview_state = app
        .try_state::<Arc<tokio::sync::Mutex<NativePreviewSession>>>()
        .ok_or_else(|| "Native preview GPU session is unavailable".to_string())?;
    let surface_state = app
        .try_state::<Arc<std::sync::Mutex<NativeSurfaceRuntime>>>()
        .ok_or_else(|| "Native surface runtime is unavailable".to_string())?;
    let lut_cache = app
        .try_state::<Arc<LutCache>>()
        .map(|state| state.inner().clone());

    let mut session = preview_state.lock().await;
    let mut surface = surface_state
        .lock()
        .map_err(|_| "Native surface runtime lock is poisoned".to_string())?;
    let target_format = surface
        .configured_format()
        .ok_or_else(|| "Native surface has not been configured".to_string())?;
    let probe = surface
        .probe()
        .ok_or_else(|| "Native surface lost its readiness probe".to_string())?;
    let (audio_position_ticks, frame_age_ticks, late_for_audio) = native_presentation_timing(
        &app,
        request.frame_time.ticks,
        request.frame_time.timescale,
    );
    if !surface.accept_presentation(presentation_sequence) {
        return Ok(NativeSurfacePresentation {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request.request_id,
            frame_index: request.frame_time.frame_index,
            presented: false,
            dropped: true,
            audio_position_ticks,
            frame_age_ticks,
            surface: probe,
        });
    }
    if late_for_audio {
        return Ok(NativeSurfacePresentation {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request.request_id,
            frame_index: request.frame_time.frame_index,
            presented: false,
            dropped: true,
            audio_position_ticks,
            frame_age_ticks,
            surface: probe,
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
    let surface_texture = surface.acquire_current_texture(&session.gpu.device)?;
    let target_view = surface_texture
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());

    let canvas_width = legacy_request.canvas_width as f32;
    let canvas_height = legacy_request.canvas_height as f32;
    let mut textures = Vec::with_capacity(
        legacy_request.layers.len() + legacy_request.raster_layers.len(),
    );
    let mut views = Vec::with_capacity(
        legacy_request.layers.len() + legacy_request.raster_layers.len(),
    );
    for (layer, (y_plane, uv_plane, width, height, color)) in legacy_request
        .layers
        .iter()
        .zip(decoded_frames.iter())
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

    let compositor = MultiTrackCompositor::new_with_target_format(
        &session.gpu.device,
        &session.gpu.queue,
        legacy_request.canvas_width,
        legacy_request.canvas_height,
        target_format,
    );
    let mut specs = Vec::with_capacity(
        legacy_request.layers.len() + legacy_request.raster_layers.len(),
    );
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
            lut: resolve_native_lut(layer.color_grade.as_ref(), lut_cache.as_ref())?,
            grain_seed: ((layer.time_secs.max(0.0) * 60.0).floor() * 0.37) as f32,
        });
    }
    let raster_views = views.iter().skip(legacy_request.layers.len());
    for (layer, view) in legacy_request.raster_layers.iter().zip(raster_views) {
        specs.push(NativeLayerSpec {
            view,
            x: layer.x,
            y: layer.y,
            width: layer.width as f32,
            height: layer.height as f32,
            rotation: layer.rotation,
            opacity: layer.opacity,
            z_index: layer.z_index,
            blend_mode: &layer.blend_mode,
            color_grade: ColorGradeUniforms::default(),
            lut: None,
            grain_seed: 0.0,
        });
    }
    let layers = build_native_composite_layers(&specs, canvas_width, canvas_height)?;

    compositor.composite_layers(
        &session.gpu.device,
        &session.gpu.queue,
        &target_view,
        &layers,
        Some(wgpu::Color {
            r: legacy_request.clear_color[0].clamp(0.0, 1.0) as f64,
            g: legacy_request.clear_color[1].clamp(0.0, 1.0) as f64,
            b: legacy_request.clear_color[2].clamp(0.0, 1.0) as f64,
            a: legacy_request.clear_color[3].clamp(0.0, 1.0) as f64,
        }),
    )?;
    // Keep decoded textures and views alive until after queue submission.
    let _textures = textures;
    surface_texture.present();
    surface.show_surface()?;

    Ok(NativeSurfacePresentation {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: request.request_id,
        frame_index: request.frame_time.frame_index,
        presented: true,
        dropped: false,
        audio_position_ticks,
        frame_age_ticks,
        surface: probe,
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
            });
            return Ok(tauri::ipc::Response::new(packet.data));
        }
    }

    let legacy_request = to_video_project_request(&request)?;
    let rgba = render_native_video_project_frame_bytes(app.clone(), legacy_request).await?;
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
            decode_time_us: total_time_us,
            compose_time_us: 0,
            readback_time_us: 0,
            total_time_us,
            bytes_transferred: rgba.len() as u64,
            cache_hit: false,
        });
    }

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

#[cfg(test)]
mod tests {
    use super::{
        color_params, merge_color_metadata, parse_blend_mode, project_layer_transform,
        validate_project_request, validate_video_project_request, NativeProjectFrameRequest,
        NativePreviewFrameQueue, NativeVideoProjectFrameRequest,
    };
    use crate::thumbnail_engine::decoder::VideoColorMetadata;

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
        assert!(queue.begin("frame-1"));
        assert!(!queue.begin("frame-1"));
        queue.complete("frame-1".to_string(), Vec::new());
        assert!(queue.contains("frame-1"));
        assert!(queue.take("frame-1").is_some());
        assert!(!queue.contains("frame-1"));

        assert!(queue.begin("frame-2"));
        queue.complete("frame-2".to_string(), Vec::new());
        assert!(queue.begin("frame-3"));
        queue.complete("frame-3".to_string(), Vec::new());
        assert!(queue.begin("frame-4"));
        queue.complete("frame-4".to_string(), Vec::new());
        assert!(!queue.contains("frame-2"));
        assert!(queue.contains("frame-3"));
        assert!(queue.contains("frame-4"));
    }
}
