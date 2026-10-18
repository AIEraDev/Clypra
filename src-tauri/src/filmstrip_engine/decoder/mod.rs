//! Native FFmpeg decoder with hardware acceleration.
//!
//! Features:
//! - Reusable decoder pool (one per video file)
//! - Hardware decode (VideoToolbox/D3D11VA/VAAPI)
//! - Sequential decoding optimization (avoids seeking during scrubbing)
//! - Display-aware geometry (respects SAR/DAR/rotation)

use crate::native_core::{performance::ServedFrom, QualityTier};
use ffmpeg_next as ffmpeg;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub mod geometry;
pub mod metadata;
pub mod pixel_ops;
pub mod pool;
pub mod seek_planner;

#[cfg(test)]
mod tests;

pub use crate::filmstrip_engine::decoder::geometry::*;
pub use crate::filmstrip_engine::decoder::metadata::*;
pub use crate::filmstrip_engine::decoder::pixel_ops::*;
pub use crate::filmstrip_engine::decoder::pool::*;
pub use crate::filmstrip_engine::decoder::seek_planner::*;


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

    pub fn hw_device_type(&self) -> Option<&'static str> {
        self.last_decode_activity.hw_device_type.or_else(|| {
            self.stream_metadata.is_hardware_accelerated.then_some({
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
                    "unknown"
                }
            })
        })
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
        crate::filmstrip_engine::demuxer::configure_stream_discard(&mut input_ctx, stream_index);

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
        (1.0f64 / stream_fps.max(1.0f64)).min(0.2f64)
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
    /// Returns raw RGBA bytes scaled to fit within `(max_w, max_h)` while preserving
    /// aspect ratio (or full display resolution if `max_w == 0 || max_h == 0`).
    pub fn decode_frame_scaled(
        &mut self,
        timestamp_secs: f64,
        max_w: u32,
        max_h: u32,
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

        let (target_w, target_h) =
            if max_w > 0 && max_h > 0 && (display_w > max_w || display_h > max_h) {
                let scale =
                    (max_w as f64 / display_w as f64).min(max_h as f64 / display_h as f64);
                let w = (((display_w as f64 * scale).round() as u32).max(1) + 1) & !1;
                let h = (((display_h as f64 * scale).round() as u32).max(1) + 1) & !1;
                (w, h)
            } else {
                (display_w, display_h)
            };

        // Account for rotation when choosing scale target
        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (target_h, target_w)
        } else {
            (target_w, target_h)
        };

        // Scale YUV → RGBA
        let scaled = self.scale_to_rgba_explicit(&cpu_frame, scale_w, scale_h)?;

        let rgba = if self.rotation != 0 {
            Self::rotate_rgba(&scaled, scale_w, scale_h, self.rotation)
        } else {
            scaled
        };

        Ok((rgba, target_w, target_h))
    }

    /// Returns raw RGBA bytes at `(display_w, display_h)` after SAR correction
    /// and rotation. No downsampling is applied here.
    pub fn decode_frame_full_res(
        &mut self,
        timestamp_secs: f64,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        self.decode_frame_scaled(timestamp_secs, 0, 0)
    }

    /// Decode multiple frames in a single forward pass, scaled to fit within
    /// `(max_w, max_h)` to prevent allocating multi-gigabyte uncompressed RGBA buffers
    /// for 4K/8K timeline filmstrip generation.
    pub fn decode_frames_batch_scaled(
        &mut self,
        target_timestamps_secs: &[f64],
        max_w: u32,
        max_h: u32,
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
        let (target_w, target_h) =
            if max_w > 0 && max_h > 0 && (display_w > max_w || display_h > max_h) {
                let scale =
                    (max_w as f64 / display_w as f64).min(max_h as f64 / display_h as f64);
                let w = (((display_w as f64 * scale).round() as u32).max(1) + 1) & !1;
                let h = (((display_h as f64 * scale).round() as u32).max(1) + 1) & !1;
                (w, h)
            } else {
                (display_w, display_h)
            };

        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (target_h, target_w)
        } else {
            (target_w, target_h)
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
                width: target_w,
                height: target_h,
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
        self.decode_frames_batch_scaled(target_timestamps_secs, 0, 0)
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
        let frame_duration_secs = (1.0f64 / stream_fps.max(1.0f64)).min(0.2f64);
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
        let frame_duration_secs = (1.0f64 / stream_fps.max(1.0f64)).min(0.2f64);
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

