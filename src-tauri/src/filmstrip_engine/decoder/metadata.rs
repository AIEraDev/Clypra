use crate::native_core::QualityTier;
use ffmpeg_next as ffmpeg;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

pub const MAX_RAW_NV12_CACHE_ENTRIES: usize = 16;

#[derive(Clone)]
pub struct CachedNv12Frame {
    pub pts: i64,
    pub y_plane: Arc<[u8]>,
    pub uv_plane: Arc<[u8]>,
    pub width: u32,
    pub height: u32,
    pub color: VideoColorMetadata,
    /// Decode scale is part of the frame identity. A proxy frame must never
    /// satisfy a full-quality paused render (or vice versa).
    pub quality: QualityTier,
    pub is_approximate: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeFrameOptions {
    pub allow_keyframe_approx: bool,
    pub quality: QualityTier,
    pub is_playback: bool,
    pub skip_hw_download: bool,
    pub target_dimensions: Option<(u32, u32)>,
}


/// Explicit color metadata carried from FFmpeg into the native render path.
///
/// The normalized labels are convenient for renderer decisions while the raw
/// FFmpeg codes preserve information for values not yet handled by the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoColorMetadata {
    pub range: String,
    pub range_code: u32,
    pub matrix: String,
    pub matrix_code: u32,
    pub primaries: String,
    pub primaries_code: u32,
    pub transfer: String,
    pub transfer_code: u32,
    pub chroma_location: String,
    pub chroma_location_code: u32,
}

impl Default for VideoColorMetadata {
    fn default() -> Self {
        Self {
            range: "unspecified".to_string(),
            range_code: ffmpeg::ffi::AVColorRange::AVCOL_RANGE_UNSPECIFIED as u32,
            matrix: "unspecified".to_string(),
            matrix_code: ffmpeg::ffi::AVColorSpace::AVCOL_SPC_UNSPECIFIED as u32,
            primaries: "unspecified".to_string(),
            primaries_code: ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_UNSPECIFIED as u32,
            transfer: "unspecified".to_string(),
            transfer_code: ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_UNSPECIFIED as u32,
            chroma_location: "unspecified".to_string(),
            chroma_location_code: ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_UNSPECIFIED as u32,
        }
    }
}

/// Stream-level metadata used to configure deterministic frame decoding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamMetadata {
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub time_base_num: i32,
    pub time_base_den: i32,
    pub nominal_frame_rate_num: i32,
    pub nominal_frame_rate_den: i32,
    pub average_frame_rate_num: i32,
    pub average_frame_rate_den: i32,
    pub pixel_format_code: i32,
    pub bits_per_raw_sample: u8,
    pub sample_aspect_ratio_num: i32,
    pub sample_aspect_ratio_den: i32,
    pub rotation: u32,
    pub color: VideoColorMetadata,
    #[serde(default)]
    pub container_format: String,
    #[serde(default)]
    pub codec_name: String,
    #[serde(default)]
    pub is_hardware_accelerated: bool,
}

impl VideoStreamMetadata {
    pub fn average_frame_rate_milli(&self) -> Option<u32> {
        let (num, den) = if self.average_frame_rate_num > 0 && self.average_frame_rate_den > 0 {
            (self.average_frame_rate_num, self.average_frame_rate_den)
        } else if self.nominal_frame_rate_num > 0 && self.nominal_frame_rate_den > 0 {
            (self.nominal_frame_rate_num, self.nominal_frame_rate_den)
        } else {
            return None;
        };
        Some(((i64::from(num) * 1_000) / i64::from(den)).clamp(0, i64::from(u32::MAX)) as u32)
    }
}

/// Metadata for one decoded frame, including the timestamp selected by the
/// decoder and the actual pixel format produced by the active backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedFrameMetadata {
    pub pts: Option<i64>,
    pub best_effort_pts: Option<i64>,
    pub pts_seconds: Option<f64>,
    pub width: u32,
    pub height: u32,
    pub pixel_format: String,
    pub linesize_y: i32,
    pub linesize_uv: i32,
    pub sample_aspect_ratio_num: i32,
    pub sample_aspect_ratio_den: i32,
    pub color: VideoColorMetadata,
}

