#[cfg(test)]
pub mod d3d11;
#[cfg(test)]
pub mod d3d12;
#[cfg(test)]
pub mod planner;
pub mod pool;
pub mod software;
pub mod traits;
pub mod types;

#[cfg(test)]
pub use d3d11::{D3D11VADecoderBackend, D3D11VASession};
#[cfg(test)]
pub use d3d12::{D3D12VADecoderBackend, D3D12VASession};
#[cfg(test)]
pub use planner::DecoderPlanner;
pub use pool::DecoderSurfacePool;
pub use software::{SoftwareFFmpegBackend, SoftwareSession};
pub use traits::{DecoderSession, SurfaceBridge, VideoDecoderBackend};
pub use types::{
    DecodeUsage, DecoderBackend, DecoderCapabilities, DecoderError, DecoderExecutionMode,
    DecoderInitMetadata, DecoderRequest, DecoderTelemetry, EncodedPacket, RenderSurface,
    SeekTarget, StreamProfile, SurfacePoolConfig, SurfaceState, VideoDecodeCapability,
};
