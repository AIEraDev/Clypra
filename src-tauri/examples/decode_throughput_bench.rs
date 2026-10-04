//! Clypra Standalone Decode Throughput Benchmark
//!
//! Measures sustained decode throughput across isolated arms to determine whether
//! the pipeline bottleneck is decoding, GPU-to-CPU host transfer, or scaling.
//!
//! # Usage
//! ```
//! cargo run --release --bin decode-throughput-bench -- \
//!     --video /path/to/test.mp4 \
//!     --frames 300 \
//!     --warmup 30 \
//!     --download-every 3 \
//!     --output result.json
//! ```
//!
//! # Arms
//! | Arm | Name                                     | What it isolates |
//! |-----|------------------------------------------|------------------|
//! | 0   | Software decode + preview scale (320×180)| CPU decoder + swscale throughput |
//! | 1   | Hardware decode, GPU frame discarded    | Pure GPU decode engine throughput |
//! | 2   | Hardware decode + full-res CPU download  | Hardware decode + av_hwframe_transfer_data cost |
//! | 2b  | Hardware decode, download every Nth frame| Throughput with display-rate-throttled downloads |
//! | 3   | Hardware decode + GPU downscale          | Explicitly marked not implemented until D3D11 VP integrated |

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
    arm: String,
    description: String,
    implemented: bool,
    valid: bool,
    validity_notes: Option<String>,
    frames_measured: usize,
    /// Frames per second over the measured window (wall-clock time including final GPU sync).
    sustained_fps: f64,
    /// Total wall clock duration for measured frames (microseconds).
    total_wall_us: u64,
    /// Per-frame wall time percentiles (µs).
    frame_time_p50_us: Option<u64>,
    frame_time_p95_us: Option<u64>,
    frame_time_p99_us: Option<u64>,
    /// Hardware frame download time percentiles (µs).
    hw_download_p50_us: Option<u64>,
    hw_download_p95_us: Option<u64>,
    hw_download_p99_us: Option<u64>,
    /// Total hardware frame download time across all frames (µs).
    total_hw_download_us: u64,
    downloads_performed: usize,
    downloads_skipped: usize,
    /// Whether the decoder confirmed hardware acceleration was active.
    hw_accelerated: bool,
    /// Decoder-reported device type (e.g. "d3d11va", "videotoolbox", "software").
    hw_device_type: Option<String>,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct BenchReport {
    git_commit: Option<String>,
    git_dirty: Option<bool>,
    build_profile: String,
    operating_system: String,
    architecture: String,
    video_path: String,
    clip_codec: String,
    clip_width: u32,
    clip_height: u32,
    clip_fps: f64,
    detected_hw_device: Option<String>,
    warmup_frames: usize,
    measured_frames: usize,
    download_every_n: usize,
    target_scale_resolution: String,
    arms: Vec<ArmResult>,
}

struct Config {
    video_path: String,
    warmup_frames: usize,
    measured_frames: usize,
    download_every: usize,
    target_width: u32,
    target_height: u32,
    output_path: Option<PathBuf>,
    arms: Vec<String>,
}

fn usage() {
    eprintln!(
        "Usage: decode-throughput-bench \
         --video <path> \
         [--frames <N=300>] \
         [--warmup <N=30>] \
         [--download-every <N=3>] \
         [--target-width <W=320>] \
         [--target-height <H=180>] \
         [--arms 0,1,2,2b,3] \
         [--output <result.json>]"
    );
}

fn parse_args() -> Option<Config> {
    let args: Vec<String> = env::args().collect();
    let mut video_path = None;
    let mut measured_frames = 300usize;
    let mut warmup_frames = 30usize;
    let mut download_every = 3usize;
    let mut target_width = 320u32;
    let mut target_height = 180u32;
    let mut output_path = None;
    let mut arms: Vec<String> = vec![
        "0".to_string(),
        "1".to_string(),
        "2".to_string(),
        "2b".to_string(),
    ];
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
            "--download-every" => {
                i += 1;
                download_every = args.get(i)?.parse().ok()?;
            }
            "--target-width" => {
                i += 1;
                target_width = args.get(i)?.parse().ok()?;
            }
            "--target-height" => {
                i += 1;
                target_height = args.get(i)?.parse().ok()?;
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
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
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
        download_every: download_every.max(1),
        target_width,
        target_height,
        output_path,
        arms,
    })
}

