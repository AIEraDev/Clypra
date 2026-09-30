//! Hardware Benchmark & Performance Gate Subsystem (Phase J)
//!
//! Provides dedicated physical hardware benchmarking, machine profiling,
//! zero-copy telemetry validation, and regression gating.

pub mod cli;
pub mod runner;
pub mod types;

pub use cli::CliOptions;
pub use runner::{
    probe_decoder_identity, probe_machine_identity, BenchmarkConfig, HardwareBenchmarkRunner,
};
pub use types::{
    BenchmarkMedia, BenchmarkResult, BenchmarkScenario, DecoderIdentity, FrameOutcome,
    FrameTelemetry, MachineIdentity, PlaybackSummary, RepeatedBenchmarkResult,
    RepeatedBenchmarkSummary, StartupMetrics, TransferMetrics,
};
