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
use std::sync::Arc;
use tokio::sync::Mutex;

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

impl DisplayGeometry {
    pub fn from_encoded(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> Self {
        let (display_w, display_h) = if sar.0 > 0 && sar.1 > 0 && sar.0 != sar.1 {
            let w = ((width as f64) * (sar.0 as f64) / (sar.1 as f64)).round() as u32;
            (w, height)
        } else {
            (width, height)
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
    /// Decoder state for sequential optimization
    state: DecoderState,
}

impl VideoDecoder {
    pub fn open(path: &str) -> Result<Self, String> {
        ffmpeg::init().map_err(|e| e.to_string())?;

        let input_ctx = ffmpeg::format::input(&path).map_err(|e| format!("Cannot open: {}", e))?;

        let stream = input_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("No video stream")?;

        let stream_index = stream.index();
        let time_base = stream.time_base();

        let sar = unsafe {
            let codecpar = (*stream.as_ptr()).codecpar;
            if !codecpar.is_null() {
                let sar_num = (*codecpar).sample_aspect_ratio.num;
                let sar_den = (*codecpar).sample_aspect_ratio.den;
                if sar_den > 0 {
                    (sar_num, sar_den)
                } else {
                    (1, 1) // Square pixels
                }
            } else {
                (1, 1)
            }
        };

        eprintln!("[VideoDecoder::open] SAR: {}:{}", sar.0, sar.1);

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

        if rotation != 0 {
            eprintln!("[VideoDecoder::open] Detected rotation={}°", rotation);
        }

        let duration = input_ctx.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;
        let codec_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .map_err(|e| e.to_string())?;

        let (decoder, width, height) = Self::open_with_hw(codec_ctx)?;

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
            state: DecoderState::new(),
        })
    }

    pub fn display_dimensions(&self) -> (u32, u32) {
        let display_w = if self.sar.0 > 0 && self.sar.1 > 0 && self.sar.0 != self.sar.1 {
            ((self.width as f64) * (self.sar.0 as f64) / (self.sar.1 as f64)).round() as u32
        } else {
            self.width
        };
        let display_h = self.height;

        if self.rotation == 90 || self.rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        }
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
        if self.time_base.denominator() > 0 {
            self.time_base.denominator() as f64 / self.time_base.numerator() as f64
        } else {
            30.0
        }
    }

    fn open_with_hw(
        mut ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
        #[cfg(target_os = "macos")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX as u32];
        #[cfg(target_os = "windows")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA as u32];
        #[cfg(target_os = "linux")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI as u32];
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let hw_types: &[u32] = &[];

        for &hw_type_raw in hw_types {
            unsafe {
                let hw_type = std::mem::transmute::<u32, ffmpeg::ffi::AVHWDeviceType>(hw_type_raw);
                let mut hw_ctx = std::ptr::null_mut();
                let ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                    &mut hw_ctx,
                    hw_type,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    0,
                );
                if ret >= 0 {
                    (*ctx.as_mut_ptr()).hw_device_ctx = ffmpeg::ffi::av_buffer_ref(hw_ctx);
                    ffmpeg::ffi::av_buffer_unref(&mut hw_ctx);
                }
            }
        }

        let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
        let w = decoder.width();
        let h = decoder.height();

        eprintln!("[VideoDecoder::open] Opened {}x{} decoder", w, h);

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
        let ts = timestamp_secs.max(0.0).min(self.duration - 0.001);
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

    /// Seek and decode a single frame. Optimized for sequential timeline scrubbing.
    pub fn decode_frame(
        &mut self,
        timestamp_secs: f64,
        out_width: u32,
        out_height: u32,
    ) -> Result<Vec<u8>, String> {
        let start = std::time::Instant::now();

        // Clamp to video bounds
        let ts = timestamp_secs.max(0.0).min(self.duration - 0.001);

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
            eprintln!(
                "[decode_frame] SEQUENTIAL: @{:.3}s (forward decode, no seek, hits={})",
                ts, self.state.sequential_hits
            );
            false
        } else {
            // Too far forward - seek
            true
        };

        let mut seek_time = std::time::Duration::ZERO;
        let mut packets_decoded = 0u32;

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

            seek_time = seek_start.elapsed();
            eprintln!(
                "[decode_frame] SEEK: @{:.3}s (seek_time={:?})",
                ts, seek_time
            );
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
            packets_decoded += 1;

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

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        let decode_time = start.elapsed();

        // Handle hardware frames (copy back from GPU to CPU if needed)
        let cpu_frame = self.to_cpu_frame(best_frame)?;

        // Explicit display geometry calculation (prevents accidental SAR handling)
        let (display_w, display_h) = self.display_dimensions();

        eprintln!(
            "[decode_frame] Display geometry: {}×{} pixels → {}×{} display (SAR {}:{})",
            self.width, self.height, display_w, display_h, self.sar.0, self.sar.1
        );

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

        let total_time = start.elapsed();

        if needs_seek {
            eprintln!(
                "[decode_frame] @{:.3}s: seek={:?} decode={:?} total={:?} ({} packets)",
                ts,
                seek_time,
                decode_time - seek_time,
                total_time,
                packets_decoded
            );
        } else {
            eprintln!(
                "[decode_frame] @{:.3}s: forward_decode={:?} total={:?} ({} packets, seq_hits={})",
                ts, decode_time, total_time, packets_decoded, self.state.sequential_hits
            );
        }

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

