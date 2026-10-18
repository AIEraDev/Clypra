//! Cold-start span recorder and launch milestone tracer.
//!
//! Collects instrumented spans across the cold-start lifecycle (C0–C4),
//! maintains bounded ring-buffer storage with per-stage aggregates,
//! tracks audio safety counters (PCM bytes, 256 MiB cap truncations, CLI fallbacks),
//! and captures process creation / OS uptime and user-visible launch milestones.

pub mod milestones;
pub mod models;
pub mod os;
pub mod recorder;

#[cfg(test)]
mod tests;

pub use milestones::*;
pub use models::*;
pub use os::*;
pub use recorder::*;
