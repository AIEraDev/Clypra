//! Clypra Real-Time Media Engine
//!
//! Architectural Principle:
//! "The UI owns editor intent. The native engine owns the truth of playback."
//!
//! Submodules:
//! - `types`: Fundamental types (MediaTime, CanvasSpec, PixelFormat, LayerTransform)
//! - `surface`: Backend-owned VideoSurface with explicit SurfaceSync and SurfaceInterop
//! - `frame`: VideoFrame domain object decoupled from CPU pixel buffers
//! - `render_plan`: RenderPlan and RenderLayer contracts
//! - `clock`: Authoritative PlaybackClock trait and EngineClock
//! - `state_machine`: PlaybackMode (Play, Scrub, Seek, FrameStep), PlaybackCommand, and snapshots
//! - `decoder`: VideoDecoderBackend, DecoderCapabilities, DecoderSurfacePool, and DecoderSession
//! - `scheduler`: FrameDeadline, FramePacingDecision, and FramePlanner

pub mod benchmark;
pub mod clock;
pub mod decoder;
pub mod diagnostic;
pub mod frame;
pub mod graph;
pub mod hardware;
pub mod interop;
pub mod planner;
pub mod playback;
pub mod presenter;
pub mod qos;
pub mod render_plan;
pub mod scheduler;
pub mod state_machine;
pub mod surface;
pub mod telemetry;
pub mod temporal;
pub mod timeline;
pub mod types;

#[cfg(test)]
mod benchmark_tests;
#[cfg(test)]
mod decoder_tests;
#[cfg(test)]
mod graph_tests;
#[cfg(test)]
mod planner_tests;
#[cfg(test)]
mod qos_tests;
#[cfg(test)]
mod surface_tests;
#[cfg(test)]
mod temporal_tests;
#[cfg(test)]
mod tests;

// Re-export canonical domain types
pub use benchmark::{
    probe_decoder_identity, probe_machine_identity, BenchmarkConfig, BenchmarkMedia,
    BenchmarkResult, BenchmarkScenario, CliOptions, DecoderIdentity, FrameOutcome, FrameTelemetry,
    HardwareBenchmarkRunner, MachineIdentity, PlaybackSummary, StartupMetrics, TransferMetrics,
};
pub use clock::{ClockMode, EngineClock, PlaybackClock};
pub use decoder::{
    D3D11VADecoderBackend, D3D12VADecoderBackend, DecodeUsage, DecoderCapabilities, DecoderError,
    DecoderPlanner, DecoderRequest, DecoderSession, DecoderSurfacePool, DecoderTelemetry,
    EncodedPacket, RenderSurface, SeekTarget, SoftwareFFmpegBackend, StreamProfile, SurfaceBridge,
    SurfacePoolConfig, SurfaceState, VideoDecodeCapability, VideoDecoderBackend,
};
pub use diagnostic::{HardwareRealityReport, HardwareRealityRunner};
pub use frame::{ColorMetadata, VideoFrame};
pub use graph::{
    create_solid_surface, CachedNodeOutput, ColorGradeParams, CullReason, EffectSpec, GraphError,
    GraphResourcePool, LifetimeInterval, NodeCacheKey, NodeId, OverlayType, PassKind, RenderGraph,
    RenderGraphCache, RenderGraphExecutor, RenderGraphTelemetry, RenderPassNode, ResourceBarrier,
    ResourceId, TransientResourceDesc,
};
pub use hardware::{
    probe_hardware_capability, AdapterId, AdapterRegistry, CapabilityTier, DecodeCapability,
    GpuAdapter, GpuAdapterIdentity, GpuVendor, GraphicsBackend, HardwareCapabilityProfile,
    PlaybackDevice, RecommendedQoSConfig, VideoDecodeCapabilities,
};
pub use interop::{CpuSurfaceInterop, D3D11SurfaceInterop, D3D12SurfaceInterop, InteropMetrics};
pub use planner::{
    CacheVariant, DecodeRange, FrameCacheKey, MediaFrameCache, MediaPriority, MediaRequest,
    MediaWorkPlan, PerAssetQueueManager, PlannerTelemetry, PlaybackDirection, PrefetchPolicy,
    QueueConfig, ReadyFrame, ReadyFrameQueue, ReadyTimingStatus, WorkPlanner, WorkResult,
};
pub use playback::{EngineCommand, PlaybackController, PlaybackPlanQueue, PlaybackPlanReceiver};
pub use presenter::{
    NativeDxgiPresenter, PresentResult, PresentationTarget, Presenter, PresenterError,
    RenderedFrame, WgpuPresenter,
};
pub use qos::{
    AsyncProxyManager, Bottleneck, DecodeStrategy, DecoderBackendId, EffectsPolicy, MediaVariant,
    PerformanceEnvelope, PerformanceSnapshot, PerformanceWindow, PlaybackPolicySnapshot,
    PlaybackResolutionDemand, ProxyAvailability, ProxyId, ProxyVariant, QoSConfig, QoSController,
    QoSDecision, QoSReason, QoSTelemetry, QoSTransitionEvent, RenderQuality, Resolution,
};
pub use render_plan::{AudioPlan, AudioTrackPlan, RenderLayer, RenderPlan};
pub use scheduler::{
    FrameDeadline, FramePacingDecision, FramePlanner, PlaybackScheduler, StarvationReason,
};
pub use state_machine::{PlaybackCommand, PlaybackMode, PlaybackStateSnapshot, QoSTier};
pub use surface::{
    GpuFence, ResourceState, SurfaceBackend, SurfaceHandle, SurfaceInterop, SurfaceLifetimeToken,
    SurfaceOwner, SurfaceSync, VideoSurface,
};
pub use telemetry::{
    EngineTelemetryCollector, EngineTelemetrySnapshot, ENGINE_PIPELINE_NAME, ENGINE_TELEMETRY,
    ENGINE_VERSION,
};
pub use temporal::{
    FileCacheStatus, KeyframeEntry, KeyframeIndex, SeekTelemetry, SeekWarmth, TemporalController,
    TemporalDirection, TemporalRequest, TemporalRequestId, TemporalState,
};
pub use timeline::{
    Clip, ClipId, CommandEnvelope, EngineVersion, MediaAssetRef, ProjectCommand, ProjectError,
    ProjectModelAdapter, ProjectSettings, ProjectState, PureTimelineEvaluator, Sequence,
    TimeMapping, TimelineEvaluator, Track, TrackId, TrackKind,
};
pub use types::{
    BlendMode, CanvasSpec, ChromaSubsampling, CodecProfile, CodecType, ColorSpace, LayerTransform,
    LayerVisibility, MediaTime, PixelFormat,
};
