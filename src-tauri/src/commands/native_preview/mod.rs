use crate::commands::lut::LutCache;
use crate::commands::native_surface::NativeSurfaceRuntime;
use crate::diagnostics;
use crate::native_core::{
    BodyEffectSnapshot, ColorGradeSnapshot, FramePacket, FrameRequest, FrameTime,
    NativeFrameService, NativeFrameServiceStats, NativePerformanceSampleBatch,
    NativeSurfacePresentation, NativeSurfacePresentationTimings, PerformanceSample, PixelFormat,
    PreviewMode, TextLayerSnapshot, TransitionSnapshot, DEFAULT_TIME_SCALE,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::sync_metrics::SYNC_METRICS;
#[cfg(target_os = "windows")]
use crate::filmstrip_engine::decoder::get_preview_decoder_for_stream;
use crate::filmstrip_engine::decoder::{
    get_preview_decoder, DecodeFrameOptions, VideoColorMetadata,
};
use crate::wgpu_compositor::multi_track_composer::TransitionUniforms;
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use crate::wgpu_compositor::DxgiImportState;
use crate::wgpu_compositor::{
    BodyEffectUniforms, ChromaKeyUniforms, ColorGradeUniforms, ColorTransformUniforms,
    CompositeLayer, CropMargins, FrameRenderPath, LayerTransform, NativePreviewSession,
    NativeWgpuRenderer,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

use crate::filmstrip_engine::stream_actor::DecodedVideoPlanes;

type DecodedNativeVideoFrame = (DecodedVideoPlanes, u32, u32, VideoColorMetadata, u32);
static NATIVE_SURFACE_PRESENTATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);


pub mod font_registry;
pub mod layer_models;
pub mod performance_report;
pub mod presentation_queue;
pub mod push_runtime;
pub mod raster_assets;

#[cfg(test)]
mod tests;

pub use font_registry::*;
pub use layer_models::*;
pub use performance_report::*;
pub use presentation_queue::*;
pub use push_runtime::*;
pub use raster_assets::*;


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
        canvas_aspect_ratio: canvas_width / canvas_height,
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
    crop: CropMargins,
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

fn crop_margins_from_snapshot(
    snapshot: Option<&crate::native_core::contracts::CropMarginsSnapshot>,
) -> CropMargins {
    snapshot.map_or_else(CropMargins::default, |c| CropMargins {
        left: c.left,
        top: c.top,
        right: c.right,
        bottom: c.bottom,
    })
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
                crop: layer.crop,
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

/// Diagnostics-only transport isolation probe.
///
/// Returns a deterministic RGBA-sized byte buffer through the exact same
/// Tauri `Response` path as `render_native_frame`, without decode, wgpu, or
/// compositor work. The WebView-side loop owns timing so this command does
/// not add another clock domain or telemetry IPC message per iteration.
#[tauri::command]
pub fn render_native_preview_transport_probe(
    byte_length: Option<usize>,
) -> Result<tauri::ipc::Response, String> {
    const DEFAULT_BYTES: usize = 518 * 1024;
    const MAX_BYTES: usize = 4 * 1024 * 1024;
    let byte_length = byte_length.unwrap_or(DEFAULT_BYTES);
    if byte_length == 0 || byte_length > MAX_BYTES {
        return Err(format!(
            "transport probe byte_length must be between 1 and {MAX_BYTES}"
        ));
    }
    let mut bytes = vec![0u8; byte_length];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = (index & 0xff) as u8;
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// Phase 2a transport gate for the playback push bridge.
///
/// This deliberately streams deterministic RGBA-sized buffers through a Tauri
/// `Channel`, rather than the invoke-response route used by
/// `render_native_frame`. It does not render or decode: its only job is to
/// prove (or reject) Channel delivery before the production playback pipeline
/// is moved to it. Every packet has the production header layout followed by
/// tightly packed RGBA8 pixels.
///
/// Header layout (little endian, 52 bytes):
/// magic u32, version u16, header_bytes u16, generation u64,
/// delivery_seq u64, frame_id u64, t8_epoch_us u64, width u32,
/// height u32, stride u32.
#[tauri::command]
pub fn stream_native_playback_frames(
    generation: u64,
    frame_count: Option<u32>,
    payload_bytes: Option<usize>,
    pace_ms: Option<u32>,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<(), String> {
    const MAGIC: u32 = 0x4350_4652; // "RFPC" in little-endian byte order.
    const VERSION: u16 = 1;
    const HEADER_BYTES: usize = 52;
    const WIDTH: u32 = 480;
    const HEIGHT: u32 = 270;
    const STRIDE: u32 = WIDTH * 4;
    const MAX_FRAMES: u32 = 120;
    const MIN_PAYLOAD_BYTES: usize = 1024;
    const MAX_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

    let frame_count = frame_count.unwrap_or(20).clamp(1, MAX_FRAMES);
    let default_pixel_bytes = (STRIDE as usize)
        .checked_mul(HEIGHT as usize)
        .ok_or_else(|| "Push-bridge probe frame size overflow".to_string())?;
    let pixel_bytes = payload_bytes.unwrap_or(default_pixel_bytes);
    if !(MIN_PAYLOAD_BYTES..=MAX_PAYLOAD_BYTES).contains(&pixel_bytes) {
        return Err(format!(
            "push-bridge payload_bytes must be between {MIN_PAYLOAD_BYTES} and {MAX_PAYLOAD_BYTES}"
        ));
    }
    let pace = std::time::Duration::from_millis(u64::from(pace_ms.unwrap_or(0).min(1000)));

    // `Channel::send` may schedule WebView work, but a synchronous command
    // remains active until this function returns. Sleeping here made the old
    // diagnostic measure command lifetime rather than t8 → t9. Return now;
    // the background sender is the actual one-way transport being evaluated.
    std::thread::spawn(move || {
        for delivery_seq in 1..=u64::from(frame_count) {
            let mut packet = vec![0_u8; HEADER_BYTES + pixel_bytes];
            packet[0..4].copy_from_slice(&MAGIC.to_le_bytes());
            packet[4..6].copy_from_slice(&VERSION.to_le_bytes());
            packet[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
            packet[8..16].copy_from_slice(&generation.to_le_bytes());
            packet[16..24].copy_from_slice(&delivery_seq.to_le_bytes());
            // This is intentionally a source-frame identity, not a delivery
            // sequence. Phase 2b will allow it to skip when mailbox work is
            // superseded; the two counters must never be conflated.
            packet[24..32].copy_from_slice(&delivery_seq.to_le_bytes());
            packet[40..44].copy_from_slice(&WIDTH.to_le_bytes());
            packet[44..48].copy_from_slice(&HEIGHT.to_le_bytes());
            packet[48..52].copy_from_slice(&STRIDE.to_le_bytes());

            // t8 must bracket transport delivery, not packet allocation.
            // Keep this immediately adjacent to `send`: on a weak machine
            // allocating/filling half a MiB is measurable work of its own.
            let t8_epoch_us = match SystemTime::now().duration_since(UNIX_EPOCH) {
                Ok(duration) => duration.as_micros().min(u64::MAX as u128) as u64,
                Err(_) => break,
            };
            packet[32..40].copy_from_slice(&t8_epoch_us.to_le_bytes());

            if on_frame
                .send(tauri::ipc::InvokeResponseBody::Raw(packet))
                .is_err()
            {
                // A WebView reload or closed diagnostics pane is normal
                // teardown, not an application-level playback error.
                break;
            }
            if !pace.is_zero() {
                std::thread::sleep(pace);
            }
        }
    });
    Ok(())
}

/// Open one benchmark-only playback stream. This does not alter the default
/// invoke bridge; the frontend must explicitly opt into this command.
#[tauri::command]
pub fn open_native_playback_push_stream(
    app: tauri::AppHandle,
    generation: u64,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<(), String> {
    let runtime = push_runtime(&app)?;
    if runtime.sender_started.swap(true, Ordering::AcqRel) {
        return Err("Native playback push stream is already open".to_string());
    }
    runtime.mailbox.begin_generation(generation);
    let channel = on_frame.clone();
    let mailbox = Arc::clone(&runtime.mailbox);
    mailbox.spawn_sender(move |delivery| {
        let packet = push_packet(delivery)?;
        channel.send(packet).map_err(|_| ())
    });
    if !runtime.render_worker_started.swap(true, Ordering::AcqRel) {
        let worker_runtime = Arc::clone(&runtime);
        tauri::async_runtime::spawn(run_push_render_worker(app, worker_runtime));
    }
    Ok(())
}

/// Producer-side playback update. This returns immediately; rendering and
/// transport happen on their respective workers.
#[tauri::command]
pub fn submit_native_playback_push_frame(
    app: tauri::AppHandle,
    request: FrameRequest,
) -> Result<(), String> {
    let runtime = push_runtime(&app)?;
    let generation = request.generation.unwrap_or_default();
    runtime.mailbox.begin_generation(generation);
    let mut latest = runtime
        .latest_render
        .lock()
        .map_err(|_| "Native playback push render mailbox lock is poisoned".to_string())?;
    *latest = Some(request);
    drop(latest);
    runtime.render_notify.notify_one();
    Ok(())
}

#[tauri::command]
pub fn acknowledge_native_playback_push_frame(
    app: tauri::AppHandle,
    generation: u64,
    consumed_delivery_seq: u64,
) -> Result<bool, String> {
    Ok(push_runtime(&app)?
        .mailbox
        .acknowledge(generation, consumed_delivery_seq))
}

#[tauri::command]
pub fn close_native_playback_push_stream(app: tauri::AppHandle) -> Result<(), String> {
    push_runtime(&app)?.mailbox.close();
    Ok(())
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
#[derive(Debug, Default, Clone)]
struct NativeRenderStageTimings {
    decode_time_us: u32,
    conversion_time_us: u32,
    compose_time_us: u32,
    readback_time_us: u32,
    /// CPU-side bracket from readback submission to map_async completion.
    /// This is intentionally marked separately from GPU timestamp queries.
    map_wait_us: u32,
    decoder_mutex_wait_us: u64,
    decode_telemetry: NativeDecodeTimings,
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

pub(crate) async fn render_native_video_project_frame_bytes(
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
    let mut decode_telemetry = NativeDecodeTimings::default();

    // ── Capability-Negotiated Render Path Selection ───────────────────────────
    // Before decoding, inspect the session's negotiated DXGI state. If zero-copy
    // has previously failed or was disabled, immediately bypass DXGI extraction
    // and proceed directly via the GpuUploadRing / CPU transfer fallback.
    #[cfg(target_os = "windows")]
    let can_attempt_dxgi = !request.layers.is_empty() && {
        let session = state.lock().await;
        // A failed/unsupported import still mutates the FFmpeg decoder while
        // probing D3D11VA. Repeating that probe per playback frame resets the
        // shared decoder cursor and turns a forward stream into GOP seeks.
        // Attempt it only when the active wgpu adapter can actually consume
        // the imported NV12 texture.
        session.dxgi_state.is_usable()
            && session.gpu.capabilities.zero_copy_available()
            && session.gpu.capabilities.wgpu_nv12
    };

    #[cfg(target_os = "windows")]
    let dxgi_env_disabled = std::env::var("CLYPRA_DISABLE_DXGI").as_deref() == Ok("1")
        || std::env::var("CLYPRA_DISABLE_DXGI_ZERO_COPY").as_deref() == Ok("1");

    #[cfg(target_os = "windows")]
    let dxgi_frames_result = if can_attempt_dxgi && !dxgi_env_disabled {
        use crate::filmstrip_engine::decoder::DecodeFrameOptions;
        let decode_options = DecodeFrameOptions {
            allow_keyframe_approx: request.allow_keyframe_approx.unwrap_or(false)
                || request.is_scrubbing.unwrap_or(false)
                || request.mode.as_deref() == Some("scrub"),
            quality: request.quality,
            is_playback: request.mode.as_deref() == Some("playback"),
            skip_hw_download: false,
            target_dimensions: None,
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
    let mut conversion_started = Instant::now();

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
                    request.layers.iter().zip(frames)
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
                    decode_telemetry.actor_wait_us = Some(0);
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
        decode_telemetry = decode_timings;

        session = state.lock().await;
        // The prior timer was started before awaiting CPU decode, making
        // `conversionUpload` cumulative with decode. Start it at the actual
        // GPU-upload/format-conversion boundary instead.
        conversion_started = Instant::now();
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
                        let (ry, ruv, rw, rh) = crate::filmstrip_engine::decoder::rotate_nv12(
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
            crop: crop_margins_from_snapshot(layer.crop.as_ref()),
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
            crop: CropMargins::default(),
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
            crop: CropMargins::default(),
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
    let (rgba, compose_time_us, readback_time_us, map_wait_us) =
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
            let (rgba, compositor_compose_us, readback_us, map_wait_us) = compositor
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
            (rgba, compositor_compose_us, readback_us, map_wait_us)
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
            map_wait_us: map_wait_us.min(u32::MAX as u64) as u32,
            decoder_mutex_wait_us,
            decode_telemetry,
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
        is_playback: request.mode.as_deref() == Some("playback"),
        skip_hw_download: false,
        target_dimensions: None,
    };

    // P0 visible seek/scrub work must preempt any same-source P2/P3 filmstrip
    // extraction before it acquires its own preview decoder. The decoder pools
    // are isolated, but releasing thumbnail serialization/IPC work keeps the
    // WebView response path responsive under rapid scrubbing.
    if is_preview_preemptive_request(request.is_scrubbing, request.mode.as_deref()) {
        let preempted = request
            .layers
            .iter()
            .map(|layer| {
                crate::commands::filmstrip::in_flight::preempt_filmstrip_for_preview(
                    &layer.video_path,
                )
            })
            .sum::<u64>();
        crate::filmstrip_engine::metrics::METRICS
            .source
            .preemptions
            .fetch_add(preempted, std::sync::atomic::Ordering::Relaxed);
    }

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
        let actor = crate::filmstrip_engine::stream_actor::get_preview_decoder_actor_for_stream(
            &layer.video_path,
            stream_id,
        )
        .await?;
        let actor_frame = if request.mode.as_deref() == Some("playback") {
            actor
                .decode_playback_frame(layer.time_secs, decode_options, generation)
                .await?
        } else {
            actor
                .decode_frame(layer.time_secs, decode_options, is_prefetch, generation)
                .await?
        };
        let decode_us = actor_frame.decode_us;
        let mutex_wait_us = actor_frame.decoder_mutex_wait_us;
        let actor_wait_us = actor_frame.actor_wait_us;
        let demux_us = actor_frame.demux_us;
        let container_format = actor_frame.container_format.clone();
        let is_hw = actor_frame.is_hardware_accelerated;
        let decoder_seek_count = actor_frame.decoder_seek_count;
        let decoder_seek_time_us = actor_frame.decoder_seek_time_us;
        let decoder_frames_decoded = actor_frame.decoder_frames_decoded;
        let hardware_frame_download_us = actor_frame.hardware_frame_download_us;
        let hardware_frames_downloaded = actor_frame.hardware_frames_downloaded;
        let scale_colorspace_us = actor_frame.scale_colorspace_us;
        let source = actor_frame.source_metadata.clone();
        let actor_served_from = actor_frame.served_from;
        let hw_device_type = actor_frame.hw_device_type.clone();
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
                decoder_seek_count: Some(decoder_seek_count),
                seek_time_us: Some(decoder_seek_time_us),
                decoder_frames_decoded: Some(decoder_frames_decoded),
                hardware_frame_download_us,
                scale_colorspace_us: Some(scale_colorspace_us),
                source_width: Some(source.width),
                source_height: Some(source.height),
                source_bits_per_raw_sample: Some(source.bits_per_raw_sample),
                source_frame_rate_milli: source.average_frame_rate_milli(),
                codec_name: Some(source.codec_name),
                hardware_frames_downloaded: Some(hardware_frames_downloaded),
                served_from: Some(actor_served_from),
                hw_device_type,
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

            let is_playback = request.mode.as_deref() == Some("playback");
            unique_tasks.push(tauri::async_runtime::spawn(async move {
                let stream_id = if !layer_id.is_empty() {
                    layer_id.as_str()
                } else {
                    ""
                };
                let actor =
                    crate::filmstrip_engine::stream_actor::get_preview_decoder_actor_for_stream(
                        &video_path,
                        stream_id,
                    )
                    .await?;
                let actor_frame = if is_playback {
                    actor
                        .decode_playback_frame(time_secs, decode_options, generation)
                        .await?
                } else {
                    actor
                        .decode_frame(time_secs, decode_options, is_prefetch, generation)
                        .await?
                };
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
            // Multi-layer aggregation currently records the critical-path
            // maximum. Per-stream decode activity is intentionally omitted
            // until the report can represent one row per source.
            ..NativeDecodeTimings::default()
        },
    ))
}

/// Both a continuous scrub and a paused exact seek are user-visible P0 work.
/// A `seek` request may originate from the timeline click/keyboard path, where
/// there is no `is_scrubbing` flag even though it must not wait behind a
/// visible filmstrip batch for the same source.
fn is_preview_preemptive_request(is_scrubbing: Option<bool>, mode: Option<&str>) -> bool {
    is_scrubbing.unwrap_or(false) || matches!(mode, Some("scrub" | "seek"))
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
                        decode_timings: decode_timings.clone(),
                        queued_at: command_started,
                        ready_at,
                        scheduler_wait_us,
                    },
                    lifecycle_epoch,
                );

                if let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
                    if let Ok(mut service) = service.try_lock() {
                        let total_time_us =
                            command_started.elapsed().as_micros().min(u32::MAX as u128) as u32;
                        let unaccounted_us = u64::from(total_time_us)
                            .saturating_sub(u64::from(decode_timings.decode_time_us));
                        service.record_sample(PerformanceSample {
                            request_id: request.request_id.clone(),
                            frame_index: request.frame_time.frame_index,
                            decode_time_us: decode_timings.decode_time_us,
                            compose_time_us: 0,
                            readback_time_us: 0,
                            total_time_us,
                            bytes_transferred: 0,
                            cache_hit: false,
                            generation: request.generation,
                            mode: Some(PreviewMode::PlaybackLookahead),
                            quality: Some(format!("{:?}", request.quality)),
                            strategy: Some("LOOKAHEAD_PREFETCH".to_string()),
                            transfer_path: Some("lookahead-queue".to_string()),
                            cancelled: false,
                            stale: false,
                            dropped: false,
                            drop_reason: None,
                            seek_time_us: decode_timings.seek_time_us.unwrap_or(0),
                            conversion_time_us: 0,
                            upload_time_us: 0,
                            present_time_us: 0,
                            decode_us: Some(u64::from(decode_timings.decode_time_us)),
                            conversion_upload_us: None,
                            compose_us: None,
                            readback_us: None,
                            map_wait_us: None,
                            timestamp_query_available: None,
                            present_us: None,
                            scheduler_wait_us: Some(scheduler_wait_us),
                            lookahead_wait_us: None,
                            cold_start_init_us: None,
                            queue_residency_us: None,
                            ipc_wait_us: None,
                            decoder_mutex_wait_us: Some(decode_timings.decoder_mutex_wait_us),
                            actor_wait_us: decode_timings.actor_wait_us,
                            gpu_queue_wait_us: None,
                            surface_acquire_us: None,
                            submit_present_us: None,
                            capability_policy: None,
                            capability_probe_us: None,
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
                            stage_overlap_us: Some(0),
                            served_from: decode_timings.served_from.or(Some(
                                crate::native_core::performance::ServedFrom::DecodedInRequest,
                            )),
                            hw_device_type: decode_timings.hw_device_type.clone(),
                            cache_lock_wait_us: None,
                            cache_insert_us: None,
                            dxgi_latched_off: None,
                            dxgi_latch_reason: None,
                dxgi_latch_context: None,
                        });
                    }
                }
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
    quality: Option<crate::native_core::QualityTier>,
    start_frame: Arc<std::sync::atomic::AtomicU64>,
    end_frame: Arc<std::sync::atomic::AtomicU64>,
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
fn current_lookahead_quality(app: &tauri::AppHandle) -> Option<crate::native_core::QualityTier> {
    let playback = app.try_state::<Arc<std::sync::Mutex<
        crate::commands::native_playback::NativePlaybackRuntime,
    >>>()?;
    let runtime_arc = playback.inner().clone();
    let runtime = runtime_arc.lock().ok()?;
    runtime.render_session_quality()
}

/// Feed visible playback queue outcomes back to the render session. The
/// session may lower *future lookahead* scale after repeated deadline misses;
/// it never mutates the frame-request snapshot used for paused exact renders.
fn record_playback_lookahead_outcome(app: &tauri::AppHandle, queue_hit: bool) {
    let Some(playback) = app.try_state::<Arc<std::sync::Mutex<
        crate::commands::native_playback::NativePlaybackRuntime,
    >>>() else {
        return;
    };
    let runtime_arc = playback.inner().clone();
    let Ok(runtime) = runtime_arc.lock() else {
        return;
    };
    if queue_hit {
        runtime.record_playback_lookahead_hit();
    } else {
        let previous_quality = runtime.render_session_quality();
        let next_quality = runtime.record_playback_lookahead_miss();
        if let (Some(previous_quality), Some(next_quality)) = (previous_quality, next_quality) {
            if previous_quality != next_quality {
                // Persist the adaptive decision as a rare diagnostic event so
                // a future trace distinguishes an inadequate startup probe
                // from normal queue jitter. Per-frame sample quality records
                // then show the scale used by the refilled queue.
                let _ = app.emit(
                    "clypra://native-diagnostic",
                    serde_json::json!({
                        "marker": "native-playback-lookahead-quality-adapted",
                        "fromQuality": format!("{:?}", previous_quality),
                        "toQuality": format!("{:?}", next_quality),
                        "reason": "consecutive-lookahead-misses",
                    }),
                );
            }
        }
    }
}

/// Non-blocking lookahead pre-decode worker.
/// Pre-decodes upcoming frames sequentially into `NativePreviewFrameQueue`
/// ahead of the presentation playhead. Sequential forward decoding avoids
/// seeking, but is deliberately limited to the two-frame interactive window.
pub(crate) fn schedule_lookahead_predecode(
    app: tauri::AppHandle,
    base_request: FrameRequest,
    lookahead_count: usize,
    quality_override: Option<crate::native_core::QualityTier>,
) {
    if base_request.project.video_layers.is_empty() || lookahead_count == 0 {
        return;
    }

    // PR4: count every trigger attempt
    crate::filmstrip_engine::stream_actor::record_lookahead_trigger();

    let generation = base_request.generation.unwrap_or(0);
    let frame_rate = base_request.project.frame_rate.max(1);
    let fps = frame_rate as f64;

    // Anchor current audio playback position
    let (current_audio_frame, current_audio_secs) = if let Ok(audio_time) =
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

    let mut worker_guard = match LOOKAHEAD_WORKER.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    // If an active worker for the SAME generation is already busy pre-decoding upcoming frames,
    // do NOT abort it if it covers the forward horizon of current_audio_frame!
    if let Some(active) = worker_guard.as_ref() {
        let is_active = !active.finished.load(std::sync::atomic::Ordering::Acquire);
        let is_same_gen = active.generation == generation;
        let is_same_quality = active.quality == quality_override;
        let start_f = active
            .start_frame
            .load(std::sync::atomic::Ordering::Acquire);
        let end_f = active.end_frame.load(std::sync::atomic::Ordering::Acquire);
        let frames_ahead = end_f.saturating_sub(current_audio_frame);
        let has_sufficient_lookahead = frames_ahead >= 2;
        let is_in_range =
            current_audio_frame >= start_f.saturating_sub(2) && has_sufficient_lookahead;

        if is_active && is_same_gen && is_same_quality && is_in_range {
            // PR4: count dropped trigger and record ahead-of-clock
            crate::filmstrip_engine::stream_actor::record_lookahead_trigger_dropped();
            let end_time_secs = end_f as f64 / fps;
            let ahead_ms = (end_time_secs - current_audio_secs) * 1_000.0;
            crate::filmstrip_engine::stream_actor::record_producer_ahead_of_clock_ms(ahead_ms);
            return;
        }
    }

    // PR4: record ahead-of-clock when accepted (worker ends at lookahead_count frames ahead)
    let ahead_ms = (lookahead_count as f64 / fps) * 1_000.0;
    crate::filmstrip_engine::stream_actor::record_producer_ahead_of_clock_ms(ahead_ms);

    // If generation changed or audio jumped out of range, abort previous worker to free decoders immediately.
    if let Some(prev) = worker_guard.take() {
        prev.handle.abort();
    }

    let _base_timeline_secs =
        (base_request.frame_time.ticks as f64) / (base_request.frame_time.timescale.max(1) as f64);

    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_finished = finished.clone();

    let initial_target_end = current_audio_frame.saturating_add(lookahead_count as u64);
    let worker_start = Arc::new(std::sync::atomic::AtomicU64::new(current_audio_frame));
    let worker_end = Arc::new(std::sync::atomic::AtomicU64::new(initial_target_end));
    let worker_start_clone = worker_start.clone();
    let worker_end_clone = worker_end.clone();

    let handle = tauri::async_runtime::spawn(async move {
        // Determine the next forward frame range that needs decoding:
        // NEVER decode backwards during playback!
        // If highest_frame_index >= current_audio_frame, start at highest_frame_index + 1
        // so the decoder moves strictly FORWARD in 11ms sequential steps.
        let (start_frame_index, target_end_frame_index) = {
            let queue_opt = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>();
            let (highest, effective_lookahead_count) = if let Some(queue) = &queue_opt {
                let mut queue_state = queue.lock().await;
                queue_state.discard_discontinuity(current_audio_frame, lookahead_count);
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
                Some(max_idx) if max_idx >= current_audio_frame && max_idx <= target_end => {
                    max_idx.saturating_add(1)
                }
                _ => current_audio_frame,
            };

            (start, target_end)
        };

        worker_start_clone.store(start_frame_index, std::sync::atomic::Ordering::Release);
        worker_end_clone.store(target_end_frame_index, std::sync::atomic::Ordering::Release);

        if start_frame_index > target_end_frame_index {
            worker_finished.store(true, std::sync::atomic::Ordering::Release);
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
        quality: quality_override,
        start_frame: worker_start,
        end_frame: worker_end,
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
    queue.lock().await.invalidate_generation(generation);
    if let Some(playback) = app.try_state::<Arc<std::sync::Mutex<crate::commands::native_playback::NativePlaybackRuntime>>>() {
        if let Ok(runtime) = playback.inner().clone().lock() {
            runtime.invalidate_render_generation(generation);
        }
    }
    Ok(())
}



/// Present a versioned frame directly to the retained native surface.
///
/// This is deliberately a sibling of the readback renderer rather than a
/// second composition implementation: decode, color conversion, layer
/// transforms, blend modes, and clear color are identical. The only changed
/// target is the final wgpu texture view, which removes the CPU RGBA bridge
/// when an embedded native surface is available.
#[cfg(debug_assertions)]
pub(crate) static LAST_PRESENTED_REQUEST: tokio::sync::RwLock<Option<FrameRequest>> =
    tokio::sync::RwLock::const_new(None);

#[cfg(debug_assertions)]
pub async fn get_last_presented_request() -> Option<FrameRequest> {
    LAST_PRESENTED_REQUEST.read().await.clone()
}

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
            q.discard_discontinuity(request.frame_time.frame_index, 16);
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
    if is_playback_mode {
        record_playback_lookahead_outcome(&app, queued_frame.is_some());
    }
    if playback_lookahead_miss {
        // A miss is intentionally non-blocking, but it must never become a
        // terminal queue state. The normal refill call lives after a
        // successful presentation, which this early return bypasses. Ensure
        // the single bounded worker is running before reporting the drop so
        // the next audio deadline can consume newly ready work. The scheduler
        // coalesces an already-running worker for this generation.
        schedule_lookahead_predecode(
            app.clone(),
            request.clone(),
            lookahead_frames_for_rate(request.project.frame_rate),
            current_lookahead_quality(&app),
        );
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
        let current_pts = crate::engine::MediaTime::from_micros(
            (request.frame_time.ticks.max(0) as u128 * 1_000_000u128
                / request.frame_time.timescale.max(1) as u128) as i64,
        );
        crate::engine::ENGINE_TELEMETRY.record_live_frame_metrics(
            0,
            0,
            true,
            0,
            current_pts,
            match request.mode.as_deref() {
                Some("scrub") => crate::engine::state_machine::PlaybackMode::Scrub,
                Some("seek") => crate::engine::state_machine::PlaybackMode::Seek,
                Some("playback") => crate::engine::state_machine::PlaybackMode::Play,
                _ => crate::engine::state_machine::PlaybackMode::Play,
            },
            Some(&app),
        );
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
    // EXCEPT when severe A/V drift occurs (> 120 ms behind audio clock). In that case,
    // presenting ancient frames only perpetuates desync. We purge stale queue frames and re-anchor.
    let is_severely_late_for_audio =
        is_playback && !legacy_request.layers.is_empty() && frame_age_ticks > 120_000;

    let late_for_audio = (late_for_audio && !legacy_request.layers.is_empty() && !is_playback)
        || is_severely_late_for_audio;

    if is_severely_late_for_audio {
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<NativePreviewFrameQueue>>>() {
            if let Ok(mut q) = queue.try_lock() {
                q.discard_before(request.frame_time.frame_index);
            }
        }
        schedule_lookahead_predecode(
            app.clone(),
            request.clone(),
            lookahead_frames_for_rate(request.project.frame_rate),
            current_lookahead_quality(&app),
        );
    }
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
                            let (ry, ruv, rw, rh) = crate::filmstrip_engine::decoder::rotate_nv12(
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
            crop: crop_margins_from_snapshot(layer.crop.as_ref()),
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
            crop: CropMargins::default(),
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
            crop: CropMargins::default(),
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
        let overlays = if layers.len() > 2 { &layers[2..] } else { &[] };
        if !overlays.is_empty() {
            compositor.composite_layers(
                &gpu.device,
                &gpu.queue,
                &target_view,
                overlays,
                None,
            )?;
        }
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
    #[cfg(debug_assertions)]
    {
        if let Ok(mut lock) = LAST_PRESENTED_REQUEST.try_write() {
            *lock = Some(request.clone());
        }
    }
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

    crate::engine::ENGINE_TELEMETRY.record_frame(
        crate::engine::FrameTelemetry {
            frame_id: request.frame_time.frame_index,
            generation: request.generation.unwrap_or(0),
            project_revision: 1,
            pts: crate::engine::MediaTime::from_micros(
                (request.frame_time.ticks.max(0) as u128 * 1_000_000u128
                    / request.frame_time.timescale.max(1) as u128) as i64,
            ),
            outcome: crate::engine::FrameOutcome::PresentedOnTime,
            demux_us: 1200,
            decode_us: decode_timings.decode_time_us as u64,
            decode_queue_wait_us: scheduler_wait_us,
            surface_acquire_us,
            surface_wait_us: 0,
            interop_us: conversion_upload_us,
            graph_compile_us: 100,
            graph_execute_us: compose_us,
            gpu_wait_us: surface_acquire_us,
            present_wait_us: 50,
            present_us: submit_present_us,
            total_frame_ms: request_started_at.elapsed().as_secs_f64() * 1000.0,
            surface_pool_used: 4,
            surface_pool_capacity: 16,
            cache_hit: queue_hit,
        },
        Some(&app),
    );

    let frame_pts = crate::engine::MediaTime::from_micros(
        (request.frame_time.ticks.max(0) as u128 * 1_000_000u128
            / request.frame_time.timescale.max(1) as u128) as i64,
    );
    crate::engine::ENGINE_TELEMETRY.record_live_frame_metrics(
        decode_timings.decode_time_us as u64,
        compose_us,
        false,
        if queue_hit { 2 } else { 0 },
        frame_pts,
        match request.mode.as_deref() {
            Some("scrub") => crate::engine::state_machine::PlaybackMode::Scrub,
            Some("seek") => crate::engine::state_machine::PlaybackMode::Seek,
            Some("playback") => crate::engine::state_machine::PlaybackMode::Play,
            _ => crate::engine::state_machine::PlaybackMode::Play,
        },
        Some(&app),
    );

    if request.mode.as_deref() != Some("prefetch") && request.mode.as_deref() != Some("scrub") {
        schedule_lookahead_predecode(
            app.clone(),
            request.clone(),
            lookahead_frames_for_rate(request.project.frame_rate),
            current_lookahead_quality(&app),
        );
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
    log::debug!(
        "[preview-diag][rust] render_native_frame called: frame={} mode={:?} quality={:?}",
        request.frame_time.frame_index,
        request.mode,
        request.quality,
    );
    if request.contract_version != NATIVE_CORE_CONTRACT_VERSION {
        let err = format!(
            "Unsupported native core contract version: {}",
            request.contract_version
        );
        log::error!(
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

        // --- Commit D: UNCH short-circuit ---
        // Before looking up the LRU cache, check whether this playback frame is
        // identical to the last frame we already delivered.  If so, return a
        // lightweight 12-byte sentinel so the frontend can skip `putImageData`.
        // The sentinel format: magic "UNCH" (4 bytes) + frame_index LE u64 (8 bytes).
        if request.mode.as_deref() == Some("playback") {
            if let Ok(key) = request.cache_key() {
                if cache.should_skip_unchanged(
                    request.mode.as_deref(),
                    request.generation,
                    &request,
                    &key,
                ) {
                    let frame_index = request.frame_time.frame_index;
                    let mut sentinel = [0u8; 12];
                    sentinel[0] = 0x55; // 'U'
                    sentinel[1] = 0x4E; // 'N'
                    sentinel[2] = 0x43; // 'C'
                    sentinel[3] = 0x48; // 'H'
                    sentinel[4..12].copy_from_slice(&frame_index.to_le_bytes());
                    cache.record_sample(PerformanceSample {
                        request_id: request.request_id.clone(),
                        frame_index,
                        decode_time_us: 0,
                        compose_time_us: 0,
                        readback_time_us: 0,
                        total_time_us: started.elapsed().as_micros().min(u32::MAX as u128) as u32,
                        bytes_transferred: 12,
                        cache_hit: false,
                        generation: request.generation,
                        mode: PreviewMode::from_request_mode(request.mode.as_deref()),
                        quality: Some(format!("{:?}", request.quality)),
                        strategy: Some("UNCH".to_string()),
                        transfer_path: Some("unchanged-skip".to_string()),
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
                        map_wait_us: None,
                        timestamp_query_available: None,
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
                        decoder_seek_count: None,
                        decoder_frames_decoded: None,
                        hardware_frame_download_us: None,
                        scale_colorspace_us: None,
                        source_width: None,
                        source_height: None,
                        source_bits_per_raw_sample: None,
                        source_frame_rate_milli: None,
                        unaccounted_us: Some(0),
                        codec_name: None,
                        hardware_frames_downloaded: Some(0),
                        stage_overlap_us: Some(0),
                        served_from: Some(
                            crate::native_core::performance::ServedFrom::UnchangedSkipped,
                        ),
                        hw_device_type: None,
                        cache_lock_wait_us: None,
                        cache_insert_us: None,
                        dxgi_latched_off: None,
                        dxgi_latch_reason: None,
                dxgi_latch_context: None,
                    });
                    log::debug!(
                        "[preview-diag][rust] render_native_frame UNCH: frame={} gen={:?}",
                        frame_index,
                        request.generation,
                    );
                    return Ok(tauri::ipc::Response::new(sentinel.to_vec()));
                }
            }
        }
        // --- end Commit D ---

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
                map_wait_us: None,
                timestamp_query_available: None,
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
                decoder_seek_count: None,
                decoder_frames_decoded: None,
                hardware_frame_download_us: None,
                scale_colorspace_us: None,
                source_width: None,
                source_height: None,
                source_bits_per_raw_sample: None,
                source_frame_rate_milli: None,
                unaccounted_us: Some(0),
                codec_name: None,
                hardware_frames_downloaded: Some(0),
                stage_overlap_us: Some(0),
                served_from: Some(crate::native_core::performance::ServedFrom::ReadyCache),
                hw_device_type: None,
                cache_lock_wait_us: None,
                cache_insert_us: None,
                        dxgi_latched_off: None,
                        dxgi_latch_reason: None,
                dxgi_latch_context: None,
            });
            record_successful_readback_metrics(&app, &request);
            return Ok(tauri::ipc::Response::new(packet.data));
        }
    }

    let legacy_request = match to_video_project_request(&request) {
        Ok(r) => r,
        Err(e) => {
            log::error!(
                "[preview-diag][rust] to_video_project_request FAILED: {}",
                e
            );
            return Err(e);
        }
    };
    log::debug!(
        "[preview-diag][rust] rendering legacy video request: layers={}, rasters={}, texts={}, clear_color={:?}",
        legacy_request.layers.len(),
        legacy_request.raster_layers.len(),
        legacy_request.text_layers.len(),
        legacy_request.clear_color,
    );
    let (rgba, stage_timings) =
        match render_native_video_project_frame_bytes_timed(app.clone(), legacy_request).await {
            Ok(res) => {
                log::debug!(
                "[preview-diag][rust] render_native_video_project_frame_bytes_timed OK: bytes={}",
                res.0.len()
            );
                res
            }
            Err(e) => {
                log::error!(
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

    if let Some(session_collector) =
        app.try_state::<Arc<crate::wgpu_compositor::SessionTelemetryCollector>>()
    {
        session_collector.record_frame_source("cpu-rgba");
    }

    if let Some(cache) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        let lock_start = Instant::now();
        let mut cache = cache.lock().await;
        let cache_lock_wait_us = lock_start.elapsed().as_micros().min(u64::MAX as u128) as u64;

        let is_playback = request.mode.as_deref() == Some("playback");
        let cache_insert_us = if is_playback && skip_playback_cache_insert_enabled() {
            // Experiment: skip the insert for playback frames and leave
            // cache_insert_us as None so the unaccounted delta is attributable
            // to the insert cost. Controlled by CLYPRA_SKIP_PLAYBACK_CACHE_INSERT.
            None
        } else {
            let insert_start = Instant::now();
            let _ = cache.insert(&request, packet);
            Some(insert_start.elapsed().as_micros().min(u64::MAX as u128) as u64)
        };

        let total_time_us = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
        let stages_sum = u64::from(stage_timings.decode_time_us)
            + u64::from(stage_timings.conversion_time_us)
            + u64::from(stage_timings.compose_time_us)
            + u64::from(stage_timings.readback_time_us);
        let unaccounted_us = u64::from(total_time_us).saturating_sub(stages_sum);
        let stage_overlap_us = stages_sum.saturating_sub(u64::from(total_time_us));
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
            seek_time_us: stage_timings.decode_telemetry.seek_time_us.unwrap_or(0),
            conversion_time_us: stage_timings.conversion_time_us,
            upload_time_us: 0,
            present_time_us: 0,
            decode_us: Some(u64::from(stage_timings.decode_time_us)),
            conversion_upload_us: Some(u64::from(stage_timings.conversion_time_us)),
            compose_us: Some(u64::from(stage_timings.compose_time_us)),
            readback_us: Some(u64::from(stage_timings.readback_time_us)),
            map_wait_us: Some(u64::from(stage_timings.map_wait_us)),
            // The current compatibility path deliberately uses a portable
            // CPU bracket. A timestamp-query implementation may replace this
            // later without changing the telemetry schema.
            timestamp_query_available: Some(false),
            present_us: None,
            scheduler_wait_us: None,
            lookahead_wait_us: None,
            cold_start_init_us: None,
            queue_residency_us: Some(0),
            ipc_wait_us: None,
            decoder_mutex_wait_us: Some(stage_timings.decoder_mutex_wait_us),
            actor_wait_us: stage_timings.decode_telemetry.actor_wait_us.or(Some(0)),
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: None,
            capability_policy: None,
            capability_probe_us: None,
            demux_wait_us: stage_timings.decode_telemetry.demux_wait_us,
            container_format: stage_timings.decode_telemetry.container_format.clone(),
            is_hardware_accelerated: stage_timings.decode_telemetry.is_hardware_accelerated,
            decoder_seek_count: stage_timings.decode_telemetry.decoder_seek_count,
            decoder_frames_decoded: stage_timings.decode_telemetry.decoder_frames_decoded,
            hardware_frame_download_us: stage_timings.decode_telemetry.hardware_frame_download_us,
            scale_colorspace_us: stage_timings.decode_telemetry.scale_colorspace_us,
            source_width: stage_timings.decode_telemetry.source_width,
            source_height: stage_timings.decode_telemetry.source_height,
            source_bits_per_raw_sample: stage_timings.decode_telemetry.source_bits_per_raw_sample,
            source_frame_rate_milli: stage_timings.decode_telemetry.source_frame_rate_milli,
            unaccounted_us: Some(unaccounted_us),
            codec_name: stage_timings.decode_telemetry.codec_name.clone(),
            hardware_frames_downloaded: stage_timings.decode_telemetry.hardware_frames_downloaded,
            stage_overlap_us: Some(stage_overlap_us),
            served_from: stage_timings.decode_telemetry.served_from,
            hw_device_type: stage_timings.decode_telemetry.hw_device_type.clone(),
            cache_lock_wait_us: Some(cache_lock_wait_us),
            cache_insert_us,
            dxgi_latched_off: None,
            dxgi_latch_reason: None,
                dxgi_latch_context: None,
        });

        // Commit D: record this delivery so that the next identical playback
        // RAF tick can be short-circuited via the UNCH sentinel.
        if is_playback {
            if let Some(gen) = request.generation {
                if let Ok(key) = request.cache_key() {
                    cache.record_delivered_playback(gen, &request, &key);
                }
            }
        }
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
    let mut stats = service.lock().await.stats();
    // Inject current DXGI latch state into last_sample at read time.
    // This is done here (main crate) rather than in clypra-native-core because
    // native_core is an isolated crate with no dependency on wgpu_compositor.
    if let Some(ref mut s) = stats.last_sample {
        let (latched, reason, ctx) =
            crate::wgpu_compositor::adapter_selector::get_dxgi_latch_state();
        s.dxgi_latched_off = latched;
        s.dxgi_latch_reason = reason.map(|r| r.to_string());
        s.dxgi_latch_context = ctx.and_then(|c| serde_json::to_value(c).ok());
    }
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

    // 8. Reset producer download counters.
    crate::filmstrip_engine::stream_actor::reset_producer_downloads_wasted();
    crate::filmstrip_engine::stream_actor::reset_producer_lookahead_downloads_skipped();

    Ok(())
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
