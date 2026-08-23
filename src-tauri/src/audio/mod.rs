//! Native audio engine module for Clypra.
//!
//! Provides lock-free real-time safe audio output, master clock synchronization,
//! multi-track mixing, and format-agnostic audio decoding.

pub mod decoder;
pub mod mixer;
pub mod ring_buffer;

pub use decoder::{decode_audio_clip, MAX_AUDIO_CLIP_BYTES};
pub use mixer::{
    constant_power_pan, AudioClipConfig, AudioMixGraph, AudioTrackConfig, DecodedAudioClip,
    TICKS_PER_SECOND,
};
pub use ring_buffer::{
    create_audio_ring_buffer, AudioRingBufferConsumer, AudioRingBufferProducer,
    DEFAULT_RING_BUFFER_FRAMES,
};
