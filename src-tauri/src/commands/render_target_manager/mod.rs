//! Presentation target lifecycle management.
//!
//! # Design
//!
//! [`RenderTargetManager`] is **boring by design**. Its only job is:
//! create, destroy, resize, show, hide, and hand out presentation handles.
//! It does **not** render.
//!
//! Rendering flows as:
//! ```text
//! renderer.render(&frame_resource, &mut present_frame)?;
//! present_frame.present();
//! ```
//! Not `target.render(frame)`.
//!
//! # Target vs Monitor
//!
//! - [`RenderTargetId`] = Clypra's logical output. An opaque `u64`.
//! - [`MonitorId`]      = OS display device (HMONITOR / CGDirectDisplayID).
//!
//! These are separate concepts. A logical target can survive monitor
//! disconnection in a [`RenderTargetState::surface_lost`] state. When the
//! monitor reappears, the target reattaches.

mod frame;
mod manager;
mod types;

#[cfg(test)]
mod tests;

pub use frame::*;
pub use manager::*;
pub use types::*;
