//! Hardware Benchmark Types and Schemas
//!
//! Captures machine identity, decoder backend truth, zero-copy verification,
//! granular frame-time distributions (p50, p90, p95, p99, max), per-stage
//! microsecond timings, and benchmark scenarios.

use super::super::hardware::{GpuVendor, GraphicsBackend};
use super::super::qos::QoSDecision;
use super::super::types::{CodecProfile, CodecType, MediaTime, PixelFormat};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// Benchmark scenarios executed by the Hardware Benchmark Runner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BenchmarkScenario {
    /// Cold engine startup and first-frame presentation latency breakdown
    ColdStartup,
    /// Warm engine startup and first-frame latency
    WarmStartup,
    /// 30+ second continuous deadline-driven playback at target framerate
    ContinuousPlayback,
    /// Cold seek across long GOP keyframe boundaries
    SeekCold,
    /// Warm seek with pre-cached frames
    SeekWarm,
    /// Rapid back-and-forth scrubbing with latest-request-wins coalescing
    RapidScrub,
    /// Single-frame precise stepping (+1 / -1 frame)
    FrameStep,
    /// Multi-layer concurrent 4K playback composition
    MultiLayerPlayback,
    /// Playback pause and graceful high-quality frame replacement
    PauseQualityRecovery,
    /// QoS degradation under overload and recovery with hysteresis
    QoSDegradationRecovery,
    /// Surface pool and VRAM memory pressure handling
    MemoryPressure,
    /// Empty timeline gap fast path
    TimelineGap,
    /// Native engine execution during simulated UI / React thread freeze
    ReactFreezeImmunity,
}

/// Description of the media asset evaluated in the benchmark.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenchmarkMedia {
    pub path: PathBuf,
    pub codec: CodecType,
    pub profile: CodecProfile,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub bit_depth: u8,
    pub duration: Duration,
    pub file_size_bytes: u64,
}

impl BenchmarkMedia {
    pub fn mock_4k60_hevc_10bit() -> Self {
        Self {
            path: PathBuf::from("test_4k_hevc_main10_60.mp4"),
            codec: CodecType::Hevc,
            profile: CodecProfile::Main10,
            width: 3840,
            height: 2160,
            fps: 60.0,
            bit_depth: 10,
            duration: Duration::from_secs(60),
            file_size_bytes: 250_000_000,
        }
    }

    pub fn mock_1080p60_h264() -> Self {
        Self {
            path: PathBuf::from("test_1080p_h264_60.mp4"),
            codec: CodecType::H264,
            profile: CodecProfile::High,
            width: 1920,
            height: 1080,
            fps: 60.0,
            bit_depth: 8,
            duration: Duration::from_secs(60),
            file_size_bytes: 80_000_000,
        }
    }
}

/// Physical machine identity and hardware environment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineIdentity {
    pub os: String,
    pub os_version: String,
    pub windows_build: Option<String>,
    pub cpu: String,
    pub ram_bytes: u64,
    pub gpu_adapter: String,
    pub gpu_vendor: GpuVendor,
    pub gpu_luid: Option<u64>,
    pub vram_bytes: u64,
    pub driver_version: String,
    pub graphics_backend: GraphicsBackend,
    pub ffmpeg_version: String,
    pub clypra_build: String,
    pub display_refresh_rate: f64,
    pub selected_decoder_adapter: String,
    pub selected_renderer_adapter: String,
    pub same_adapter_zero_copy: bool,
}

/// Actual runtime identity of the decoder backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecoderIdentity {
    pub backend: String,
    pub is_hardware: bool,
    pub codec: CodecType,
    pub profile: CodecProfile,
    pub bit_depth: u8,
    pub output_format: PixelFormat,
    pub rejection_reason: Option<String>,
}

/// Memory copy and transfer metrics for validating true zero-copy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferMetrics {
    pub cpu_readback_bytes: usize,
    pub cpu_upload_bytes: usize,
    pub cross_adapter_bytes: usize,
    pub gpu_copy_bytes: usize,
    pub is_zero_copy: bool,
}

/// Outcome of presenting an individual frame against its deadline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameOutcome {
    PresentedOnTime,
    PresentedLate(Duration),
    RepeatedPrevious,
    Dropped,
    Obsolete,
}

/// Decomposed microsecond stage timings for an individual frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrameTelemetry {
    pub frame_id: u64,
    pub generation: u64,
    pub project_revision: u64,
    pub pts: MediaTime,
    pub outcome: FrameOutcome,
    // Decomposed timings in microseconds
    pub demux_us: u64,
    pub decode_us: u64,
    pub decode_queue_wait_us: u64,
    pub surface_acquire_us: u64,
    pub surface_wait_us: u64,
    pub interop_us: u64,
    pub graph_compile_us: u64,
    pub graph_execute_us: u64,
    pub gpu_wait_us: u64,
    pub present_wait_us: u64,
    pub present_us: u64,
    pub total_frame_ms: f64,
    // Buffer & cache metrics
    pub surface_pool_used: usize,
    pub surface_pool_capacity: usize,
    pub cache_hit: bool,
}

/// Microsecond breakdown of startup stages.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartupMetrics {
    pub process_start_us: u64,
    pub engine_ready_us: u64,
    pub gpu_device_ready_us: u64,
    pub shader_cache_loaded_us: u64,
    pub decoder_ready_us: u64,
    pub first_frame_decoded_us: u64,
    pub first_frame_rendered_us: u64,
    pub first_frame_presented_us: u64,
    pub is_warm: bool,
}

/// Aggregate statistical summary of playback performance.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PlaybackSummary {
    pub target_fps: f64,
    pub presented_fps: f64,
    pub total_frames: usize,
    pub presented_on_time_count: usize,
    pub presented_late_count: usize,
    pub dropped_count: usize,
    pub repeated_count: usize,
    pub drop_ratio: f64,
    pub repeat_ratio: f64,
    pub deadline_miss_ratio: f64,
    pub consecutive_misses_max: usize,
    // Frame-time distribution percentiles (ms)
    pub p50_frame_ms: f64,
    pub p90_frame_ms: f64,
    pub p95_frame_ms: f64,
    pub p99_frame_ms: f64,
    pub max_frame_ms: f64,
    // Stage averages (us)
    pub mean_decode_us: u64,
    pub mean_render_us: u64,
    pub mean_present_us: u64,
}

/// Complete benchmark result for a scenario run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub scenario: BenchmarkScenario,
    pub media: BenchmarkMedia,
    pub machine: MachineIdentity,
    pub decoder: DecoderIdentity,
    pub transfers: TransferMetrics,
    pub playback: PlaybackSummary,
    pub startup: Option<StartupMetrics>,
    pub qos_decisions: Vec<QoSDecision>,
    pub passed: bool,
    pub failure_reasons: Vec<String>,
}

/// Statistical summary of repeated, identically configured benchmark runs.
///
/// `p95_relative_spread` is the largest absolute deviation from the median,
/// divided by the median. The regression tolerance is deliberately derived
/// from measured variance so a fixed 10% gate does not flap on consumer PCs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepeatedBenchmarkSummary {
    pub run_count: usize,
    pub passed_run_count: usize,
    pub median_p95_frame_ms: f64,
    pub median_p99_frame_ms: f64,
    pub median_presented_fps: f64,
    pub p95_relative_spread: f64,
    pub p95_regression_threshold: f64,
}

/// JSON artifact for a controlled baseline. Keep all individual runs: the
/// summary is convenient for comparison, but cannot replace raw evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepeatedBenchmarkResult {
    pub runs: Vec<BenchmarkResult>,
    pub summary: RepeatedBenchmarkSummary,
}
