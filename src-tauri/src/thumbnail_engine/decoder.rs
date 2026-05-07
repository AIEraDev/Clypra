//! Native FFmpeg decoder for ultra-fast thumbnail extraction
//!
//! This module replaces the sidecar-based extraction with direct FFmpeg API calls.
//! Key features:
//! - One decoder per video file, reused across frame requests
//! - Hardware acceleration (VideoToolbox on macOS, D3D11VA on Windows, VAAPI on Linux)
//! - In-memory decoder pool for instant subsequent requests
//! - Forward seeking optimization for sequential frame decoding

use dashmap::DashMap;
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Mutex;

/// One decoder per video file — stays alive between frame requests
pub struct VideoDecoder {
    input_ctx: ffmpeg::format::context::Input,
    decoder: ffmpeg::codec::decoder::Video,
    stream_index: usize,
    time_base: ffmpeg::Rational,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

impl VideoDecoder {
    pub fn open(path: &str) -> Result<Self, String> {
        // Initialize FFmpeg once globally
        ffmpeg::init().map_err(|e| e.to_string())?;

        let input_ctx = ffmpeg::format::input(&path)
            .map_err(|e| format!("Cannot open: {}", e))?;

        // Find best video stream
        let stream = input_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("No video stream")?;

        let stream_index = stream.index();
        let time_base = stream.time_base();

        // Duration in seconds
        let duration = input_ctx.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;

        // Build codec context
        let codec_ctx = ffmpeg::codec::context::Context::from_parameters(
            stream.parameters()
        ).map_err(|e| e.to_string())?;

        let (decoder, width, height) = Self::open_with_hw(codec_ctx)?;

        Ok(Self {
            input_ctx,
            decoder,
            stream_index,
            time_base,
            duration,
            width,
            height,
        })
    }

    /// Try hardware acceleration, fall back to software silently
    fn open_with_hw(
        mut ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
        // Platform-specific hardware decoder priority
        #[cfg(target_os = "macos")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX as u32];
        #[cfg(target_os = "windows")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA as u32];
        #[cfg(target_os = "linux")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI as u32];
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let hw_types: &[u32] = &[];

        // Try hardware decode
        for &hw_type_raw in hw_types {
            unsafe {
                let hw_type = std::mem::transmute(hw_type_raw);
                let mut hw_ctx = std::ptr::null_mut();
                let ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                    &mut hw_ctx,
                    hw_type,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    0,
                );
                if ret >= 0 {
                    (*ctx.as_mut_ptr()).hw_device_ctx =
                        ffmpeg::ffi::av_buffer_ref(hw_ctx);
                    ffmpeg::ffi::av_buffer_unref(&mut hw_ctx);
                }
            }
        }

        // Open decoder (hw or software — FFmpeg decides)
        let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
        let w = decoder.width();
        let h = decoder.height();

        Ok((decoder, w, h))
    }

    /// Seek and decode a single frame — reuses this decoder instance
    pub fn decode_frame(
        &mut self,
        timestamp_secs: f64,
        out_width: u32,
        out_height: u32,
    ) -> Result<Vec<u8>, String> {
        // Clamp to video bounds
        let ts = timestamp_secs.max(0.0).min(self.duration - 0.001);

        // Convert seconds to stream time base units
        let target_pts = (ts * self.time_base.1 as f64
            / self.time_base.0 as f64) as i64;

        // Seek to nearest keyframe at or before target
        unsafe {
            let ret = ffmpeg::ffi::av_seek_frame(
                self.input_ctx.as_mut_ptr(),
                self.stream_index as i32,
                target_pts,
                ffmpeg::ffi::AVSEEK_FLAG_BACKWARD as i32,
            );
            if ret < 0 {
                return Err(format!("Seek failed at {}s", ts));
            }
        }

        self.decoder.flush();

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

            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let frame_pts = frame.pts().unwrap_or(0);
                let frame_ts = frame_pts as f64
                    * self.time_base.0 as f64
                    / self.time_base.1 as f64;

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

        // Handle hardware frames (copy back from GPU to CPU if needed)
        let cpu_frame = self.to_cpu_frame(best_frame)?;

        // Scale to output dimensions and convert to RGBA
        self.scale_to_rgba(&cpu_frame, out_width, out_height)
    }

    fn to_cpu_frame(
        &self,
        frame: ffmpeg::frame::Video,
    ) -> Result<ffmpeg::frame::Video, String> {
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

    fn scale_to_rgba(
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
            Flags::BILINEAR,
        ).map_err(|e| e.to_string())?;

        let mut out = ffmpeg::frame::Video::empty();
        scaler.run(frame, &mut out).map_err(|e| e.to_string())?;

        // plane 0 = RGBA bytes
        Ok(out.data(0).to_vec())
    }
}

// ─── Global Decoder Pool ────────────────────────────────────────────────────
// One decoder per video path. Created on first use, reused forever.
// Mutex is per-video so decoders for different videos don't block each other.

pub static DECODER_POOL: Lazy<DashMap<String, Arc<Mutex<VideoDecoder>>>> =
    Lazy::new(DashMap::new);

pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    if let Some(existing) = DECODER_POOL.get(path) {
        return Ok(existing.clone());
    }

    // Create new decoder — this is the only slow path (~20-50ms once per video)
    let decoder = VideoDecoder::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let arc = Arc::new(Mutex::new(decoder));
    DECODER_POOL.insert(path.to_string(), arc.clone());
    Ok(arc)
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    DECODER_POOL.remove(path);
}
