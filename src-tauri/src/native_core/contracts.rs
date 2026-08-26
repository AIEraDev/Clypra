use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;

pub const NATIVE_CORE_CONTRACT_VERSION: u32 = 1;
pub const DEFAULT_TIME_SCALE: u32 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualityTier {
    Full,
    Half,
    Quarter,
    Proxy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackClockStatus {
    Audio,
    MonotonicFallback,
    Buffering,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPlan {
    pub contract_version: u32,
    pub project_revision: String,
    pub frame_rate: u32,
    pub duration_frames: u64,
    pub audio_track_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub contract_version: u32,
    pub project_revision: String,
    pub audio_position_ticks: i64,
    pub presented_frame: Option<u64>,
    pub dropped_frames: u64,
    pub buffering: bool,
    pub clock_status: PlaybackClockStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelFormat {
    Rgba8Srgb,
    Rgba16Float,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameTime {
    /// Canonical sequence frame index. This is the primary addressing key.
    pub frame_index: u64,
    /// Optional exact timecode for source/VFR mapping. It is always integral.
    pub ticks: i64,
    pub timescale: u32,
}

impl FrameTime {
    pub fn new(frame_index: u64, ticks: i64, timescale: u32) -> Result<Self, NativeCoreError> {
        if timescale == 0 {
            return Err(NativeCoreError::InvalidContract(
                "FrameTime timescale must be non-zero".to_string(),
            ));
        }
        Ok(Self {
            frame_index,
            ticks,
            timescale,
        })
    }

    pub fn seconds(self) -> f64 {
        self.ticks as f64 / self.timescale as f64
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorPolicy {
    pub version: u32,
    pub working_space: String,
    pub output_format: PixelFormat,
    pub tone_map_hdr_to_sdr: bool,
    pub display_profile: String,
}

impl Default for ColorPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            working_space: "linear-rec709".to_string(),
            output_format: PixelFormat::Rgba8Srgb,
            tone_map_hdr_to_sdr: true,
            display_profile: "srgb-reference".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoLayerSnapshot {
    #[serde(default)]
    pub layer_id: String,
    pub asset_id: String,
    pub video_path: String,
    pub source_time: FrameTime,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
    pub opacity: f32,
    pub z_index: i32,
    pub blend_mode: String,
    #[serde(default)]
    pub color_grade: Option<ColorGradeSnapshot>,
    #[serde(default)]
    pub body_effect: Option<BodyEffectSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionSnapshot {
    pub outgoing_layer: String,
    pub incoming_layer: String,
    pub transition_type: String,
    pub progress: f32,
    #[serde(default = "default_transition_feather")]
    pub feather: f32,
    #[serde(default = "default_transition_intensity")]
    pub intensity: f32,
    #[serde(default)]
    pub fade_color: Option<[f32; 4]>,
}

fn default_transition_feather() -> f32 { 0.1 }
fn default_transition_intensity() -> f32 { 1.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyEffectSnapshot {
    pub mask_asset_id: String,
    pub renderer: String,
    pub color_r: f32,
    pub color_g: f32,
    pub color_b: f32,
    pub strength: f32,
    pub radius: f32,
    pub time: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGradeSnapshot {
    #[serde(default)]
    pub exposure: f32,
    #[serde(default = "default_color_grade_multiplier")]
    pub contrast: f32,
    #[serde(default = "default_color_grade_multiplier")]
    pub saturation: f32,
    #[serde(default)]
    pub temperature: f32,
    #[serde(default)]
    pub tint: f32,
    #[serde(default)]
    pub brightness: f32,
    #[serde(default)]
    pub sepia: f32,
    #[serde(default)]
    pub grayscale: f32,
    #[serde(default)]
    pub hue_rotate: f32,
    #[serde(default)]
    pub vignette: f32,
    #[serde(default)]
    pub invert: f32,
    #[serde(default)]
    pub grain_intensity: f32,
    #[serde(default = "default_color_grade_grain_size")]
    pub grain_size: f32,
    #[serde(default)]
    pub lut_id: Option<String>,
    #[serde(default = "default_color_grade_lut_intensity")]
    pub lut_intensity: f32,
    #[serde(default = "default_color_grade_lut_size")]
    pub lut_size: f32,
    #[serde(default)]
    pub blur_strength: f32,
    #[serde(default)]
    pub blur_radius: f32,
    #[serde(default)]
    pub pixelate_size: f32,
    #[serde(default)]
    pub scanline_count: f32,
    #[serde(default)]
    pub scanline_intensity: f32,
    #[serde(default)]
    pub rgb_split_x: f32,
    #[serde(default)]
    pub rgb_split_y: f32,
    #[serde(default)]
    pub vibrance_amount: f32,
    #[serde(default = "default_vibrance_protected_hue_r")]
    pub vibrance_protected_hue_r: f32,
    #[serde(default = "default_vibrance_protected_hue_g")]
    pub vibrance_protected_hue_g: f32,
    #[serde(default = "default_vibrance_protected_hue_b")]
    pub vibrance_protected_hue_b: f32,
    #[serde(default)]
    pub lift: f32,
    #[serde(default)]
    pub cross_process_amount: f32,
    #[serde(default)]
    pub channel_mix_r: f32,
    #[serde(default)]
    pub channel_mix_g: f32,
    #[serde(default)]
    pub channel_mix_b: f32,
    #[serde(default)]
    pub channel_mix_enabled: f32,
    #[serde(default)]
    pub duotone_dark_r: f32,
    #[serde(default)]
    pub duotone_dark_g: f32,
    #[serde(default)]
    pub duotone_dark_b: f32,
    #[serde(default)]
    pub duotone_light_r: f32,
    #[serde(default)]
    pub duotone_light_g: f32,
    #[serde(default)]
    pub duotone_light_b: f32,
    #[serde(default)]
    pub duotone_enabled: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub shadow_tint_r: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub shadow_tint_g: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub shadow_tint_b: f32,
    #[serde(default)]
    pub shadow_tint_strength: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub highlight_tint_r: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub highlight_tint_g: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub highlight_tint_b: f32,
    #[serde(default)]
    pub highlight_tint_strength: f32,
    #[serde(default = "default_color_grade_split_balance")]
    pub split_balance: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub glow_color_r: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub glow_color_g: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub glow_color_b: f32,
    #[serde(default)]
    pub glow_strength: f32,
    #[serde(default)]
    pub glow_radius: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub flash_color_r: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub flash_color_g: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub flash_color_b: f32,
    #[serde(default)]
    pub flash_strength: f32,
    #[serde(default)]
    pub flicker_strength: f32,
    #[serde(default)]
    pub strobe_frequency: f32,
    #[serde(default)]
    pub strobe_time: f32,
    #[serde(default)]
    pub strobe_strength: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub light_leak_color_r: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub light_leak_color_g: f32,
    #[serde(default = "default_color_grade_neutral_channel")]
    pub light_leak_color_b: f32,
    #[serde(default)]
    pub light_leak_strength: f32,
    #[serde(default = "default_color_grade_light_leak_angle")]
    pub light_leak_angle: f32,
    #[serde(default)]
    pub light_leak_time: f32,
    #[serde(default)]
    pub glitch_intensity: f32,
    #[serde(default)]
    pub glitch_time: f32,
    #[serde(default)]
    pub glitch_slice_count: f32,
    #[serde(default)]
    pub glitch_color_shift: f32,
    #[serde(default)]
    pub distortion_type: f32,
    #[serde(default)]
    pub distortion_strength: f32,
    #[serde(default)]
    pub distortion_time: f32,
    #[serde(default = "default_color_grade_distortion_frequency")]
    pub distortion_frequency: f32,
    /// Procedural fire overlay: height, particle count, intensity, time.
    #[serde(default)]
    pub fire_params: [f32; 4],
    #[serde(default = "default_color_grade_fire_color_1")]
    pub fire_color_1: [f32; 4],
    #[serde(default = "default_color_grade_fire_color_2")]
    pub fire_color_2: [f32; 4],
    #[serde(default = "default_color_grade_fire_color_3")]
    pub fire_color_3: [f32; 4],
    /// Procedural particles: count, size, drift speed, intensity.
    #[serde(default)]
    pub particle_params: [f32; 4],
    /// RGB plus mode (1 particles, 2 dust; fractional .5 means edge fade).
    #[serde(default = "default_color_grade_particle_color")]
    pub particle_color: [f32; 4],
    #[serde(default)]
    pub particle_time: f32,
}

fn default_color_grade_multiplier() -> f32 { 1.0 }
fn default_color_grade_grain_size() -> f32 { 1.0 }
fn default_color_grade_lut_intensity() -> f32 { 1.0 }
fn default_color_grade_lut_size() -> f32 { 33.0 }
fn default_vibrance_protected_hue_r() -> f32 { 0.91 }
fn default_vibrance_protected_hue_g() -> f32 { 0.69 }
fn default_vibrance_protected_hue_b() -> f32 { 0.55 }
fn default_color_grade_neutral_channel() -> f32 { 1.0 }
fn default_color_grade_split_balance() -> f32 { 0.5 }
fn default_color_grade_light_leak_angle() -> f32 { 0.7853982 }
fn default_color_grade_distortion_frequency() -> f32 { 6.0 }
fn default_color_grade_fire_color_1() -> [f32; 4] { [1.0, 0.2705882353, 0.0, 0.0] }
fn default_color_grade_fire_color_2() -> [f32; 4] { [1.0, 0.6470588235, 0.0, 0.0] }
fn default_color_grade_fire_color_3() -> [f32; 4] { [1.0, 0.8431372549, 0.0, 0.0] }
fn default_color_grade_particle_color() -> [f32; 4] { [1.0, 1.0, 1.0, 0.0] }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterLayerSnapshot {
    pub asset_id: String,
    /// Pixel payload is present on the registration/miss path and omitted
    /// once the native GPU asset is already resident.
    #[serde(default)]
    pub rgba: Option<Vec<u8>>,
    pub width: u32,
    pub height: u32,
    pub x: f32,
    pub y: f32,
    pub rotation: f32,
    pub opacity: f32,
    pub z_index: i32,
    pub blend_mode: String,
    #[serde(default)]
    pub color_grade: Option<ColorGradeSnapshot>,
    #[serde(default)]
    pub is_mask: bool,
    #[serde(default)]
    pub is_text: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TextParamValue {
    Float(f32),
    Color([f32; 4]),
    Vec2([f32; 2]),
    String(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEffectInstance {
    pub effect_id: String,
    pub effect_version: u32,
    #[serde(default)]
    pub parameter_overrides: HashMap<String, TextParamValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayerSnapshot {
    pub text: String,
    pub font_id: String,
    pub font_size: f32,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default)]
    pub line_height: f32,
    #[serde(default = "default_text_color")]
    pub color: [f32; 4],
    #[serde(default = "default_text_align")]
    pub text_align: String,
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
    pub stroke_color: Option<[f32; 4]>,
    #[serde(default)]
    pub stroke_width: Option<f32>,
    #[serde(default)]
    pub shadow_color: Option<[f32; 4]>,
    #[serde(default)]
    pub shadow_offset: Option<[f32; 2]>,
    #[serde(default)]
    pub shadow_blur: Option<f32>,
    #[serde(default)]
    pub effect: Option<TextEffectInstance>,
}

fn default_text_color() -> [f32; 4] {
    [1.0, 1.0, 1.0, 1.0]
}

fn default_text_align() -> String {
    "left".to_string()
}

fn default_opacity() -> f32 {
    1.0
}

fn default_blend_mode() -> String {
    "normal".to_string()
}

/// Text template element kind (§3 Architecture Plan).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateElementKind {
    Text,
    SolidBackground,
    Image,
}

/// Child element snapshot within a template definition (§3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateElementSnapshot {
    pub id: String,
    pub kind: TemplateElementKind,
    pub relative_x: f32,
    pub relative_y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub text_layer: Option<TextLayerSnapshot>,
    #[serde(default)]
    pub solid_color: Option<[f32; 4]>,
    #[serde(default)]
    pub image_asset_id: Option<String>,
}

/// Template definition snapshot (§3).
/// Instantiating this definition produces an independent compound clip snapshot on the timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDefinitionSnapshot {
    pub id: String,
    pub version: u32,
    pub display_name: String,
    pub category: String,
    #[serde(default)]
    pub description: Option<String>,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub default_duration_secs: f32,
    pub elements: Vec<TemplateElementSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub schema_version: u32,
    pub project_revision: String,
    #[serde(default = "default_frame_rate")]
    pub frame_rate: u32,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub clear_color: [f32; 4],
    pub video_layers: Vec<VideoLayerSnapshot>,
    #[serde(default)]
    pub raster_layers: Vec<RasterLayerSnapshot>,
    #[serde(default)]
    pub text_layers: Vec<TextLayerSnapshot>,
    #[serde(default)]
    pub transition: Option<TransitionSnapshot>,
}

fn default_frame_rate() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRequest {
    pub contract_version: u32,
    pub request_id: String,
    pub frame_time: FrameTime,
    pub project: ProjectSnapshot,
    pub output_width: u32,
    pub output_height: u32,
    pub quality: QualityTier,
    pub color_policy: ColorPolicy,
    pub render_graph_version: u32,
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub scrub_velocity_px_per_second: Option<f64>,
    #[serde(default)]
    pub requested_at_ms: Option<f64>,
}

impl FrameRequest {
    pub fn validate(&self) -> Result<(), NativeCoreError> {
        if self.contract_version != NATIVE_CORE_CONTRACT_VERSION {
            return Err(NativeCoreError::InvalidContract(format!(
                "Unsupported native core contract version: {}",
                self.contract_version
            )));
        }
        if self.request_id.trim().is_empty() || self.project.project_revision.trim().is_empty() {
            return Err(NativeCoreError::InvalidContract(
                "FrameRequest requires request_id and project_revision".to_string(),
            ));
        }
        if self.frame_time.timescale == 0 {
            return Err(NativeCoreError::InvalidContract(
                "FrameRequest frame_time timescale must be non-zero".to_string(),
            ));
        }
        if self.color_policy.output_format != PixelFormat::Rgba8Srgb {
            return Err(NativeCoreError::UnsupportedFeature(
                "RGBA16F output is not enabled in the CPU readback bridge".to_string(),
            ));
        }
        if self.output_width == 0 || self.output_height == 0 {
            return Err(NativeCoreError::InvalidContract(
                "FrameRequest output dimensions must be non-zero".to_string(),
            ));
        }
        if self.output_width > 8192 || self.output_height > 8192 {
            return Err(NativeCoreError::InvalidContract(
                "FrameRequest output dimensions exceed the native limit".to_string(),
            ));
        }
        if let Some(mode) = self.mode.as_deref() {
            if !matches!(mode, "playback" | "scrub" | "seek" | "frameStep") {
                return Err(NativeCoreError::InvalidContract(
                    "FrameRequest mode is not supported".to_string(),
                ));
            }
        }
        if self
            .scrub_velocity_px_per_second
            .map(|velocity| !velocity.is_finite())
            .unwrap_or(false)
        {
            return Err(NativeCoreError::InvalidContract(
                "FrameRequest scrub velocity must be finite".to_string(),
            ));
        }
        if self.project.canvas_width == 0 || self.project.canvas_height == 0 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot canvas dimensions must be non-zero".to_string(),
            ));
        }
        if self
            .project
            .clear_color
            .iter()
            .any(|value| !value.is_finite())
        {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot clear color contains invalid color data".to_string(),
            ));
        }
        if self.project.video_layers.len() > 256 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot supports at most 256 video layers".to_string(),
            ));
        }
        if self.project.raster_layers.len() > 64 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot supports at most 64 raster layers".to_string(),
            ));
        }
        for layer in &self.project.video_layers {
            if layer.asset_id.trim().is_empty()
                || layer.video_path.trim().is_empty()
                || !layer.x.is_finite()
                || !layer.y.is_finite()
                || !layer.width.is_finite()
                || !layer.height.is_finite()
                || !layer.rotation.is_finite()
                || !layer.opacity.is_finite()
                || layer.width <= 0.0
                || layer.height <= 0.0
            {
                return Err(NativeCoreError::InvalidContract(
                    "ProjectSnapshot contains an invalid video layer".to_string(),
                ));
            }
            if layer.source_time.timescale == 0 {
                return Err(NativeCoreError::InvalidContract(
                    "VideoLayerSnapshot source_time timescale must be non-zero".to_string(),
                ));
            }
            if let Some(color_grade) = layer.color_grade.as_ref() {
                if !color_grade.exposure.is_finite()
                    || !color_grade.contrast.is_finite()
                    || !color_grade.saturation.is_finite()
                    || !color_grade.temperature.is_finite()
                    || !color_grade.tint.is_finite()
                    || !color_grade.brightness.is_finite()
                    || !color_grade.sepia.is_finite()
                    || !color_grade.grayscale.is_finite()
                    || !color_grade.hue_rotate.is_finite()
                    || !color_grade.vignette.is_finite()
                    || !color_grade.invert.is_finite()
                    || !color_grade.grain_intensity.is_finite()
                    || !color_grade.grain_size.is_finite()
                    || !color_grade.lut_intensity.is_finite()
                    || !color_grade.lut_size.is_finite()
                    || !color_grade.blur_strength.is_finite()
                    || !color_grade.blur_radius.is_finite()
                    || !color_grade.pixelate_size.is_finite()
                    || !color_grade.scanline_count.is_finite()
                    || !color_grade.scanline_intensity.is_finite()
                    || !color_grade.rgb_split_x.is_finite()
                    || !color_grade.rgb_split_y.is_finite()
                    || !color_grade.vibrance_amount.is_finite()
                    || !color_grade.vibrance_protected_hue_r.is_finite()
                    || !color_grade.vibrance_protected_hue_g.is_finite()
                    || !color_grade.vibrance_protected_hue_b.is_finite()
                    || !color_grade.lift.is_finite()
                    || !color_grade.cross_process_amount.is_finite()
                    || !color_grade.channel_mix_r.is_finite()
                    || !color_grade.channel_mix_g.is_finite()
                    || !color_grade.channel_mix_b.is_finite()
                    || !color_grade.channel_mix_enabled.is_finite()
                    || !color_grade.duotone_dark_r.is_finite()
                    || !color_grade.duotone_dark_g.is_finite()
                    || !color_grade.duotone_dark_b.is_finite()
                    || !color_grade.duotone_light_r.is_finite()
                    || !color_grade.duotone_light_g.is_finite()
                    || !color_grade.duotone_light_b.is_finite()
                    || !color_grade.duotone_enabled.is_finite()
                    || !color_grade.shadow_tint_r.is_finite()
                    || !color_grade.shadow_tint_g.is_finite()
                    || !color_grade.shadow_tint_b.is_finite()
                    || !color_grade.shadow_tint_strength.is_finite()
                    || !color_grade.highlight_tint_r.is_finite()
                    || !color_grade.highlight_tint_g.is_finite()
                    || !color_grade.highlight_tint_b.is_finite()
                    || !color_grade.highlight_tint_strength.is_finite()
                    || !color_grade.split_balance.is_finite()
                    || !color_grade.glow_color_r.is_finite()
                    || !color_grade.glow_color_g.is_finite()
                    || !color_grade.glow_color_b.is_finite()
                    || !color_grade.glow_strength.is_finite()
                    || !color_grade.glow_radius.is_finite()
                    || !color_grade.flash_color_r.is_finite()
                    || !color_grade.flash_color_g.is_finite()
                    || !color_grade.flash_color_b.is_finite()
                    || !color_grade.flash_strength.is_finite()
                    || !color_grade.flicker_strength.is_finite()
                    || !color_grade.strobe_frequency.is_finite()
                    || !color_grade.strobe_time.is_finite()
                    || !color_grade.strobe_strength.is_finite()
                    || !color_grade.light_leak_color_r.is_finite()
                    || !color_grade.light_leak_color_g.is_finite()
                    || !color_grade.light_leak_color_b.is_finite()
                    || !color_grade.light_leak_strength.is_finite()
                    || !color_grade.light_leak_angle.is_finite()
                    || !color_grade.light_leak_time.is_finite()
                    || !color_grade.glitch_intensity.is_finite()
                    || !color_grade.glitch_time.is_finite()
                    || !color_grade.glitch_slice_count.is_finite()
                    || !color_grade.glitch_color_shift.is_finite()
                    || !color_grade.distortion_type.is_finite()
                    || !color_grade.distortion_strength.is_finite()
                    || !color_grade.distortion_time.is_finite()
                    || !color_grade.distortion_frequency.is_finite()
                    || color_grade.fire_params.iter().any(|value| !value.is_finite())
                    || color_grade.fire_color_1.iter().any(|value| !value.is_finite())
                    || color_grade.fire_color_2.iter().any(|value| !value.is_finite())
                    || color_grade.fire_color_3.iter().any(|value| !value.is_finite())
                    || color_grade.particle_params.iter().any(|value| !value.is_finite())
                    || color_grade.particle_color.iter().any(|value| !value.is_finite())
                    || !color_grade.particle_time.is_finite()
                    || color_grade.contrast < 0.0
                    || color_grade.saturation < 0.0
                    || color_grade.sepia < 0.0
                    || color_grade.sepia > 1.0
                    || color_grade.grayscale < 0.0
                    || color_grade.grayscale > 1.0
                    || color_grade.vignette < 0.0
                    || color_grade.vignette > 1.0
                    || color_grade.invert < 0.0
                    || color_grade.invert > 1.0
                    || color_grade.grain_intensity < 0.0
                    || color_grade.grain_size <= 0.0
                    || color_grade.lut_intensity < 0.0
                    || color_grade.lut_intensity > 1.0
                    || color_grade.lut_size <= 0.0
                    || color_grade.blur_strength < 0.0
                    || color_grade.blur_radius < 0.0
                    || color_grade.pixelate_size < 0.0
                    || color_grade.scanline_count < 0.0
                    || color_grade.scanline_intensity < 0.0
                    || color_grade.scanline_intensity > 1.0
                    || color_grade.rgb_split_x < 0.0
                    || color_grade.rgb_split_y < 0.0
                    || color_grade.vibrance_amount < -1.0
                    || color_grade.vibrance_amount > 1.0
                    || color_grade.vibrance_protected_hue_r < 0.0
                    || color_grade.vibrance_protected_hue_r > 1.0
                    || color_grade.vibrance_protected_hue_g < 0.0
                    || color_grade.vibrance_protected_hue_g > 1.0
                    || color_grade.vibrance_protected_hue_b < 0.0
                    || color_grade.vibrance_protected_hue_b > 1.0
                    || color_grade.lift < -0.5
                    || color_grade.lift > 0.5
                    || color_grade.cross_process_amount < 0.0
                    || color_grade.cross_process_amount > 1.0
                    || color_grade.channel_mix_r < 0.0
                    || color_grade.channel_mix_g < 0.0
                    || color_grade.channel_mix_b < 0.0
                    || color_grade.channel_mix_enabled < 0.0
                    || color_grade.channel_mix_enabled > 1.0
                    || color_grade.duotone_dark_r < 0.0
                    || color_grade.duotone_dark_r > 1.0
                    || color_grade.duotone_dark_g < 0.0
                    || color_grade.duotone_dark_g > 1.0
                    || color_grade.duotone_dark_b < 0.0
                    || color_grade.duotone_dark_b > 1.0
                    || color_grade.duotone_light_r < 0.0
                    || color_grade.duotone_light_r > 1.0
                    || color_grade.duotone_light_g < 0.0
                    || color_grade.duotone_light_g > 1.0
                    || color_grade.duotone_light_b < 0.0
                    || color_grade.duotone_light_b > 1.0
                    || color_grade.duotone_enabled < 0.0
                    || color_grade.duotone_enabled > 1.0
                    || color_grade.shadow_tint_r < 0.0
                    || color_grade.shadow_tint_g < 0.0
                    || color_grade.shadow_tint_b < 0.0
                    || color_grade.shadow_tint_strength < 0.0
                    || color_grade.shadow_tint_strength > 1.0
                    || color_grade.highlight_tint_r < 0.0
                    || color_grade.highlight_tint_g < 0.0
                    || color_grade.highlight_tint_b < 0.0
                    || color_grade.highlight_tint_strength < 0.0
                    || color_grade.highlight_tint_strength > 1.0
                    || color_grade.split_balance < 0.0
                    || color_grade.split_balance > 1.0
                    || color_grade.glow_color_r < 0.0
                    || color_grade.glow_color_r > 1.0
                    || color_grade.glow_color_g < 0.0
                    || color_grade.glow_color_g > 1.0
                    || color_grade.glow_color_b < 0.0
                    || color_grade.glow_color_b > 1.0
                    || color_grade.glow_strength < 0.0
                    || color_grade.glow_strength > 1.0
                    || color_grade.glow_radius < 0.0
                    || color_grade.flash_color_r < 0.0
                    || color_grade.flash_color_r > 1.0
                    || color_grade.flash_color_g < 0.0
                    || color_grade.flash_color_g > 1.0
                    || color_grade.flash_color_b < 0.0
                    || color_grade.flash_color_b > 1.0
                    || color_grade.flash_strength < 0.0
                    || color_grade.flash_strength > 1.0
                    || color_grade.flicker_strength < 0.0
                    || color_grade.flicker_strength > 1.0
                    || color_grade.strobe_frequency < 0.0
                    || color_grade.strobe_time < 0.0
                    || color_grade.strobe_strength < 0.0
                    || color_grade.strobe_strength > 1.0
                    || color_grade.light_leak_color_r < 0.0
                    || color_grade.light_leak_color_r > 1.0
                    || color_grade.light_leak_color_g < 0.0
                    || color_grade.light_leak_color_g > 1.0
                    || color_grade.light_leak_color_b < 0.0
                    || color_grade.light_leak_color_b > 1.0
                    || color_grade.light_leak_strength < 0.0
                    || color_grade.light_leak_strength > 1.0
                    || color_grade.light_leak_time < 0.0
                    || color_grade.glitch_intensity < 0.0
                    || color_grade.glitch_intensity > 1.0
                    || color_grade.glitch_time < 0.0
                    || color_grade.glitch_slice_count < 0.0
                    || color_grade.glitch_color_shift < 0.0
                    || color_grade.distortion_type < 0.0
                    || color_grade.distortion_type > 5.0
                    || color_grade.distortion_strength < 0.0
                    || color_grade.distortion_strength > 1.0
                    || color_grade.distortion_time < 0.0
                    || color_grade.distortion_frequency <= 0.0
                    || color_grade.fire_params[0] < 0.0
                    || color_grade.fire_params[0] > 1.0
                    || color_grade.fire_params[1] < 0.0
                    || color_grade.fire_params[1] > 128.0
                    || color_grade.fire_params[2] < 0.0
                    || color_grade.fire_params[2] > 1.0
                    || color_grade.fire_params[3] < 0.0
                    || color_grade.fire_color_1.iter().any(|value| *value < 0.0 || *value > 1.0)
                    || color_grade.fire_color_2.iter().any(|value| *value < 0.0 || *value > 1.0)
                    || color_grade.fire_color_3.iter().any(|value| *value < 0.0 || *value > 1.0)
                    || color_grade.particle_params[0] < 0.0
                    || color_grade.particle_params[0] > 128.0
                    || color_grade.particle_params[1] < 0.0
                    || color_grade.particle_params[2] < 0.0
                    || color_grade.particle_params[3] < 0.0
                    || color_grade.particle_params[3] > 1.0
                    || color_grade.particle_color[0] < 0.0
                    || color_grade.particle_color[0] > 1.0
                    || color_grade.particle_color[1] < 0.0
                    || color_grade.particle_color[1] > 1.0
                    || color_grade.particle_color[2] < 0.0
                    || color_grade.particle_color[2] > 1.0
                    || color_grade.particle_color[3] < 0.0
                    || color_grade.particle_color[3] > 2.5
                    || color_grade.particle_time < 0.0
                {
                    return Err(NativeCoreError::InvalidContract(
                        "VideoLayerSnapshot contains invalid color-grade data".to_string(),
                    ));
                }
            }
            if let Some(body_effect) = layer.body_effect.as_ref() {
                if body_effect.mask_asset_id.trim().is_empty()
                    || !matches!(body_effect.renderer.as_str(), "body_outline" | "body_glow" | "body_segmentation_glow" | "body_particles")
                    || !body_effect.color_r.is_finite()
                    || !body_effect.color_g.is_finite()
                    || !body_effect.color_b.is_finite()
                    || !body_effect.strength.is_finite()
                    || !body_effect.radius.is_finite()
                    || !body_effect.time.is_finite()
                    || body_effect.color_r < 0.0 || body_effect.color_r > 1.0
                    || body_effect.color_g < 0.0 || body_effect.color_g > 1.0
                    || body_effect.color_b < 0.0 || body_effect.color_b > 1.0
                    || body_effect.strength < 0.0 || body_effect.strength > 1.0
                    || body_effect.radius < 0.0 || body_effect.time < 0.0
                {
                    return Err(NativeCoreError::InvalidContract(
                        "VideoLayerSnapshot contains invalid body-effect data".to_string(),
                    ));
                }
            }
        }
        let mut raster_bytes = 0usize;
        for layer in &self.project.raster_layers {
            let expected_bytes = (layer.width as usize)
                .checked_mul(layer.height as usize)
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or_else(|| {
                    NativeCoreError::InvalidContract(
                        "RasterLayerSnapshot dimensions overflow".to_string(),
                    )
                })?;
            if let Some(rgba) = &layer.rgba {
                raster_bytes = raster_bytes.saturating_add(expected_bytes);
                if rgba.len() != expected_bytes || rgba.len() > 64 * 1024 * 1024 {
                    return Err(NativeCoreError::InvalidContract(
                        "ProjectSnapshot contains an invalid raster payload".to_string(),
                    ));
                }
            }
            if layer.asset_id.trim().is_empty()
                || layer.width == 0
                || layer.height == 0
                || layer.width > 8192
                || layer.height > 8192
                || !layer.x.is_finite()
                || !layer.y.is_finite()
                || !layer.rotation.is_finite()
                || !layer.opacity.is_finite()
            {
                return Err(NativeCoreError::InvalidContract(
                    "ProjectSnapshot contains an invalid raster layer".to_string(),
                ));
            }
        }
        if self.project.text_layers.len() > 64 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot supports at most 64 text layers".to_string(),
            ));
        }
        for layer in &self.project.text_layers {
            if layer.font_id.trim().is_empty()
                || !layer.font_size.is_finite()
                || layer.font_size <= 0.0
                || layer.font_size > 1024.0
                || !layer.x.is_finite()
                || !layer.y.is_finite()
                || !layer.rotation.is_finite()
                || !layer.opacity.is_finite()
                || !layer.letter_spacing.is_finite()
                || !layer.line_height.is_finite()
                || layer.line_height <= 0.0
                || layer.text.len() > 10_000
                || layer.color.iter().any(|c| !c.is_finite() || *c < 0.0 || *c > 1.0)
                || layer.stroke_width.map(|w| !w.is_finite() || w < 0.0).unwrap_or(false)
                || layer.stroke_color.map(|c| c.iter().any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0)).unwrap_or(false)
                || layer.shadow_blur.map(|b| !b.is_finite() || b < 0.0).unwrap_or(false)
                || layer.shadow_color.map(|c| c.iter().any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0)).unwrap_or(false)
                || layer.shadow_offset.map(|o| !o[0].is_finite() || !o[1].is_finite()).unwrap_or(false)
            {
                return Err(NativeCoreError::InvalidContract(
                    "ProjectSnapshot contains an invalid text layer".to_string(),
                ));
            }
            if let Some(effect) = &layer.effect {
                if effect.effect_id.trim().is_empty() || effect.effect_version == 0 {
                    return Err(NativeCoreError::InvalidContract(
                        "Text layer effect requires valid effect_id and non-zero version".to_string(),
                    ));
                }
                for (_, param_val) in &effect.parameter_overrides {
                    let is_finite = match param_val {
                        TextParamValue::Float(f) => f.is_finite(),
                        TextParamValue::Color(c) => c.iter().all(|v| v.is_finite()),
                        TextParamValue::Vec2(v) => v.iter().all(|x| x.is_finite()),
                        TextParamValue::String(_) => true,
                    };
                    if !is_finite {
                        return Err(NativeCoreError::InvalidContract(
                            "Text layer effect parameter override contains non-finite values (NaN/Inf)".to_string(),
                        ));
                    }
                }
            }
        }
        for video_layer in &self.project.video_layers {
            if let Some(body_effect) = video_layer.body_effect.as_ref() {
                if !self.project.raster_layers.iter().any(|mask| mask.is_mask && mask.asset_id == body_effect.mask_asset_id) {
                    return Err(NativeCoreError::InvalidContract(
                        "Body effect references a missing mask asset".to_string(),
                    ));
                }
            }
        }
        if let Some(transition) = self.project.transition.as_ref() {
            let layer_ids: Vec<&str> = if self.project.video_layers.len() == 2 && self.project.raster_layers.is_empty() {
                self.project.video_layers.iter().map(|layer| layer.layer_id.as_str()).collect()
            } else if self.project.video_layers.is_empty() && self.project.raster_layers.len() == 2 {
                self.project.raster_layers.iter().map(|layer| layer.asset_id.as_str()).collect()
            } else {
                Vec::new()
            };
            let supported = matches!(
                transition.transition_type.as_str(),
                "cross-dissolve" | "cross_dissolve" | "crossfade" | "fade" | "fade-through-color" | "directional-wipe" | "directional_wipe" | "wipe" | "wipe-left" | "wipe-right" | "wipe-up" | "wipe-down" | "wipe-diagonal"
                    | "wipe-clockwise" | "circle-wipe" | "diamond-wipe" | "rectangle-wipe"
                    | "slide-left" | "slide-right" | "slide-up" | "slide-down"
                    | "zoom-blur" | "zoom-in" | "zoom-out" | "blur-fade"
                    | "glitch" | "rgb-split" | "chromatic" | "film-burn" | "light-leak" | "whip-pan"
                    | "iris-wipe"
            );
            if layer_ids.len() != 2
                || transition.outgoing_layer.trim().is_empty()
                || transition.incoming_layer.trim().is_empty()
                || transition.outgoing_layer == transition.incoming_layer
                || !layer_ids.iter().any(|id| *id == transition.outgoing_layer)
                || !layer_ids.iter().any(|id| *id == transition.incoming_layer)
                || !transition.progress.is_finite()
                || !transition.feather.is_finite()
                || !transition.intensity.is_finite()
                || !(0.0..=1.0).contains(&transition.progress)
                || !(0.0..=1.0).contains(&transition.feather)
                || transition.intensity < 0.0
                || transition.fade_color.map(|color| color.iter().any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))).unwrap_or(false)
                || !supported
            {
                return Err(NativeCoreError::UnsupportedFeature(
                    "Native transition requires exactly two source layers and a supported transition shader".to_string(),
                ));
            }
        }
        if raster_bytes > 128 * 1024 * 1024 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot raster layers exceed the byte limit".to_string(),
            ));
        }
        Ok(())
    }

    pub fn cache_key(&self) -> Result<String, NativeCoreError> {
        self.validate()?;
        // Request identity controls cancellation/telemetry, not decoded-frame
        // identity. Keep those fields out of the cache key so a new seek
        // generation can reuse an already-rendered exact frame.
        let mut cache_request = self.clone();
        cache_request.request_id.clear();
        cache_request.generation = None;
        cache_request.mode = None;
        cache_request.scrub_velocity_px_per_second = None;
        cache_request.requested_at_ms = None;
        let bytes = serde_json::to_vec(&cache_request).map_err(|error| {
            NativeCoreError::InvalidContract(format!("Unable to serialize FrameRequest: {error}"))
        })?;
        let digest = Sha256::digest(bytes);
        Ok(format!("native-v{}-{:x}", self.contract_version, digest))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePacket {
    pub contract_version: u32,
    pub request_id: String,
    pub frame_time: FrameTime,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub format: PixelFormat,
    #[serde(skip)]
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeCoreError {
    InvalidContract(String),
    Cache(String),
    Cancelled,
    StaleResponse,
    Decode(String),
    Gpu(String),
    UnsupportedFeature(String),
}

impl fmt::Display for NativeCoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidContract(message) => write!(f, "Invalid native core contract: {message}"),
            Self::Cache(message) => write!(f, "Native frame cache error: {message}"),
            Self::Cancelled => write!(f, "Native operation cancelled"),
            Self::StaleResponse => write!(f, "Native response is stale"),
            Self::Decode(message) => write!(f, "Native decode error: {message}"),
            Self::Gpu(message) => write!(f, "Native GPU error: {message}"),
            Self::UnsupportedFeature(message) => write!(f, "Unsupported native feature: {message}"),
        }
    }
}

