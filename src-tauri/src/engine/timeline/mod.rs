//! Authoritative Native Timeline & Project State
//!
//! Architectural Invariant:
//! ------------------------
//! - `ProjectState` is authoritative and mutated only by the native engine via `ProjectCommand`.
//! - `TimelineEvaluator` is a pure function: `(&ProjectState, MediaTime, generation) -> RenderPlan`.
//! - `RenderPlan` is an evaluation result. It is NOT editor state, NOT playback state,
//!   NOT a transport protocol, and NOT owned by React.

pub mod adapter;
pub mod commands;
pub mod evaluator;
pub mod model;

#[cfg(test)]
mod tests;

pub use adapter::ProjectModelAdapter;
pub use commands::{CommandEnvelope, ProjectCommand, ProjectError};
pub use evaluator::{PureTimelineEvaluator, TimelineEvaluator};
pub use model::{
    AssetId, Clip, ClipId, EngineVersion, MediaAssetRef, ProjectSettings, ProjectState, Sequence,
    TimeMapping, Track, TrackId, TrackKind,
};
