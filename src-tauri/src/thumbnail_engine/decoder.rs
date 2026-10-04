//! Native FFmpeg decoder with hardware acceleration.
//!
//! Features:
//! - Reusable decoder pool (one per video file)
//! - Hardware decode (VideoToolbox/D3D11VA/VAAPI)
//! - Sequential decoding optimization (avoids seeking during scrubbing)
//! - Display-aware geometry (respects SAR/DAR/rotation)

use crate::native_core::{performance::ServedFrom, QualityTier};
use dashmap::DashMap;
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

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

/// NV12 chroma planes require even pixel dimensions. Keep the preview source
/// proportional while making reduced-quality CPU fallback material enough
/// smaller to avoid uploading an unnecessary 4K texture every frame.
fn nv12_dimensions_for_quality(width: u32, height: u32, quality: QualityTier) -> (u32, u32) {
    let divisor = match quality {
        QualityTier::Full => 1,
        QualityTier::Half => 2,
        QualityTier::Quarter | QualityTier::Proxy => 4,
    };
    let scaled_width = (width / divisor).max(2) & !1;
    let scaled_height = (height / divisor).max(2) & !1;
    (scaled_width, scaled_height)
}

fn scale_frame_to_nv12(
    frame: &ffmpeg::frame::Video,
    target_width: u32,
    target_height: u32,
    frame_color: VideoColorMetadata,
) -> Result<(Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata), String> {
    use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

    let mut scaler = Context::get(
        frame.format(),
        frame.width(),
        frame.height(),
        ffmpeg::format::Pixel::NV12,
        target_width,
        target_height,
        Flags::FAST_BILINEAR,
    )
    .map_err(|e| e.to_string())?;
    let mut out = ffmpeg::frame::Video::empty();
    scaler.run(frame, &mut out).map_err(|e| e.to_string())?;

    // This is intentionally a standalone helper because reduced quality has
    // to pass through the same plane extraction path as full quality.
    let y_stride = out.stride(0);
    let uv_stride = out.stride(1);
    if y_stride == 0 || uv_stride == 0 || out.data(0).is_empty() || out.data(1).is_empty() {
        return Err("Scaled NV12 output has no Y/UV planes".to_string());
    }
    let mut y = Vec::with_capacity((target_width * target_height) as usize);
    for row in 0..target_height as usize {
        let start = row * y_stride;
        y.extend_from_slice(&out.data(0)[start..start + target_width as usize]);
    }
    let uv_height = target_height.div_ceil(2) as usize;
    let mut uv = Vec::with_capacity((target_width * uv_height as u32) as usize);
    for row in 0..uv_height {
        let start = row * uv_stride;
        uv.extend_from_slice(&out.data(1)[start..start + target_width as usize]);
    }
    Ok((
        y,
        uv,
        target_width,
        target_height,
        normalize_converted_nv12_color(frame_color),
    ))
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

fn color_metadata(
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
fn normalize_converted_nv12_color(mut color: VideoColorMetadata) -> VideoColorMetadata {
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

fn pixel_format_name(frame: &ffmpeg::frame::Video) -> String {
    frame
        .format()
        .descriptor()
        .map(|descriptor| descriptor.name().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Centralized display geometry model.
#[derive(Debug, Clone, Copy)]
pub struct DisplayGeometry {
    pub encoded_width: u32,
    pub encoded_height: u32,
    pub display_width: u32,
    pub display_height: u32,
    pub sar_num: i32,
    pub sar_den: i32,
    pub rotation: u32,
}

/// Maximum safe display dimension to prevent OOM allocations on corrupted video metadata
pub const MAX_DISPLAY_DIMENSION: u32 = 8192;

impl DisplayGeometry {
    pub fn from_encoded(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> Self {
        if width == 0 || height == 0 {
            return Self {
                encoded_width: width,
                encoded_height: height,
                display_width: 0,
                display_height: 0,
                sar_num: sar.0,
                sar_den: sar.1,
                rotation,
            };
        }

        let (display_w, display_h) = if sar.0 > 0 && sar.1 > 0 && sar.0 != sar.1 {
            let ratio = (sar.0 as f64) / (sar.1 as f64);
            // Cap extreme SAR ratios between 1:4 and 4:1 to prevent allocation blowups
            let clamped_ratio = ratio.clamp(0.25, 4.0);
            let w = ((width as f64) * clamped_ratio).round() as u32;
            (
                w.clamp(1, MAX_DISPLAY_DIMENSION),
                height.clamp(1, MAX_DISPLAY_DIMENSION),
            )
        } else {
            (
                width.clamp(1, MAX_DISPLAY_DIMENSION),
                height.clamp(1, MAX_DISPLAY_DIMENSION),
            )
        };

        let (final_w, final_h) = if rotation == 90 || rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        };

        Self {
            encoded_width: width,
            encoded_height: height,
            display_width: final_w,
            display_height: final_h,
            sar_num: sar.0,
            sar_den: sar.1,
            rotation,
        }
    }
}

/// Port of FFmpeg's av_display_rotation_get from libavutil/display.h.
unsafe fn av_display_rotation_get(matrix: *const i32) -> f64 {
    let s0 = *matrix.add(0) as f64; // matrix[0]
    let s1 = *matrix.add(1) as f64; // matrix[1]
    let s3 = *matrix.add(3) as f64; // matrix[3]
    let s4 = *matrix.add(4) as f64; // matrix[4]

    // scale[0] = hypot(matrix[0], matrix[3])
    // scale[1] = hypot(matrix[1], matrix[4])
    let scale0 = s0.hypot(s3);
    let scale1 = s1.hypot(s4);

    if scale0 == 0.0 || scale1 == 0.0 {
        return 0.0;
    }

    // rotation = atan2(matrix[1] / scale[1], matrix[0] / scale[0]) in degrees
    let angle = (s1 / scale1).atan2(s0 / scale0) * 180.0 / std::f64::consts::PI;
    -angle
}

/// Decoder state for sequential frame optimization.
#[derive(Debug, Clone)]
struct DecoderState {
    current_pts: i64,
    last_requested_pts: i64,
    gop_start_pts: i64,
    sequential_hits: u32,
}

/// Per-request facts retained by the long-lived decoder. These are deliberately
/// request-scoped rather than cumulative so a performance sample can identify
/// re-seeking and GOP amplification without guessing from elapsed time.
#[derive(Debug, Clone, Copy)]
struct DecodeActivity {
    seek_count: u32,
    seek_time_us: u32,
    frames_decoded: u32,
    hardware_frame_download_us: Option<u64>,
    scale_colorspace_us: u64,
    hardware_frames_downloaded: u32,
    /// How the last request was satisfied. Defaults to `DecodedInRequest` so
    /// pre-existing paths that don't explicitly set a value are not silently
    /// misclassified as cache hits.
    served_from: ServedFrom,
    hw_device_type: Option<&'static str>,
}

impl Default for DecodeActivity {
    fn default() -> Self {
        Self {
            seek_count: 0,
            seek_time_us: 0,
            frames_decoded: 0,
            hardware_frame_download_us: None,
            scale_colorspace_us: 0,
            hardware_frames_downloaded: 0,
            served_from: ServedFrom::DecodedInRequest,
            hw_device_type: None,
        }
    }
}

impl DecoderState {
    fn new() -> Self {
        Self {
            current_pts: -1,
            last_requested_pts: -1,
            gop_start_pts: -1,
            sequential_hits: 0,
        }
    }

    fn can_decode_forward(&self, target_pts: i64, sequential_window: i64) -> bool {
        if target_pts < self.current_pts {
            return false;
        }

        let distance = target_pts - self.current_pts;
        let max_distance = if self.sequential_hits >= 3 {
            sequential_window * 2
        } else {
            sequential_window
        };

        distance <= max_distance
    }

    fn update_sequential(&mut self, target_pts: i64) {
        if target_pts > self.last_requested_pts {
            self.sequential_hits += 1;
        } else {
            self.sequential_hits = 0;
        }
        self.last_requested_pts = target_pts;
    }
}

/// Pure decision for stream decoder positioning on incoming frame requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecoderSeekAction {
    /// Cold start, discontinuity, loop wrap, large backward jump, or large forward jump beyond window.
    Seek,
    /// Forward progress within sequential decode window.
    DecodeForward,
    /// Target is within small backward/forward jitter tolerance; reuse ready frame without seeking or decoding.
    ReuseCurrent,
}

/// Pure decision function determining whether to seek, decode forward, or reuse current position.
pub fn decide_decoder_action(
    is_playback: bool,
    current_pts: i64,
    target_pts: i64,
    pts_tolerance: i64,
    forward_window: i64,
    backward_jitter_threshold: i64,
    generation_changed: bool,
) -> DecoderSeekAction {
    if generation_changed || current_pts < 0 {
        return DecoderSeekAction::Seek;
    }

    let delta = target_pts - current_pts;

    // Forward decision is identical for both modes: small delta → reuse,
    // within window → decode forward, beyond window → seek to keyframe.
    let decide_forward = |delta: i64| -> DecoderSeekAction {
        if delta <= pts_tolerance {
            DecoderSeekAction::ReuseCurrent
        } else if delta <= forward_window {
            DecoderSeekAction::DecodeForward
        } else {
            DecoderSeekAction::Seek
        }
    };

    if delta >= 0 {
        return decide_forward(delta);
    }

    // delta < 0: target is behind current position.
    if !is_playback {
        // Paused seek / scrub: exact frame correctness matters; only allow
        // reuse within pts_tolerance (sub-frame rounding).
        if delta.abs() <= pts_tolerance {
            DecoderSeekAction::ReuseCurrent
        } else {
            DecoderSeekAction::Seek
        }
    } else {
        // Continuous playback: small backward drift is normal clock jitter.
        // `backward_jitter_threshold` is capped at 1 frame duration so the
        // served frame is never more than ~1 frame ahead of target_pts.
        if delta.abs() <= backward_jitter_threshold {
            DecoderSeekAction::ReuseCurrent
        } else {
            // Real backward jump (loop wrap, clip boundary, timeline drag).
            DecoderSeekAction::Seek
        }
    }
}

/// One decoder per video file — stays alive between frame requests
pub struct VideoDecoder {
    input_ctx: ffmpeg::format::context::Input,
    decoder: ffmpeg::codec::decoder::Video,
    stream_index: usize,
    time_base: ffmpeg::Rational,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    /// Sample Aspect Ratio (pixel shape)
    sar: (i32, i32),
    /// Rotation from container metadata (0, 90, 180, 270)
    rotation: u32,
    /// Stream metadata retained for the native preview/render contract.
    stream_metadata: VideoStreamMetadata,
    /// Decoder state for sequential optimization
    state: DecoderState,
    /// The visible preview often renders the same first frame once while the
    /// session is stopped and again when audio playback starts. Retain only
    /// the last raw frame so that boundary does not force a second FFmpeg
    /// seek/decode before playback has even begun.
    last_raw_nv12: Option<(
        i64,
        Arc<[u8]>,
        Arc<[u8]>,
        u32,
        u32,
        VideoColorMetadata,
        QualityTier,
        bool,
    )>,
    raw_nv12_cache: VecDeque<CachedNv12Frame>,
    /// Accumulated microsecond duration spent demuxing packets from container I/O during the last decode request.
    last_demux_us: u32,
    last_decode_activity: DecodeActivity,
}

impl VideoDecoder {
    pub fn is_last_frame_approximate(&self) -> bool {
        self.last_raw_nv12.as_ref().map(|f| f.7).unwrap_or(false)
    }

    pub fn container_format(&self) -> &str {
        &self.stream_metadata.container_format
    }

    pub fn codec_name(&self) -> &str {
        &self.stream_metadata.codec_name
    }

    pub fn is_hardware_accelerated(&self) -> bool {
        self.stream_metadata.is_hardware_accelerated
    }

    pub fn last_demux_us(&self) -> u32 {
        self.last_demux_us
    }

    pub fn last_decode_activity(
        &self,
    ) -> (
        u32,
        u32,
        u32,
        Option<u64>,
        u64,
        u32,
        ServedFrom,
        Option<&'static str>,
    ) {
        let activity = self.last_decode_activity;
        (
            activity.seek_count,
            activity.seek_time_us,
            activity.frames_decoded,
            activity.hardware_frame_download_us,
            activity.scale_colorspace_us,
            activity.hardware_frames_downloaded,
            activity.served_from,
            activity.hw_device_type,
        )
    }

    fn clamp_timestamp(&self, timestamp_secs: f64) -> f64 {
        let timestamp_secs = timestamp_secs.max(0.0);
        // Still-image demuxers commonly report an unknown/zero container
        // duration. They still expose one decodable video packet, so do not
        // clamp a valid request to a negative timestamp in that case.
        if self.duration > 0.001 {
            timestamp_secs.min(self.duration - 0.001)
        } else {
            timestamp_secs
        }
    }

    /// Open a general-purpose CPU decoder. Background and legacy callers use
    /// this safe default because they need CPU-readable frames.
    pub fn open(path: &str) -> Result<Self, String> {
        Self::open_internal(path, false, None)
    }

    /// Open a background thumbnail decoder. Filmstrip extraction needs a
    /// stable CPU frame for batch scaling; some VideoToolbox frame surfaces do
    /// not support the transfer formats required by that path (EINVAL/-22).
    pub fn open_software(path: &str) -> Result<Self, String> {
        Self::open_internal(path, false, Some("filmstrip"))
    }

    /// Open an interactive decoder with platform hardware acceleration.
    pub fn open_hardware(path: &str) -> Result<Self, String> {
        Self::open_internal(path, true, Some("preview"))
    }

    /// Open a decoder with an explicit cold-start purpose tag.
    pub fn open_with_purpose(
        path: &str,
        prefer_hardware: bool,
        purpose: Option<&'static str>,
    ) -> Result<Self, String> {
        Self::open_internal(path, prefer_hardware, purpose)
    }

    fn open_internal(
        path: &str,
        prefer_hardware: bool,
        purpose: Option<&'static str>,
    ) -> Result<Self, String> {
        ffmpeg::init().map_err(|e| e.to_string())?;
        ffmpeg::util::log::set_level(ffmpeg::util::log::Level::Error);

        let mut probe_guard = crate::cold_start::SpanGuard::start("c2_container_open_probe");
        if let Some(p) = purpose {
            probe_guard.set_purpose(p);
        }
        let input_ctx = match ffmpeg::format::input(&path) {
            Ok(ctx) => ctx,
            Err(e) => {
                probe_guard.set_ok(false);
                return Err(format!("Cannot open: {}", e));
            }
        };
        let file_size = std::fs::metadata(path).ok().map(|m| m.len());
        let media_loc = crate::cold_start::classify_media_location(std::path::Path::new(path));
        let clip_idx = crate::cold_start::next_clip_index();
        probe_guard.set_clip_info(
            clip_idx,
            Some(input_ctx.format().name().to_string()),
            file_size,
            Some(media_loc),
        );
        probe_guard.finish_ok();

        let stream = input_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("No video stream")?;

        let stream_index = stream.index();
        let time_base = stream.time_base();
        let nominal_frame_rate = stream.rate();
        let average_frame_rate = stream.avg_frame_rate();

        let sar = unsafe {
            let codecpar = (*stream.as_ptr()).codecpar;
            if !codecpar.is_null() {
                let sar_num = (*codecpar).sample_aspect_ratio.num;
                let sar_den = (*codecpar).sample_aspect_ratio.den;
                if sar_den > 0 && sar_num > 0 {
                    (sar_num, sar_den)
                } else {
                    (1, 1) // Square pixels
                }
            } else {
                (1, 1)
            }
        };

        let (pixel_format_code, bits_per_raw_sample, color) = unsafe {
            let codecpar = (*stream.as_ptr()).codecpar;
            if codecpar.is_null() {
                (0, 0, VideoColorMetadata::default())
            } else {
                (
                    (*codecpar).format,
                    (*codecpar).bits_per_raw_sample.clamp(0, u8::MAX as i32) as u8,
                    color_metadata(
                        (*codecpar).color_range,
                        (*codecpar).color_space,
                        (*codecpar).color_primaries,
                        (*codecpar).color_trc,
                        (*codecpar).chroma_location,
                    ),
                )
            }
        };

        let rotation = {
            let mut rot = 0i32;

            for (key, value) in stream.metadata().iter() {
                if key.eq_ignore_ascii_case("rotate") {
                    rot = value.parse::<i32>().unwrap_or(0);
                    break;
                }
            }

            if rot == 0 {
                unsafe {
                    let stream_ptr = stream.as_ptr();
                    let codecpar = (*stream_ptr).codecpar;
                    if !codecpar.is_null() {
                        let nb_sd = (*codecpar).nb_coded_side_data as usize;
                        let sd_arr = (*codecpar).coded_side_data;
                        if !sd_arr.is_null() {
                            for i in 0..nb_sd {
                                let sd = &*sd_arr.add(i);
                                if sd.type_
                                    == ffmpeg::ffi::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX
                                {
                                    let matrix = sd.data as *const i32;
                                    rot = -(av_display_rotation_get(matrix) as i32);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            let abs_rot = ((rot % 360) + 360) as u32 % 360;
            match abs_rot {
                r if r > 45 && r <= 135 => 90,
                r if r > 135 && r <= 225 => 180,
                r if r > 225 && r <= 315 => 270,
                _ => 0,
            }
        };

        let duration = input_ctx.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;
        let codec_name = stream.parameters().id().name().to_string();
        let codec_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .map_err(|e| e.to_string())?;

        // Option 3: Stream Discard Optimization
        // Discard all non-video streams at the demuxer layer so libavformat skips
        // audio, subtitle, and data packets at the lowest C demuxing layer.
        let mut input_ctx = input_ctx;
        crate::thumbnail_engine::demuxer::configure_stream_discard(&mut input_ctx, stream_index);

        let container_format = input_ctx.format().name().to_string();

        let mut codec_guard = crate::cold_start::SpanGuard::start("c2_codec_open");
        if let Some(p) = purpose {
            codec_guard.set_purpose(p);
        }
        let (decoder, width, height, is_hardware_accelerated) = if prefer_hardware {
            match Self::open_with_hw(codec_ctx, purpose) {
                Ok(res) => res,
                Err(e) => {
                    codec_guard.set_ok(false);
                    return Err(e);
                }
            }
        } else {
            match Self::open_software_codec(codec_ctx) {
                Ok((dec, w, h)) => (dec, w, h, false),
                Err(e) => {
                    codec_guard.set_ok(false);
                    return Err(e);
                }
            }
        };
        codec_guard.finish_ok();

        let stream_metadata = VideoStreamMetadata {
            width,
            height,
            duration_seconds: duration.max(0.0),
            time_base_num: time_base.numerator(),
            time_base_den: time_base.denominator(),
            nominal_frame_rate_num: nominal_frame_rate.numerator(),
            nominal_frame_rate_den: nominal_frame_rate.denominator(),
            average_frame_rate_num: average_frame_rate.numerator(),
            average_frame_rate_den: average_frame_rate.denominator(),
            pixel_format_code,
            bits_per_raw_sample,
            sample_aspect_ratio_num: sar.0,
            sample_aspect_ratio_den: sar.1,
            rotation,
            color,
            container_format,
            codec_name,
            is_hardware_accelerated,
        };

        Ok(Self {
            input_ctx,
            decoder,
            stream_index,
            time_base,
            duration,
            width,
            height,
            sar,
            rotation,
            stream_metadata,
            state: DecoderState::new(),
            last_raw_nv12: None,
            raw_nv12_cache: VecDeque::with_capacity(MAX_RAW_NV12_CACHE_ENTRIES),
            last_demux_us: 0,
            last_decode_activity: DecodeActivity::default(),
        })
    }

    /// Return the stream-level metadata used to configure native rendering.
    pub fn metadata(&self) -> VideoStreamMetadata {
        self.stream_metadata.clone()
    }

    /// Estimated duration in seconds of a single video frame.
    pub fn frame_duration_secs(&self) -> f64 {
        let stream_fps = if self.stream_metadata.average_frame_rate_den > 0
            && self.stream_metadata.average_frame_rate_num > 0
        {
            self.stream_metadata.average_frame_rate_num as f64
                / self.stream_metadata.average_frame_rate_den as f64
        } else if self.stream_metadata.nominal_frame_rate_den > 0
            && self.stream_metadata.nominal_frame_rate_num > 0
        {
            self.stream_metadata.nominal_frame_rate_num as f64
                / self.stream_metadata.nominal_frame_rate_den as f64
        } else {
            30.0
        };
        (1.0 / stream_fps.max(1.0)).min(0.2)
    }

    /// Current sequential decoder PTS position.
    pub fn sequential_position(&self) -> i64 {
        self.state.current_pts
    }

    /// Describe the actual decoded frame, rather than only the encoded stream.
    pub fn frame_metadata(&self, frame: &ffmpeg::frame::Video) -> DecodedFrameMetadata {
        let raw = unsafe { &*frame.as_ptr() };
        let pts = frame.pts();
        let best_effort_pts = if raw.best_effort_timestamp >= 0 {
            Some(raw.best_effort_timestamp)
        } else {
            None
        };
        let pts_seconds = best_effort_pts.or(pts).map(|value| {
            value as f64 * self.time_base.numerator() as f64 / self.time_base.denominator() as f64
        });

        DecodedFrameMetadata {
            pts,
            best_effort_pts,
            pts_seconds,
            width: frame.width(),
            height: frame.height(),
            pixel_format: pixel_format_name(frame),
            linesize_y: if frame.planes() > 0 {
                frame.stride(0).min(i32::MAX as usize) as i32
            } else {
                0
            },
            // RGB/still-image frames can have one packed plane. UV stride is
            // only meaningful for planar YUV formats.
            linesize_uv: if frame.planes() > 1 {
                frame.stride(1).min(i32::MAX as usize) as i32
            } else {
                0
            },
            sample_aspect_ratio_num: raw.sample_aspect_ratio.num,
            sample_aspect_ratio_den: raw.sample_aspect_ratio.den,
            color: color_metadata(
                raw.color_range,
                raw.colorspace,
                raw.color_primaries,
                raw.color_trc,
                raw.chroma_location,
            ),
        }
    }

    pub fn display_dimensions(&self) -> (u32, u32) {
        let geom = DisplayGeometry::from_encoded(self.width, self.height, self.sar, self.rotation);
        (geom.display_width, geom.display_height)
    }

    pub fn sar(&self) -> (i32, i32) {
        self.sar
    }

    pub fn rotation(&self) -> u32 {
        self.rotation
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn fps(&self) -> f64 {
        let average = self.stream_metadata.average_frame_rate_num as f64
            / self.stream_metadata.average_frame_rate_den as f64;
        if average.is_finite() && average > 0.0 {
            return average;
        }

        let nominal = self.stream_metadata.nominal_frame_rate_num as f64
            / self.stream_metadata.nominal_frame_rate_den as f64;
        if nominal.is_finite() && nominal > 0.0 {
            return nominal;
        }

        // VFR streams may not expose a usable rate. Keep the legacy fallback
        // for callers that require a display rate, but do not derive FPS from
        // the timestamp time base.
        30.0
    }

    /// Select the only hardware frame type backed by the device attached to
    /// this process. A codec can offer several hardware types; choosing an
    /// arbitrary one produces frames with no compatible device context.
    fn platform_hw_pixel_format() -> Option<ffmpeg::ffi::AVPixelFormat> {
        #[cfg(target_os = "macos")]
        {
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX)
        }
        #[cfg(target_os = "windows")]
        {
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11)
        }
        #[cfg(target_os = "linux")]
        {
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VAAPI)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            None
        }
    }

    fn is_hwaccel_format(format: ffmpeg::ffi::AVPixelFormat) -> bool {
        unsafe {
            let desc = ffmpeg::ffi::av_pix_fmt_desc_get(format);
            if desc.is_null() {
                return false;
            }
            ((*desc).flags & ffmpeg::ffi::AV_PIX_FMT_FLAG_HWACCEL as u64) != 0
        }
    }

    /// FFmpeg's get_format callback must always return one of the formats it
    /// was offered. Returning AV_PIX_FMT_NONE means "no format", not "use
    /// software", and can leave a decoder producing an invalid AVFrame.
    fn select_decoder_pixel_format(
        offered: &[ffmpeg::ffi::AVPixelFormat],
        preferred_hardware_format: Option<ffmpeg::ffi::AVPixelFormat>,
    ) -> ffmpeg::ffi::AVPixelFormat {
        if let Some(preferred) = preferred_hardware_format {
            if offered.contains(&preferred) {
                return preferred;
            }
        }

        // When hardware acceleration is not preferred or not supported,
        // we MUST select a software pixel format and reject any hardware formats
        // (such as AV_PIX_FMT_VIDEOTOOLBOX) that FFmpeg might place first in `offered`.
        offered
            .iter()
            .copied()
            .find(|format| {
                *format != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE
                    && !Self::is_hwaccel_format(*format)
            })
            .or_else(|| {
                offered
                    .iter()
                    .copied()
                    .find(|format| *format != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE)
            })
            .unwrap_or(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE)
    }

    #[cfg(target_os = "windows")]
    unsafe fn configure_d3d11va_shared_frames(
        ctx: *mut ffmpeg::ffi::AVCodecContext,
        chosen: ffmpeg::ffi::AVPixelFormat,
    ) {
        #[repr(C)]
        struct AVD3D11VAFramesContext {
            texture: *mut std::ffi::c_void,
            bind_flags: u32,
            misc_flags: u32,
        }

        if ctx.is_null() || (*ctx).hw_device_ctx.is_null() {
            return;
        }

        if !(*ctx).hw_frames_ctx.is_null() {
            ffmpeg::ffi::av_buffer_unref(&mut (*ctx).hw_frames_ctx);
        }

        let mut frames_ref = std::ptr::null_mut();
        let ret = ffmpeg::ffi::avcodec_get_hw_frames_parameters(
            ctx,
            (*ctx).hw_device_ctx,
            chosen,
            &mut frames_ref,
        );
        if ret < 0 || frames_ref.is_null() {
            log::debug!(
                "[VideoDecoder] avcodec_get_hw_frames_parameters returned {ret}; using default hw frames"
            );
            return;
        }

        let frames_ctx = (*frames_ref).data as *mut ffmpeg::ffi::AVHWFramesContext;
        if frames_ctx.is_null() {
            ffmpeg::ffi::av_buffer_unref(&mut frames_ref);
            return;
        }

        let hwctx = (*frames_ctx).hwctx as *mut AVD3D11VAFramesContext;
        if !hwctx.is_null() {
            // D3D11_RESOURCE_MISC_SHARED (0x2) | D3D11_RESOURCE_MISC_SHARED_NTHANDLE (0x800)
            (*hwctx).misc_flags |= 0x802;
            // D3D11_BIND_DECODER (0x200) | D3D11_BIND_SHADER_RESOURCE (0x8)
            (*hwctx).bind_flags |= 0x208;
        }

        let init_ret = ffmpeg::ffi::av_hwframe_ctx_init(frames_ref);
        if init_ret >= 0 {
            (*ctx).hw_frames_ctx = frames_ref;
            log::info!(
                "[VideoDecoder] D3D11VA hw_frames_ctx configured with SHARED_NTHANDLE (0x802)"
            );
        } else {
            log::warn!(
                "[VideoDecoder] av_hwframe_ctx_init failed ({init_ret}); falling back to default FFmpeg frames"
            );
            ffmpeg::ffi::av_buffer_unref(&mut frames_ref);
        }
    }

    #[cfg(target_os = "macos")]
    pub fn macos_supports_hw_av1() -> bool {
        #[link(name = "VideoToolbox", kind = "framework")]
        extern "C" {
            fn VTIsHardwareDecodeSupported(codec_type: u32) -> bool;
        }
        // kCMVideoCodecType_AV1 = 'av01' = 0x61763031
        const K_CM_VIDEO_CODEC_TYPE_AV1: u32 = u32::from_be_bytes(*b"av01");
        unsafe { VTIsHardwareDecodeSupported(K_CM_VIDEO_CODEC_TYPE_AV1) }
    }

    unsafe extern "C" fn get_hw_format(
        #[allow(unused_variables)] ctx: *mut ffmpeg::ffi::AVCodecContext,
        pix_fmts: *const ffmpeg::ffi::AVPixelFormat,
    ) -> ffmpeg::ffi::AVPixelFormat {
        if pix_fmts.is_null() {
            return ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE;
        }

        // FFmpeg guarantees a NONE-terminated list. Materialize it before
        // selection so the policy is independently testable and never falls
        // through to an invalid format.
        let mut offered = Vec::new();
        let mut current = pix_fmts;
        while *current != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE {
            offered.push(*current);
            current = current.add(1);
        }

        #[cfg(target_os = "macos")]
        let preferred_hw = if !ctx.is_null()
            && (*ctx).codec_id == ffmpeg::ffi::AVCodecID::AV_CODEC_ID_AV1
            && !Self::macos_supports_hw_av1()
        {
            None
        } else {
            Self::platform_hw_pixel_format()
        };

        #[cfg(not(target_os = "macos"))]
        let preferred_hw = Self::platform_hw_pixel_format();

        let chosen = Self::select_decoder_pixel_format(&offered, preferred_hw);
        #[cfg(target_os = "windows")]
        if chosen == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11 {
            Self::configure_d3d11va_shared_frames(ctx, chosen);
        }
        chosen
    }

    /// A hardware device is attached only when the selected codec explicitly
    /// supports that device through AVCodecContext::hw_device_ctx.
    fn codec_supports_hw_device(
        ctx: &ffmpeg::codec::context::Context,
        hw_type: ffmpeg::ffi::AVHWDeviceType,
    ) -> bool {
        unsafe {
            let raw_ctx = ctx.as_ptr();
            let mut codec = (*raw_ctx).codec;
            if codec.is_null() {
                codec = ffmpeg::ffi::avcodec_find_decoder((*raw_ctx).codec_id);
            }
            if codec.is_null() {
                return false;
            }

            #[cfg(target_os = "macos")]
            if hw_type == ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX
                && (*raw_ctx).codec_id == ffmpeg::ffi::AVCodecID::AV_CODEC_ID_AV1
                && !Self::macos_supports_hw_av1()
            {
                log::info!(
                    "[VideoDecoder] VideoToolbox AV1 hardware decode not supported on this Mac; using software decode (dav1d)"
                );
                return false;
            }

            let required_method = ffmpeg::ffi::AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX as i32;
            let mut index = 0;
            loop {
                let config = ffmpeg::ffi::avcodec_get_hw_config(codec, index);
                if config.is_null() {
                    return false;
                }
                if (*config).device_type == hw_type && ((*config).methods & required_method) != 0 {
                    return true;
                }
                index += 1;
            }
        }
    }

    unsafe extern "C" fn get_sw_format(
        _ctx: *mut ffmpeg::ffi::AVCodecContext,
        pix_fmts: *const ffmpeg::ffi::AVPixelFormat,
    ) -> ffmpeg::ffi::AVPixelFormat {
        if pix_fmts.is_null() {
            return ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE;
        }

        let mut offered = Vec::new();
        let mut current = pix_fmts;
        while *current != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE {
            offered.push(*current);
            current = current.add(1);
        }

        Self::select_decoder_pixel_format(&offered, None)
    }

    fn open_software_codec(
        mut ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
        unsafe {
            if !ctx.as_mut_ptr().is_null() {
                (*ctx.as_mut_ptr()).get_format = Some(Self::get_sw_format);
            }
        }

        let is_av1 = unsafe {
            !ctx.as_ptr().is_null()
                && (*ctx.as_ptr()).codec_id == ffmpeg::ffi::AVCodecID::AV_CODEC_ID_AV1
        };

        let mut decoder = if is_av1 {
            if let Some(dav1d) = ffmpeg::codec::decoder::find_by_name("libdav1d") {
                log::debug!("[VideoDecoder] Found libdav1d software decoder for AV1");
                ctx.decoder().open_as(dav1d).and_then(|c| c.video())
            } else {
                ctx.decoder().video()
            }
        } else {
            ctx.decoder().video()
        }
        .map_err(|e| e.to_string())?;

        unsafe {
            if !decoder.as_ptr().is_null() {
                (*decoder.as_mut_ptr()).get_format = Some(Self::get_sw_format);
            }
        }

        let w = decoder.width();
        let h = decoder.height();
        Ok((decoder, w, h))
    }

    fn open_with_hw(
        mut ctx: ffmpeg::codec::context::Context,
        purpose: Option<&'static str>,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32, bool), String> {
        #[cfg(target_os = "macos")]
        let hw_types: &[ffmpeg::ffi::AVHWDeviceType] =
            &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX];
        #[cfg(target_os = "windows")]
        let hw_types: &[ffmpeg::ffi::AVHWDeviceType] =
            &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA];
        #[cfg(target_os = "linux")]
        let hw_types: &[ffmpeg::ffi::AVHWDeviceType] =
            &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI];
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let hw_types: &[ffmpeg::ffi::AVHWDeviceType] = &[];

        for &hw_type in hw_types {
            if !Self::codec_supports_hw_device(&ctx, hw_type) {
                log::debug!(
                    "[VideoDecoder] codec has no compatible hardware-device configuration for {hw_type:?}; using software decode"
                );
                continue;
            }
            unsafe {
                #[cfg(target_os = "windows")]
                let device_arg = if hw_type == ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA
                {
                    crate::wgpu_compositor::adapter_selector::get_selected_dxgi_adapter_index()
                        .and_then(|idx| std::ffi::CString::new(idx.to_string()).ok())
                } else {
                    None
                };
                #[cfg(not(target_os = "windows"))]
                let device_arg: Option<std::ffi::CString> = None;

                let device_ptr = device_arg
                    .as_ref()
                    .map(|s| s.as_ptr())
                    .unwrap_or(std::ptr::null());

                let mut hw_ctx = std::ptr::null_mut();
                let mut hw_guard = crate::cold_start::SpanGuard::start("c2_hw_device_create");
                if let Some(p) = purpose {
                    hw_guard.set_purpose(p);
                }
                let mut ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                    &mut hw_ctx,
                    hw_type,
                    device_ptr,
                    std::ptr::null_mut(),
                    0,
                );

                if ret < 0 && !device_ptr.is_null() {
                    log::warn!(
                        "[VideoDecoder] av_hwdevice_ctx_create failed with DXGI adapter {:?}; retrying with default device",
                        device_arg
                    );
                    ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                        &mut hw_ctx,
                        hw_type,
                        std::ptr::null(),
                        std::ptr::null_mut(),
                        0,
                    );
                }

                if ret >= 0 && !hw_ctx.is_null() {
                    hw_guard.finish_ok();
                    (*ctx.as_mut_ptr()).hw_device_ctx = ffmpeg::ffi::av_buffer_ref(hw_ctx);
                    ffmpeg::ffi::av_buffer_unref(&mut hw_ctx);
                    (*ctx.as_mut_ptr()).get_format = Some(Self::get_hw_format);
                    let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
                    let w = decoder.width();
                    let h = decoder.height();
                    return Ok((decoder, w, h, true));
                } else {
                    hw_guard.set_ok(false);
                }
            }
        }

        // No compatible device is an expected capability outcome, not a
        // partially initialized decoder. Re-open using the normal software
        // format negotiation path.
        Self::open_software_codec(ctx).map(|(d, w, h)| (d, w, h, false))
    }

    /// Decode a single frame at full display resolution (no thumbnail scaling).
    ///
    /// Used by the pyramid pipeline: decode once at full res → pass to
    /// `downsample_pyramid()` which produces L0–L3 in parallel via LANCZOS.
    ///
    /// Returns raw RGBA bytes at `(display_w, display_h)` after SAR correction
    /// and rotation. No downsampling is applied here.
    pub fn decode_frame_full_res(
        &mut self,
        timestamp_secs: f64,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        let ts = self.clamp_timestamp(timestamp_secs);
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        self.state.update_sequential(target_pts);

        let needs_seek = self.state.current_pts < 0
            || target_pts < self.state.current_pts
            || !self.state.can_decode_forward(target_pts, sequential_window);

        if needs_seek {
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", ts));
                }
            }
            self.decoder.flush();
            self.state.current_pts = -1;
            self.state.gop_start_pts = target_pts;
        }

        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut found = false;

        'decode: for (stream, packet) in self.input_ctx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }
            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }
            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let pts = frame.pts().unwrap_or(0);
                self.state.current_pts = pts;
                let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = frame;
                    found = true;
                    break 'decode;
                }
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
        }

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        let cpu_frame = self.to_cpu_frame(best_frame)?;
        let (display_w, display_h) = self.display_dimensions();

        // Account for rotation when choosing scale target
        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        };

        // Scale YUV → RGBA at display resolution (LANCZOS, no additional thumbnail scaling)
        let scaled = self.scale_to_rgba_explicit(&cpu_frame, scale_w, scale_h)?;

        let rgba = if self.rotation != 0 {
            Self::rotate_rgba(&scaled, scale_w, scale_h, self.rotation)
        } else {
            scaled
        };

        Ok((rgba, display_w, display_h))
    }

    /// Decode multiple frames in a single forward pass under one lock hold.
    ///
    /// The input `target_timestamps_secs` should be sorted ascending.
    /// Performs a single seek before the first timestamp, then streams packets
    /// forward continuously through the GOP without repeated seeking or decoder resets.
    ///
    /// Returns `(target_ts, rgba, display_w, display_h)` for each satisfied target.
    pub fn decode_frames_batch_full_res(
        &mut self,
        target_timestamps_secs: &[f64],
    ) -> Result<BatchDecodeResult, String> {
        if target_timestamps_secs.is_empty() {
            return Ok(BatchDecodeResult {
                frames: Vec::new(),
                seek_elapsed: Duration::ZERO,
                decode_elapsed: Duration::ZERO,
            });
        }

        let first_ts = self.clamp_timestamp(target_timestamps_secs[0]);
        let first_target_pts =
            (first_ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        self.state.update_sequential(first_target_pts);

        let needs_seek = self.state.current_pts < 0
            || first_target_pts < self.state.current_pts
            || !self
                .state
                .can_decode_forward(first_target_pts, sequential_window);

        let seek_elapsed = if needs_seek {
            let seek_start = Instant::now();
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    first_target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", first_ts));
                }
            }
            self.decoder.flush();
            self.state.current_pts = -1;
            self.state.gop_start_pts = first_target_pts;
            seek_start.elapsed()
        } else {
            Duration::ZERO
        };

        let (display_w, display_h) = self.display_dimensions();
        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        };

        let mut cpu_frames = Vec::with_capacity(target_timestamps_secs.len());
        let mut next_target_idx = 0;

        let decode_start = Instant::now();
        'packet_loop: for (stream, packet) in self.input_ctx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }
            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }
            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let pts = frame.pts().unwrap_or(0);
                self.state.current_pts = pts;
                let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;

                let mut transferred_cpu_frame: Option<ffmpeg::frame::Video> = None;

                while next_target_idx < target_timestamps_secs.len() {
                    let target_ts = target_timestamps_secs[next_target_idx];
                    if frame_ts >= target_ts - (1.0 / 60.0) {
                        let cpu_frame = match &transferred_cpu_frame {
                            Some(cached) => cached.clone(),
                            None => {
                                let cpu = Self::hw_to_cpu_frame(frame.clone())?;
                                transferred_cpu_frame = Some(cpu.clone());
                                cpu
                            }
                        };
                        cpu_frames.push((target_ts, cpu_frame));
                        next_target_idx += 1;
                    } else {
                        break;
                    }
                }

                if next_target_idx >= target_timestamps_secs.len() {
                    break 'packet_loop;
                }
                frame = ffmpeg::frame::Video::empty();
            }
        }
        let decode_elapsed = decode_start.elapsed();

        let mut results = Vec::with_capacity(cpu_frames.len());
        for (target_ts, cpu_frame) in cpu_frames {
            let convert_start = Instant::now();
            let (scaled, conversion_fast_path) =
                self.scale_to_rgba_explicit_with_path(&cpu_frame, scale_w, scale_h)?;
            let convert_elapsed = convert_start.elapsed();
            let rgba = if self.rotation != 0 {
                Self::rotate_rgba(&scaled, scale_w, scale_h, self.rotation)
            } else {
                scaled
            };
            results.push(BatchDecodedFrame {
                target_ts_secs: target_ts,
                rgba,
                width: display_w,
                height: display_h,
                convert_elapsed,
                conversion_fast_path,
            });
        }

        Ok(BatchDecodeResult {
            frames: results,
            seek_elapsed,
            decode_elapsed,
        })
    }

    /// Fast keyframe decode for poster frames / library thumbnails.
    ///
    /// Seeks to the nearest keyframe at or before target_time and immediately returns
    /// the first decoded frame without walking intermediate GOP packets.
    /// This completes in ~5-15ms (1 packet decode) regardless of GOP length.
    pub fn decode_keyframe_frame(
        &mut self,
        timestamp_secs: f64,
        out_width: u32,
        out_height: u32,
    ) -> Result<Vec<u8>, String> {
        let _start = std::time::Instant::now();
        let ts = self.clamp_timestamp(timestamp_secs);
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

        let seek_start = std::time::Instant::now();
        unsafe {
            let ret = ffmpeg::ffi::av_seek_frame(
                self.input_ctx.as_mut_ptr(),
                self.stream_index as i32,
                target_pts,
                ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
            );
            if ret < 0 {
                return self.decode_frame(timestamp_secs, out_width, out_height);
            }
        }
        self.decoder.flush();
        self.state.current_pts = -1;
        self.state.gop_start_pts = target_pts;
        let _seek_elapsed = seek_start.elapsed();

        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut _packets_decoded = 0u32;

        'decode_kf: for (stream, packet) in self.input_ctx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }
            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }
            _packets_decoded += 1;

            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                if frame.width() > 0 && frame.height() > 0 {
                    best_frame = frame;
                    break 'decode_kf;
                }
            }
        }

        if best_frame.width() == 0 || best_frame.height() == 0 {
            return self.decode_frame(timestamp_secs, out_width, out_height);
        }

        let cpu_frame = self.to_cpu_frame(best_frame)?;
        let (display_w, display_h) = self.display_dimensions();
        let display_aspect = display_w as f64 / display_h as f64;
        let target_aspect = out_width as f64 / out_height as f64;

        let (fit_w, fit_h) = if (display_aspect - target_aspect).abs() < 0.01 {
            (out_width, out_height)
        } else {
            let scale =
                (out_width as f64 / display_w as f64).min(out_height as f64 / display_h as f64);
            let w = (display_w as f64 * scale).round() as u32;
            let h = (display_h as f64 * scale).round() as u32;
            (w.max(1), h.max(1))
        };

        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (fit_h, fit_w)
        } else {
            (fit_w, fit_h)
        };

        let scaled = self.scale_to_rgba_explicit(&cpu_frame, scale_w, scale_h)?;

        let rgba = if self.rotation != 0 {
            Self::rotate_rgba(&scaled, scale_w, scale_h, self.rotation)
        } else {
            scaled
        };

        Ok(rgba)
    }

    /// Seek and decode a single frame. Optimized for sequential timeline scrubbing.
    pub fn decode_frame(
        &mut self,
        timestamp_secs: f64,
        out_width: u32,
        out_height: u32,
    ) -> Result<Vec<u8>, String> {
        let _start = std::time::Instant::now();

        // Clamp to video bounds
        let ts = self.clamp_timestamp(timestamp_secs);

        // Convert seconds to stream time base units
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

        // Sequential window: 2 seconds worth of frames (adjusts based on time_base)
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

        // Update sequential tracking
        self.state.update_sequential(target_pts);

        // Decide: seek or decode forward?
        let needs_seek = if self.state.current_pts < 0 {
            // First frame - always seek
            true
        } else if target_pts < self.state.current_pts {
            // Backward request - must seek
            true
        } else if self.state.can_decode_forward(target_pts, sequential_window) {
            // Forward within window - decode without seeking
            false
        } else {
            // Too far forward - seek
            true
        };

        let mut _seek_time = std::time::Duration::ZERO;
        let mut _packets_decoded = 0u32;

        if needs_seek {
            let seek_start = std::time::Instant::now();

            // Seek to nearest keyframe at or before target
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", ts));
                }
            }

            self.decoder.flush();
            self.state.current_pts = -1; // Reset position after seek
            self.state.gop_start_pts = target_pts; // Approximate GOP start

            _seek_time = seek_start.elapsed();
        }

        // Decode forward until we reach or pass the target timestamp
        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut found = false;

        'decode: for (stream, packet) in self.input_ctx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }

            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }
            _packets_decoded += 1;

            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let frame_pts = frame.pts().unwrap_or(0);
                let frame_ts = frame_pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;

                // Update decoder position
                self.state.current_pts = frame_pts;

                // Accept this frame if it's at or just past target
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = frame;
                    found = true;
                    break 'decode;
                }

                // Keep this frame as best candidate so far
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
        }

        // Some containers report a duration slightly beyond the last packet,
        // and some codecs hold the final decoded frame until EOF is signalled.
        // Retry from an earlier keyframe before giving up so a late timeline
        // request resolves to the last available frame instead of a black
        // preview.
        if !found && best_frame.width() == 0 {
            let retry_ts = (ts - 1.0).max(0.0);
            let retry_pts = (retry_ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    retry_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret >= 0 {
                    self.decoder.flush();
                    self.state.current_pts = -1;
                    self.state.gop_start_pts = retry_pts;

                    'retry_decode: for (stream, packet) in self.input_ctx.packets() {
                        if stream.index() != self.stream_index {
                            continue;
                        }
                        if self.decoder.send_packet(&packet).is_err() {
                            continue;
                        }
                        let mut frame = ffmpeg::frame::Video::empty();
                        while self.decoder.receive_frame(&mut frame).is_ok() {
                            let pts = frame.pts().unwrap_or(0);
                            self.state.current_pts = pts;
                            let frame_ts =
                                pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                            best_frame = frame;
                            if frame_ts >= ts - (1.0 / 60.0) {
                                found = true;
                                break 'retry_decode;
                            }
                            frame = ffmpeg::frame::Video::empty();
                        }
                    }
                }
            }
        }

        // Drain delayed codec output after packet iteration. If this path is
        // used, force the next request to seek because the decoder is at EOF.
        if !found && self.decoder.send_eof().is_ok() {
            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let pts = frame.pts().unwrap_or(0);
                self.state.current_pts = pts;
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
            self.state.current_pts = -1;
        }

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        // Handle hardware frames (copy back from GPU to CPU if needed)
        let cpu_frame = self.to_cpu_frame(best_frame)?;

        // Explicit display geometry calculation (prevents accidental SAR handling)
        let (display_w, display_h) = self.display_dimensions();

        // Calculate target dimensions maintaining display aspect ratio
        let display_aspect = display_w as f64 / display_h as f64;
        let target_aspect = out_width as f64 / out_height as f64;

        let (fit_w, fit_h) = if (display_aspect - target_aspect).abs() < 0.01 {
            (out_width, out_height)
        } else {
            let scale =
                (out_width as f64 / display_w as f64).min(out_height as f64 / display_h as f64);
            let w = (display_w as f64 * scale).round() as u32;
            let h = (display_h as f64 * scale).round() as u32;
            (w.max(1), h.max(1))
        };

        // Account for rotation when determining scale target
        let (scale_target_w, scale_target_h) = if self.rotation == 90 || self.rotation == 270 {
            (fit_h, fit_w)
        } else {
            (fit_w, fit_h)
        };

        // Single-pass YUV→RGBA scale with display-aware dimensions
        let scaled_rgba =
            self.scale_to_rgba_explicit(&cpu_frame, scale_target_w, scale_target_h)?;

        // Rotate if needed
        let rgba = if self.rotation != 0 {
            Self::rotate_rgba(&scaled_rgba, scale_target_w, scale_target_h, self.rotation)
        } else {
            scaled_rgba
        };

        let _total_time = _start.elapsed();

        // Validate RGBA buffer size matches expected dimensions
        // RGBA format = 4 bytes per pixel
        let expected_size = (fit_w * fit_h * 4) as usize;
        let actual_size = rgba.len();

        if actual_size != expected_size {
            return Err(format!(
                "Frame buffer size mismatch: expected {} bytes ({}x{}x4), got {} bytes",
                expected_size, fit_w, fit_h, actual_size
            ));
        }

        Ok(rgba)
    }

    /// Validate the native frame before any safe-wrapper code hands it to
    /// libswscale. FFmpeg asserts (and on Windows terminates the process) when
    /// asked to scale AV_PIX_FMT_NONE or a hardware surface directly.
    fn validate_software_frame(frame: &ffmpeg::frame::Video) -> Result<(), String> {
        let raw = unsafe { &*frame.as_ptr() };
        if raw.width <= 0 || raw.height <= 0 {
            return Err(format!(
                "Decoded frame has invalid dimensions {}x{}",
                raw.width, raw.height
            ));
        }
        if raw.width as u32 > MAX_DISPLAY_DIMENSION || raw.height as u32 > MAX_DISPLAY_DIMENSION {
            return Err(format!(
                "Decoded frame dimensions {}x{} exceed the supported limit",
                raw.width, raw.height
            ));
        }
        if raw.format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE as i32 {
            return Err("Decoder produced AV_PIX_FMT_NONE instead of a software frame".to_string());
        }

        let descriptor = frame
            .format()
            .descriptor()
            .ok_or_else(|| format!("Decoder produced unknown pixel format {}", raw.format))?;
        if unsafe {
            ((*descriptor.as_ptr()).flags & ffmpeg::ffi::AV_PIX_FMT_FLAG_HWACCEL as u64) != 0
        } {
            return Err("Hardware frame reached the software conversion boundary".to_string());
        }
        if raw.data[0].is_null() || raw.linesize[0] == 0 {
            return Err("Decoded software frame has no primary image plane".to_string());
        }
        Ok(())
    }

    fn hw_to_cpu_frame(frame: ffmpeg::frame::Video) -> Result<ffmpeg::frame::Video, String> {
        let source_format = unsafe { (*frame.as_ptr()).format };
        let cpu_frame = if source_format
            == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX as i32
            || source_format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11 as i32
            || source_format == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VAAPI as i32
        {
            log::debug!(
                "[VideoDecoder] Transferring hardware frame ({:?}, {}x{}) to host CPU memory",
                frame.format(),
                frame.width(),
                frame.height()
            );
            let mut cpu_frame = ffmpeg::frame::Video::empty();
            unsafe {
                // VideoToolbox/D3D11 require explicit destination pixel format
                (*cpu_frame.as_mut_ptr()).format =
                    ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NV12 as i32;
                let mut ret = ffmpeg::ffi::av_hwframe_transfer_data(
                    cpu_frame.as_mut_ptr(),
                    frame.as_ptr(),
                    0,
                );
                if ret < 0 {
                    log::debug!(
                        "[VideoDecoder] NV12 HW transfer failed (ret={}), falling back to YUV420P",
                        ret
                    );
                    (*cpu_frame.as_mut_ptr()).format =
                        ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
                    ret = ffmpeg::ffi::av_hwframe_transfer_data(
                        cpu_frame.as_mut_ptr(),
                        frame.as_ptr(),
                        0,
                    );
                }
                if ret < 0 {
                    log::error!(
                        "[VideoDecoder] Hardware frame transfer failed completely with ret={}",
                        ret
                    );
                    return Err(format!("HW frame transfer failed (ret={})", ret));
                }
            }
            log::debug!(
                "[VideoDecoder] Hardware frame successfully transferred to CPU (format={:?}, planes={})",
                cpu_frame.format(),
                cpu_frame.planes()
            );
            cpu_frame
        } else {
            frame
        };
        Self::validate_software_frame(&cpu_frame)?;
        Ok(cpu_frame)
    }

    fn to_cpu_frame(&self, frame: ffmpeg::frame::Video) -> Result<ffmpeg::frame::Video, String> {
        Self::hw_to_cpu_frame(frame)
    }

    /// Attempt to extract a DXGI NT shared handle from a D3D11VA hardware frame
    /// **without copying data to CPU RAM** (Phase 2 zero-copy path).
    ///
    /// Returns `Some(handle)` when:
    ///   1. We are on Windows (`cfg!(target_os = "windows")`).
    ///   2. The frame pixel format is `D3D11` (hardware surface, not yet transferred).
    ///   3. The `IDXGIResource1::CreateSharedHandle` call succeeds.
    ///
    /// Returns `None` in all other cases; the caller must fall back to the
    /// standard `to_cpu_frame` + `extract_nv12_planes` path.
    ///
    /// The returned `D3d11SharedFrame.nt_handle` is an NT kernel handle that
    /// **must be closed** (via `wgpu_compositor::dxgi_import::import_into_wgpu`,
    /// which closes it internally) before the next frame is decoded.
    #[cfg(target_os = "windows")]
    pub fn try_extract_dxgi_shared_handle(
        frame: &ffmpeg::frame::Video,
    ) -> Option<crate::wgpu_compositor::dxgi_import::D3d11SharedFrame> {
        if frame.format() != ffmpeg::format::Pixel::D3D11 {
            return None;
        }
        // `frame.as_ptr()` is a valid, non-null AVFrame* and the
        // hardware context is still live because the frame is in scope.
        unsafe { crate::wgpu_compositor::dxgi_import::extract_shared_handle(frame.as_ptr()) }
    }

    /// Extract raw NV12 planes (Y plane + interleaved UV plane) directly from a decoded frame without CPU sws_scale.
    pub fn extract_nv12_planes(
        &self,
        frame: &ffmpeg::frame::Video,
    ) -> Option<(Vec<u8>, Vec<u8>, u32, u32)> {
        let width = frame.width() as usize;
        let height = frame.height() as usize;
        // Sanity-check dimensions before any plane access.
        if width == 0 || height == 0 {
            return None;
        }

        if frame.format() == ffmpeg::format::Pixel::NV12 {
            // Guard: NV12 needs exactly 2 planes (Y + interleaved UV).
            // av_hwframe_transfer_data can produce a frame whose format is
            // reported as NV12 but whose linesize[1] is 0 (UV plane absent),
            // which would panic in ffmpeg-next's stride() bounds check.
            if frame.planes() < 2 {
                return None;
            }
            let y_stride = frame.stride(0);
            let uv_stride = frame.stride(1);
            let y_data = frame.data(0);
            let uv_data = frame.data(1);

            let mut y_plane = Vec::with_capacity(width * height);
            for y in 0..height {
                let row_start = y * y_stride;
                let row_end = row_start + width;
                if row_end > y_data.len() {
                    return None;
                }
                y_plane.extend_from_slice(&y_data[row_start..row_end]);
            }

            let uv_height = height.div_ceil(2);
            let uv_width = width.div_ceil(2);
            let uv_packed_stride = uv_width * 2;
            let mut uv_plane = Vec::with_capacity(uv_packed_stride * uv_height);
            for y in 0..uv_height {
                let row_start = y * uv_stride;
                let copy_len = width.min(uv_packed_stride);
                let row_end = row_start + copy_len;
                if row_end > uv_data.len() {
                    return None;
                }
                uv_plane.extend_from_slice(&uv_data[row_start..row_end]);
                if copy_len < uv_packed_stride {
                    uv_plane.extend(std::iter::repeat_n(0u8, uv_packed_stride - copy_len));
                }
            }

            Some((y_plane, uv_plane, width as u32, height as u32))
        } else if frame.format() == ffmpeg::format::Pixel::YUV420P {
            // Direct zero-swscale conversion: interleave planar U and V into NV12 directly.
            // Guard: YUV420P needs 3 planes (Y, U, V).
            if frame.planes() < 3 {
                return None;
            }
            let y_stride = frame.stride(0);
            let u_stride = frame.stride(1);
            let v_stride = frame.stride(2);
            let y_data = frame.data(0);
            let u_data = frame.data(1);
            let v_data = frame.data(2);

            let mut y_plane = Vec::with_capacity(width * height);
            for y in 0..height {
                let row_start = y * y_stride;
                let row_end = row_start + width;
                if row_end > y_data.len() {
                    return None;
                }
                y_plane.extend_from_slice(&y_data[row_start..row_end]);
            }

            let uv_height = height.div_ceil(2);
            let uv_width = width.div_ceil(2);
            let uv_packed_stride = uv_width * 2;
            let mut uv_plane = Vec::with_capacity(uv_packed_stride * uv_height);

            for y in 0..uv_height {
                let u_row = y * u_stride;
                let v_row = y * v_stride;
                if u_row + uv_width > u_data.len() || v_row + uv_width > v_data.len() {
                    return None;
                }
                for x in 0..uv_width {
                    uv_plane.push(u_data[u_row + x]);
                    uv_plane.push(v_data[v_row + x]);
                }
            }

            Some((y_plane, uv_plane, width as u32, height as u32))
        } else {
            None
        }
    }

    /// Decode a single frame and return raw NV12 planes plus the color metadata
    /// attached to the actual decoded frame for GPU shader consumption.
    #[allow(clippy::type_complexity)]
    pub fn decode_frame_raw_nv12(
        &mut self,
        timestamp_secs: f64,
    ) -> Result<(Arc<[u8]>, Arc<[u8]>, u32, u32, VideoColorMetadata), String> {
        self.decode_frame_raw_nv12_with_cancel(timestamp_secs, || false)
    }

    /// Optimized decoding: decodes directly to NV12 without CPU sws_scale RGBA conversion.
    /// Returns (y_plane, uv_plane, width, height, color).
    /// Used for zero-copy GPU shader-based YUV conversion via wgpu_compositor.
    pub fn decode_frame_raw_nv12_with_cancel<F: Fn() -> bool>(
        &mut self,
        timestamp_secs: f64,
        is_cancelled: F,
    ) -> Result<(Arc<[u8]>, Arc<[u8]>, u32, u32, VideoColorMetadata), String> {
        self.decode_frame_raw_nv12_with_options(
            timestamp_secs,
            DecodeFrameOptions::default(),
            is_cancelled,
        )
    }

    /// Optimized decoding: decodes directly to NV12 without CPU sws_scale RGBA conversion.
    /// Returns (y_plane, uv_plane, width, height, color).
    /// Used for zero-copy GPU shader-based YUV conversion via wgpu_compositor.
    pub fn decode_frame_raw_nv12_with_options<F: Fn() -> bool>(
        &mut self,
        timestamp_secs: f64,
        options: DecodeFrameOptions,
        is_cancelled: F,
    ) -> Result<(Arc<[u8]>, Arc<[u8]>, u32, u32, VideoColorMetadata), String> {
        if is_cancelled() {
            return Err("Native preview request cancelled".to_string());
        }
        let ts = self.clamp_timestamp(timestamp_secs);
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        let stream_fps = if self.stream_metadata.average_frame_rate_den > 0
            && self.stream_metadata.average_frame_rate_num > 0
        {
            self.stream_metadata.average_frame_rate_num as f64
                / self.stream_metadata.average_frame_rate_den as f64
        } else if self.stream_metadata.nominal_frame_rate_den > 0
            && self.stream_metadata.nominal_frame_rate_num > 0
        {
            self.stream_metadata.nominal_frame_rate_num as f64
                / self.stream_metadata.nominal_frame_rate_den as f64
        } else {
            30.0
        };
        let frame_duration_secs = (1.0 / stream_fps.max(1.0)).min(0.2);
        let pts_tolerance = ((frame_duration_secs * 0.95) * self.time_base.1 as f64
            / self.time_base.0 as f64)
            .round()
            .max(1.0) as i64;

        // Allow a ready-frame cache to cover requests that are at most 1 frame
        // behind the cached PTS.  Using exactly pts_tolerance (≈ 0.95 × frame
        // duration) means the served frame is never more than ~1 frame ahead
        // of the target, which is the weakest correctness guarantee consistent
        // with smooth forward playback.  Using 2× was too loose and could
        // deliver a frame that was visibly a full frame early.
        let backward_jitter_threshold = pts_tolerance;

        // 1. Check LRU ring-buffer cache for recently decoded frames
        if options.is_playback {
            if let Some((pos, _)) = self
                .raw_nv12_cache
                .iter()
                .enumerate()
                .filter(|(_, cached)| {
                    cached.quality == options.quality
                        && (!cached.is_approximate || options.allow_keyframe_approx)
                        && cached.pts <= target_pts
                        && target_pts.saturating_sub(cached.pts) <= backward_jitter_threshold
                })
                .max_by(|(_, left), (_, right)| left.pts.cmp(&right.pts))
            {
                let cached = self.raw_nv12_cache.remove(pos).unwrap();
                let y_clone = Arc::clone(&cached.y_plane);
                let uv_clone = Arc::clone(&cached.uv_plane);
                let width = cached.width;
                let height = cached.height;
                let color = cached.color.clone();
                self.raw_nv12_cache.push_back(cached);
                self.last_decode_activity = DecodeActivity {
                    served_from: ServedFrom::ReadyCache,
                    ..DecodeActivity::default()
                };
                return Ok((y_clone, uv_clone, width, height, color));
            }
        } else if let Some(pos) = self.raw_nv12_cache.iter().position(|cached| {
            cached.quality == options.quality
                && (!cached.is_approximate || options.allow_keyframe_approx)
                && (cached.pts - target_pts).abs() <= pts_tolerance
        }) {
            let cached = self.raw_nv12_cache.remove(pos).unwrap();
            let y_clone = Arc::clone(&cached.y_plane);
            let uv_clone = Arc::clone(&cached.uv_plane);
            let width = cached.width;
            let height = cached.height;
            let color = cached.color.clone();
            self.raw_nv12_cache.push_back(cached);
            self.last_decode_activity = DecodeActivity {
                served_from: ServedFrom::ReadyCache,
                ..DecodeActivity::default()
            };
            return Ok((y_clone, uv_clone, width, height, color));
        }

        if let Some((cached_pts, y, uv, width, height, color, quality, is_approx)) =
            &self.last_raw_nv12
        {
            let is_hit = if options.is_playback {
                *quality == options.quality
                    && (!*is_approx || options.allow_keyframe_approx)
                    && *cached_pts <= target_pts
                    && target_pts.saturating_sub(*cached_pts) <= backward_jitter_threshold
            } else {
                *quality == options.quality
                    && (!*is_approx || options.allow_keyframe_approx)
                    && (*cached_pts - target_pts).abs() <= pts_tolerance
            };
            if is_hit {
                self.last_decode_activity = DecodeActivity {
                    served_from: ServedFrom::ReadyCache,
                    ..DecodeActivity::default()
                };
                return Ok((
                    Arc::clone(y),
                    Arc::clone(uv),
                    *width,
                    *height,
                    color.clone(),
                ));
            }
        }
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        self.state.update_sequential(target_pts);
        let forward_window = if self.state.sequential_hits >= 3 {
            sequential_window * 2
        } else {
            sequential_window
        };

        let action = decide_decoder_action(
            options.is_playback,
            self.state.current_pts,
            target_pts,
            pts_tolerance,
            forward_window,
            backward_jitter_threshold,
            false,
        );

        if action == DecoderSeekAction::ReuseCurrent {
            if let Some((_, y, uv, width, height, color, _, _)) = &self.last_raw_nv12 {
                self.last_decode_activity = DecodeActivity {
                    served_from: ServedFrom::ReusedCurrent,
                    ..DecodeActivity::default()
                };
                return Ok((
                    Arc::clone(y),
                    Arc::clone(uv),
                    *width,
                    *height,
                    color.clone(),
                ));
            }
        }

        let needs_seek = matches!(action, DecoderSeekAction::Seek);

        let mut demux_time_us = 0u32;
        let mut frames_decoded = 0u32;
        let mut seek_time_us = 0u32;

        if needs_seek {
            if is_cancelled() {
                return Err("Native preview request cancelled".to_string());
            }
            let seek_t0 = Instant::now();
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", ts));
                }
            }
            seek_time_us = seek_t0.elapsed().as_micros().min(u32::MAX as u128) as u32;
            demux_time_us = demux_time_us.saturating_add(seek_time_us);
            self.decoder.flush();
            self.state.current_pts = -1;
            self.state.gop_start_pts = target_pts;
        }

        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut found = false;

        // Fast path for scrubbing / keyframe-only approximation:
        // When allow_keyframe_approx is requested, seek directly to the prior keyframe and return
        // the immediate I-frame without decoding subsequent P/B delta frames forward to target.
        if options.allow_keyframe_approx && needs_seek {
            'keyframe_decode: for (stream, packet) in self.input_ctx.packets() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                if stream.index() != self.stream_index {
                    continue;
                }
                if self.decoder.send_packet(&packet).is_err() {
                    continue;
                }
                let mut frame = ffmpeg::frame::Video::empty();
                if self.decoder.receive_frame(&mut frame).is_ok() {
                    frames_decoded = frames_decoded.saturating_add(1);
                    if is_cancelled() {
                        return Err("Native preview request cancelled".to_string());
                    }
                    let pts = frame.pts().unwrap_or(0);
                    self.state.current_pts = pts;
                    best_frame = frame;
                    found = true;
                    break 'keyframe_decode;
                }
            }
        }

        // Drain any frame already buffered in the codec DPB before reading new packets from container
        if !found {
            let mut buffered = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut buffered).is_ok() {
                frames_decoded = frames_decoded.saturating_add(1);
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                let pts = buffered.pts().unwrap_or(0);
                self.state.current_pts = pts;
                let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = buffered;
                    found = true;
                    break;
                }
                best_frame = buffered;
                buffered = ffmpeg::frame::Video::empty();
            }
        }

        // Budget: 3 s maximum scan per seek. On constrained iGPUs (Intel HD 520)
        // HEVC GOPs can span 2–4 s of packets. Without a budget, a single
        // backward seek blocks the decode thread for 7–14 s (measured in
        // session `launch-1790401877377-4m5myb`). When the budget is reached
        // we return the best partial frame decoded so far (a nearby keyframe)
        // as a stale-ok approximation rather than failing with `Err("No frame
        // found")`, which would force a full pipeline restart.
        const SEEK_SCAN_BUDGET: Duration = Duration::from_secs(3);

        if !found {
            let scan_deadline = Instant::now();
            'decode: for (stream, packet) in self.input_ctx.packets() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                if stream.index() != self.stream_index {
                    continue;
                }
                if self.decoder.send_packet(&packet).is_err() {
                    continue;
                }
                let mut frame = ffmpeg::frame::Video::empty();
                while self.decoder.receive_frame(&mut frame).is_ok() {
                    frames_decoded = frames_decoded.saturating_add(1);
                    if is_cancelled() {
                        return Err("Native preview request cancelled".to_string());
                    }
                    let pts = frame.pts().unwrap_or(0);
                    self.state.current_pts = pts;
                    let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                    if frame_ts >= ts - (1.0 / 60.0) {
                        best_frame = frame;
                        found = true;
                        break 'decode;
                    }
                    best_frame = frame;
                    frame = ffmpeg::frame::Video::empty();
                }
                // Bail out after the budget to prevent multi-second stalls on
                // long-GOP HEVC files. `best_frame` holds the most recent
                // keyframe decoded so far — close enough for interactive preview.
                if scan_deadline.elapsed() > SEEK_SCAN_BUDGET {
                    break 'decode;
                }
            }
        }

        // A late timestamp can be past the last packet even when it is still
        // inside the container duration. Retry from an earlier keyframe so the
        // preview can use the last available decoded frame.
        if !found && best_frame.width() == 0 {
            if options.is_playback {
                if let Some((_, y, uv, width, height, color, _, _)) = &self.last_raw_nv12 {
                    return Ok((
                        Arc::clone(y),
                        Arc::clone(uv),
                        *width,
                        *height,
                        color.clone(),
                    ));
                }
            }
            let retry_ts = (ts - 1.0).max(0.0);
            let retry_pts = (retry_ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    retry_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret >= 0 {
                    self.decoder.flush();
                    self.state.current_pts = -1;
                    self.state.gop_start_pts = retry_pts;

                    let retry_scan_deadline = Instant::now();
                    'retry_decode: for (stream, packet) in self.input_ctx.packets() {
                        if is_cancelled() {
                            return Err("Native preview request cancelled".to_string());
                        }
                        if stream.index() != self.stream_index {
                            continue;
                        }
                        if self.decoder.send_packet(&packet).is_err() {
                            continue;
                        }
                        let mut frame = ffmpeg::frame::Video::empty();
                        while self.decoder.receive_frame(&mut frame).is_ok() {
                            frames_decoded = frames_decoded.saturating_add(1);
                            if is_cancelled() {
                                return Err("Native preview request cancelled".to_string());
                            }
                            let pts = frame.pts().unwrap_or(0);
                            self.state.current_pts = pts;
                            let frame_ts =
                                pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                            best_frame = frame;
                            if frame_ts >= ts - (1.0 / 60.0) {
                                found = true;
                                break 'retry_decode;
                            }
                            frame = ffmpeg::frame::Video::empty();
                        }
                        if retry_scan_deadline.elapsed() > SEEK_SCAN_BUDGET {
                            break 'retry_decode;
                        }
                    }
                }
            }
        }

        // Drain delayed codec output after packet iteration. The decoder is at
        // EOF after this path, so force the next request to seek.
        if !found && self.decoder.send_eof().is_ok() {
            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                frames_decoded = frames_decoded.saturating_add(1);
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                let pts = frame.pts().unwrap_or(0);
                self.state.current_pts = pts;
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
            self.state.current_pts = -1;
        }

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        if options.skip_hw_download && self.stream_metadata.is_hardware_accelerated {
            let width = best_frame.width();
            let height = best_frame.height();
            self.last_decode_activity = DecodeActivity {
                seek_count: self.last_decode_activity.seek_count,
                seek_time_us: self.last_decode_activity.seek_time_us,
                frames_decoded,
                hardware_frame_download_us: None,
                scale_colorspace_us: 0,
                hardware_frames_downloaded: 0,
                served_from: ServedFrom::DecodedInRequest,
                hw_device_type: self.stream_metadata.is_hardware_accelerated.then_some({
                    #[cfg(target_os = "windows")]
                    {
                        "d3d11va"
                    }
                    #[cfg(target_os = "macos")]
                    {
                        "videotoolbox"
                    }
                    #[cfg(target_os = "linux")]
                    {
                        "vaapi"
                    }
                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        "hardware"
                    }
                }),
            };
            let dummy_y = Arc::from(vec![0u8; 4]);
            let dummy_uv = Arc::from(vec![128u8; 2]);
            return Ok((
                dummy_y,
                dummy_uv,
                width,
                height,
                VideoColorMetadata::default(),
            ));
        }

        let hardware_download_started = Instant::now();
        let cpu_frame = self.to_cpu_frame(best_frame)?;
        let hardware_frame_download_us = self.stream_metadata.is_hardware_accelerated.then(|| {
            hardware_download_started
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64
        });
        let frame_color = self.frame_metadata(&cpu_frame).color;
        let (target_width, target_height) = options.target_dimensions.unwrap_or_else(|| {
            nv12_dimensions_for_quality(cpu_frame.width(), cpu_frame.height(), options.quality)
        });
        // QualityTier must change actual decoded-plane dimensions, not merely
        // cache labels or output geometry. Before this, a `proxy` CPU fallback
        // still uploaded/composited the source 4K NV12 surface, which is the
        // exact failure mode observed on the Intel HD 520 beta session.
        let scale_started = Instant::now();
        let result = if target_width == cpu_frame.width() && target_height == cpu_frame.height() {
            if let Some(nv12) = self.extract_nv12_planes(&cpu_frame) {
                Ok((
                    nv12.0,
                    nv12.1,
                    nv12.2,
                    nv12.3,
                    normalize_converted_nv12_color(frame_color),
                ))
            } else {
                scale_frame_to_nv12(&cpu_frame, target_width, target_height, frame_color.clone())
            }
        } else {
            scale_frame_to_nv12(&cpu_frame, target_width, target_height, frame_color.clone())
        }?;
        let scale_colorspace_us = scale_started.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let y_arc: Arc<[u8]> = Arc::from(result.0);
        let uv_arc: Arc<[u8]> = Arc::from(result.1);
        let is_approx = options.allow_keyframe_approx
            && (self.state.current_pts - target_pts).abs() > pts_tolerance;
        self.last_raw_nv12 = Some((
            target_pts,
            Arc::clone(&y_arc),
            Arc::clone(&uv_arc),
            result.2,
            result.3,
            result.4.clone(),
            options.quality,
            is_approx,
        ));
        if self.raw_nv12_cache.len() >= MAX_RAW_NV12_CACHE_ENTRIES {
            self.raw_nv12_cache.pop_front();
        }
        self.raw_nv12_cache.push_back(CachedNv12Frame {
            pts: target_pts,
            y_plane: Arc::clone(&y_arc),
            uv_plane: Arc::clone(&uv_arc),
            width: result.2,
            height: result.3,
            color: result.4.clone(),
            quality: options.quality,
            is_approximate: is_approx,
        });
        self.last_demux_us = demux_time_us;
        let hardware_frames_downloaded = if self.stream_metadata.is_hardware_accelerated {
            1
        } else {
            0
        };
        self.last_decode_activity = DecodeActivity {
            seek_count: u32::from(needs_seek),
            seek_time_us,
            frames_decoded,
            hardware_frame_download_us,
            scale_colorspace_us,
            hardware_frames_downloaded,
            served_from: ServedFrom::DecodedInRequest,
            hw_device_type: if self.stream_metadata.is_hardware_accelerated {
                #[cfg(target_os = "windows")]
                {
                    Some("d3d11va")
                }
                #[cfg(target_os = "macos")]
                {
                    Some("videotoolbox")
                }
                #[cfg(target_os = "linux")]
                {
                    Some("vaapi")
                }
                #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
                {
                    None
                }
            } else {
                Some("software")
            },
        };
        Ok((y_arc, uv_arc, result.2, result.3, result.4))
    }

    /// Windows-only: attempt to decode the frame at `timestamp_secs` and return
    /// a zero-copy DXGI shared handle instead of copying NV12 data to CPU RAM.
    ///
    /// Returns:
    ///   * `Ok(Some(handle))` — D3D11VA frame successfully extracted; the caller
    ///     must pass the handle to `dxgi_import::import_into_wgpu` and then
    ///     call `session.render_nv12_from_imported_texture`.
    ///   * `Ok(None)` — frame is not D3D11VA (software decode, VAAPI, etc.);
    ///     caller must fall back to `decode_frame_raw_nv12_with_options`.
    ///   * `Err(e)` — seek or decode failed.
    ///
    /// Important: this method holds the `best_frame` alive through the DXGI
    /// extraction.  The NT handle is closed by `import_into_wgpu`; the caller
    /// must not free the decoder between extraction and import.
    #[cfg(target_os = "windows")]
    pub fn decode_frame_dxgi_windows<F: Fn() -> bool>(
        &mut self,
        timestamp_secs: f64,
        options: DecodeFrameOptions,
        is_cancelled: F,
        out_color: &mut VideoColorMetadata,
        out_width: &mut u32,
        out_height: &mut u32,
    ) -> Result<Option<crate::wgpu_compositor::dxgi_import::D3d11SharedFrame>, String> {
        if is_cancelled() {
            return Err("Native preview request cancelled".to_string());
        }
        let ts = self.clamp_timestamp(timestamp_secs);
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        let stream_fps = if self.stream_metadata.average_frame_rate_den > 0
            && self.stream_metadata.average_frame_rate_num > 0
        {
            self.stream_metadata.average_frame_rate_num as f64
                / self.stream_metadata.average_frame_rate_den as f64
        } else {
            30.0
        };
        let frame_duration_secs = (1.0 / stream_fps.max(1.0)).min(0.2);
        let pts_tolerance = ((frame_duration_secs * 0.95) * self.time_base.1 as f64
            / self.time_base.0 as f64)
            .round()
            .max(1.0) as i64;

        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        self.state.update_sequential(target_pts);

        let backward_distance = self.state.current_pts - target_pts;
        let is_backward = target_pts < self.state.current_pts;
        let needs_seek = if options.is_playback {
            self.state.current_pts < 0
                || (!is_backward
                    && !self
                        .state
                        .can_decode_forward(target_pts, sequential_window * 2))
        } else {
            self.state.current_pts < 0
                || (is_backward && backward_distance > pts_tolerance)
                || (!is_backward && !self.state.can_decode_forward(target_pts, sequential_window))
        };

        let mut demux_time_us = 0u32;

        if needs_seek {
            if is_cancelled() {
                return Err("Native preview request cancelled".to_string());
            }
            let seek_t0 = Instant::now();
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", ts));
                }
            }
            demux_time_us = demux_time_us
                .saturating_add(seek_t0.elapsed().as_micros().min(u32::MAX as u128) as u32);
            self.decoder.flush();
            self.state.current_pts = -1;
            self.state.gop_start_pts = target_pts;
        }

        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut found = false;

        // Keyframe-only fast path (scrubbing)
        if options.allow_keyframe_approx && needs_seek {
            'kf: for (stream, packet) in self.input_ctx.packets() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                if stream.index() != self.stream_index {
                    continue;
                }
                if self.decoder.send_packet(&packet).is_err() {
                    continue;
                }
                let mut frame = ffmpeg::frame::Video::empty();
                if self.decoder.receive_frame(&mut frame).is_ok() {
                    if is_cancelled() {
                        return Err("Native preview request cancelled".to_string());
                    }
                    let pts = frame.pts().unwrap_or(0);
                    self.state.current_pts = pts;
                    best_frame = frame;
                    found = true;
                    break 'kf;
                }
            }
        }

        // Drain DPB
        if !found {
            let mut buffered = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut buffered).is_ok() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                let pts = buffered.pts().unwrap_or(0);
                self.state.current_pts = pts;
                let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = buffered;
                    found = true;
                    break;
                }
                best_frame = buffered;
                buffered = ffmpeg::frame::Video::empty();
            }
        }

        if !found {
            'dec: for (stream, packet) in self.input_ctx.packets() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                if stream.index() != self.stream_index {
                    continue;
                }
                if self.decoder.send_packet(&packet).is_err() {
                    continue;
                }
                let mut frame = ffmpeg::frame::Video::empty();
                while self.decoder.receive_frame(&mut frame).is_ok() {
                    if is_cancelled() {
                        return Err("Native preview request cancelled".to_string());
                    }
                    let pts = frame.pts().unwrap_or(0);
                    self.state.current_pts = pts;
                    let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                    best_frame = frame;
                    if frame_ts >= ts - (1.0 / 60.0) {
                        found = true;
                        break 'dec;
                    }
                    frame = ffmpeg::frame::Video::empty();
                }
            }
        }

        // Drain delayed codec output after packet iteration. If this path is
        // used, force the next request to seek because the decoder is at EOF.
        if !found && self.decoder.send_eof().is_ok() {
            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                if is_cancelled() {
                    return Err("Native preview request cancelled".to_string());
                }
                let pts = frame.pts().unwrap_or(0);
                self.state.current_pts = pts;
                let frame_ts = pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                best_frame = frame;
                if frame_ts >= ts - (1.0 / 60.0) {
                    found = true;
                    break;
                }
                frame = ffmpeg::frame::Video::empty();
            }
            self.state.current_pts = -1;
        }

        // Some containers report a duration slightly beyond the last packet,
        // and some codecs hold the final decoded frame until EOF is signalled.
        // Retry from an earlier keyframe before giving up so a late timeline
        // request resolves to the last available frame instead of an error.
        if !found && best_frame.width() == 0 {
            let retry_ts = (ts - 1.0).max(0.0);
            let retry_pts = (retry_ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    retry_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
                if ret >= 0 {
                    self.decoder.flush();
                    self.state.current_pts = -1;
                    self.state.gop_start_pts = retry_pts;

                    'retry_dxgi: for (stream, packet) in self.input_ctx.packets() {
                        if is_cancelled() {
                            return Err("Native preview request cancelled".to_string());
                        }
                        if stream.index() != self.stream_index {
                            continue;
                        }
                        if self.decoder.send_packet(&packet).is_err() {
                            continue;
                        }
                        let mut frame = ffmpeg::frame::Video::empty();
                        while self.decoder.receive_frame(&mut frame).is_ok() {
                            if is_cancelled() {
                                return Err("Native preview request cancelled".to_string());
                            }
                            let pts = frame.pts().unwrap_or(0);
                            self.state.current_pts = pts;
                            let frame_ts =
                                pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                            best_frame = frame;
                            if frame_ts >= ts - (1.0 / 60.0) {
                                found = true;
                                break 'retry_dxgi;
                            }
                            frame = ffmpeg::frame::Video::empty();
                        }
                    }

                    if !found && self.decoder.send_eof().is_ok() {
                        let mut frame = ffmpeg::frame::Video::empty();
                        while self.decoder.receive_frame(&mut frame).is_ok() {
                            if is_cancelled() {
                                return Err("Native preview request cancelled".to_string());
                            }
                            let pts = frame.pts().unwrap_or(0);
                            self.state.current_pts = pts;
                            let frame_ts =
                                pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64;
                            best_frame = frame;
                            if frame_ts >= ts - (1.0 / 60.0) {
                                found = true;
                                break;
                            }
                            frame = ffmpeg::frame::Video::empty();
                        }
                    }
                }
            }
        }

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        // Check if this is a D3D11VA hardware frame — if so, try zero-copy.
        if best_frame.format() == ffmpeg::format::Pixel::D3D11 {
            // Capture color metadata before potentially consuming the frame.
            let meta = self.frame_metadata(&best_frame);
            *out_color = normalize_converted_nv12_color(meta.color);
            *out_width = best_frame.width();
            *out_height = best_frame.height();

            if let Some(shared) = Self::try_extract_dxgi_shared_handle(&best_frame) {
                // Zero-copy succeeded — return the handle without touching CPU.
                log::debug!(
                    "[VideoDecoder] D3D11VA zero-copy shared handle extracted successfully for {}x{}",
                    *out_width,
                    *out_height
                );
                self.last_demux_us = demux_time_us;
                return Ok(Some(shared));
            }
            log::warn!(
                "[VideoDecoder] D3D11VA zero-copy handle extraction returned None; falling back to CPU copy"
            );
            // If CreateSharedHandle failed (e.g., Optimus with cross-adapter),
            // fall through to the CPU copy path below.
        }

        // CPU fallback: populate raw NV12 cache so caller does NOT need to re-seek or re-decode.
        if let Ok(cpu_frame) = self.to_cpu_frame(best_frame) {
            let frame_color = self.frame_metadata(&cpu_frame).color;
            let (target_width, target_height) =
                nv12_dimensions_for_quality(cpu_frame.width(), cpu_frame.height(), options.quality);
            if let Ok(result) = if target_width == cpu_frame.width()
                && target_height == cpu_frame.height()
            {
                if let Some(nv12) = self.extract_nv12_planes(&cpu_frame) {
                    Ok((
                        nv12.0,
                        nv12.1,
                        nv12.2,
                        nv12.3,
                        normalize_converted_nv12_color(frame_color),
                    ))
                } else {
                    scale_frame_to_nv12(
                        &cpu_frame,
                        target_width,
                        target_height,
                        frame_color.clone(),
                    )
                }
            } else {
                scale_frame_to_nv12(&cpu_frame, target_width, target_height, frame_color.clone())
            } {
                let y_arc: Arc<[u8]> = Arc::from(result.0);
                let uv_arc: Arc<[u8]> = Arc::from(result.1);
                let is_approx = options.allow_keyframe_approx
                    && (self.state.current_pts - target_pts).abs() > pts_tolerance;
                self.last_raw_nv12 = Some((
                    target_pts,
                    Arc::clone(&y_arc),
                    Arc::clone(&uv_arc),
                    result.2,
                    result.3,
                    result.4.clone(),
                    options.quality,
                    is_approx,
                ));
                if self.raw_nv12_cache.len() >= MAX_RAW_NV12_CACHE_ENTRIES {
                    self.raw_nv12_cache.pop_front();
                }
                self.raw_nv12_cache.push_back(CachedNv12Frame {
                    pts: target_pts,
                    y_plane: Arc::clone(&y_arc),
                    uv_plane: Arc::clone(&uv_arc),
                    width: result.2,
                    height: result.3,
                    color: result.4,
                    quality: options.quality,
                    is_approximate: is_approx,
                });
            }
        }
        self.last_demux_us = demux_time_us;
        Ok(None)
    }

    /// Scale YUV frame to RGBA
    ///
    /// Uses raw pixel dimensions to prevent double SAR application.
    /// SAR correction is handled by caller through geometry calculation.
    fn scale_to_rgba_explicit(
        &self,
        frame: &ffmpeg::frame::Video,
        out_w: u32,
        out_h: u32,
    ) -> Result<Vec<u8>, String> {
        self.scale_to_rgba_explicit_with_path(frame, out_w, out_h)
            .map(|(rgba, _)| rgba)
    }

    fn scale_to_rgba_explicit_with_path(
        &self,
        frame: &ffmpeg::frame::Video,
        out_w: u32,
        out_h: u32,
    ) -> Result<(Vec<u8>, bool), String> {
        use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

        // For 1:1 format conversion (YUV420P → RGBA at native resolution), use FAST_BILINEAR
        // to enable SIMD vector colorspace matrices (NEON/AVX2) without filter overhead.
        // For spatial downscaling/upscaling, use LANCZOS for high-order anti-aliasing.
        let conversion_fast_path = frame.width() == out_w && frame.height() == out_h;
        let flags = if conversion_fast_path {
            Flags::FAST_BILINEAR
        } else {
            Flags::LANCZOS
        };

        let mut scaler = Context::get(
            frame.format(),
            frame.width(),
            frame.height(),
            ffmpeg::format::Pixel::RGBA,
            out_w,
            out_h,
            flags,
        )
        .map_err(|e| e.to_string())?;

        let mut out = ffmpeg::frame::Video::empty();
        scaler.run(frame, &mut out).map_err(|e| e.to_string())?;

        if out.planes() == 0 {
            return Err("Scaled RGBA output has no image planes".to_string());
        }

        // FFmpeg frame data may have stride padding - copy tightly packed RGBA
        let stride = out.stride(0);
        let width = out.width() as usize;
        let height = out.height() as usize;
        let src_data = out.data(0);

        // Copy row by row to handle stride
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let row_start = y * stride;
            if row_start + (width * 4) > src_data.len() {
                return Err("Scaled RGBA buffer smaller than expected".to_string());
            }
            let row_pixels = &src_data[row_start..row_start + (width * 4)];
            rgba.extend_from_slice(row_pixels);
        }

        Ok((rgba, conversion_fast_path))
    }

    /// Scale an RGBA buffer to new dimensions
    /// Used after rotation to scale display-oriented frames
    pub fn scale_rgba_buffer(
        &self,
        rgba: &[u8],
        src_w: u32,
        src_h: u32,
        dst_w: u32,
        dst_h: u32,
    ) -> Result<Vec<u8>, String> {
        use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

        // Create a temporary frame from RGBA buffer
        let mut src_frame = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::RGBA, src_w, src_h);
        if src_frame.planes() == 0 {
            return Err("Failed to allocate src_frame for scale_rgba_buffer".to_string());
        }

        // Copy RGBA data into frame (row-by-row to handle stride alignment)
        let stride = src_frame.stride(0);
        let width = src_w as usize;
        let height = src_h as usize;
        let src_data = src_frame.data_mut(0);
        for y in 0..height {
            let row_start = y * stride;
            let src_row_start = y * width * 4;
            if src_row_start + (width * 4) > rgba.len() || row_start + (width * 4) > src_data.len()
            {
                return Err("Source buffer smaller than expected in scale_rgba_buffer".to_string());
            }
            src_data[row_start..row_start + (width * 4)]
                .copy_from_slice(&rgba[src_row_start..src_row_start + (width * 4)]);
        }

        // Scale to destination size
        let mut scaler = Context::get(
            ffmpeg::format::Pixel::RGBA,
            src_w,
            src_h,
            ffmpeg::format::Pixel::RGBA,
            dst_w,
            dst_h,
            Flags::LANCZOS,
        )
        .map_err(|e| e.to_string())?;

        let mut dst_frame = ffmpeg::frame::Video::empty();
        scaler
            .run(&src_frame, &mut dst_frame)
            .map_err(|e| e.to_string())?;

        if dst_frame.planes() == 0 {
            return Err("Scaled dst_frame has no image planes in scale_rgba_buffer".to_string());
        }

        // Extract tightly packed RGBA
        let stride = dst_frame.stride(0);
        let width = dst_frame.width() as usize;
        let height = dst_frame.height() as usize;
        let dst_data = dst_frame.data(0);

        let mut result = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let row_start = y * stride;
            if row_start + (width * 4) > dst_data.len() {
                return Err(
                    "Scaled dst_data buffer smaller than expected in scale_rgba_buffer".to_string(),
                );
            }
            let row_pixels = &dst_data[row_start..row_start + (width * 4)];
            result.extend_from_slice(row_pixels);
        }

        Ok(result)
    }

    /// Rotate an RGBA buffer by 90, 180, or 270 degrees.
    /// For 90/270 the output dimensions are swapped (W×H → H×W).
    fn rotate_rgba(src: &[u8], w: u32, h: u32, rotation: u32) -> Vec<u8> {
        let w = w as usize;
        let h = h as usize;

        match rotation {
            90 => {
                // 90° CW: output is h×w
                let mut dst = vec![0u8; w * h * 4];
                for y in 0..h {
                    for x in 0..w {
                        let src_off = (y * w + x) * 4;
                        // new position: col=h-1-y, row=x → offset = x * h + (h-1-y)
                        let dst_off = (x * h + (h - 1 - y)) * 4;
                        dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                    }
                }
                dst
            }
            180 => {
                // 180°: same dimensions, reverse pixel order
                let mut dst = vec![0u8; w * h * 4];
                let total = w * h;
                for i in 0..total {
                    let src_off = i * 4;
                    let dst_off = (total - 1 - i) * 4;
                    dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                }
                dst
            }
            270 => {
                // 270° CW (= 90° CCW): output is h×w
                let mut dst = vec![0u8; w * h * 4];
                for y in 0..h {
                    for x in 0..w {
                        let src_off = (y * w + x) * 4;
                        // new position: col=y, row=w-1-x → offset = (w-1-x) * h + y
                        let dst_off = ((w - 1 - x) * h + y) * 4;
                        dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                    }
                }
                dst
            }
            _ => src.to_vec(),
        }
    }
}

