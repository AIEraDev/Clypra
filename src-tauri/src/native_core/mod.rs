//! Compatibility adapter for the extracted, platform-neutral native crate.
//!
//! Tauri commands keep their existing `crate::native_core::*` paths while the
//! implementation is now reusable by the future CLI and local lab daemon.

pub use clypra_native_core::*;
