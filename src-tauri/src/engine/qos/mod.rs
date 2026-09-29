//! Quality of Service (QoS) Subsystem
//!
//! Control system governing dynamic engine quality:
//! - Classifies system bottlenecks (Decode, RenderGpu, ExpensiveEffect, SurfaceMemory)
//! - Evaluates rolling 250–500 ms performance windows
//! - Enforces asymmetric hysteresis (recover window threshold M > degrade threshold N)
//! - Decouples RenderQuality (Full, Half, Quarter) from MediaVariant (Original vs Proxy)
//! - Manages EffectsPolicy (Full, Reduced, Minimal, BypassOptional)
//! - Coordinates asynchronous background proxy generation and safe frame-boundary switching
//! - Provides explainable decisions and diagnostic telemetry

pub mod controller;
pub mod metrics;
pub mod proxy_manager;
pub mod telemetry;
pub mod types;

pub use controller::{QoSConfig, QoSController, QoSTransitionEvent};
pub use metrics::{PerformanceSnapshot, PerformanceWindow};
pub use proxy_manager::AsyncProxyManager;
pub use telemetry::QoSTelemetry;
pub use types::{
    Bottleneck, DecodeStrategy, DecoderBackendId, EffectsPolicy, MediaVariant, PerformanceEnvelope,
    PlaybackPolicySnapshot, PlaybackResolutionDemand, ProxyAvailability, ProxyId, ProxyVariant,
    QoSDecision, QoSReason, RenderQuality, Resolution,
};
