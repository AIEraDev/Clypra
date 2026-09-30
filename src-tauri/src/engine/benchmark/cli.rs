//! Benchmark CLI Arguments & Options Parser
//!
//! Parses command line options for `clypra-engine-benchmark.exe`.

use super::runner::BenchmarkConfig;
use super::types::BenchmarkScenario;
use std::env;
use std::path::PathBuf;

/// Parsed CLI execution options.
#[derive(Debug, Clone)]
pub struct CliOptions {
    pub config: BenchmarkConfig,
    pub output_json_path: Option<PathBuf>,
    pub run_full_suite: bool,
    pub use_t1200_profile: bool,
    /// Number of identical runs used to estimate normal machine variance.
    /// Phase 0 baselines should use at least three.
    pub runs: usize,
}

impl Default for CliOptions {
    fn default() -> Self {
        Self {
            config: BenchmarkConfig::default(),
            output_json_path: None,
            run_full_suite: false,
            use_t1200_profile: false,
            runs: 1,
        }
    }
}

impl CliOptions {
    pub fn parse_from_args() -> Self {
        let args: Vec<String> = env::args().collect();
        Self::parse(&args)
    }

    pub fn parse(args: &[String]) -> Self {
        let mut opts = CliOptions::default();
        let mut i = 1;

        while i < args.len() {
            match args[i].as_str() {
                "--media" if i + 1 < args.len() => {
                    opts.config.media.path = PathBuf::from(&args[i + 1]);
                    i += 1;
                }
                "--scenario" if i + 1 < args.len() => {
                    opts.config.scenario = match args[i + 1].as_str() {
                        "playback" => BenchmarkScenario::ContinuousPlayback,
                        "startup-cold" | "cold-startup" => BenchmarkScenario::ColdStartup,
                        "startup-warm" | "warm-startup" => BenchmarkScenario::WarmStartup,
                        "seek-cold" => BenchmarkScenario::SeekCold,
                        "seek-warm" => BenchmarkScenario::SeekWarm,
                        "scrub" | "rapid-scrub" => BenchmarkScenario::RapidScrub,
                        "step" | "frame-step" => BenchmarkScenario::FrameStep,
                        "multi-layer" => BenchmarkScenario::MultiLayerPlayback,
                        "qos" => BenchmarkScenario::QoSDegradationRecovery,
                        "memory" => BenchmarkScenario::MemoryPressure,
                        "gap" => BenchmarkScenario::TimelineGap,
                        "freeze" => BenchmarkScenario::ReactFreezeImmunity,
                        "pause" => BenchmarkScenario::PauseQualityRecovery,
                        _ => BenchmarkScenario::ContinuousPlayback,
                    };
                    i += 1;
                }
                "--duration" if i + 1 < args.len() => {
                    if let Ok(secs) = args[i + 1].parse::<usize>() {
                        opts.config.duration_frames = secs * (opts.config.target_fps as usize);
                    }
                    i += 1;
                }
                "--fps" if i + 1 < args.len() => {
                    if let Ok(fps) = args[i + 1].parse::<f64>() {
                        opts.config.target_fps = fps;
                    }
                    i += 1;
                }
                "--backend" if i + 1 < args.len() => {
                    opts.config.force_backend = Some(args[i + 1].clone());
                    i += 1;
                }
                "--runs" if i + 1 < args.len() => {
                    if let Ok(runs) = args[i + 1].parse::<usize>() {
                        opts.runs = runs.max(1);
                    }
                    i += 1;
                }
                "--output" if i + 1 < args.len() => {
                    opts.output_json_path = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
                "--suite" => {
                    opts.run_full_suite = true;
                    if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                        i += 1;
                    }
                }
                "--t1200" => {
                    opts.use_t1200_profile = true;
                }
                "--help" | "-h" => {
                    print_help();
                    std::process::exit(0);
                }
                _ => {}
            }
            i += 1;
        }

        opts
    }
}

fn print_help() {
    println!(
        "clypra-engine-benchmark — Windows NLE Native Hardware Benchmark\n\n\
         USAGE:\n\
           clypra-engine-benchmark [OPTIONS]\n\n\
         OPTIONS:\n\
           --media <FILE>         Path to test video media file\n\
           --scenario <SCENARIO>  playback, seek-cold, seek-warm, scrub, step, multi-layer, qos, memory, gap, freeze\n\
           --duration <SECS>      Duration in seconds for playback test (default: 30)\n\
           --fps <FPS>            Target timeline framerate (default: 60)\n\
           --backend <BACKEND>    Force decoder backend (d3d12, d3d11, software)\n\
           --runs <N>             Repeat the identical run N times (use 3 for a baseline)\n\
           --output <PATH.json>   Export structured benchmark results to JSON\n\
           --suite                Run the complete Windows NLE benchmark suite\n\
           --t1200                Use calibrated Windows 11 NVIDIA T1200 hardware profile\n\
           --help, -h             Print this help message\n"
    );
}