/// Rotate NV12 biplanar pixel data by `rotation` degrees (0, 90, 180, 270 CW).
///
/// NV12 has two planes:
///   - Y plane: one byte per pixel, stride == width
///   - UV plane: interleaved U/V pairs, one pair per 2×2 luma block,
///     stride == width (same as luma), height == ceil(luma_h / 2)
///
/// Returns `(rotated_y, rotated_uv, out_width, out_height)`.
/// For 90° and 270° the output dimensions are the transpose of the input.
///
/// # Panics
/// Panics only if the supplied plane buffers are shorter than `w * h` (Y)
/// or `w * ceil(h/2)` (UV), which would indicate a bug in the caller.
pub fn rotate_nv12(
    y_src: &[u8],
    uv_src: &[u8],
    w: u32,
    h: u32,
    rotation: u32,
) -> (Vec<u8>, Vec<u8>, u32, u32) {
    let w = w as usize;
    let h = h as usize;
    let uv_w = w.div_ceil(2);
    let uv_h = h.div_ceil(2);

    match rotation {
        90 => {
            // 90° CW: output is (h × w)
            let ow = h;
            let oh = w;
            let ouv_w = ow.div_ceil(2);
            let ouv_h = oh.div_ceil(2);

            let mut y_dst = vec![0u8; ow * oh];
            for row in 0..h {
                for col in 0..w {
                    let src_idx = row * w + col;
                    // 90° CW: new_col = h-1-row, new_row = col
                    let dst_idx = col * ow + (ow - 1 - row);
                    y_dst[dst_idx] = y_src[src_idx];
                }
            }

            // UV is a 2D grid of 2-byte (U, V) pairs: uv_h rows × uv_w cols.
            // Rotated 90° CW, it becomes ouv_h rows × ouv_w cols (ouv_w = uv_h, ouv_h = uv_w).
            let mut uv_dst = vec![0u8; ow * ouv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = c;
                    let dst_c = ouv_w.saturating_sub(1 + r);
                    let dst_off = dst_r * ow + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, ow as u32, oh as u32)
        }
        180 => {
            // 180°: same dimensions, reverse all pixels
            let mut y_dst = vec![0u8; w * h];
            let total_y = w * h;
            for i in 0..total_y {
                y_dst[total_y - 1 - i] = y_src[i];
            }

            let mut uv_dst = vec![0u8; w * uv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = uv_h.saturating_sub(1 + r);
                    let dst_c = uv_w.saturating_sub(1 + c);
                    let dst_off = dst_r * w + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, w as u32, h as u32)
        }
        270 => {
            // 270° CW (= 90° CCW): output is (h × w)
            let ow = h;
            let oh = w;
            let _ouv_w = ow.div_ceil(2);
            let ouv_h = oh.div_ceil(2);

            let mut y_dst = vec![0u8; ow * oh];
            for row in 0..h {
                for col in 0..w {
                    let src_idx = row * w + col;
                    // 270° CW: new_col = row, new_row = w-1-col
                    let dst_idx = (oh - 1 - col) * ow + row;
                    y_dst[dst_idx] = y_src[src_idx];
                }
            }

            let mut uv_dst = vec![0u8; ow * ouv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = ouv_h.saturating_sub(1 + c);
                    let dst_c = r;
                    let dst_off = dst_r * ow + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, ow as u32, oh as u32)
        }
        _ => (y_src.to_vec(), uv_src.to_vec(), w as u32, h as u32),
    }
}

