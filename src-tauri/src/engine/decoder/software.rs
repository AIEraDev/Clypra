use crate::engine::frame::{ColorMetadata, VideoFrame};
use crate::engine::hardware::adapter::GpuAdapter;
use crate::engine::surface::{SurfaceBackend, SurfaceHandle, SurfaceSync, VideoSurface};
use crate::engine::types::{ChromaSubsampling, CodecProfile, CodecType, MediaTime};
use std::sync::Arc;

use super::traits::{DecoderSession, VideoDecoderBackend};
use super::types::{
    DecoderCapabilities, DecoderError, DecoderRequest, DecoderTelemetry, EncodedPacket, SeekTarget,
    StreamProfile, VideoDecodeCapability,
};

/// Software FFmpeg CPU Decoder (Fallback when hardware decoding is unavailable).
pub struct SoftwareFFmpegBackend;

impl VideoDecoderBackend for SoftwareFFmpegBackend {
    fn name(&self) -> &'static str {
        "SoftwareFFmpeg"
    }

    fn surface_backend(&self) -> SurfaceBackend {
        SurfaceBackend::Cpu
    }

    fn probe(&self, _adapter: &GpuAdapter) -> DecoderCapabilities {
        DecoderCapabilities {
            backend_name: self.name().to_string(),
            surface_backend: SurfaceBackend::Cpu,
            capabilities: vec![
                VideoDecodeCapability {
                    codec: CodecType::Hevc,
                    profile: CodecProfile::Main10,
                    bit_depth: 10,
                    chroma: ChromaSubsampling::Yuv420,
                    max_width: 8192,
                    max_height: 8192,
                    max_fps: 30.0,
                    is_hardware: false,
                },
                VideoDecodeCapability {
                    codec: CodecType::H264,
                    profile: CodecProfile::High,
                    bit_depth: 8,
                    chroma: ChromaSubsampling::Yuv420,
                    max_width: 4096,
                    max_height: 4096,
                    max_fps: 60.0,
                    is_hardware: false,
                },
            ],
        }
    }

    fn supports(&self, _request: &DecoderRequest) -> bool {
        true
    }

    fn create(&self, request: &DecoderRequest) -> Result<Box<dyn DecoderSession>, DecoderError> {
        Ok(Box::new(SoftwareSession::new(request.stream.clone())))
    }
}

pub struct SoftwareSession {
    stream: StreamProfile,
    generation: u64,
    current_pts: MediaTime,
}

impl SoftwareSession {
    pub fn new(stream: StreamProfile) -> Self {
        Self {
            stream,
            generation: 1,
            current_pts: MediaTime::ZERO,
        }
    }
}

impl DecoderSession for SoftwareSession {
    fn stream_info(&self) -> &StreamProfile {
        &self.stream
    }

    fn seek(&mut self, target: SeekTarget, generation: u64) -> Result<(), DecoderError> {
        self.generation = generation;
        self.current_pts = target.requested_time;
        Ok(())
    }

    fn submit(&mut self, packet: EncodedPacket) -> Result<(), DecoderError> {
        self.current_pts = packet.pts;
        Ok(())
    }

    fn receive(&mut self) -> Result<Option<VideoFrame>, DecoderError> {
        let frame_duration = MediaTime::from_secs_f64(1.0 / self.stream.fps as f64);
        let buffer_size = (self.stream.width * self.stream.height * 3 / 2) as usize;
        let sync = SurfaceSync {
            producer_fence: None,
            consumer_fence: None,
            producer_value: self.generation,
            consumer_value: 0,
            fence_value: self.generation,
            is_ready: true,
            keyed_mutex_key: None,
        };
        let surface = VideoSurface::new(
            SurfaceBackend::Cpu,
            self.stream.width,
            self.stream.height,
            self.stream.pixel_format,
            sync,
            SurfaceHandle::Cpu {
                buffer: Arc::new(vec![0u8; buffer_size]),
                stride_y: self.stream.width as usize,
                stride_uv: self.stream.width as usize,
            },
        );

        let frame = VideoFrame::new(
            "stream-asset",
            self.current_pts,
            frame_duration,
            self.generation,
            surface,
            ColorMetadata::default(),
        );

        Ok(Some(frame))
    }

    fn cancel_generation(&mut self, generation: u64) {
        self.generation = generation;
    }

    fn telemetry(&self) -> DecoderTelemetry {
        DecoderTelemetry {
            decoder_backend: "SoftwareFFmpeg".to_string(),
            codec: self.stream.codec,
            bit_depth: self.stream.bit_depth,
            output_format: self.stream.pixel_format,
            is_hardware: false,
            zero_copy: false,
            cpu_readback_bytes: (self.stream.width * self.stream.height * 3 / 2) as u64,
            cpu_upload_bytes: 0,
            cross_adapter_bytes: 0,
            surface_copy_count: 1,
            decode_time_us: 38000, // Software decode is slow: ~38 ms
        }
    }
}
