/*!
 * Native wgpu Compositor & Offscreen Renderer
 *
 * Real wgpu GPU pipeline initialization for Clypra Rust core.
 * Headless Instance -> Adapter (Metal/Vulkan/DirectX) -> Device/Queue -> Texture Render Pass -> Buffer Readback
 */


pub mod texture_pool;
pub use texture_pool::{
    create_nv12_bind_group_layout, create_nv12_render_pipeline, create_nv12_sampler,
    render_scrub_frame, Nv12FrameSlot, Nv12TextureRingBuffer,
};

pub mod yuv_ring_buffer;
pub use yuv_ring_buffer::{
    create_yuv_hdr_bind_group_layout, create_yuv_hdr_render_pipeline, create_yuv_hdr_sampler,
    render_yuv_frame, ColorTransformUniforms, YuvFrameSlot, YuvPixelFormat, YuvTextureRingBuffer,
};

pub mod render_path;
pub use render_path::{
    DisableReason, DxgiFailureReason, DxgiImportState, FrameRenderPath, FrameSource,
    PreviewRenderError,
};

pub mod frame_resource;
pub use frame_resource::{
    ColorMatrix, ColorPrimaries, ColorRange, CpuFrame, FrameColorInfo, FrameResource,
    FrameUploader, TransferFunction, VideoPixelFormat,
};

pub mod frame_request;
pub use frame_request::{
    FramePriority, FrameRequest, PresentationRequest, PreviewQuality, Viewport,
};

pub mod frame_telemetry;
pub use frame_telemetry::{FrameTelemetry, FrameTelemetryRing};

pub mod frame_cache;
pub use frame_cache::FrameResourceCache;

pub mod frame_scheduler;
pub use frame_scheduler::{
    DecodedCacheKey, FrameKey, FrameProducer, FrameScheduler, SchedulerConfig, SchedulerError,
    SequenceId,
};

pub mod frame_deadline;
pub use frame_deadline::FrameDeadline;

pub mod performance_manager;
pub use performance_manager::{
    BackpressureError, PerformanceConfig, PerformanceManager, PerformanceTicket, PolicyState,
    QueueMetrics,
};

pub use frame_telemetry::ResourceBudget;

pub mod session_telemetry;
pub use session_telemetry::{FramesBySource, SessionSnapshot, SessionTelemetryCollector};

pub mod preview_capabilities;
pub use preview_capabilities::PreviewCapabilities;

pub mod adapter_selector;
pub use adapter_selector::{GpuContext, SelectedGpuInfo};

pub mod lut_parser;
pub use lut_parser::ParsedLut3D;

pub mod lut_texture;
pub use lut_texture::GpuLut3D;

pub mod chroma_key;
pub use chroma_key::ChromaKeyUniforms;

pub mod multi_track_composer;
pub use multi_track_composer::{
    BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins, LayerBlendMode,
    LayerTransform, LayerUniforms, MultiTrackCompositor,
};

pub mod transition_pipeline;
pub use transition_pipeline::{TransitionPipeline, TransitionType, TransitionUniforms};

pub mod bezier;
pub use bezier::{interpolate_keyframe, CubicBezier};

pub mod speed_ramp;
pub use speed_ramp::{SpeedKeyframe, SpeedRampProfile};

pub mod text_effect_pipeline;
pub use text_effect_pipeline::{
    DistanceThresholdParams, DropShadowParams, GlowParams, OutlineParams, TextEffectPipeline,
};

pub mod effect_interpreter;
pub use effect_interpreter::{
    param_color, param_f32, param_vec2, resolve_passes, sanitize_parameter_overrides,
    validate_effect_definition, EffectDefinition, EffectValidationError, ParamSpec, ParamType,
    PrimitiveKind, PrimitivePass, ResolutionTier, ResolvedPass,
};

pub mod text_layer_cache;
pub use text_layer_cache::{text_layer_cache_key, TextLayerCache};

pub mod curves;
pub use curves::{evaluate_monotone_spline, CurveLutTable, CurvePoint, CurvesData};

pub mod scopes;
pub use scopes::{
    compute_video_scopes, HistogramData, RgbParadeData, ScopeGridData, ScopeType, VideoScopePayload,
};

/// Zero-copy D3D11VA → wgpu texture import (Windows discrete GPU only).
/// On non-Windows platforms this module is an empty stub so call-sites can
/// reference it unconditionally behind `#[cfg(target_os = "windows")]`.
#[cfg(target_os = "windows")]
pub mod dxgi_import;


pub mod rgba_layer_cache;
pub mod session;
pub mod renderer;

#[cfg(test)]
mod tests;

pub use rgba_layer_cache::*;
pub use session::*;
pub use renderer::*;
