//! Standalone Clypra Native Engine Benchmark Executable
//!
//! Run with:
//! cargo run --bin clypra-engine-benchmark -- --scenario playback --duration 30 --t1200 --output result.json

use std::fs;
use tauri_app_lib::engine::benchmark::{BenchmarkScenario, CliOptions, HardwareBenchmarkRunner};

fn main() {
    let opts = CliOptions::parse_from_args();

    if opts.run_full_suite {
        println!("Running Clypra Windows NLE Native Hardware Benchmark Suite...\n");

        let scenarios = [
            BenchmarkScenario::ColdStartup,
            BenchmarkScenario::ContinuousPlayback,
            BenchmarkScenario::SeekCold,
            BenchmarkScenario::SeekWarm,
            BenchmarkScenario::RapidScrub,
            BenchmarkScenario::FrameStep,
            BenchmarkScenario::MultiLayerPlayback,
            BenchmarkScenario::QoSDegradationRecovery,
            BenchmarkScenario::MemoryPressure,
            BenchmarkScenario::TimelineGap,
            BenchmarkScenario::ReactFreezeImmunity,
        ];

        let mut all_passed = true;
        let mut results = Vec::new();

        for scenario in scenarios {
            let mut scenario_config = opts.config.clone();
            scenario_config.scenario = scenario;

            let mut scenario_runner = if opts.use_t1200_profile {
                HardwareBenchmarkRunner::new_windows_t1200(scenario_config)
            } else {
                HardwareBenchmarkRunner::new(scenario_config)
            };

            let res = scenario_runner.run();
            let report = scenario_runner.format_report(&res);
            println!("{report}\n");

            if !res.passed {
                all_passed = false;
            }
            results.push(res);
        }

        if let Some(ref path) = opts.output_json_path {
            if let Ok(json) = serde_json::to_string_pretty(&results) {
                let _ = fs::write(path, json);
                println!("Saved benchmark suite JSON to: {}", path.display());
            }
        }

        if all_passed {
            println!("OVERALL SUITE RESULT: PASS\n");
            std::process::exit(0);
        } else {
            eprintln!("OVERALL SUITE RESULT: FAIL\n");
            std::process::exit(1);
        }
    } else {
        let mut runs = Vec::with_capacity(opts.runs);
        for run_index in 0..opts.runs {
            let mut runner = if opts.use_t1200_profile {
                HardwareBenchmarkRunner::new_windows_t1200(opts.config.clone())
            } else {
                HardwareBenchmarkRunner::new(opts.config.clone())
            };
            let result = runner.run();
            println!(
                "Run {}/{}\n{}",
                run_index + 1,
                opts.runs,
                runner.format_report(&result)
            );
            runs.push(result);
        }
        let repeated = HardwareBenchmarkRunner::summarize_repeated(runs);
        println!(
            "Repeat summary\n  Runs: {} ({} passed)\n  Median p95 frame: {:.2} ms\n  Median p99 frame: {:.2} ms\n  Median presented FPS: {:.2}\n  p95 spread: {:.2}%\n  Regression threshold: {:.2}%\n",
            repeated.summary.run_count,
            repeated.summary.passed_run_count,
            repeated.summary.median_p95_frame_ms,
            repeated.summary.median_p99_frame_ms,
            repeated.summary.median_presented_fps,
            repeated.summary.p95_relative_spread * 100.0,
            repeated.summary.p95_regression_threshold * 100.0,
        );

        if let Some(ref path) = opts.output_json_path {
            if let Ok(json) = serde_json::to_string_pretty(&repeated) {
                let _ = fs::write(path, json);
                println!("\nSaved repeated benchmark JSON to: {}", path.display());
            }
        }

        if repeated.summary.passed_run_count == repeated.summary.run_count {
            std::process::exit(0);
        } else {
            std::process::exit(1);
        }
    }
}
