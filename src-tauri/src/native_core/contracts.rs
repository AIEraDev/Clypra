use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
}

fn default_color_grade_multiplier() -> f32 { 1.0 }
fn default_color_grade_grain_size() -> f32 { 1.0 }
fn default_color_grade_lut_intensity() -> f32 { 1.0 }
fn default_color_grade_lut_size() -> f32 { 33.0 }
fn default_vibrance_protected_hue_r() -> f32 { 0.91 }
fn default_vibrance_protected_hue_g() -> f32 { 0.69 }
fn default_vibrance_protected_hue_b() -> f32 { 0.55 }

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub schema_version: u32,
    pub project_revision: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub clear_color: [f32; 4],
    pub video_layers: Vec<VideoLayerSnapshot>,
    #[serde(default)]
    pub raster_layers: Vec<RasterLayerSnapshot>,
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
                {
                    return Err(NativeCoreError::InvalidContract(
                        "VideoLayerSnapshot contains invalid color-grade data".to_string(),
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
        if raster_bytes > 128 * 1024 * 1024 {
            return Err(NativeCoreError::InvalidContract(
                "ProjectSnapshot raster layers exceed the byte limit".to_string(),
            ));
        }
        Ok(())
    }

    pub fn cache_key(&self) -> Result<String, NativeCoreError> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|error| {
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
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: vec![VideoLayerSnapshot {
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
                }],
                raster_layers: vec![],
            },
            output_width: 1920,
            output_height: 1080,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
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
        }];

        value
            .validate()
            .expect("registered raster references should validate without bytes");
    }
}
