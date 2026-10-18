use serde::{Deserialize, Serialize};
use crate::native_core::{
    BodyEffectSnapshot, ColorGradeSnapshot, FrameRequest, FrameTime, QualityTier,
    TextLayerSnapshot, TransitionSnapshot,
};
use crate::wgpu_compositor::BlendMode;

pub fn default_clear_color() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

pub fn default_opacity() -> f32 {
    1.0
}


pub fn default_blend_mode() -> String {
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
    pub crop: Option<crate::native_core::contracts::CropMarginsSnapshot>,
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

pub(crate) fn parse_blend_mode(value: &str) -> Result<BlendMode, String> {
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

pub(crate) fn validate_transition(
    transition: &TransitionSnapshot,
    layer_ids: &[String],
    _raster_count: usize,
) -> Result<(), String> {
    if layer_ids.len() < 2 {
        return Err(
            "Native transitions currently require at least two video layers".to_string(),
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

pub(crate) fn validate_project_request(request: &NativeProjectFrameRequest) -> Result<(), String> {
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

pub(crate) fn validate_video_project_request(request: &NativeVideoProjectFrameRequest) -> Result<(), String> {
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

pub(crate) fn frame_time_seconds(time: FrameTime) -> Result<f64, String> {
    if time.timescale == 0 || time.ticks < 0 {
        return Err("FrameTime must have a non-zero timescale and non-negative ticks".to_string());
    }
    let seconds = time.seconds();
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("FrameTime resolves to an invalid timestamp".to_string());
    }
    Ok(seconds)
}

pub(crate) fn to_video_project_request(
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
                crop: layer.crop,
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
