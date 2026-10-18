use crate::engine::surface::SurfaceBackend;
use crate::engine::types::CodecType;
use super::types::{StreamProfile, SurfacePoolConfig};

/// Dynamic pool managing hardware-backed decoder surfaces.
#[derive(Debug, Clone)]
pub struct DecoderSurfacePool {
    pub config: SurfacePoolConfig,
    pub capacity: usize,
    pub width: u32,
    pub height: u32,
    pub backend: SurfaceBackend,
}

impl DecoderSurfacePool {
    #[inline]
    pub fn calculate_capacity(
        codec: CodecType,
        pipeline_depth: usize,
        prefetch_depth: usize,
    ) -> usize {
        let reference_frames = match codec {
            CodecType::Hevc => 16,
            CodecType::H264 => 16,
            CodecType::Av1 => 8,
            _ => 4,
        };
        reference_frames + pipeline_depth + prefetch_depth + 4
    }

    pub fn new(stream: &StreamProfile, backend: SurfaceBackend) -> Self {
        let config = SurfacePoolConfig::for_stream(stream);
        let capacity = config.capacity();
        Self {
            config,
            capacity,
            width: stream.width,
            height: stream.height,
            backend,
        }
    }
}