/// One full-resolution frame produced by the batch filmstrip decoder.
///
/// Timing metadata is internal to the native pipeline and is consumed by the
/// thumbnail command when populating per-tier metrics. It is not serialized to
/// the frontend artifact.
#[derive(Debug)]
pub struct BatchDecodedFrame {
    pub target_ts_secs: f64,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub convert_elapsed: Duration,
    pub conversion_fast_path: bool,
}

#[derive(Debug)]
pub struct BatchDecodeResult {
    pub frames: Vec<BatchDecodedFrame>,
    pub seek_elapsed: Duration,
    pub decode_elapsed: Duration,
}

pub(crate) fn color_metadata(
    range: ffmpeg::ffi::AVColorRange,
    matrix: ffmpeg::ffi::AVColorSpace,
    primaries: ffmpeg::ffi::AVColorPrimaries,
    transfer: ffmpeg::ffi::AVColorTransferCharacteristic,
    chroma_location: ffmpeg::ffi::AVChromaLocation,
) -> VideoColorMetadata {
    VideoColorMetadata {
        range: match range {
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_MPEG => "limited",
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_JPEG => "full",
            _ => "unspecified",
        }
        .to_string(),
        range_code: range as u32,
        matrix: match matrix {
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT709 => "bt709",
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT470BG => "bt601_625",
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_SMPTE170M => "bt601_525",
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT2020_NCL => "bt2020_ncl",
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT2020_CL => "bt2020_cl",
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_RGB => "rgb",
            _ => "unspecified",
        }
        .to_string(),
        matrix_code: matrix as u32,
        primaries: match primaries {
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT709 => "bt709",
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT470BG => "bt601_625",
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_SMPTE170M => "bt601_525",
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT2020 => "bt2020",
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_SMPTE432 => "display_p3",
            _ => "unspecified",
        }
        .to_string(),
        primaries_code: primaries as u32,
        transfer: match transfer {
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_BT709 => "bt709",
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_IEC61966_2_1 => "srgb",
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_BT2020_10 => "bt2020_10",
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_BT2020_12 => "bt2020_12",
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_SMPTE2084 => "pq",
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_ARIB_STD_B67 => "hlg",
            _ => "unspecified",
        }
        .to_string(),
        transfer_code: transfer as u32,
        chroma_location: match chroma_location {
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_LEFT => "left",
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_CENTER => "center",
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_TOPLEFT => "top_left",
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_TOP => "top",
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_BOTTOMLEFT => "bottom_left",
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_BOTTOM => "bottom",
            _ => "unspecified",
        }
        .to_string(),
        chroma_location_code: chroma_location as u32,
    }
}

/// The native preview shader consumes NV12, not packed RGB. FFmpeg can report
/// `matrix=rgb` for still-image streams even after swscale has converted the
/// decoded frame into NV12. Carrying that source metadata past the conversion
/// boundary makes the compositor reject an otherwise valid image frame.
///
/// Normalize the metadata to the explicit SDR contract used by the converted
/// NV12 payload. This is deliberately done at the decoder boundary so preview,
/// playback, and export receive the same payload/metadata pair.
pub(crate) fn normalize_converted_nv12_color(mut color: VideoColorMetadata) -> VideoColorMetadata {
    if color.matrix == "rgb" {
        color.matrix = "bt709".to_string();
        color.matrix_code = ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT709 as u32;

        if color.transfer == "unspecified" {
            color.transfer = "srgb".to_string();
            color.transfer_code =
                ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_IEC61966_2_1 as u32;
        }
        if color.primaries == "unspecified" {
            color.primaries = "bt709".to_string();
            color.primaries_code = ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT709 as u32;
        }
        if color.range == "unspecified" {
            color.range = "full".to_string();
            color.range_code = ffmpeg::ffi::AVColorRange::AVCOL_RANGE_JPEG as u32;
        }
    }
    color
}

pub(crate) fn pixel_format_name(frame: &ffmpeg::frame::Video) -> String {
    frame
        .format()
        .descriptor()
        .map(|descriptor| descriptor.name().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}
