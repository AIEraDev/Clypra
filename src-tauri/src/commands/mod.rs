pub mod ai;
pub mod audio_extraction;
pub mod auto_reframe;
pub mod binary_resolver;
pub mod captions;
pub mod creator_thumbnail;
pub mod debug;
pub mod export;
#[cfg(test)]
pub mod ipc_security_tests;
/// `filmstrip` — timeline tile streaming, atlas cache, frame decode pipeline, and poster frames.
/// This module was previously named `thumbnail` (an MVP simplification). The `thumbnail` alias
/// is preserved as a transparent re-export for IPC backwards compatibility during the transition.
pub mod filmstrip;
/// Backward-compat alias — all Tauri IPC command names are unchanged.
pub mod thumbnail {
    pub use super::filmstrip::*;
}
pub mod lut;
pub mod media;
pub mod native_audio;
pub mod native_clymatte;
pub mod native_export;
pub mod native_playback;
pub mod native_preview;
pub mod native_surface;
pub mod permissions;
pub mod playback_push_mailbox;
pub mod project;
pub mod recording;
pub mod render_target_manager;
pub mod security;
pub mod silence_detector;
pub mod sync_metrics;
pub mod transfer;
pub mod whisper;

pub use ai::*;
pub use audio_extraction::*;
pub use auto_reframe::*;
pub use binary_resolver::{create_async_command, create_std_command, resolve_binary_path};
pub use captions::*;
pub use creator_thumbnail::*;
pub use debug::*;
pub use export::*;
pub use filmstrip::*;
pub use lut::*;
pub use media::*;
pub use native_audio::*;
pub use native_clymatte::*;
pub use native_export::*;
pub use native_playback::*;
pub use native_preview::*;
pub use native_surface::*;
pub use permissions::*;
pub use project::*;
pub use recording::*;
pub use render_target_manager::*;
pub use security::*;
pub use silence_detector::*;
pub use sync_metrics::*;
pub use transfer::*;
pub use whisper::*;
