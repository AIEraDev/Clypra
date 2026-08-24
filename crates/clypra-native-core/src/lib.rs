//! Reusable, platform-neutral native contracts and runtime primitives.
//!
//! The first extraction intentionally reuses the proven implementation from
//! the Tauri shell through path modules. This keeps the migration behavior
//! identical while establishing a real crate boundary for the future CLI and
//! daemon. The source files can be moved into this crate in a later mechanical
//! step without changing the public API.

#[path = "../../../src-tauri/src/native_core/cache.rs"]
pub mod cache;
#[path = "../../../src-tauri/src/native_core/compatibility.rs"]
pub mod compatibility;
#[path = "../../../src-tauri/src/native_core/contracts.rs"]
pub mod contracts;
pub mod golden;
#[path = "../../../src-tauri/src/native_core/performance.rs"]
pub mod performance;
#[path = "../../../src-tauri/src/native_core/playback.rs"]
pub mod playback;
#[path = "../../../src-tauri/src/native_core/service.rs"]
pub mod service;
#[path = "../../../src-tauri/src/native_core/session.rs"]
pub mod session;
#[path = "../../../src-tauri/src/native_core/surface.rs"]
pub mod surface;

// Compatibility namespace for the original Tauri module paths. Keeping this
// namespace stable lets existing command adapters migrate without a flag day.
pub mod native_core {
    pub use crate::cache;
    pub use crate::compatibility;
    pub use crate::contracts;
    pub use crate::performance;
    pub use crate::playback;
    pub use crate::service;
    pub use crate::session;
    pub use crate::surface;

    pub use crate::cache::FrameCache;
    pub use crate::contracts::{
        BodyEffectSnapshot, ColorGradeSnapshot, ColorPolicy, FramePacket, FrameRequest, FrameTime,
        NativeCoreError, PixelFormat, PlaybackClockStatus, PlaybackPlan, PlaybackState,
        ProjectSnapshot, QualityTier, RasterLayerSnapshot, TransitionSnapshot, VideoLayerSnapshot,
        DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
    };
    pub use crate::performance::{
        ModeStats, NativeFrameServiceStats, PerformanceBudget, PerformanceSample, PreviewMode,
        StagePercentiles,
    };
    pub use crate::service::NativeFrameService;
    pub use crate::session::PlaybackSession;
    pub use crate::surface::{
        NativeGpuRuntimeState, NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe,
        NativeSurfacePresentation, NativeSurfaceStatus,
    };
}

pub use cache::FrameCache;
pub use contracts::{
    BodyEffectSnapshot, ColorGradeSnapshot, ColorPolicy, FramePacket, FrameRequest, FrameTime,
    NativeCoreError, PixelFormat, PlaybackClockStatus, PlaybackPlan, PlaybackState, ProjectSnapshot,
    QualityTier, RasterLayerSnapshot, TransitionSnapshot, VideoLayerSnapshot, DEFAULT_TIME_SCALE,
    NATIVE_CORE_CONTRACT_VERSION,
};
pub use golden::{compare_rgba8, GoldenDiff};
pub use performance::{
    ModeStats, NativeFrameServiceStats, PerformanceBudget, PerformanceSample, PreviewMode,
    StagePercentiles,
};
pub use service::NativeFrameService;
pub use session::PlaybackSession;
pub use surface::{
    NativeGpuRuntimeState, NativeGpuRuntimeStatus, NativeSurfaceGeometry, NativeSurfaceProbe,
    NativeSurfacePresentation, NativeSurfaceStatus,
};