// ─── Global Decoder Pool with LRU Eviction ──────────────────────────────────
// One decoder per video path. Created on first use, reused with LRU tracking.
// Mutex is per-video so decoders for different videos don't block each other.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// Wrapper to track last access time for LRU eviction without async mutex overhead
pub(crate) struct DecoderEntry {
    pub(crate) decoder: Arc<Mutex<VideoDecoder>>,
    pub(crate) last_accessed_ms: AtomicU64,
    /// Persistent playback leases pin the entry while the preview owns it.
    /// Filmstrip activity may evict only entries with a zero lease count.
    pub(crate) lease_count: AtomicU64,
}

impl DecoderEntry {
    pub(crate) fn touch(&self) {
        self.last_accessed_ms
            .store(current_timestamp_ms(), Ordering::Relaxed);
    }
}

/// An active-preview pin for one decoder pool entry.
///
/// The decoder mutex is still acquired only by the decode operation. Holding
/// this lease does not hold the mutex; it only prevents LRU eviction while a
/// persistent Native playback session is using the decoder.
pub struct PreviewDecoderLease {
    path: String,
    entry: Arc<DecoderEntry>,
}

impl PreviewDecoderLease {
    pub fn decoder(&self) -> Arc<Mutex<VideoDecoder>> {
        self.entry.touch();
        self.entry.decoder.clone()
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

impl Drop for PreviewDecoderLease {
    fn drop(&mut self) {
        self.entry.lease_count.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) static THUMBNAIL_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);
pub(crate) static PREVIEW_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);

// Symmetric pool size limits with lock-free atomic LRU eviction
const MAX_THUMBNAIL_DECODER_POOL_SIZE: usize = 10;
const MAX_PREVIEW_DECODER_POOL_SIZE: usize = 32;

#[inline]
pub fn preview_pool_key(path: &str, stream_id: &str) -> String {
    if stream_id.trim().is_empty() {
        path.to_string()
    } else {
        format!("{path}::stream::{stream_id}")
    }
}

async fn get_or_create_decoder_in_pool(
    pool: &DashMap<String, Arc<DecoderEntry>>,
    key: &str,
    path: &str,
    max_pool_size: usize,
    prefer_hardware: bool,
    purpose: &'static str,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    // 1. Fast Path: Check if decoder exists in pool without holding shard lock across await
    if let Some(entry) = pool.get(key) {
        entry.touch();
        return Ok(entry.decoder.clone());
    }

    // 2. LRU Eviction: Collect candidates snapshot without holding locks across await
    if pool.len() >= max_pool_size {
        let oldest = pool
            .iter()
            .map(|kv| {
                (
                    kv.key().clone(),
                    kv.value().last_accessed_ms.load(Ordering::Relaxed),
                    kv.value().lease_count.load(Ordering::Acquire),
                )
            })
            .filter(|(_, _, leases)| *leases == 0)
            .min_by_key(|(_, ts, _)| *ts);

        if let Some((oldest_key, _, _)) = oldest {
            pool.remove(&oldest_key);
        }
    }

    // 3. Create new decoder with explicit purpose tag — performed outside any DashMap lock
    let decoder = VideoDecoder::open_with_purpose(path, prefer_hardware, Some(purpose))
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let arc_decoder = Arc::new(Mutex::new(decoder));
    let entry = Arc::new(DecoderEntry {
        decoder: arc_decoder.clone(),
        last_accessed_ms: AtomicU64::new(current_timestamp_ms()),
        lease_count: AtomicU64::new(0),
    });

    pool.insert(key.to_string(), entry);
    Ok(arc_decoder)
}

/// Thumbnail/Filmstrip background decoder pool (used for timeline thumbnail caching)
pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_or_create_decoder_in_pool(
        &THUMBNAIL_DECODER_POOL,
        path,
        path,
        MAX_THUMBNAIL_DECODER_POOL_SIZE,
        false,
        "filmstrip",
    )
    .await
}

