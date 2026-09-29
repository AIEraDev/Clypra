use super::types::MediaTime;
use serde::{Deserialize, Serialize};

/// The four distinct operating modes of the Clypra real-time media engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum PlaybackMode {
    /// Continuous, deadline-driven, ordered, audio-synchronized playback
    Play,
    /// Latest-request-wins scrubbing; cancels in-flight jobs, prioritizes low latency
    Scrub,
    /// Keyframe lookup + forward burst decode to target frame
    Seek,
    /// Exact target frame step (+1 / -1 frame); precision over throughput
    FrameStep,
    /// Engine is paused and holding the current frame
    #[default]
    Idle,
}

/// Quality of Service (QoS) tier dynamically governed by workload telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum QoSTier {
    /// Full master resolution (1080p, 4K)
    #[default]
    Full,
    /// Half resolution (0.5x scale decode/render)
    Half,
    /// Quarter resolution (0.25x scale decode/render for heavy multi-track/scrub)
    Quarter,
    /// Pre-rendered timeline proxy
    Proxy,
}

/// Commands accepted by the Engine Control Plane from the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PlaybackCommand {
    /// Start continuous playback from current position
    Play,
    /// Pause playback at current position
    Pause,
    /// Jump to target timestamp with a new generation ID
    Seek {
        target_time: MediaTime,
        generation: u64,
    },
    /// Scrub to timestamp with latest-request-wins coalescing
    Scrub {
        target_time: MediaTime,
        generation: u64,
    },
    /// Step by delta frames (e.g. +1 or -1)
    Step { delta_frames: i32, generation: u64 },
    /// Adjust playback speed multiplier
    SetSpeed(f64),
    /// Override quality tier manually or via QoS policy
    SetQuality(QoSTier),
}

/// Lightweight state snapshot broadcast to the UI at 30 Hz for observer synchronization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackStateSnapshot {
    /// Authoritative playback position
    pub position: MediaTime,
    /// Total duration of the timeline
    pub duration: MediaTime,
    /// Current operating mode
    pub mode: PlaybackMode,
    /// True if the clock is running
    pub is_playing: bool,
    /// Active quality tier
    pub quality_tier: QoSTier,
    /// Furthest contiguous media timestamp decoded in memory
    pub buffered_until: MediaTime,
    /// Total dropped frames since playback started
    pub dropped_frames: u64,
    /// Real measured presentation FPS
    pub presented_fps: f32,
    /// Current active seek/scrub generation
    pub generation: u64,
}

impl Default for PlaybackStateSnapshot {
    fn default() -> Self {
        Self {
            position: MediaTime::ZERO,
            duration: MediaTime::ZERO,
            mode: PlaybackMode::Idle,
            is_playing: false,
            quality_tier: QoSTier::Full,
            buffered_until: MediaTime::ZERO,
            dropped_frames: 0,
            presented_fps: 0.0,
            generation: 0,
        }
    }
}
