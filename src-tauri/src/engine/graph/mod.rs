//! GPU Render Graph (DAG) Subsystem
//!
//! Provides a Directed Acyclic Graph (DAG) composition pipeline:
//! - Decouples decoding, color grading, transforms, overlays, text, and presentation
//! - Caches static branches (video decode & grade) when text or overlays change
//! - Culls hidden, zero-opacity, and occluded layers
//! - Analyzes resource lifetimes and aliases transient GPU memory
//! - Emits minimal GPU resource barriers

pub mod cache;
pub mod executor;
#[allow(clippy::module_inception)]
pub mod graph;
pub mod node;
pub mod resource_pool;
pub mod telemetry;

pub use cache::{CachedNodeOutput, RenderGraphCache};
pub use executor::{create_solid_surface, RenderGraphExecutor};
pub use graph::{GraphError, RenderGraph, ResourceBarrier};
pub use node::{
    ColorGradeParams, CullReason, EffectSpec, NodeCacheKey, NodeId, OverlayType, PassKind,
    RenderPassNode, ResourceId,
};
pub use resource_pool::{GraphResourcePool, LifetimeInterval, TransientResourceDesc};
pub use telemetry::RenderGraphTelemetry;
