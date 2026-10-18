use crate::engine::frame::{ColorMetadata, VideoFrame};
use crate::engine::hardware::adapter::GpuAdapter;
use crate::engine::surface::{SurfaceBackend, SurfaceHandle, SurfaceSync, VideoSurface};
use crate::engine::types::{ChromaSubsampling, CodecProfile, CodecType, MediaTime};

use super::traits::{DecoderSession, VideoDecoderBackend};
use super::types::{
    DecoderCapabilities, DecoderError, DecoderRequest, DecoderTelemetry, EncodedPacket, SeekTarget,
    StreamProfile, VideoDecodeCapability,
};

/// Direct3D 11 Video Acceleration (Windows fallback hardware backend).
pub struct D3D11VADecoderBackend;

impl VideoDecoderBackend for D3D11VADecoderBackend {
    fn name(&self) -> &'static str {
        "D3D11VA"
    }

    fn surface_backend(&self) -> SurfaceBackend {
        SurfaceBackend::D3D11
    }

    fn probe(&self, _adapter: &GpuAdapter) -> DecoderCapabilities {
        DecoderCapabilities {
            backend_name: self.name().to_string(),
            surface_backend: SurfaceBackend::D3D11,
            capabilities: vec![
                VideoDecodeCapability {
                    codec: CodecType::Hevc,
                    profile: CodecProfile::Main10,
                    bit_depth: 10,
                    chroma: ChromaSubsampling::Yuv420,
                    max_width: 4096,
                    max_height: 4096,
                    max_fps: 60.0,
                    is_hardware: true,
                },
                VideoDecodeCapability {
                    codec: CodecType::H264,
                    profile: CodecProfile::High,
                    bit_depth: 8,
                    chroma: ChromaSubsampling::Yuv420,
                    max_width: 4096,
                    max_height: 4096,
                    max_fps: 60.0,
                    is_hardware: true,
                },
            ],
        }
    }

    fn supports(&self, request: &DecoderRequest) -> bool {
        (request.stream.codec == CodecType::Hevc || request.stream.codec == CodecType::H264)
            && request.stream.width <= 4096
    }

    fn create(&self, request: &DecoderRequest) -> Result<Box<dyn DecoderSession>, DecoderError> {
        Ok(Box::new(D3D11VASession::new(request.stream.clone())))
    }
}

pub struct D3D11VASession {
    stream: StreamProfile,
    generation: u64,
    current_pts: MediaTime,
}

impl D3D11VASession {
    pub fn new(stream: StreamProfile) -> Self {
        Self {
            stream,
            generation: 1,
            current_pts: MediaTime::ZERO,
        }
    }
}

impl DecoderSession for D3D11VASession {
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
        let sync = SurfaceSync {
            producer_fence: None,
            consumer_fence: None,
            producer_value: self.generation,
            consumer_value: 0,
            fence_value: self.generation,
            is_ready: true,
            keyed_mutex_key: Some(0),
        };
        let surface = VideoSurface::new(
            SurfaceBackend::D3D11,
            self.stream.width,
            self.stream.height,
            self.stream.pixel_format,
            sync,
            SurfaceHandle::D3D11 {
                texture_ptr: 0x2345_6789,
                shared_handle: Some(0xABCD),
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
            decoder_backend: "D3D11VA".to_string(),
            codec: self.stream.codec,
            bit_depth: self.stream.bit_depth,
            output_format: self.stream.pixel_format,
            is_hardware: true,
            zero_copy: true,
            cpu_readback_bytes: 0,
            cpu_upload_bytes: 0,
            cross_adapter_bytes: 0,
            surface_copy_count: 0,
            decode_time_us: 6500,
        }
    }
}
