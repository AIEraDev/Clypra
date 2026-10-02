//! 4-Arm Decode Throughput Benchmark
//!
//! Measures sustained decode throughput across four arms that isolate individual
//! pipeline stages. Run this before and after any decode-path change to detect
//! regressions.
//!
//! # Usage
//! ```
//! cargo run --release --bin decode-throughput-bench -- \
//!     --video /path/to/test.mp4 \
//!     --frames 300 \
//!     --warmup 30 \
//!     --output result.json
//! ```
//!
//! # Arms
//! | Arm | Mode                                                      |
//! |-----|-----------------------------------------------------------|
//! | 0   | Software decode (CPU frame threading) + Half quality scale |
//! | 1   | Hardware decode, GPU frame discarded before CPU download  |
//! | 2   | Hardware decode + full-resolution CPU download            |
//! | 3   | Hardware decode + CPU download (same as 2 until GPU downscale path available) |

use clypra_native_core::QualityTier;
use std::{env, fs, path::PathBuf, time::Instant};
use tauri_app_lib::thumbnail_engine::decoder::{DecodeFrameOptions, VideoDecoder};

fn percentile(sorted: &[u64], p: f64) -> Option<u64> {
    if sorted.is_empty() {
        return None;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p / 100.0).round() as usize;
    Some(sorted[idx.min(sorted.len() - 1)])
}

#[derive(Debug, serde::Serialize)]
struct ArmResult {
    arm: u8,
    description: String,
    frames_measured: usize,
    /// Frames per second over the measured window.
    sustained_fps: f64,
    /// Per-frame wall time percentiles (µs).
    frame_time_p50_us: Option<u64>,
    frame_time_p95_us: Option<u64>,
    frame_time_p99_us: Option<u64>,
    /// Hardware frame download time percentiles (µs) — populated for arms 2+.
    hw_download_p50_us: Option<u64>,
    hw_download_p95_us: Option<u64>,
    hw_download_p99_us: Option<u64>,
    /// Whether the decoder confirmed hardware acceleration was active.
    hw_accelerated: bool,
    /// Decoder-reported device type (e.g. "d3d11va", "videotoolbox", "software").
    hw_device_type: Option<String>,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct BenchReport {
    video_path: String,
    warmup_frames: usize,
    measured_frames: usize,
    arms: Vec<ArmResult>,
}

struct Config {
    video_path: String,
    warmup_frames: usize,
    measured_frames: usize,
    output_path: Option<PathBuf>,
    arms: Vec<u8>,
}

fn usage() {
    eprintln!(
        "Usage: decode-throughput-bench \
         --video <path> \
         [--frames <N=300>] \
         [--warmup <N=30>] \
         [--arms 0,1,2,3] \
         [--output <result.json>]"
    );
}

fn parse_args() -> Option<Config> {
    let args: Vec<String> = env::args().collect();
    let mut video_path = None;
    let mut measured_frames = 300usize;
    let mut warmup_frames = 30usize;
    let mut output_path = None;
    let mut arms: Vec<u8> = vec![0, 1, 2, 3];
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--video" => {
                i += 1;
                video_path = args.get(i).cloned();
            }
            "--frames" => {
                i += 1;
                measured_frames = args.get(i)?.parse().ok()?;
            }
            "--warmup" => {
                i += 1;
                warmup_frames = args.get(i)?.parse().ok()?;
            }
            "--output" => {
                i += 1;
                output_path = args.get(i).map(PathBuf::from);
            }
            "--arms" => {
                i += 1;
                arms = args
                    .get(i)?
                    .split(',')
                    .filter_map(|s| s.trim().parse().ok())
                    .collect();
            }
            _ => {}
        }
        i += 1;
    }
    Some(Config {
        video_path: video_path?,
        warmup_frames,
        measured_frames,
        output_path,
        arms,
    })
}

fn open_decoder(arm: u8, video_path: &str) -> Result<VideoDecoder, String> {
    match arm {
        0 => VideoDecoder::open_software(video_path),
        _ => VideoDecoder::open_hardware(video_path).or_else(|e| {
            eprintln!(
                "[arm {}] Hardware decoder unavailable ({}), falling back to software",
                arm, e
            );
            VideoDecoder::open_software(video_path)
        }),
    }
}

