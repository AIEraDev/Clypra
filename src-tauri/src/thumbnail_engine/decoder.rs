//! Native FFmpeg decoder with hardware acceleration.
//!
//! Features:
//! - Reusable decoder pool (one per video file)
//! - Hardware decode (VideoToolbox/D3D11VA/VAAPI)
//! - Sequential decoding optimization (avoids seeking during scrubbing)
//! - Display-aware geometry (respects SAR/DAR/rotation)

use dashmap::DashMap;
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
        if target_pts <= self.current_pts {
            return false;
        }

        let distance = target_pts - self.current_pts;
        if distance > sequential_window {
            return false;
        }

        if self.sequential_hits >= 3 {
            return distance <= sequential_window * 2;
        }

        true
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
    last_raw_nv12: Option<(i64, Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata)>,
}

impl VideoDecoder {
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
        Self::open_internal(path, false)
    }

    /// Open a background thumbnail decoder. Filmstrip extraction needs a
    /// stable CPU frame for batch scaling; some VideoToolbox frame surfaces do
    /// not support the transfer formats required by that path (EINVAL/-22).
    pub fn open_software(path: &str) -> Result<Self, String> {
        Self::open_internal(path, false)
    }

    /// Open an interactive decoder with platform hardware acceleration.
    pub fn open_hardware(path: &str) -> Result<Self, String> {
        Self::open_internal(path, true)
    }

    fn open_internal(path: &str, prefer_hardware: bool) -> Result<Self, String> {
        ffmpeg::init().map_err(|e| e.to_string())?;
        ffmpeg::util::log::set_level(ffmpeg::util::log::Level::Error);

        let input_ctx = ffmpeg::format::input(&path).map_err(|e| format!("Cannot open: {}", e))?;

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
        let codec_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .map_err(|e| e.to_string())?;

        let (decoder, width, height) = if prefer_hardware {
            Self::open_with_hw(codec_ctx)?
        } else {
            Self::open_software_codec(codec_ctx)?
        };

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
        })
    }

    /// Return the stream-level metadata used to configure native rendering.
    pub fn metadata(&self) -> VideoStreamMetadata {
        self.stream_metadata.clone()
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
            linesize_y: frame.stride(0).min(i32::MAX as usize) as i32,
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

    unsafe extern "C" fn get_hw_format(
        _ctx: *mut ffmpeg::ffi::AVCodecContext,
        pix_fmts: *const ffmpeg::ffi::AVPixelFormat,
    ) -> ffmpeg::ffi::AVPixelFormat {
        let mut p = pix_fmts;
        while !p.is_null() && *p != ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE {
            if *p == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX
                || *p == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_D3D11
                || *p == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_VAAPI
                || *p == ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_CUDA
            {
                return *p;
            }
            p = p.add(1);
        }
        ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_NONE
    }

    fn open_software_codec(
        ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
        let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
        let w = decoder.width();
        let h = decoder.height();
        Ok((decoder, w, h))
    }

    fn open_with_hw(
        mut ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
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

        let mut _hw_attached = false;
        for &hw_type in hw_types {
            unsafe {
                let mut hw_ctx = std::ptr::null_mut();
                let ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                    &mut hw_ctx,
                    hw_type,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    0,
                );
                if ret >= 0 && !hw_ctx.is_null() {
                    (*ctx.as_mut_ptr()).hw_device_ctx = ffmpeg::ffi::av_buffer_ref(hw_ctx);
                    ffmpeg::ffi::av_buffer_unref(&mut hw_ctx);
                    (*ctx.as_mut_ptr()).get_format = Some(Self::get_hw_format);
                    _hw_attached = true;
                    break;
                }
            }
        }

        let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
        let w = decoder.width();
        let h = decoder.height();

        Ok((decoder, w, h))
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

    fn hw_to_cpu_frame(frame: ffmpeg::frame::Video) -> Result<ffmpeg::frame::Video, String> {
        if frame.format() == ffmpeg::format::Pixel::VIDEOTOOLBOX
            || frame.format() == ffmpeg::format::Pixel::D3D11
            || frame.format() == ffmpeg::format::Pixel::VAAPI
        {
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
                    (*cpu_frame.as_mut_ptr()).format =
                        ffmpeg::ffi::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
                    ret = ffmpeg::ffi::av_hwframe_transfer_data(
                        cpu_frame.as_mut_ptr(),
                        frame.as_ptr(),
                        0,
                    );
                }
                if ret < 0 {
                    return Err(format!("HW frame transfer failed (ret={})", ret));
                }
            }
            Ok(cpu_frame)
        } else {
            Ok(frame)
        }
    }

    fn to_cpu_frame(&self, frame: ffmpeg::frame::Video) -> Result<ffmpeg::frame::Video, String> {
        Self::hw_to_cpu_frame(frame)
    }

    /// Extract raw NV12 planes (Y plane + interleaved UV plane) directly from a decoded frame without CPU sws_scale.
    pub fn extract_nv12_planes(
        &self,
        frame: &ffmpeg::frame::Video,
    ) -> Option<(Vec<u8>, Vec<u8>, u32, u32)> {
        if frame.format() == ffmpeg::format::Pixel::NV12 {
            let width = frame.width() as usize;
            let height = frame.height() as usize;
            let y_stride = frame.stride(0);
            let uv_stride = frame.stride(1);
            let y_data = frame.data(0);
            let uv_data = frame.data(1);

            let mut y_plane = Vec::with_capacity(width * height);
            for y in 0..height {
                let row_start = y * y_stride;
                y_plane.extend_from_slice(&y_data[row_start..row_start + width]);
            }

            let uv_height = height.div_ceil(2);
            let uv_width = width.div_ceil(2);
            let uv_packed_stride = uv_width * 2;
            let mut uv_plane = Vec::with_capacity(uv_packed_stride * uv_height);
            for y in 0..uv_height {
                let row_start = y * uv_stride;
                let copy_len = width.min(uv_packed_stride);
                uv_plane.extend_from_slice(&uv_data[row_start..row_start + copy_len]);
                if copy_len < uv_packed_stride {
                    uv_plane.extend(std::iter::repeat_n(0u8, uv_packed_stride - copy_len));
                }
            }

            Some((y_plane, uv_plane, width as u32, height as u32))
        } else if frame.format() == ffmpeg::format::Pixel::YUV420P {
            // Direct zero-swscale conversion: interleave planar U and V into NV12 directly
            let width = frame.width() as usize;
            let height = frame.height() as usize;
            let y_stride = frame.stride(0);
            let u_stride = frame.stride(1);
            let v_stride = frame.stride(2);
            let y_data = frame.data(0);
            let u_data = frame.data(1);
            let v_data = frame.data(2);

            let mut y_plane = Vec::with_capacity(width * height);
            for y in 0..height {
                let row_start = y * y_stride;
                y_plane.extend_from_slice(&y_data[row_start..row_start + width]);
            }

            let uv_height = height.div_ceil(2);
            let uv_width = width.div_ceil(2);
            let uv_packed_stride = uv_width * 2;
            let mut uv_plane = Vec::with_capacity(uv_packed_stride * uv_height);

            for y in 0..uv_height {
                let u_row = y * u_stride;
                let v_row = y * v_stride;
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
    ) -> Result<(Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata), String> {
        self.decode_frame_raw_nv12_with_cancel(timestamp_secs, || false)
    }

    /// Decode a frame while allowing the native preview owner to supersede it
    /// at packet/frame boundaries. The regular decoder API remains unchanged
    /// for thumbnails and other callers.
    #[allow(clippy::type_complexity)]
    pub fn decode_frame_raw_nv12_with_cancel<F: Fn() -> bool>(
        &mut self,
        timestamp_secs: f64,
        is_cancelled: F,
    ) -> Result<(Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata), String> {
        if is_cancelled() {
            return Err("Native preview request cancelled".to_string());
        }
        let ts = self.clamp_timestamp(timestamp_secs);
        let target_pts = (ts * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        if let Some((cached_pts, y, uv, width, height, color)) = &self.last_raw_nv12 {
            if *cached_pts == target_pts {
                return Ok((y.clone(), uv.clone(), *width, *height, color.clone()));
            }
        }
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;
        self.state.update_sequential(target_pts);

        let needs_seek = self.state.current_pts < 0
            || target_pts < self.state.current_pts
            || !self.state.can_decode_forward(target_pts, sequential_window);

        if needs_seek {
            if is_cancelled() {
                return Err("Native preview request cancelled".to_string());
            }
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
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = frame;
                    found = true;
                    break 'decode;
                }
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
        }

        // A late timestamp can be past the last packet even when it is still
        // inside the container duration. Retry from an earlier keyframe so the
        // preview can use the last available decoded frame.
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
                                break 'retry_decode;
                            }
                            frame = ffmpeg::frame::Video::empty();
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

        let cpu_frame = self.to_cpu_frame(best_frame)?;
        let frame_color = self.frame_metadata(&cpu_frame).color;
        let result = if let Some(nv12) = self.extract_nv12_planes(&cpu_frame) {
            Ok((
                nv12.0,
                nv12.1,
                nv12.2,
                nv12.3,
                normalize_converted_nv12_color(frame_color),
            ))
        } else {
            use ffmpeg_next::software::scaling::{context::Context, flag::Flags};
            let mut scaler = Context::get(
                cpu_frame.format(),
                cpu_frame.width(),
                cpu_frame.height(),
                ffmpeg::format::Pixel::NV12,
                cpu_frame.width(),
                cpu_frame.height(),
                Flags::FAST_BILINEAR,
            )
            .map_err(|e| e.to_string())?;

            let mut out = ffmpeg::frame::Video::empty();
            scaler
                .run(&cpu_frame, &mut out)
                .map_err(|e| e.to_string())?;
            self.extract_nv12_planes(&out)
                .map(|nv12| {
                    (
                        nv12.0,
                        nv12.1,
                        nv12.2,
                        nv12.3,
                        normalize_converted_nv12_color(frame_color),
                    )
                })
                .ok_or_else(|| "Failed to extract converted NV12 planes".to_string())
        }?;
        self.last_raw_nv12 = Some((
            target_pts,
            result.0.clone(),
            result.1.clone(),
            result.2,
            result.3,
            result.4.clone(),
        ));
        Ok(result)
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

        // FFmpeg frame data may have stride padding - copy tightly packed RGBA
        let stride = out.stride(0);
        let width = out.width() as usize;
        let height = out.height() as usize;
        let src_data = out.data(0);

        // Copy row by row to handle stride
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let row_start = y * stride;
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

        // Copy RGBA data into frame (row-by-row to handle stride alignment)
        let stride = src_frame.stride(0);
        let width = src_w as usize;
        let height = src_h as usize;
        let src_data = src_frame.data_mut(0);
        for y in 0..height {
            let row_start = y * stride;
            let src_row_start = y * width * 4;
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

        // Extract tightly packed RGBA
        let stride = dst_frame.stride(0);
        let width = dst_frame.width() as usize;
        let height = dst_frame.height() as usize;
        let dst_data = dst_frame.data(0);

        let mut result = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let row_start = y * stride;
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
}

impl DecoderEntry {
    pub(crate) fn touch(&self) {
        self.last_accessed_ms
            .store(current_timestamp_ms(), Ordering::Relaxed);
    }
}

pub(crate) static THUMBNAIL_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);
pub(crate) static PREVIEW_DECODER_POOL: Lazy<DashMap<String, Arc<DecoderEntry>>> =
    Lazy::new(DashMap::new);

// Symmetric pool size limits with lock-free atomic LRU eviction (Total 20 max decoders)
const MAX_THUMBNAIL_DECODER_POOL_SIZE: usize = 10;
const MAX_PREVIEW_DECODER_POOL_SIZE: usize = 10;

async fn get_or_create_decoder_in_pool(
    pool: &DashMap<String, Arc<DecoderEntry>>,
    path: &str,
    max_pool_size: usize,
    prefer_hardware: bool,
) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    // 1. Fast Path: Check if decoder exists in pool without holding shard lock across await
    if let Some(entry) = pool.get(path) {
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
                )
            })
            .min_by_key(|(_, ts)| *ts);

        if let Some((oldest_key, _)) = oldest {
            pool.remove(&oldest_key);
        }
    }

    // 3. Create new decoder — performed outside any DashMap lock
    let decoder = if prefer_hardware {
        VideoDecoder::open_hardware(path)
    } else {
        VideoDecoder::open_software(path)
    }
    .map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let arc_decoder = Arc::new(Mutex::new(decoder));
    let entry = Arc::new(DecoderEntry {
        decoder: arc_decoder.clone(),
        last_accessed_ms: AtomicU64::new(current_timestamp_ms()),
    });

    pool.insert(path.to_string(), entry);
    Ok(arc_decoder)
}

/// Thumbnail/Filmstrip background decoder pool (used for timeline thumbnail caching)
pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_or_create_decoder_in_pool(
        &THUMBNAIL_DECODER_POOL,
        path,
        MAX_THUMBNAIL_DECODER_POOL_SIZE,
        false,
    )
    .await
}

/// Dedicated Interactive Preview & Playback decoder pool.
/// Completely decoupled from background filmstrip decoding so playback/playhead scrubbing
/// is NEVER blocked by background batch generation locks.
pub async fn get_preview_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    get_or_create_decoder_in_pool(
        &PREVIEW_DECODER_POOL,
        path,
        MAX_PREVIEW_DECODER_POOL_SIZE,
        true,
    )
    .await
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    THUMBNAIL_DECODER_POOL.remove(path);
    PREVIEW_DECODER_POOL.remove(path);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

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
    use super::{normalize_converted_nv12_color, VideoColorMetadata, VideoDecoder};

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
}