impl std::error::Error for NativeCoreError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> FrameRequest {
        FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "request-1".to_string(),
            frame_time: FrameTime::new(12, 400_000, DEFAULT_TIME_SCALE).unwrap(),
            project: ProjectSnapshot {
                schema_version: 1,
                project_revision: "project-rev-1".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                transition: None,
                video_layers: vec![VideoLayerSnapshot {
                    layer_id: "layer-1".to_string(),
                    asset_id: "asset-1".to_string(),
                    video_path: "/tmp/video.mp4".to_string(),
                    source_time: FrameTime::new(12, 400_000, DEFAULT_TIME_SCALE).unwrap(),
                    x: 0.0,
                    y: 0.0,
                    width: 1920.0,
                    height: 1080.0,
                    rotation: 0.0,
                    opacity: 1.0,
                    z_index: 0,
                    blend_mode: "normal".to_string(),
                    color_grade: None,
                    body_effect: None,
                }],
                raster_layers: vec![],
                text_layers: vec![],
            },
            output_width: 1920,
            output_height: 1080,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
        }
    }

    #[test]
    fn frame_time_rejects_zero_timescale() {
        assert!(FrameTime::new(0, 0, 0).is_err());
    }

    #[test]
    fn request_cache_key_changes_with_frame_and_policy() {
        let first = request();
        let first_key = first.cache_key().unwrap();
        let mut second = first.clone();
        second.frame_time.frame_index += 1;
        assert_ne!(first_key, second.cache_key().unwrap());

        let mut third = first;
        third.color_policy.version += 1;
        assert_ne!(first_key, third.cache_key().unwrap());
    }

    #[test]
    fn request_cache_key_ignores_seek_generation_metadata() {
        let mut first = request();
        first.generation = Some(1);
        first.mode = Some("scrub".to_string());
        first.scrub_velocity_px_per_second = Some(2_000.0);
        let mut second = first.clone();
        second.generation = Some(2);
        second.mode = Some("seek".to_string());
        second.scrub_velocity_px_per_second = Some(0.0);

        assert_eq!(first.cache_key().unwrap(), second.cache_key().unwrap());
    }

    #[test]
    fn request_validation_rejects_unknown_seek_modes() {
        let mut invalid = request();
        invalid.mode = Some("unknown".to_string());
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn request_validation_rejects_unknown_contract_versions() {
        let mut value = request();
        value.contract_version += 1;
        assert!(value.validate().is_err());
    }

    #[test]
    fn registered_raster_reference_can_omit_pixel_payload() {
        let mut value = request();
        value.project.raster_layers = vec![RasterLayerSnapshot {
            asset_id: "native-text:title:abcd1234".to_string(),
            rgba: None,
            width: 64,
            height: 32,
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 1,
            blend_mode: "normal".to_string(),
            color_grade: None,
            is_mask: false,
            is_text: false,
        }];

        value
            .validate()
            .expect("registered raster references should validate without bytes");
    }

    #[test]
    fn request_validation_enforces_video_and_raster_layer_caps() {
        let mut video_at_limit = request();
        let video_layer = video_at_limit.project.video_layers[0].clone();
        video_at_limit.project.video_layers = vec![video_layer; 256];
        assert!(video_at_limit.validate().is_ok());
        video_at_limit.project.video_layers.push(video_at_limit.project.video_layers[0].clone());
        assert!(video_at_limit
            .validate()
            .unwrap_err()
            .to_string()
            .contains("at most 256 video layers"));

        let mut raster_at_limit = request();
        let raster_layer = RasterLayerSnapshot {
            asset_id: "native-raster".to_string(),
            rgba: None,
            width: 64,
            height: 32,
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 1,
            blend_mode: "normal".to_string(),
            color_grade: None,
            is_mask: false,
            is_text: false,
        };
        raster_at_limit.project.raster_layers = vec![raster_layer; 64];
        assert!(raster_at_limit.validate().is_ok());
        raster_at_limit.project.raster_layers.push(raster_at_limit.project.raster_layers[0].clone());
        assert!(raster_at_limit
            .validate()
            .unwrap_err()
            .to_string()
            .contains("at most 64 raster layers"));
    }

    #[test]
    fn raster_transition_accepts_two_native_source_layers() {
        let mut value = request();
        value.project.video_layers.clear();
        value.project.raster_layers = vec![
            RasterLayerSnapshot {
                asset_id: "clip-a".to_string(),
                rgba: None,
                width: 64,
                height: 32,
                x: 0.0,
                y: 0.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                color_grade: None,
                is_mask: false,
                is_text: false,
            },
            RasterLayerSnapshot {
                asset_id: "clip-b".to_string(),
                rgba: None,
                width: 64,
                height: 32,
                x: 0.0,
                y: 0.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 1,
                blend_mode: "normal".to_string(),
                color_grade: None,
                is_mask: false,
                is_text: false,
            },
        ];
        value.project.transition = Some(TransitionSnapshot {
            outgoing_layer: "clip-a".to_string(),
            incoming_layer: "clip-b".to_string(),
            transition_type: "cross-dissolve".to_string(),
            progress: 0.5,
            feather: 0.1,
            intensity: 1.0,
            fade_color: None,
        });

        value
            .validate()
            .expect("two raster layers should be valid transition sources");
    }

    #[test]
    fn text_layers_validation_rejects_nan_and_enforces_caps() {
        let mut value = request();
        let valid_text_layer = TextLayerSnapshot {
            text: "Hello Clypra".to_string(),
            font_id: "inter".to_string(),
            font_size: 48.0,
            letter_spacing: 0.0,
            line_height: 1.2,
            color: [1.0, 1.0, 1.0, 1.0],
            text_align: "left".to_string(),
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
            stroke_color: None,
            stroke_width: None,
            shadow_color: None,
            shadow_offset: None,
            shadow_blur: None,
            effect: Some(TextEffectInstance {
                effect_id: "neon-glow".to_string(),
                effect_version: 1,
                parameter_overrides: {
                    let mut m = HashMap::new();
                    m.insert("radius".to_string(), TextParamValue::Float(0.3));
                    m
                },
            }),
        };

        // Valid layer passes
        value.project.text_layers = vec![valid_text_layer.clone()];
        assert!(value.validate().is_ok());

        // NaN parameter override is rejected
        let mut nan_layer = valid_text_layer.clone();
        nan_layer.effect.as_mut().unwrap().parameter_overrides.insert(
            "radius".to_string(),
            TextParamValue::Float(f32::NAN),
        );
        value.project.text_layers = vec![nan_layer];
        assert!(value
            .validate()
            .unwrap_err()
            .to_string()
            .contains("parameter override contains non-finite"));

        // More than 64 text layers rejected
        value.project.text_layers = (0..65).map(|_| valid_text_layer.clone()).collect();
        assert!(value
            .validate()
            .unwrap_err()
            .to_string()
            .contains("at most 64 text layers"));
    }
}