fn run_arm(arm: u8, video_path: &str, warmup_frames: usize, measured_frames: usize) -> ArmResult {
    let description = match arm {
        0 => "Software decode (CPU threading) + Half quality",
        1 => "Hardware decode, GPU frame discarded (no CPU download)",
        2 => "Hardware decode + full-resolution CPU download",
        3 => "Hardware decode + CPU download (GPU downscale path — falls back to arm 2 if unavailable)",
        _ => "Unknown arm",
    }
    .to_string();

    let mut decoder = match open_decoder(arm, video_path) {
        Ok(d) => d,
        Err(e) => {
            return ArmResult {
                arm,
                description,
                frames_measured: 0,
                sustained_fps: 0.0,
                frame_time_p50_us: None,
                frame_time_p95_us: None,
                frame_time_p99_us: None,
                hw_download_p50_us: None,
                hw_download_p95_us: None,
                hw_download_p99_us: None,
                hw_accelerated: false,
                hw_device_type: None,
                error: Some(e),
            };
        }
    };

    let frame_duration = decoder.frame_duration_secs().max(1.0 / 120.0);
    let hw_accelerated = decoder.is_hardware_accelerated();

    // Arm 0: Half quality so swscale targets ~320×180 for a 1440p source.
    // Arms 1-3: Full quality (hardware decode always produces full resolution frames).
    let options = DecodeFrameOptions {
        allow_keyframe_approx: false,
        quality: if arm == 0 {
            QualityTier::Half
        } else {
            QualityTier::Full
        },
        is_playback: true,
    };

    let total_frames = warmup_frames + measured_frames;
    let mut frame_times_us: Vec<u64> = Vec::with_capacity(measured_frames);
    let mut hw_download_us_vec: Vec<u64> = Vec::with_capacity(measured_frames);
    let mut hw_device_type: Option<String> = None;
    let mut error: Option<String> = None;

    for i in 0..total_frames {
        let t = i as f64 * frame_duration;
        let frame_start = Instant::now();

        let result = decoder.decode_frame_raw_nv12_with_options(t, options, || false);
        let elapsed_us = frame_start.elapsed().as_micros() as u64;

        match result {
            Ok(_) => {
                // Arm 1: we intentionally do not use the decoded planes — the
                // frame is dropped here. The decoder still performed the GPU
                // decode; we just skip the CPU download measurement.
                let (_, _, _, download_us, _, _, _, device_type) = decoder.last_decode_activity();
                if hw_device_type.is_none() {
                    hw_device_type = device_type.map(|s| s.to_string());
                }
                if i >= warmup_frames {
                    frame_times_us.push(elapsed_us);
                    // Arms 2 and 3 record the measured hw download time.
                    if arm >= 2 {
                        if let Some(dl) = download_us {
                            hw_download_us_vec.push(dl);
                        }
                    }
                }
            }
            Err(e) => {
                if i >= warmup_frames {
                    error = Some(format!("frame {i} failed: {e}"));
                    break;
                }
                // Warmup errors are non-fatal; the decoder may be seeking.
            }
        }
    }

    frame_times_us.sort_unstable();
    hw_download_us_vec.sort_unstable();

    let frames_measured = frame_times_us.len();
    let total_wall_us: u64 = frame_times_us.iter().sum();
    let sustained_fps = if total_wall_us > 0 {
        frames_measured as f64 / (total_wall_us as f64 / 1_000_000.0)
    } else {
        0.0
    };

    ArmResult {
        arm,
        description,
        frames_measured,
        sustained_fps,
        frame_time_p50_us: percentile(&frame_times_us, 50.0),
        frame_time_p95_us: percentile(&frame_times_us, 95.0),
        frame_time_p99_us: percentile(&frame_times_us, 99.0),
        hw_download_p50_us: percentile(&hw_download_us_vec, 50.0),
        hw_download_p95_us: percentile(&hw_download_us_vec, 95.0),
        hw_download_p99_us: percentile(&hw_download_us_vec, 99.0),
        hw_accelerated,
        hw_device_type,
        error,
    }
}

fn main() {
    let config = match parse_args() {
        Some(c) => c,
        None => {
            usage();
            std::process::exit(1);
        }
    };

    println!("=== Clypra 4-Arm Decode Throughput Benchmark ===");
    println!("Video   : {}", config.video_path);
    println!(
        "Warmup  : {} frames | Measured: {} frames",
        config.warmup_frames, config.measured_frames
    );
    println!();

    let mut results: Vec<ArmResult> = Vec::new();

    for &arm in &config.arms {
        println!("▶ Arm {} ─────────────────────────────────", arm);
        let result = run_arm(
            arm,
            &config.video_path,
            config.warmup_frames,
            config.measured_frames,
        );
        println!("  {}", result.description);
        println!(
            "  Frames: {} | FPS: {:.2}",
            result.frames_measured, result.sustained_fps
        );
        println!(
            "  Frame time  p50: {:?} µs | p95: {:?} µs | p99: {:?} µs",
            result.frame_time_p50_us, result.frame_time_p95_us, result.frame_time_p99_us,
        );
        if let Some(dl50) = result.hw_download_p50_us {
            println!(
                "  HW download p50: {} µs | p95: {:?} µs | p99: {:?} µs",
                dl50, result.hw_download_p95_us, result.hw_download_p99_us,
            );
        }
        if let Some(ref e) = result.error {
            eprintln!("  ERROR: {e}");
        }
        println!();
        results.push(result);
    }

    let report = BenchReport {
        video_path: config.video_path.clone(),
        warmup_frames: config.warmup_frames,
        measured_frames: config.measured_frames,
        arms: results,
    };

    if let Some(ref path) = config.output_path {
        match serde_json::to_string_pretty(&report) {
            Ok(json) => match fs::write(path, &json) {
                Ok(_) => println!("Results saved to: {}", path.display()),
                Err(e) => eprintln!("Failed to write output JSON: {e}"),
            },
            Err(e) => eprintln!("Failed to serialize results: {e}"),
        }
    } else {
        if let Ok(json) = serde_json::to_string_pretty(&report) {
            println!("{json}");
        }
    }
}
