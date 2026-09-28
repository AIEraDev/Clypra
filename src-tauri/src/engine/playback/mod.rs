//! Native Real-Time Playback Controller
//!
//! Architectural Invariant:
//! ------------------------
//! - The dedicated OS playback thread owns time, project state, and continuous frame production.
//! - The UI sends commands (`Play`, `Pause`, `Seek`, `Scrub`, `Step`, `ProjectCommand`) via a non-blocking channel.
//! - The UI observes state snapshots emitted asynchronously at 30 Hz.
//! - Continuous frame production never traverses Tauri IPC or React render loops.

pub mod controller;

#[cfg(test)]
mod tests;

pub use controller::{EngineCommand, PlaybackController, PlaybackPlanQueue, PlaybackPlanReceiver};
