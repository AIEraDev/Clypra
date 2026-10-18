use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::process::Child;
use tokio::sync::Mutex;
use super::types::ExportProgress;

/// Active export session.
pub(crate) struct ExportSession {
    /// FFmpeg child process
    pub(crate) process: Option<Child>,

    /// Stdin handle for writing frames
    pub(crate) stdin: Option<tokio::process::ChildStdin>,

    /// Current frame count
    pub(crate) current_frame: u32,

    /// Total frames
    pub(crate) total_frames: u32,

    /// Start time
    pub(crate) start_time: std::time::Instant,

    /// Last progress emission timestamp for 15 Hz rate limiting
    pub(crate) last_progress_emit: std::time::Instant,

    /// Channel for progress updates
    pub(crate) on_progress: Channel<ExportProgress>,

    /// Export configuration (for frame size validation)
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) frame_rate: f64,

    /// Final output destination path
    pub(crate) final_output_path: std::path::PathBuf,

    /// Ephemeral temporary output path (atomic swap target)
    pub(crate) temp_output_path: std::path::PathBuf,

    /// Performance monitoring
    pub(crate) frame_write_times: VecDeque<f64>, // Last 60 frame write times (ms) — VecDeque for O(1) front removal
    pub(crate) last_perf_log_time: std::time::Instant,

    /// The most recently successful complete composition. This is retained
    /// only for the life of an export so a container-duration/decoder-EOF
    /// mismatch on the final source frame cannot discard the whole file.
    pub(crate) last_composited_frame: Option<Arc<[u8]>>,
    pub(crate) source_eof_fallback_frames: u32,
}

/// Type alias for the shared export session map.
pub(crate) type ExportSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<ExportSession>>>>>;

/// Global export sessions (keyed by session ID).
/// Uses Arc<Mutex<ExportSession>> so the map lock is released immediately after lookup,
/// eliminating deadlocks and lock contention during streaming stdin writes.
pub(crate) static EXPORT_SESSIONS: once_cell::sync::Lazy<ExportSessionMap> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Progress emission interval ceiling (15 Hz / ~66ms) to prevent IPC flooding and UI freezes
pub(crate) const PROGRESS_THROTTLE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(66);

