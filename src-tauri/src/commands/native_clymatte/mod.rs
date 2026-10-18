//! Native `.clymatte` IPC commands and runtime prefetch orchestration.
//!
//! Provides lock-free, zero-contention access to single-file baked matte containers
//! for real-time 60fps subject cutout and body effect playback.

mod bake;
mod paths;
mod session;
mod types;

pub use bake::*;
pub use session::*;
pub use types::*;
