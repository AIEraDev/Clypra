use crate::engine::frame::VideoFrame;
use crate::engine::hardware::adapter::GpuAdapter;
use crate::engine::surface::{SurfaceBackend, VideoSurface};
use super::types::{
    DecoderCapabilities, DecoderError, DecoderRequest, DecoderTelemetry, EncodedPacket,
    RenderSurface, SeekTarget, StreamProfile,
};

/// Primary trait implemented by all video decoder backends.
pub trait VideoDecoderBackend: Send + Sync {
    /// Human-readable backend identifier (e.g. "D3D12VA", "D3D11VA", "SoftwareFFmpeg")
    fn name(&self) -> &'static str;

    /// Primary surface backend produced by this decoder
    fn surface_backend(&self) -> SurfaceBackend;

    /// Probe capabilities against a specific GPU adapter
    fn probe(&self, adapter: &GpuAdapter) -> DecoderCapabilities;

    /// Verifies if this backend supports the requested stream on the target adapter
    fn supports(&self, request: &DecoderRequest) -> bool;

    /// Spawns a dedicated decoder session for the target request
    fn create(&self, request: &DecoderRequest) -> Result<Box<dyn DecoderSession>, DecoderError>;
}

/// Active decoder session responsible for decoding packets for a specific stream.
pub trait DecoderSession: Send {
    /// Stream profile being decoded
    fn stream_info(&self) -> &StreamProfile;

    /// Seek stream to keyframe preceding target timestamp
    fn seek(&mut self, target: SeekTarget, generation: u64) -> Result<(), DecoderError>;

    /// Flushes any pending reference frames or decoder queues
    fn flush(&mut self) -> Result<(), DecoderError> {
        Ok(())
    }

    /// Submits a compressed packet to the decoder input queue
    fn submit(&mut self, packet: EncodedPacket) -> Result<(), DecoderError>;

    /// Retrieves the next available decoded frame backed by a native GPU surface.
    /// Invariant: Must return native VideoSurface; NO CPU buffer readback on hardware path.
    fn receive(&mut self) -> Result<Option<VideoFrame>, DecoderError>;

    /// Invalidate any queued work or buffered frames matching obsolete generations
    fn cancel_generation(&mut self, generation: u64);

    /// Reports real-time telemetry metrics for this session
    fn telemetry(&self) -> DecoderTelemetry;
}

/// Trait for zero-copy surface import into the renderer.
pub trait SurfaceBridge: Send + Sync {
    fn import(&self, decoded: &VideoSurface) -> Result<RenderSurface, String>;
    fn is_zero_copy(&self) -> bool;
}