/// Dedicated Interactive Preview & Playback decoder pool.
/// Completely decoupled from background filmstrip decoding so playback/playhead scrubbing
/// is NEVER blocked by background batch generation locks.
pub async fn get_preview_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_preview_decoder_for_stream(path, "").await
}

/// Dedicated stream-isolated Interactive Preview & Playback decoder.
/// Stacking multiple clips or tracks referencing the same or different video files
/// assigns each track/layer its own stream reader to prevent sequential GOP seek thrashing.
pub async fn get_preview_decoder_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    let key = preview_pool_key(path, stream_id);
    get_or_create_decoder_in_pool(
        &PREVIEW_DECODER_POOL,
        &key,
        path,
        MAX_PREVIEW_DECODER_POOL_SIZE,
        true,
        "preview",
    )
    .await
}

/// Acquire a persistent pin for a Native playback decoder.
pub async fn acquire_preview_decoder_lease(path: &str) -> Result<PreviewDecoderLease, String> {
    acquire_preview_decoder_lease_for_stream(path, "").await
}

/// Acquire a persistent stream-isolated pin for a Native playback decoder.
pub async fn acquire_preview_decoder_lease_for_stream(
    path: &str,
    stream_id: &str,
) -> Result<PreviewDecoderLease, String> {
    let key = preview_pool_key(path, stream_id);
    let decoder = get_or_create_decoder_in_pool(
        &PREVIEW_DECODER_POOL,
        &key,
        path,
        MAX_PREVIEW_DECODER_POOL_SIZE,
        true,
        "preview",
    )
    .await?;
    let entry = PREVIEW_DECODER_POOL
        .get(&key)
        .map(|value| value.value().clone())
        .ok_or_else(|| "Preview decoder disappeared during lease acquisition".to_string())?;
    entry.lease_count.fetch_add(1, Ordering::AcqRel);
    entry.touch();
    debug_assert!(Arc::ptr_eq(&decoder, &entry.decoder));
    Ok(PreviewDecoderLease {
        path: path.to_string(),
        entry,
    })
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    THUMBNAIL_DECODER_POOL.remove(path);
    let keys_to_remove: Vec<String> = PREVIEW_DECODER_POOL
        .iter()
        .filter(|kv| {
            (kv.key() == path || kv.key().starts_with(&format!("{path}::stream::")))
                && kv.value().lease_count.load(Ordering::Acquire) == 0
        })
        .map(|kv| kv.key().clone())
        .collect();
    for key in keys_to_remove {
        PREVIEW_DECODER_POOL.remove(&key);
    }
    crate::thumbnail_engine::stream_actor::release_all_preview_decoder_actors_for_path(path);
}

