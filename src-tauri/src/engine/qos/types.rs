//! Quality of Service (QoS) Types & Policies
//!
//! Separates:
//! - RenderQuality (compositor/scaler resolution: Full, Half, Quarter)
//! - MediaVariant (source decoding: Original vs Proxy)
//! - EffectsPolicy (effect graph evaluation: Full, Reduced, Minimal, BypassOptional)
//! - Bottleneck classification and explainable QoS decision reasons

use super::super::frame::ColorMetadata;
use super::super::types::CodecType;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Unique identifier for a pre-generated or optimized proxy stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ProxyId(pub u64);

/// Resolution tier of the render graph and display compositing.
/// Independent of source media decoding resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RenderQuality {
    /// Full canvas resolution (1.0x)
    Full,
    /// Half canvas resolution (0.5x scale in compositor)
    Half,
    /// Quarter canvas resolution (0.25x scale for heavy multi-track/scrubbing)
    Quarter,
}

impl Default for RenderQuality {
    fn default() -> Self {
        RenderQuality::Full
    }
}

/// Source media stream variant selected for decoding.
/// Independent of compositor render quality.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MediaVariant {
    /// Decode from original master media asset (e.g. 4K 10-bit HEVC)
    Original,
    /// Decode from an optimized proxy stream (e.g. 1080p H.264)
    Proxy(ProxyId),
}

impl Default for MediaVariant {
    fn default() -> Self {
        MediaVariant::Original
    }
}

/// Strategy for evaluating visual effects in the Render Graph under GPU load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EffectsPolicy {
    /// Evaluate all effects at authored quality
    Full,
    /// Reduce expensive sample counts (e.g. blur radii, particle counts, multi-tap filters)
    Reduced,
    /// Disable expensive non-essential filters (e.g. blur, glow, bloom)
    Minimal,
    /// Bypass all optional effects, preserving only basic transforms and opacity
    BypassOptional,
}

impl Default for EffectsPolicy {
    fn default() -> Self {
        EffectsPolicy::Full
    }
}

/// Diagnosed system bottleneck identified by the QoS decision engine.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Bottleneck {
    /// System is operating comfortably within deadline budgets
    None,
    /// Demuxing / IO thread cannot keep up with packet demand
    Demux,
    /// Hardware or software video decoder cannot meet frame decode deadlines
    Decode,
    /// Decoder input queue is congested or saturated
    DecodeQueue,
    /// Hardware surface pool is exhausted (decoder waiting for available surfaces)
    SurfacePool,
    /// CPU preparation / timeline evaluation is exceeding thread budget
    RenderCpu,
    /// GPU shader execution / compositing exceeds vsync budget
    RenderGpu,
    /// Specific expensive effect pass node in the Render Graph is dominating frame time
    Effect(String),
    /// Swapchain presentation / vsync flip wait
    Presentation,
    /// GPU or system memory pressure / VRAM budget exhaustion
    Memory,
}

impl Default for Bottleneck {
    fn default() -> Self {
        Bottleneck::None
    }
}

/// Human- and machine-readable explainable rationale for a QoS decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum QoSReason {
    /// System is healthy and operating within frame budget
    Healthy,
    /// Decoder cannot keep pace with playback deadlines
    DecodeStarvation {
        decode_mean_us: u64,
        ready_depth: usize,
    },
    /// GPU rendering / compositing is exceeding frame deadline
    GpuRenderDeadlinePressure {
        gpu_render_mean_us: u64,
        misses: u64,
        total_frames: u64,
    },
    /// A specific effect in the Render Graph is dominating frame budget
    ExpensiveEffectPressure {
        effect_name: String,
        effect_mean_us: u64,
    },
    /// VRAM or surface pool memory pressure
    SurfaceMemoryPressure {
        pool_utilization_pct: f32,
        vram_used_bytes: usize,
    },
    /// Aggressive scrubbing prioritizes instant response over quality
    ScrubLatencyOptimization,
    /// Manual override set by user or test harness
    UserManualOverride,
    /// Engine paused; asynchronously upgrading to full quality
    PausedQualityRestoration,
}

impl Default for QoSReason {
    fn default() -> Self {
        QoSReason::Healthy
    }
}

/// Comprehensive, actionable decision produced by the QoS Engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QoSDecision {
    /// Selected media source variant
    pub media_variant: MediaVariant,
    /// Selected compositor render quality
    pub render_quality: RenderQuality,
    /// Selected effects evaluation policy
    pub effects_policy: EffectsPolicy,
    /// Fractional lookahead reduction factor (0.0 = full lookahead, 0.5 = 50% lookahead)
    pub lookahead_reduction: f32,
    /// Explainable reason for this decision
    pub reason: QoSReason,
    /// Confidence metric [0.0, 1.0]
    pub confidence: f32,
}

impl Default for QoSDecision {
    fn default() -> Self {
        Self {
            media_variant: MediaVariant::Original,
            render_quality: RenderQuality::Full,
            effects_policy: EffectsPolicy::Full,
            lookahead_reduction: 0.0,
            reason: QoSReason::Healthy,
            confidence: 1.0,
        }
    }
}

/// Metadata and storage descriptor for an optimized proxy variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProxyVariant {
    pub id: ProxyId,
    pub source_asset: String,
    pub codec: CodecType,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub color: ColorMetadata,
    pub path: PathBuf,
    pub is_ready: bool,
}
