//! Platform-neutral contracts and runtime primitives for the native editor core.
//!
//! This module deliberately contains no Tauri, WebView, or UI types. Commands
//! and presentation adapters translate into these contracts at the boundary.

pub mod cache;
pub mod compatibility;
pub mod contracts;
pub mod performance;
pub mod playback;
pub mod service;
pub mod session;
pub mod surface;

pub use cache::FrameCache;
pub use contracts::{
    ColorGradeSnapshot, ColorPolicy, FramePacket, FrameRequest, FrameTime, NativeCoreError, PixelFormat,
    PlaybackClockStatus, PlaybackPlan, PlaybackState, ProjectSnapshot, QualityTier,
    BodyEffectSnapshot, RasterLayerSnapshot, VideoLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
pub use performance::{NativeFrameServiceStats, PerformanceBudget, PerformanceSample};
pub use service::NativeFrameService;
pub use session::PlaybackSession;
pub use surface::{
    NativeGpuRuntimeState, NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe,
    NativeSurfacePresentation, NativeSurfaceStatus,
};
