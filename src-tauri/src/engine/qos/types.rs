//! Quality of Service (QoS) Types & Policies
//!
//! Separates:
//! - RenderQuality (compositor/scaler resolution: Full, Half, Quarter)
//! - MediaVariant (source decoding: Original vs Proxy)
//! - EffectsPolicy (effect graph evaluation: Full, Reduced, Minimal, BypassOptional)
//! - Bottleneck classification and explainable QoS decision reasons

use super::super::frame::ColorMetadata;
use super::super::hardware::DecodeCapability;
use super::super::types::CodecType;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Resolution dimensions (width, height).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

impl Resolution {
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

pub type DecoderBackendId = String;

/// Decode strategy selected for a media clip or timeline track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeStrategy {
    pub media_variant: MediaVariant,
    pub decoder_backend: DecoderBackendId,
    pub target_decode_resolution: Option<Resolution>,
}

/// Calculated playback demand based on source media dimensions and UI viewport target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackResolutionDemand {
    pub source_width: u32,
    pub source_height: u32,
    pub target_width: u32,
    pub target_height: u32,
    pub device_limit: Option<DecodeCapability>,
}

impl PlaybackResolutionDemand {
    /// Selects the smallest acceptable proxy candidate that satisfies preview demand
    /// without unnecessary over-decoding on constrained platforms.
    pub fn select_candidate_proxy(&self, candidates: &[(u32, u32)]) -> (u32, u32) {
        let target_area = self.target_width.saturating_mul(self.target_height).max(1);
        let mut best = candidates.first().copied().unwrap_or((1280, 720));
        for &cand in candidates {
            let cand_area = cand.0.saturating_mul(cand.1);
            if cand_area >= target_area
                && (best.0 * best.1 < target_area || cand_area < best.0 * best.1)
            {
                best = cand;
            }
        }
        best
    }
}

/// Performance envelope comparing measured decode and render latencies against frame deadlines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PerformanceEnvelope {
    pub target_frame_interval_us: u64,
    pub measured_decode_us: u64,
    pub measured_render_us: u64,
    pub decode_headroom_us: i64,
    pub render_headroom_us: i64,
    pub deadline_miss_ratio: f32,
    pub sustained: bool,
}

impl PerformanceEnvelope {
    pub fn from_timings(
        target_interval_us: u64,
        decode_us: u64,
        render_us: u64,
        miss_ratio: f32,
        sustained: bool,
    ) -> Self {
        let decode_headroom = target_interval_us as i64 - decode_us as i64;
        let render_headroom = target_interval_us as i64 - render_us as i64;
        Self {
            target_frame_interval_us: target_interval_us,
            measured_decode_us: decode_us,
            measured_render_us: render_us,
            decode_headroom_us: decode_headroom,
            render_headroom_us: render_headroom,
            deadline_miss_ratio: miss_ratio,
            sustained,
        }
    }

    #[inline]
    pub fn is_decode_starved(&self) -> bool {
        self.decode_headroom_us < 0 || (self.sustained && self.deadline_miss_ratio > 0.20)
    }

    #[inline]
    pub fn is_render_starved(&self) -> bool {
        self.render_headroom_us < 0
    }
}

/// Availability lifecycle of a proxy media stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ProxyAvailability {
    Missing,
    Generating,
    Ready,
    Failed,
}

/// Authoritative playback policy snapshot exposed by the native engine to the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackPolicySnapshot {
    pub media_variant: MediaVariant,
    pub render_quality: RenderQuality,
    pub effects_policy: EffectsPolicy,
    pub reason: QoSReason,
    pub is_decode_starved: bool,
}

/// Unique identifier for a pre-generated or optimized proxy stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ProxyId(pub u64);

/// Resolution tier of the render graph and display compositing.
/// Independent of source media decoding resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum RenderQuality {
    /// Full canvas resolution (1.0x)
    #[default]
    Full,
    /// Half canvas resolution (0.5x scale in compositor)
    Half,
    /// Quarter canvas resolution (0.25x scale for heavy multi-track/scrubbing)
    Quarter,
}

/// Source media stream variant selected for decoding.
/// Independent of compositor render quality.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum MediaVariant {
    /// Decode from original master media asset (e.g. 4K 10-bit HEVC)
    #[default]
    Original,
    /// Decode from an optimized proxy stream (e.g. 1080p H.264)
    Proxy(ProxyId),
}

/// Strategy for evaluating visual effects in the Render Graph under GPU load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum EffectsPolicy {
    /// Evaluate all effects at authored quality
    #[default]
    Full,
    /// Reduce expensive sample counts (e.g. blur radii, particle counts, multi-tap filters)
    Reduced,
    /// Disable expensive non-essential filters (e.g. blur, glow, bloom)
    Minimal,
    /// Bypass all optional effects, preserving only basic transforms and opacity
    BypassOptional,
}

/// Diagnosed system bottleneck identified by the QoS decision engine.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum Bottleneck {
    /// System is operating comfortably within deadline budgets
    #[default]
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

/// Human- and machine-readable explainable rationale for a QoS decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub enum QoSReason {
    /// System is healthy and operating within frame budget
    #[default]
    Healthy,
    /// Decoder cannot keep pace with playback deadlines
    DecodeStarvation {
        decode_mean_us: u64,
        ready_depth: usize,
    },
    /// Decode deadline pressure (single-frame decode exceeds target budget)
    DecodeDeadlinePressure { measured_us: u64, budget_us: u64 },
    /// Decoder throughput insufficient for nominal framerate
    DecoderThroughputInsufficient {
        measured_fps: f32,
        target_fps: f32,
        decode_us: u64,
    },
    /// Preview viewport demand is small enough that decoding full master media is wasteful
    PreviewDemandExceedsDecodeEnvelope {
        source_res: (u32, u32),
        target_res: (u32, u32),
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