    fn to_cpu_frame(&self, frame: ffmpeg::frame::Video) -> Result<ffmpeg::frame::Video, String> {
        // If it's a hardware frame, transfer it to system memory
        if frame.format() == ffmpeg::format::Pixel::VIDEOTOOLBOX
            || frame.format() == ffmpeg::format::Pixel::D3D11
            || frame.format() == ffmpeg::format::Pixel::VAAPI
        {
            let mut cpu_frame = ffmpeg::frame::Video::empty();
            unsafe {
                let ret = ffmpeg::ffi::av_hwframe_transfer_data(
                    cpu_frame.as_mut_ptr(),
                    frame.as_ptr(),
                    0,
                );
                if ret < 0 {
                    return Err("HW frame transfer failed".to_string());
                }
            }
            Ok(cpu_frame)
        } else {
            Ok(frame)
        }
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
        use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

        let mut scaler = Context::get(
            frame.format(),
            frame.width(),
            frame.height(),
            ffmpeg::format::Pixel::RGBA,
            out_w,
            out_h,
            Flags::LANCZOS,
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

        Ok(rgba)
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

use std::time::Instant;

// Wrapper to track last access time for LRU eviction
pub(crate) struct DecoderEntry {
    decoder: Arc<Mutex<VideoDecoder>>,
    last_accessed: Arc<Mutex<Instant>>,
}

pub(crate) static DECODER_POOL: Lazy<DashMap<String, DecoderEntry>> = Lazy::new(DashMap::new);

// Add pool size limit with proper LRU eviction
const MAX_DECODER_POOL_SIZE: usize = 20;

pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    // Check if decoder exists and update access time
    if let Some(entry) = DECODER_POOL.get_mut(path) {
        // Update last accessed time (LRU tracking)
        *entry.last_accessed.lock().await = Instant::now();
        eprintln!("[get_decoder] Pool HIT for {} (LRU updated)", path);

        // MONITORING: Track cache hit
        #[cfg(debug_assertions)]
        eprintln!("[METRIC] decoder_pool.hit=1 path={}", path);

        return Ok(entry.decoder.clone());
    }

    // MONITORING: Track cache miss
    #[cfg(debug_assertions)]
    eprintln!("[METRIC] decoder_pool.miss=1 path={}", path);

    // Evict least recently used decoder if pool is full
    if DECODER_POOL.len() >= MAX_DECODER_POOL_SIZE {
        let mut oldest_key: Option<String> = None;
        let mut oldest_time = Instant::now();

        // Find the least recently used decoder
        for entry in DECODER_POOL.iter() {
            let last_accessed = *entry.value().last_accessed.lock().await;
            if oldest_key.is_none() || last_accessed < oldest_time {
                oldest_key = Some(entry.key().clone());
                oldest_time = last_accessed;
            }
        }

        if let Some(key) = oldest_key {
            let age_secs = oldest_time.elapsed().as_secs_f64();
            DECODER_POOL.remove(&key);

            // MONITORING: Track eviction with age
            #[cfg(debug_assertions)]
            eprintln!(
                "[METRIC] decoder_pool.eviction=1 age_secs={:.1} reason=lru_full",
                age_secs
            );

            eprintln!(
                "[get_decoder] Pool full ({} decoders), LRU evicted: {} (age: {:.1}s)",
                MAX_DECODER_POOL_SIZE, key, age_secs
            );
        }
    }

    // Create new decoder — this is the only slow path (~20-50ms once per video)
    let start = std::time::Instant::now();
    eprintln!(
        "[get_decoder] Pool MISS - creating new decoder for {}",
        path
    );

    let decoder =
        VideoDecoder::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let _creation_time_ms = start.elapsed().as_millis();

    // MONITORING: Track decoder creation time
    #[cfg(debug_assertions)]
    eprintln!(
        "[METRIC] decoder_pool.creation_time_ms={} path={}",
        _creation_time_ms, path
    );

    let arc = Arc::new(Mutex::new(decoder));
    let entry = DecoderEntry {
        decoder: arc.clone(),
        last_accessed: Arc::new(Mutex::new(Instant::now())),
    };

    DECODER_POOL.insert(path.to_string(), entry);

    // MONITORING: Track pool size
    let pool_size = DECODER_POOL.len();
    #[cfg(debug_assertions)]
    eprintln!("[METRIC] decoder_pool.size={}", pool_size);

    eprintln!(
        "[get_decoder] Created decoder in {:?} (pool size: {})",
        start.elapsed(),
        pool_size
    );
    Ok(arc)
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    if DECODER_POOL.remove(path).is_some() {
        eprintln!("[release_decoder] Explicitly released decoder: {}", path);
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod display_dimensions_tests {
    /// Helper to test display dimension calculation without full decoder
    fn calc_display_dims(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> (u32, u32) {
        // Step 1: Apply SAR
        let display_w = if sar.0 > 0 && sar.1 > 0 && sar.0 != sar.1 {
            ((width as f64) * (sar.0 as f64) / (sar.1 as f64)).round() as u32
        } else {
            width
        };
        let display_h = height;

        // Step 2: Apply rotation
        if rotation == 90 || rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        }
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
        let (w, h) = calc_display_dims(1920, 1080, (1000, 1), 0);
        assert_eq!((w, h), (1920000, 1080));
    }

    #[test]
    fn test_very_small_sar() {
        let (w, h) = calc_display_dims(1920, 1080, (1, 1000), 0);
        assert_eq!((w, h), (2, 1080));
    }
}
