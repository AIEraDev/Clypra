use crate::engine::hardware::adapter::AdapterId;
use crate::engine::surface::SurfaceBackend;
use crate::engine::types::{
    ChromaSubsampling, CodecProfile, CodecType, MediaTime, PixelFormat,
};
use serde::{Deserialize, Serialize};

/// Error during decoder initialization, stream submission, or frame decoding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DecoderError {
    UnsupportedStream(String),
    AdapterNotFound(String),
    DeviceLost,
    DecodeFailed(String),
    GenerationCancelled(u64),
    Eof,
}

impl std::fmt::Display for DecoderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecoderError::UnsupportedStream(s) => write!(f, "Unsupported stream profile: {s}"),
            DecoderError::AdapterNotFound(s) => write!(f, "Adapter '{s}' not found"),
            DecoderError::DeviceLost => write!(f, "GPU device lost during decode"),
            DecoderError::DecodeFailed(s) => write!(f, "Decode operation failed: {s}"),
            DecoderError::GenerationCancelled(g) => {
                write!(f, "Decode operation cancelled by generation {g}")
            }
            DecoderError::Eof => write!(f, "End of stream reached"),
        }
    }
}

impl std::error::Error for DecoderError {}

/// Full profile description of an input video stream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamProfile {
    pub codec: CodecType,
    pub profile: CodecProfile,
    pub bit_depth: u8,
    pub chroma: ChromaSubsampling,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub pixel_format: PixelFormat,
}

impl StreamProfile {
    /// Standard 4K 60fps 10-bit HEVC stream (matching our telemetry test assets).
    pub fn hevc_4k_10bit_60fps() -> Self {
        Self {
            codec: CodecType::Hevc,
            profile: CodecProfile::Main10,
            bit_depth: 10,
            chroma: ChromaSubsampling::Yuv420,
            width: 3840,
            height: 2160,
            fps: 60.0,
            pixel_format: PixelFormat::P010,
        }
    }

    /// Standard 1080p 60fps 8-bit H.264 stream.
    pub fn h264_1080p_8bit_60fps() -> Self {
        Self {
            codec: CodecType::H264,
            profile: CodecProfile::High,
            bit_depth: 8,
            chroma: ChromaSubsampling::Yuv420,
            width: 1920,
            height: 1080,
            fps: 60.0,
            pixel_format: PixelFormat::Nv12,
        }
    }
}

/// The intended operational context of the decoder session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DecodeUsage {
    /// Continuous real-time playback: low latency, strict deadline pacing
    RealtimePlayback,
    /// Timeline scrubbing: latest-request-wins, rapid keyframe jumps
    FastScrub,
    /// Sequence export: maximum quality, throughput prioritized over latency
    OfflineExport,
}

/// Request to open a decoder session for a specific stream on an adapter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecoderRequest {
    pub stream: StreamProfile,
    pub adapter_id: AdapterId,
    pub usage: DecodeUsage,
}

/// Keyframe-aware seek target specification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeekTarget {
    /// Exact target timestamp requested by the user / playback controller
    pub requested_time: MediaTime,
    /// Nearest preceding keyframe timestamp used to initialize decoding
    pub keyframe_time: MediaTime,
}

impl SeekTarget {
    pub fn new(requested_time: MediaTime, keyframe_time: MediaTime) -> Self {
        Self {
            requested_time,
            keyframe_time,
        }
    }

    pub fn exact_keyframe(time: MediaTime) -> Self {
        Self {
            requested_time: time,
            keyframe_time: time,
        }
    }
}

/// Compressed video packet submitted to a decoder session.
#[derive(Debug, Clone)]
pub struct EncodedPacket {
    pub data: Vec<u8>,
    pub pts: MediaTime,
    pub dts: MediaTime,
    pub is_keyframe: bool,
    pub generation: u64,
}

/// Strict lifecycle states for GPU-backed video surfaces.
/// Prevents decoder/renderer race conditions and memory hazards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SurfaceState {
    /// Surface resides in the pool ready to be assigned to the decoder
    Available,
    /// Decoder is actively writing into the surface
    DecoderOwned,
    /// Decoder has finished writing; surface holds valid frame data
    Ready,
    /// Renderer is actively sampling or compositing this surface
    RenderOwned,
    /// GPU command queue has submitted work referencing this surface
    GpuInFlight,
}

/// Configuration defining dynamic capacity for the decoder surface pool.
/// Sizing is derived mathematically:
/// Capacity = reference_frames + decode_pipeline_depth + render_in_flight + prefetch_depth
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfacePoolConfig {
    pub reference_frames: usize,
    pub decode_pipeline_depth: usize,
    pub render_in_flight: usize,
    pub prefetch_depth: usize,
}

impl SurfacePoolConfig {
    pub fn for_stream(stream: &StreamProfile) -> Self {
        let reference_frames = match stream.codec {
            CodecType::Hevc => 16,
            CodecType::H264 => 16,
            CodecType::Av1 => 8,
            _ => 4,
        };
        Self {
            reference_frames,
            decode_pipeline_depth: 4,
            render_in_flight: 2,
            prefetch_depth: 4,
        }
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.reference_frames
            + self.decode_pipeline_depth
            + self.render_in_flight
            + self.prefetch_depth
    }
}

/// Hardware decode capability for a specific video configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoDecodeCapability {
    pub codec: CodecType,
    pub profile: CodecProfile,
    pub bit_depth: u8,
    pub chroma: ChromaSubsampling,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: f32,
    pub is_hardware: bool,
}

/// Comprehensive decode capabilities of a hardware adapter or software fallback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecoderCapabilities {
    pub backend_name: String,
    pub surface_backend: SurfaceBackend,
    pub capabilities: Vec<VideoDecodeCapability>,
}

impl DecoderCapabilities {
    pub fn can_hardware_decode(
        &self,
        codec: CodecType,
        bit_depth: u8,
        width: u32,
        height: u32,
        fps: f32,
    ) -> bool {
        self.capabilities.iter().any(|cap| {
            cap.is_hardware
                && cap.codec == codec
                && cap.bit_depth >= bit_depth
                && cap.max_width >= width
                && cap.max_height >= height
                && cap.max_fps >= fps
        })
    }
}

/// Dynamic telemetry measuring the exact performance and data path of the decoder.
/// Verifies zero CPU readback and zero cross-adapter copies mathematically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecoderTelemetry {
    pub decoder_backend: String,
    pub codec: CodecType,
    pub bit_depth: u8,
    pub output_format: PixelFormat,
    pub is_hardware: bool,
    pub zero_copy: bool,
    pub cpu_readback_bytes: u64,
    pub cpu_upload_bytes: u64,
    pub cross_adapter_bytes: u64,
    pub surface_copy_count: u64,
    pub decode_time_us: u64,
}

impl Default for DecoderTelemetry {
    fn default() -> Self {
        Self {
            decoder_backend: "Unknown".to_string(),
            codec: CodecType::Hevc,
            bit_depth: 10,
            output_format: PixelFormat::P010,
            is_hardware: true,
            zero_copy: true,
            cpu_readback_bytes: 0,
            cpu_upload_bytes: 0,
            cross_adapter_bytes: 0,
            surface_copy_count: 0,
            decode_time_us: 0,
        }
    }
}

/// Bridge between a decoded GPU surface and a renderer-compatible texture.
#[derive(Debug, Clone)]
pub struct RenderSurface {
    pub backend: SurfaceBackend,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub is_zero_copy: bool,
}