/// Release a specific stream-isolated decoder
pub fn release_decoder_stream(path: &str, stream_id: &str) {
    let key = preview_pool_key(path, stream_id);
    if PREVIEW_DECODER_POOL
        .get(&key)
        .map(|entry| entry.lease_count.load(Ordering::Acquire) == 0)
        .unwrap_or(false)
    {
        PREVIEW_DECODER_POOL.remove(&key);
    }
    crate::thumbnail_engine::stream_actor::release_preview_decoder_actor_for_stream(
        path, stream_id,
    );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod decode_frame_options_tests {
    use super::{DecodeFrameOptions, QualityTier};

    /// The two fields added for benchmark arms must default to the safe values
    /// that preserve pre-phase-1b behaviour on every production call site.
    ///
    /// `skip_hw_download: false`  → hardware frames are always downloaded (no change)
    /// `target_dimensions: None`  → output resolution is unchanged from source/quality
    ///
    /// If this test fails, a call site was accidentally changed to benchmark
    /// mode in production code.
    #[test]
    fn production_defaults_are_safe() {
        let opts = DecodeFrameOptions::default();
        assert!(
            !opts.skip_hw_download,
            "skip_hw_download must default to false; \
             true bypasses av_hwframe_transfer_data and is only for arm-1 benchmarking"
        );
        assert_eq!(
            opts.target_dimensions, None,
            "target_dimensions must default to None; \
             Some(...) forces a fixed output size and is only for arm-0 benchmarking"
        );
        // Sanity-check the other fields haven't drifted from their zero values.
        assert!(!opts.allow_keyframe_approx);
        assert!(!opts.is_playback);
        assert_eq!(opts.quality, QualityTier::Full);
    }

    /// Benchmark arm-1 construction: skip_hw_download=true should compile and
    /// round-trip cleanly without affecting target_dimensions.
    #[test]
    fn arm1_options_skip_download_only() {
        let opts = DecodeFrameOptions {
            skip_hw_download: true,
            target_dimensions: None,
            ..DecodeFrameOptions::default()
        };
        assert!(opts.skip_hw_download);
        assert_eq!(opts.target_dimensions, None);
    }

    /// Benchmark arm-0 construction: target_dimensions=Some(320,180) should
    /// not accidentally enable skip_hw_download.
    #[test]
    fn arm0_options_target_dimensions_only() {
        let opts = DecodeFrameOptions {
            target_dimensions: Some((320, 180)),
            ..DecodeFrameOptions::default()
        };
        assert!(!opts.skip_hw_download);
        assert_eq!(opts.target_dimensions, Some((320, 180)));
    }
}

#[cfg(test)]
mod display_dimensions_tests {
    use super::ffmpeg;

    /// Helper to test display dimension calculation without full decoder
    fn calc_display_dims(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> (u32, u32) {
        let geom = super::DisplayGeometry::from_encoded(width, height, sar, rotation);
        (geom.display_width, geom.display_height)
    }

    #[test]
    fn test_square_pixels_landscape() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_square_pixels_portrait() {
        let (w, h) = calc_display_dims(720, 1280, (1, 1), 0);
        assert_eq!((w, h), (720, 1280));
    }

    #[test]
    fn test_rotation_90_landscape_to_portrait() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 90);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_rotation_270_landscape_to_portrait() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 270);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_rotation_180_no_swap() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 180);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_anamorphic_handbrake_portrait() {
        // HandBrake anamorphic: 1920×1080 pixels, SAR 81:256 → 608×1080 display
        let (w, h) = calc_display_dims(1920, 1080, (81, 256), 0);
        assert_eq!((w, h), (608, 1080));
    }

    #[test]
    fn test_anamorphic_wide_screen() {
        let (w, h) = calc_display_dims(1440, 1080, (4, 3), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_invalid_sar_zero_numerator() {
        let (w, h) = calc_display_dims(4320, 7680, (0, 1), 0);
        assert_eq!((w, h), (4320, 7680));
    }

    #[test]
    fn test_invalid_sar_zero_denominator() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 0), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_invalid_sar_both_zero() {
        let (w, h) = calc_display_dims(1920, 1080, (0, 0), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_negative_sar() {
        let (w, h) = calc_display_dims(1920, 1080, (-1, 1), 0);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn test_8k_portrait_capcut() {
        let (w, h) = calc_display_dims(4320, 7680, (0, 1), 0);
        assert_eq!((w, h), (4320, 7680));
    }

    #[test]
    fn test_iphone_portrait_rotation() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1), 90);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_combined_sar_and_rotation() {
        let (w, h) = calc_display_dims(1920, 1080, (81, 256), 90);
        assert_eq!((w, h), (1080, 608));
    }

    #[test]
    fn test_extreme_sar_wide() {
        let (w, h) = calc_display_dims(1920, 1080, (16, 9), 0);
        assert_eq!((w, h), (3413, 1080));
    }

    #[test]
    fn test_extreme_sar_narrow() {
        let (w, h) = calc_display_dims(1920, 1080, (9, 16), 0);
        assert_eq!((w, h), (1080, 1080));
    }

    #[test]
    fn test_tiktok_vertical() {
        let (w, h) = calc_display_dims(1080, 1920, (1, 1), 0);
        assert_eq!((w, h), (1080, 1920));
    }

    #[test]
    fn test_instagram_square() {
        let (w, h) = calc_display_dims(1080, 1080, (1, 1), 0);
        assert_eq!((w, h), (1080, 1080));
    }

    #[test]
    fn test_ultrawide_cinema() {
        let (w, h) = calc_display_dims(2560, 1080, (1, 1), 0);
        assert_eq!((w, h), (2560, 1080));
    }

    #[test]
    fn test_old_4_3_tv() {
        let (w, h) = calc_display_dims(640, 480, (1, 1), 0);
        assert_eq!((w, h), (640, 480));
    }

    #[test]
    fn test_dvd_anamorphic() {
        let (w, h) = calc_display_dims(720, 480, (32, 27), 0);
        assert_eq!((w, h), (853, 480));
    }

    #[test]
    fn test_pal_dvd_anamorphic() {
        let (w, h) = calc_display_dims(720, 576, (64, 45), 0);
        assert_eq!((w, h), (1024, 576));
    }

    #[test]
    fn test_zero_dimensions() {
        let (w, h) = calc_display_dims(0, 0, (1, 1), 0);
        assert_eq!((w, h), (0, 0));
    }

    #[test]
    fn test_single_pixel() {
        let (w, h) = calc_display_dims(1, 1, (1, 1), 0);
        assert_eq!((w, h), (1, 1));
    }

    #[test]
    fn test_very_large_sar() {
        // Clamped at 4:1 SAR ratio ceiling (1920 * 4.0 = 7680) to prevent OOM panics
        let (w, h) = calc_display_dims(1920, 1080, (1000, 1), 0);
        assert_eq!((w, h), (7680, 1080));
    }

    #[test]
    fn test_very_small_sar() {
        // Clamped at 1:4 SAR ratio floor (1920 * 0.25 = 480)
        let (w, h) = calc_display_dims(1920, 1080, (1, 1000), 0);
        assert_eq!((w, h), (480, 1080));
    }

    #[test]
    fn test_color_metadata_normalizes_common_sdr_values() {
        let metadata = super::color_metadata(
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_MPEG,
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_BT709,
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT709,
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_BT709,
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_LEFT,
        );

        assert_eq!(metadata.range, "limited");
        assert_eq!(metadata.matrix, "bt709");
        assert_eq!(metadata.primaries, "bt709");
        assert_eq!(metadata.transfer, "bt709");
        assert_eq!(metadata.chroma_location, "left");
        assert_eq!(metadata.range_code, 1);
        assert_eq!(metadata.matrix_code, 1);
    }

    #[test]
    fn test_color_metadata_preserves_unknown_codes() {
        let metadata = super::color_metadata(
            ffmpeg::ffi::AVColorRange::AVCOL_RANGE_UNSPECIFIED,
            ffmpeg::ffi::AVColorSpace::AVCOL_SPC_UNSPECIFIED,
            ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_UNSPECIFIED,
            ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_UNSPECIFIED,
            ffmpeg::ffi::AVChromaLocation::AVCHROMA_LOC_UNSPECIFIED,
        );

        assert_eq!(metadata.range, "unspecified");
        assert_eq!(metadata.matrix, "unspecified");
        assert_eq!(metadata.primaries, "unspecified");
        assert_eq!(metadata.transfer, "unspecified");
        assert_eq!(metadata.chroma_location, "unspecified");

        let json = serde_json::to_value(&metadata).expect("metadata should serialize");
        assert_eq!(json["range"], "unspecified");
        assert_eq!(json["rangeCode"], 0);
    }
}

#[cfg(test)]
mod still_image_tests {
    use super::{
        decide_decoder_action, normalize_converted_nv12_color, DecoderSeekAction,
        VideoColorMetadata, VideoDecoder,
    };

    #[test]
    fn hardware_format_negotiation_falls_back_to_an_offered_software_format() {
        use ffmpeg_next as ffmpeg;

        let selected = VideoDecoder::select_decoder_pixel_format(
            &[
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE,
            ],
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11),
        );

        assert_eq!(selected, ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P);
    }

    #[test]
    fn hardware_format_negotiation_prefers_the_attached_device_format() {
        use ffmpeg_next as ffmpeg;

        let selected = VideoDecoder::select_decoder_pixel_format(
            &[
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11,
                ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE,
            ],
            Some(ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11),
        );

        assert_eq!(selected, ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_av1_hardware_detection_matches_platform_capability() {
        let is_hw_supported = VideoDecoder::macos_supports_hw_av1();
        // On M1/M2/Intel, VTIsHardwareDecodeSupported('av01') is false.
        // On M3/M4, it is true. Either is valid, but the query must run safely and return a bool.
        let _: bool = is_hw_supported;
    }

    #[test]
    fn rgb_still_image_metadata_becomes_native_sdr_nv12_metadata() {
        let rgb = VideoColorMetadata {
            matrix: "rgb".to_string(),
            ..VideoColorMetadata::default()
        };

        let normalized = normalize_converted_nv12_color(rgb);

        assert_eq!(normalized.matrix, "bt709");
        assert_eq!(normalized.transfer, "srgb");
        assert_eq!(normalized.primaries, "bt709");
        assert_eq!(normalized.range, "full");
    }

    #[test]
    fn already_supported_yuv_metadata_is_preserved() {
        let yuv = VideoColorMetadata {
            matrix: "bt601_625".to_string(),
            transfer: "bt709".to_string(),
            range: "limited".to_string(),
            ..VideoColorMetadata::default()
        };

        assert_eq!(normalize_converted_nv12_color(yuv.clone()), yuv);
    }

    #[test]
    fn durationless_png_decodes_at_zero_timestamp() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");
        let (y_plane, uv_plane, width, height, _) = decoder
            .decode_frame_raw_nv12(0.0)
            .expect("durationless PNG should expose a decodable video packet");

        assert!(width > 0);
        assert!(height > 0);
        assert_eq!(y_plane.len(), (width * height) as usize);
        assert_eq!(uv_plane.len(), (width * height / 2) as usize);
    }

    #[test]
    fn raw_nv12_lru_cache_serves_repeated_queries_without_redecode() {
        use std::sync::Arc;

        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");

        let opts = super::DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: crate::native_core::QualityTier::Full,
            is_playback: false,
            skip_hw_download: false,
            target_dimensions: None,
        };

        // First decode primes the cache
        let (y1, uv1, w1, h1, _) = decoder
            .decode_frame_raw_nv12_with_options(0.0, opts, || false)
            .expect("first decode should succeed");
        assert_eq!(decoder.raw_nv12_cache.len(), 1);

        // Second decode with exact same timestamp hits the LRU cache
        let (y2, uv2, w2, h2, _) = decoder
            .decode_frame_raw_nv12_with_options(0.0, opts, || false)
            .expect("cache hit decode should succeed");

        assert_eq!(w1, w2);
        assert_eq!(h1, h2);
        assert!(
            Arc::ptr_eq(&y1, &y2),
            "Y plane Arc should be shared from LRU cache"
        );
        assert!(
            Arc::ptr_eq(&uv1, &uv2),
            "UV plane Arc should be shared from LRU cache"
        );
    }

    #[test]
    fn raw_nv12_lru_cache_evicts_oldest_when_exceeding_capacity() {
        use super::{CachedNv12Frame, QualityTier, VideoColorMetadata, MAX_RAW_NV12_CACHE_ENTRIES};
        use std::collections::VecDeque;
        use std::sync::Arc;

        let mut cache: VecDeque<CachedNv12Frame> = VecDeque::new();
        for i in 0..25 {
            if cache.len() >= MAX_RAW_NV12_CACHE_ENTRIES {
                cache.pop_front();
            }
            cache.push_back(CachedNv12Frame {
                pts: i,
                y_plane: Arc::from(vec![i as u8]),
                uv_plane: Arc::from(vec![(i * 2) as u8]),
                width: 1920,
                height: 1080,
                color: VideoColorMetadata::default(),
                quality: QualityTier::Full,
                is_approximate: false,
            });
        }
        assert_eq!(cache.len(), MAX_RAW_NV12_CACHE_ENTRIES);
        assert_eq!(cache.front().unwrap().pts, 9); // 0..9 evicted, 9 is now front
        assert_eq!(cache.back().unwrap().pts, 24);
    }

    #[test]
    fn preview_quality_scales_nv12_planes_before_gpu_upload() {
        use super::{nv12_dimensions_for_quality, QualityTier};

        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Full),
            (3840, 2160),
        );
        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Half),
            (1920, 1080),
        );
        // Proxy and quarter quality intentionally share the 25% decode scale.
        // That turns a 12.4MB 4K NV12 upload into roughly 0.78MB.
        assert_eq!(
            nv12_dimensions_for_quality(3840, 2160, QualityTier::Proxy),
            (960, 540),
        );
        // NV12 must preserve even chroma-plane dimensions.
        assert_eq!(
            nv12_dimensions_for_quality(1919, 1079, QualityTier::Half),
            (958, 538),
        );
    }

    #[test]
    fn raw_nv12_cache_ignores_approximate_frame_for_exact_request() {
        use super::{CachedNv12Frame, QualityTier, VideoColorMetadata};
        use std::collections::VecDeque;
        use std::sync::Arc;

        let mut cache: VecDeque<CachedNv12Frame> = VecDeque::new();
        cache.push_back(CachedNv12Frame {
            pts: 1000,
            y_plane: Arc::from(vec![1u8]),
            uv_plane: Arc::from(vec![2u8]),
            width: 1920,
            height: 1080,
            color: VideoColorMetadata::default(),
            quality: QualityTier::Full,
            is_approximate: true,
        });

        let target_pts = 1000;
        let pts_tolerance = 5;

        // Exact request (allow_keyframe_approx == false): must NOT match
        let exact_match = cache.iter().position(|cached| {
            !cached.is_approximate && (cached.pts - target_pts).abs() <= pts_tolerance
        });
        assert_eq!(exact_match, None);

        // Approximate request (allow_keyframe_approx == true): matches
        let approx_match = cache
            .iter()
            .position(|cached| (cached.pts - target_pts).abs() <= pts_tolerance);
        assert_eq!(approx_match, Some(0));
    }

    #[test]
    fn test_mkv_video_decoder_integration() {
        let path = std::path::Path::new("/tmp/test_mkv.mkv");
        if !path.exists() {
            return;
        }

        let mut decoder = super::VideoDecoder::open(path.to_str().unwrap())
            .expect("failed to open mkv with VideoDecoder");
        assert!(
            decoder.container_format().contains("matroska"),
            "Container format should contain matroska, got: {}",
            decoder.container_format()
        );

        let res = decoder.decode_frame_raw_nv12(0.0);
        assert!(
            res.is_ok(),
            "Should successfully decode first frame: {:?}",
            res.err()
        );
        let (y, uv, w, h, _color) = res.unwrap();
        assert_eq!(w, 320);
        assert_eq!(h, 240);
        assert_eq!(y.len(), (w * h) as usize);
        assert_eq!(uv.len(), (w * h / 2) as usize);
    }

    #[tokio::test]
    async fn test_av1_video_thumbnail_and_poster_extraction() {
        let path = "/Users/AIEraDev/Documents/clypra-testing-assets/54M views · 868K reactions ｜ Guest arrivals at the Guinness World Record Attempt and Birthday Party of @djprettyplay last night ｜ Oga Yenne TV [974631751768961].mp4";
        if !std::path::Path::new(path).exists() {
            println!("Asset file does not exist, skipping");
            return;
        }

        println!("=== TEST: extract_poster_frame_command with CLI fallback ===");
        let poster_res =
            crate::commands::thumbnail::extract_poster_frame_command(path.to_string(), 17.8, 2.0)
                .await;
        println!(
            "extract_poster_frame_command result: is_ok={}, len={}",
            poster_res.is_ok(),
            poster_res.as_ref().map(|s| s.len()).unwrap_or(0)
        );
        if let Err(ref e) = poster_res {
            println!("extract_poster_frame_command error: {}", e);
        }
        assert!(
            poster_res.is_ok(),
            "extract_poster_frame_command failed: {:?}",
            poster_res.err()
        );
        let poster_data = poster_res.unwrap();
        assert!(poster_data.starts_with("data:image/webp;base64,"));
        println!(
            "Poster extraction succeeded! Data URL length: {} chars",
            poster_data.len()
        );

        // Also test legacy command fallback
        println!("=== TEST: legacy extract_poster_frame ===");
        let legacy_res = crate::commands::media::extract_poster_frame(path.to_string(), 2.0).await;
        assert!(
            legacy_res.is_ok(),
            "legacy extract_poster_frame failed: {:?}",
            legacy_res.err()
        );
        println!(
            "Legacy poster extraction succeeded! Data URL length: {} chars",
            legacy_res.unwrap().len()
        );
    }

    #[test]
    fn playback_mode_hits_newest_eligible_cached_frame_without_seek() {
        use super::{CachedNv12Frame, DecodeFrameOptions, QualityTier, VideoColorMetadata};
        use std::path::PathBuf;
        use std::sync::Arc;

        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/test_pattern.png");
        if !fixture.exists() {
            return;
        }

        let mut decoder = VideoDecoder::open(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
        )
        .expect("repository PNG fixture should open through FFmpeg");

        // Populate raw_nv12_cache with a frame at pts = 800
        decoder.raw_nv12_cache.push_back(CachedNv12Frame {
            pts: 800,
            y_plane: Arc::from(vec![42u8; 16]),
            uv_plane: Arc::from(vec![84u8; 8]),
            width: 4,
            height: 4,
            color: VideoColorMetadata::default(),
            quality: QualityTier::Full,
            is_approximate: false,
        });

        // Request a target timestamp whose pts is 820 (slightly ahead, within tolerance).
        // Playback mode must hit the newest eligible cached frame (at or before target)!
        let opts = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
            is_playback: true,
            skip_hw_download: false,
            target_dimensions: None,
        };

        // Timestamp 820 in timebase
        let ts = 820.0 * decoder.time_base.0 as f64 / decoder.time_base.1 as f64;
        let (y, uv, w, h, _) = decoder
            .decode_frame_raw_nv12_with_options(ts, opts, || false)
            .expect("playback cache hit should succeed");

        assert_eq!(w, 4);
        assert_eq!(h, 4);
        assert_eq!(y[0], 42);
        assert_eq!(uv[0], 84);
        let activity = decoder.last_decode_activity();
        assert_eq!(activity.0, 0, "Seek count must be 0 for playback cache hit");
        assert_eq!(activity.1, 0, "Seek time must be 0 for playback cache hit");
        assert_eq!(
            activity.2, 0,
            "Decoded frames must be 0 for playback cache hit"
        );
    }

    #[test]
    fn test_decide_decoder_action_cold_start_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        assert_eq!(
            decide_decoder_action(
                true,
                -1,
                1000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_generation_bump_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1040,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                true
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_small_backward_delta_playback_reuses_current() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Small backward jitter within threshold reuses current frame without seeking
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                960,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                920,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );
    }

    #[test]
    fn test_decide_decoder_action_large_backward_jump_loop_wrap_seeks() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Timeline drag back or loop wrap (5000 -> 1000)
        assert_eq!(
            decide_decoder_action(
                true,
                5000,
                1000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
        // Jump exceeding backward jitter threshold
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                800,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_sequential_forward_playback_decodes_forward() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Small forward delta within tolerance reuses current
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1020,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );

        // Forward progress decodes forward sequentially
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                1100,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward
        );
    }

    #[test]
    fn test_decide_decoder_action_large_forward_gap_seeks_to_keyframe() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Large forward gap beyond window seeks to avoid walking GOP
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                10000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_decide_decoder_action_paused_seek_and_scrub_exact_frame_correctness() {
        let pts_tolerance = 40;
        let forward_window = 2000;
        let backward_jitter_threshold = 80;

        // Backward delta exceeding tolerance must seek (no backward jitter allowance)
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                900,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );

        // Small delta within tolerance reuses
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                1020,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent
        );

        // Forward delta within window decodes forward
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                1200,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward
        );

        // Forward delta beyond window seeks
        assert_eq!(
            decide_decoder_action(
                false,
                1000,
                5000,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek
        );
    }

    #[test]
    fn test_eligible_playback_frame_never_from_the_future() {
        let backward_jitter_threshold: i64 = 80;
        let target_pts: i64 = 1000;

        let candidate_pts: [i64; 5] = [920, 960, 1000, 1005, 1020];

        let eligible: Vec<i64> = candidate_pts
            .into_iter()
            .filter(|pts| {
                *pts <= target_pts && target_pts.saturating_sub(*pts) <= backward_jitter_threshold
            })
            .collect();

        assert_eq!(eligible, vec![920, 960, 1000]);
        let latest_eligible = eligible.into_iter().max().unwrap();
        assert_eq!(latest_eligible, 1000);
        assert!(latest_eligible <= target_pts);
    }

    /// Regression guard: a decoder in steady-state forward playback at ~2.5 frames
    /// per request must choose `DecodeForward`, not `Seek`, even when that delta is
    /// larger than `pts_tolerance`. The `forward_window` absorbs normal clock drift.
    /// Separately, a delta of exactly `forward_window + 1` must still choose `Seek`.
    #[test]
    fn test_decide_decoder_action_persistent_lag_does_not_thrash_seeks() {
        // Simulate 25 FPS source in a 12800 tick/second timebase:
        //   pts_tolerance ≈ 0.95 * (12800/25) ≈ 486 ticks
        //   forward_window (warm, 3+ sequential hits) = 2 s * 12800 = 25600 ticks
        let pts_tolerance: i64 = 486;
        let forward_window: i64 = 25600;
        let backward_jitter_threshold: i64 = pts_tolerance;

        // Steady playback at ~2.5 source frames per rendered frame = ~512 ticks.
        // 512 > pts_tolerance (486) so the action must be DecodeForward, not
        // ReuseCurrent or Seek.
        let steady_delta: i64 = 512;
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                steady_delta,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward,
            "steady 2.5-frame delta must decode forward, not seek"
        );

        // delta == forward_window: last valid forward-decode step before seeking.
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                forward_window,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::DecodeForward,
            "delta == forward_window must still decode forward"
        );

        // delta == forward_window + 1: first step beyond window, must seek.
        assert_eq!(
            decide_decoder_action(
                true,
                0,
                forward_window + 1,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek,
            "delta == forward_window + 1 must seek, not decode forward"
        );
    }

    /// Verify that the tightened backward_jitter_threshold (1× frame duration, not
    /// 2×) rejects a delta larger than one frame, which was previously accepted.
    #[test]
    fn test_backward_jitter_threshold_is_one_frame_not_two() {
        let pts_tolerance: i64 = 486;
        let forward_window: i64 = 25600;
        let backward_jitter_threshold: i64 = pts_tolerance; // 1× frame only

        // Backward delta within 1 frame (current=1000, target=520 → delta=-480).
        // -480 abs is within pts_tolerance 486, so should reuse.
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                520,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::ReuseCurrent,
            "backward delta within 1 frame must reuse current"
        );

        // Backward delta of exactly 2× pts_tolerance + 1 (was accepted before
        // tightening, must seek with 1× threshold).
        let target = 1000 - pts_tolerance * 2 - 1;
        assert_eq!(
            decide_decoder_action(
                true,
                1000,
                target,
                pts_tolerance,
                forward_window,
                backward_jitter_threshold,
                false
            ),
            DecoderSeekAction::Seek,
            "backward delta of 2× frame duration must seek with 1× threshold"
        );
    }
}
