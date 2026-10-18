//! Filmstrip command handlers — Tauri IPC surface for the filmstrip tile engine.
//!
//! # Modules
//! - `artifacts`       — Bulk tile-batch decode and render-artifact retrieval
//! - `cache_commands`  — Atlas initialisation, cache stats, and disk-cache control
//! - `frame_decode`    — Per-frame decode requests and in-flight deduplication
//! - `in_flight`       — In-flight request guard types
//! - `poster`          — Single-frame poster/keyframe extraction for the Media Pool
//!
//! # Naming Note
//! The Tauri IPC command names exposed by these handlers are **unchanged** from
//! the previous `thumbnail` module so no frontend bindings need updating.

pub mod artifacts;
pub mod cache_commands;
pub mod frame_decode;
pub mod in_flight;
pub mod poster;

#[cfg(test)]
mod tests;

pub use artifacts::*;
pub use cache_commands::*;
pub use frame_decode::*;
pub use in_flight::*;
pub use poster::*;
