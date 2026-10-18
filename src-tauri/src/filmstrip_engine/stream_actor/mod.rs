//! Stream Decoder Actor
//!
//! Provides dedicated, serialized, GOP-aware decoding per media stream.
//! Eliminates lock thrashing and backward seek cascades between the visible
//! presentation thread and background lookahead predecoding.
//!
//! Architectural invariants:
//! 1. Exactly one actor per `(video_path, stream_id)` pair.
//! 2. Urgent presentation requests always preempt background lookahead.
//! 3. Opportunistic forward priming populates an in-memory prime cache
//!    ahead of the playback playhead, making sequential frames available
//!    at near-zero (<10µs) latency.
//! 4. In-flight background decodes are cancelled immediately when a newer
//!    urgent request or generation arrives.

pub mod handle;
pub mod types;
pub(crate) mod worker;

#[cfg(test)]
mod tests;

pub use handle::*;
pub use types::*;
