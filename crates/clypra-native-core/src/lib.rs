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
pub mod font_registry;
pub mod font_validator;
pub mod glyph_cache;
pub mod golden;
#[path = "../../../src-tauri/src/native_core/performance.rs"]
pub mod performance;
#[path = "../../../src-tauri/src/native_core/playback.rs"]
pub mod playback;
pub mod sdf;
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
    pub use crate::font_registry;
    pub use crate::glyph_cache;
    pub use crate::performance;
    pub use crate::playback;
    pub use crate::sdf;
    pub use crate::service;
    pub use crate::session;
    pub use crate::surface;

    pub use crate::cache::FrameCache;
    pub use crate::contracts::{
        BodyEffectSnapshot, ColorGradeSnapshot, ColorPolicy, FramePacket, FrameRequest, FrameTime,
        NativeCoreError, NativePlaybackFrameDemand, NativePlaybackRasterLayerUpdate,
        NativePlaybackTextLayerUpdate, NativePlaybackVideoLayerUpdate, PixelFormat,
        PlaybackClockStatus, PlaybackPlan, PlaybackState, ProjectSnapshot, QualityTier,
        RasterLayerSnapshot, TemplateDefinitionSnapshot, TemplateElementKind,
        TemplateElementSnapshot, TextBackgroundSnapshot, TextEffectDefinitionSnapshot,
        TextEffectInstance, TextEffectPassSnapshot, TextLayerSnapshot, TextParamValue,
        TextRunSnapshot, TransitionSnapshot, VideoLayerSnapshot, DEFAULT_TIME_SCALE,
        NATIVE_CORE_CONTRACT_VERSION,
    };
    pub use crate::font_registry::{global_font_registry, FontRegistry, DEFAULT_FONT_ID};
    pub use crate::glyph_cache::{
        global_glyph_cache, GlyphSdfCache, SdfGlyph, ShapedTextSdf, TextAlign,
    };
    pub use crate::performance::{
        ModeStats, NativeFrameServiceStats, NativePerformanceSampleBatch, PerformanceBudget,
        PerformanceSample, PreviewMode, StagePercentiles,
    };
    pub use crate::sdf::{generate_padded_sdf, generate_sdf};
    pub use crate::service::NativeFrameService;
    pub use crate::session::PlaybackSession;
    pub use crate::surface::{
        NativeGpuRuntimeState, NativeGpuRuntimeStatus, NativeSurfaceGeometry,
        NativeSurfacePresentation, NativeSurfacePresentationTimings, NativeSurfaceProbe,
        NativeSurfaceStatus,
    };
}

pub use cache::FrameCache;
pub use contracts::{
    BodyEffectSnapshot, ColorGradeSnapshot, ColorPolicy, FramePacket, FrameRequest, FrameTime,
    NativeCoreError, NativePlaybackFrameDemand, NativePlaybackRasterLayerUpdate,
    NativePlaybackTextLayerUpdate, NativePlaybackVideoLayerUpdate, PixelFormat,
    PlaybackClockStatus, PlaybackPlan, PlaybackState, ProjectSnapshot, QualityTier,
    RasterLayerSnapshot, TemplateDefinitionSnapshot, TemplateElementKind, TemplateElementSnapshot,
    TextBackgroundSnapshot, TextEffectDefinitionSnapshot, TextEffectInstance,
    TextEffectPassSnapshot, TextLayerSnapshot, TextParamValue, TextRunSnapshot, TransitionSnapshot,
    VideoLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
pub use font_registry::{global_font_registry, FontRegistry, DEFAULT_FONT_ID};
pub use font_validator::{
    is_valid_font_bytes, is_valid_font_file, FontFormat, FontValidationError, MAX_FONT_BYTES,
    MIN_FONT_BYTES,
};
pub use glyph_cache::{global_glyph_cache, GlyphSdfCache, SdfGlyph, ShapedTextSdf, TextAlign};
pub use golden::{compare_rgba8, GoldenDiff};
pub use performance::{
    ModeStats, NativeFrameServiceStats, NativePerformanceSampleBatch, PerformanceBudget,
    PerformanceSample, PreviewMode, StagePercentiles,
};
pub use sdf::{generate_padded_sdf, generate_sdf};
pub use service::NativeFrameService;
pub use session::PlaybackSession;
pub use surface::{
    NativeGpuRuntimeState, NativeGpuRuntimeStatus, NativeSurfaceGeometry,
    NativeSurfacePresentation, NativeSurfacePresentationTimings, NativeSurfaceProbe,
    NativeSurfaceStatus,
};
