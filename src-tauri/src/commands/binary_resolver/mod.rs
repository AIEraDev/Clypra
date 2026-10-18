//! Robust cross-platform binary and sidecar resolution engine.
//!
//! Locates essential external binaries (such as `ffmpeg` and `ffprobe`)
//! using a 4-tier fallback strategy:
//! 1. Bundled application resources & sibling `bin/` directories
//! 2. Project workspace and sidecar naming conventions (e.g. `ffmpeg-<target-triple>.exe`)
//! 3. Standard platform install locations (Homebrew, WinGet, Chocolatey, Scoop, system dirs)
//! 4. Augmented PATH environment lookup

mod executable_check;
mod resolver;
mod target;

#[cfg(test)]
mod tests;

pub use executable_check::is_real_executable;
pub use resolver::{
    candidate_binary_names, create_async_command, create_std_command, resolve_binary_path,
};
pub use target::{augmented_path, TARGET_TRIPLE};