fn run_arm(
    arm: &str,
    video_path: &str,
    warmup_frames: usize,
    measured_frames: usize,
    download_every: usize,
    target_width: u32,
    target_height: u32,
) -> ArmResult {
    let (description, implemented) = match arm {
        "0" => (
            format!("Software decode (CPU threading) + swscale to {target_width}×{target_height}"),
            true,
        ),
        "1" => (
            "Hardware decode, GPU frame discarded (no host CPU download)".to_string(),
            true,
        ),
        "2" => (
            "Hardware decode + full-resolution host CPU download (every frame)".to_string(),
            true,
        ),
        "2b" => (
            format!("Hardware decode, download every {download_every}th frame (discard others)"),
            true,
        ),
        "3" => (
            "Hardware decode + GPU downscale before download (Direct3D11 Video Processor)"
                .to_string(),
            false,
        ),
        _ => (format!("Unknown arm {arm}"), false),
    };

    if !implemented {
        return ArmResult {
            arm: arm.to_string(),
            description,
            implemented: false,
            valid: true,
            validity_notes: Some("Not yet implemented: Direct3D11 Video Processor scaling is pending GPU pipeline integration.".to_string()),
            frames_measured: 0,
            sustained_fps: 0.0,
            total_wall_us: 0,
            frame_time_p50_us: None,
            frame_time_p95_us: None,
            frame_time_p99_us: None,
            hw_download_p50_us: None,
            hw_download_p95_us: None,
            hw_download_p99_us: None,
            total_hw_download_us: 0,
            downloads_performed: 0,
            downloads_skipped: 0,
            hw_accelerated: false,
            hw_device_type: None,
            error: None,
        };
    }

    let mut decoder = if arm == "0" {
        match VideoDecoder::open_software(video_path) {
            Ok(d) => d,
            Err(e) => {
                return ArmResult {
                    arm: arm.to_string(),
                    description,
                    implemented: true,
                    valid: false,
                    validity_notes: None,
                    frames_measured: 0,
                    sustained_fps: 0.0,
                    total_wall_us: 0,
                    frame_time_p50_us: None,
                    frame_time_p95_us: None,
                    frame_time_p99_us: None,
                    hw_download_p50_us: None,
                    hw_download_p95_us: None,
                    hw_download_p99_us: None,
                    total_hw_download_us: 0,
                    downloads_performed: 0,
                    downloads_skipped: 0,
                    hw_accelerated: false,
                    hw_device_type: None,
                    error: Some(format!("Failed to open software decoder: {e}")),
                };
            }
        }
    } else {
        match VideoDecoder::open_hardware(video_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!(
                    "[arm {arm}] Hardware decoder unavailable ({e}), falling back to software"
                );
                match VideoDecoder::open_software(video_path) {
                    Ok(d) => d,
                    Err(e2) => {
                        return ArmResult {
                            arm: arm.to_string(),
                            description,
                            implemented: true,
                            valid: false,
                            validity_notes: Some(
                                "Hardware decoder completely unavailable".to_string(),
                            ),
                            frames_measured: 0,
                            sustained_fps: 0.0,
                            total_wall_us: 0,
                            frame_time_p50_us: None,
                            frame_time_p95_us: None,
                            frame_time_p99_us: None,
                            hw_download_p50_us: None,
                            hw_download_p95_us: None,
                            hw_download_p99_us: None,
                            total_hw_download_us: 0,
                            downloads_performed: 0,
                            downloads_skipped: 0,
                            hw_accelerated: false,
                            hw_device_type: None,
                            error: Some(format!("Software fallback failed: {e2}")),
                        };
                    }
                }
            }
        }
    };

    let frame_duration = decoder.frame_duration_secs().max(1.0 / 120.0);
    let hw_accelerated = decoder.is_hardware_accelerated();
    let total_frames = warmup_frames + measured_frames;

    let mut frame_times_us: Vec<u64> = Vec::with_capacity(measured_frames);
    let mut hw_download_us_vec: Vec<u64> = Vec::with_capacity(measured_frames);
    let mut hw_device_type: Option<String> = None;
    let mut downloads_performed = 0usize;
    let mut downloads_skipped = 0usize;
    let mut total_hw_download_us = 0u64;
    let mut error: Option<String> = None;

    let run_started = Instant::now();
    let mut measured_start_instant: Option<Instant> = None;

    for i in 0..total_frames {
        if i == warmup_frames {
            measured_start_instant = Some(Instant::now());
        }

        let t = i as f64 * frame_duration;

        // Configure options per arm
        let should_download = match arm {
            "0" => true,
            "1" => false,
            "2" => true,
            "2b" => i % download_every == 0,
            _ => true,
        };

        let options = DecodeFrameOptions {
            allow_keyframe_approx: false,
            quality: QualityTier::Full,
            is_playback: true,
            skip_hw_download: !should_download,
            target_dimensions: if arm == "0" {
                Some((target_width, target_height))
            } else {
                None
            },
        };

        let frame_start = Instant::now();
        let result = decoder.decode_frame_raw_nv12_with_options(t, options, || false);
        let frame_elapsed_us = frame_start.elapsed().as_micros() as u64;

        match result {
            Ok(_) => {
                let (_, _, _, download_us, _, _, _, device_type) = decoder.last_decode_activity();
                if hw_device_type.is_none() {
                    hw_device_type = device_type.map(|s| s.to_string());
                }

                if i >= warmup_frames {
                    frame_times_us.push(frame_elapsed_us);
                    if should_download {
                        downloads_performed += 1;
                        if let Some(dl) = download_us {
                            hw_download_us_vec.push(dl);
                            total_hw_download_us = total_hw_download_us.saturating_add(dl);
                        }
                    } else {
                        downloads_skipped += 1;
                    }
                }
            }
            Err(e) => {
                if i >= warmup_frames {
                    error = Some(format!("Frame {i} failed: {e}"));
                    break;
                }
            }
        }
    }

    // Final GPU sync / drain:
    // Calling decode with a dummy seek/flush or a forced single download guarantees
    // all asynchronous GPU hardware work is retired before stopping the wall clock.
    if hw_accelerated {
        let _ = decoder.decode_frame_raw_nv12_with_options(
            0.0,
            DecodeFrameOptions {
                allow_keyframe_approx: false,
                quality: QualityTier::Full,
                is_playback: false,
                skip_hw_download: false, // force 1 synchronous CPU transfer to fence the GPU
                target_dimensions: None,
            },
            || false,
        );
    }

    let measured_wall_us = measured_start_instant
        .map(|start| start.elapsed().as_micros().min(u64::MAX as u128) as u64)
        .unwrap_or_else(|| run_started.elapsed().as_micros().min(u64::MAX as u128) as u64);

    frame_times_us.sort_unstable();
    hw_download_us_vec.sort_unstable();

    let frames_measured = frame_times_us.len();
    let sustained_fps = if measured_wall_us > 0 {
        frames_measured as f64 / (measured_wall_us as f64 / 1_000_000.0)
    } else {
        0.0
    };

    // Validity checks
    let mut valid = true;
    let mut validity_notes = Vec::new();

    if arm == "1" {
        // Arm 1 must prove it skipped the download: hw_download_us must be 0/empty.
        if !hw_download_us_vec.is_empty() && hw_download_us_vec.iter().any(|&d| d > 0) {
            valid = false;
            validity_notes.push("INVALID: Download was not skipped in Arm 1 (hardware_frame_download_us was non-zero)".to_string());
        }
        if downloads_performed > 0 {
            valid = false;
            validity_notes.push(format!(
                "INVALID: Arm 1 performed {downloads_performed} downloads"
            ));
        }
    } else if arm == "2" && hw_accelerated && downloads_performed == 0 {
        valid = false;
        validity_notes.push("INVALID: Arm 2 performed 0 downloads on hardware path".to_string());
    }

    ArmResult {
        arm: arm.to_string(),
        description,
        implemented: true,
        valid,
        validity_notes: if validity_notes.is_empty() {
            None
        } else {
            Some(validity_notes.join("; "))
        },
        frames_measured,
        sustained_fps,
        total_wall_us: measured_wall_us,
        frame_time_p50_us: percentile(&frame_times_us, 50.0),
        frame_time_p95_us: percentile(&frame_times_us, 95.0),
        frame_time_p99_us: percentile(&frame_times_us, 99.0),
        hw_download_p50_us: percentile(&hw_download_us_vec, 50.0),
        hw_download_p95_us: percentile(&hw_download_us_vec, 95.0),
        hw_download_p99_us: percentile(&hw_download_us_vec, 99.0),
        total_hw_download_us,
        downloads_performed,
        downloads_skipped,
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

    let build_profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };

    if build_profile == "debug" {
        eprintln!("╔══════════════════════════════════════════════════════════════════════╗");
        eprintln!("║ WARNING: RUNNING IN DEBUG PROFILE!                                   ║");
        eprintln!("║ Performance numbers will be severely skewed. Please compile with:    ║");
        eprintln!("║   cargo run --release --bin decode-throughput-bench -- ...           ║");
        eprintln!("╚══════════════════════════════════════════════════════════════════════╝");
        eprintln!();
    }

    println!("===============================================================");
    println!("       CLYPRA DECODE THROUGHPUT BENCHMARK (PHASE 1B)");
    println!("===============================================================");
    println!("Video      : {}", config.video_path);
    println!("Profile    : {}", build_profile);
    println!(
        "Commit     : {}",
        option_env!("CLYPRA_GIT_COMMIT").unwrap_or("unknown")
    );
    println!(
        "Dirty      : {}",
        option_env!("CLYPRA_GIT_DIRTY").unwrap_or("unknown")
    );
    println!(
        "OS/Arch    : {} / {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    println!("Warmup     : {} frames", config.warmup_frames);
    println!("Measured   : {} frames", config.measured_frames);
    println!("N-rate (2b): Every {} frame(s)", config.download_every);
    println!(
        "Scale (0)  : {}×{}",
        config.target_width, config.target_height
    );
    println!("===============================================================\n");

    // Open video once to inspect clip metadata
    let (clip_codec, clip_width, clip_height, clip_fps) =
        match VideoDecoder::open(&config.video_path) {
            Ok(d) => {
                let m = d.metadata();
                let fps = if m.average_frame_rate_den > 0 && m.average_frame_rate_num > 0 {
                    m.average_frame_rate_num as f64 / m.average_frame_rate_den as f64
                } else {
                    30.0
                };
                (m.codec_name, m.width, m.height, fps)
            }
            Err(e) => {
                eprintln!("Cannot probe video {}: {e}", config.video_path);
                std::process::exit(1);
            }
        };

    println!(
        "Source: {} {}×{} @ {:.2} fps\n",
        clip_codec, clip_width, clip_height, clip_fps
    );

    let mut results: Vec<ArmResult> = Vec::new();
    let mut detected_hw: Option<String> = None;

    for arm in &config.arms {
        println!(
            "▶ Arm {} ──────────────────────────────────────────────────",
            arm
        );
        let res = run_arm(
            arm,
            &config.video_path,
            config.warmup_frames,
            config.measured_frames,
            config.download_every,
            config.target_width,
            config.target_height,
        );

        if detected_hw.is_none() && res.hw_device_type.is_some() {
            detected_hw = res.hw_device_type.clone();
        }

        println!("  {}", res.description);
        if !res.implemented {
            println!("  [STATUS: NOT IMPLEMENTED]");
        } else if !res.valid {
            println!(
                "  [STATUS: INVALID] {}",
                res.validity_notes.as_deref().unwrap_or("")
            );
        } else {
            println!(
                "  Frames: {} | Wall: {:.2}s | FPS: {:.2}",
                res.frames_measured,
                res.total_wall_us as f64 / 1_000_000.0,
                res.sustained_fps
            );
            println!(
                "  Frame time  p50: {:?} µs | p95: {:?} µs | p99: {:?} µs",
                res.frame_time_p50_us, res.frame_time_p95_us, res.frame_time_p99_us
            );
            if res.downloads_performed > 0 {
                println!(
                    "  HW download p50: {:?} µs | p95: {:?} µs | p99: {:?} µs ({} downloads)",
                    res.hw_download_p50_us,
                    res.hw_download_p95_us,
                    res.hw_download_p99_us,
                    res.downloads_performed
                );
            }
            if res.downloads_skipped > 0 {
                println!("  HW downloads skipped: {}", res.downloads_skipped);
            }
        }
        if let Some(ref e) = res.error {
            eprintln!("  ERROR: {e}");
        }
        println!();
        results.push(res);
    }

    let report = BenchReport {
        git_commit: option_env!("CLYPRA_GIT_COMMIT").map(String::from),
        git_dirty: option_env!("CLYPRA_GIT_DIRTY").map(|s| s == "true"),
        build_profile: build_profile.to_string(),
        operating_system: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        video_path: std::path::Path::new(&config.video_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string(),
        clip_codec,
        clip_width,
        clip_height,
        clip_fps,
        detected_hw_device: detected_hw,
        warmup_frames: config.warmup_frames,
        measured_frames: config.measured_frames,
        download_every_n: config.download_every,
        target_scale_resolution: format!("{}x{}", config.target_width, config.target_height),
        arms: results,
    };

    if let Some(ref path) = config.output_path {
        match serde_json::to_string_pretty(&report) {
            Ok(json) => match fs::write(path, &json) {
                Ok(_) => println!("Results saved to: {}", path.display()),
                Err(e) => eprintln!("Failed to write output JSON to {}: {e}", path.display()),
            },
            Err(e) => eprintln!("Failed to serialize report: {e}"),
        }
    } else if let Ok(json) = serde_json::to_string_pretty(&report) {
        println!("{json}");
    }
}
