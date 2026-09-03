//! Performance and stress benchmarks for single and multi-stacked video playback
//! using real media assets from `clypra-testing-assets`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tauri_app_lib::thumbnail_engine::decoder::{get_preview_decoder_for_stream, VideoDecoder};

const ASSETS_DIR: &str = "/Users/AIEraDev/Documents/clypra-testing-assets";

fn get_available_test_assets() -> Vec<PathBuf> {
    let dir = Path::new(ASSETS_DIR);
    if !dir.exists() {
        eprintln!("[WARN] Testing assets directory not found at: {}", ASSETS_DIR);
        return Vec::new();
    }

    let mut assets = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "mp4") {
                assets.push(path);
            }
        }
    }
    assets.sort();
    assets
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() > max_chars {
        let prefix: String = chars[..max_chars.saturating_sub(3)].iter().collect();
        format!("{}...", prefix)
    } else {
        s.to_string()
    }
}

/// Benchmark 1: Single Video Sequential Playback Performance
/// Measures opening, initial seek latency, and steady-state 30fps sequential decoding
/// across all media assets in `clypra-testing-assets`.
#[tokio::test]
async fn test_single_video_sequential_playback_performance_all_assets() {
    let assets = get_available_test_assets();
    if assets.is_empty() {
        eprintln!("[SKIP] No testing assets found in {}", ASSETS_DIR);
        return;
    }

    println!("\n==========================================================================================================");
    println!("                           SINGLE VIDEO STEADY-STATE PLAYBACK BENCHMARK (30 FRAMES @ 30 FPS)");
    println!("==========================================================================================================");
    println!(
        "{:<35} | {:<10} | {:<9} | {:<10} | {:<9} | {:<9} | {:<10} | {:<8}",
        "Asset", "Resolution", "Open(ms)", "Cold(ms)", "Avg(ms)", "P95(ms)", "Steady FPS", "Realtime"
    );
    println!("----------------------------------------------------------------------------------------------------------");

    for asset_path in &assets {
        let file_name = asset_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let truncated_name = truncate_str(file_name, 35);
        let path_str = asset_path.to_str().unwrap();

        // 1. Measure Open Latency
        let open_start = Instant::now();
        let decoder_res = VideoDecoder::open_hardware(path_str)
            .or_else(|_| VideoDecoder::open_software(path_str));

        let mut decoder = match decoder_res {
            Ok(d) => d,
            Err(e) => {
                eprintln!("{:<35} | FAILED TO OPEN: {}", truncated_name, e);
                continue;
            }
        };
        let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
        let width = decoder.width();
        let height = decoder.height();
        let res_str = format!("{}x{}", width, height);

        // 2. Measure Playback: Frame 0 (Cold start) + Frames 1..30 (Sequential forward)
        let num_frames = 30;
        let start_time = 0.5;
        let frame_interval = 1.0 / 30.0;

        let mut latencies_ms = Vec::with_capacity(num_frames);

        for i in 0..num_frames {
            let target_time = start_time + (i as f64 * frame_interval);
            let frame_start = Instant::now();
            let res = decoder.decode_frame_raw_nv12(target_time);
            let elapsed_ms = frame_start.elapsed().as_secs_f64() * 1000.0;

            match res {
                Ok((y_plane, uv_plane, dec_w, dec_h, _color)) => {
                    assert_eq!(dec_w, width);
                    assert_eq!(dec_h, height);
                    assert_eq!(y_plane.len(), (width * height) as usize);
                    assert_eq!(uv_plane.len(), (width * height / 2) as usize);
                    latencies_ms.push(elapsed_ms);
                }
                Err(e) => {
                    eprintln!("Frame {} decode failed for {}: {}", i, file_name, e);
                    break;
                }
            }
        }

        if latencies_ms.is_empty() {
            continue;
        }

        let cold_start_ms = latencies_ms[0];
        let steady_frames = if latencies_ms.len() > 1 {
            &latencies_ms[1..]
        } else {
            &latencies_ms[..]
        };

        let avg_steady_ms =
            steady_frames.iter().sum::<f64>() / steady_frames.len().max(1) as f64;

        let mut sorted = steady_frames.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p95_idx = ((sorted.len() as f64) * 0.95).floor() as usize;
        let p95_ms = sorted.get(p95_idx.min(sorted.len() - 1)).copied().unwrap_or(0.0);

        let steady_time_secs = steady_frames.iter().sum::<f64>() / 1000.0;
        let steady_fps = (steady_frames.len() as f64) / steady_time_secs.max(0.001);
        let realtime_ratio = format!("{:.1}x", (1000.0 / 30.0) / avg_steady_ms.max(0.01));

        println!(
            "{:<35} | {:<10} | {:<9.1} | {:<10.1} | {:<9.2} | {:<9.2} | {:<10.1} | {:<8}",
            truncated_name, res_str, open_ms, cold_start_ms, avg_steady_ms, p95_ms, steady_fps, realtime_ratio
        );

        // Quality check: steady-state forward decode must comfortably beat real-time frame budget (33.3ms)
        assert!(
            avg_steady_ms < 33.3,
            "Sequential decode for {} is too slow ({:.2}ms avg), exceeds real-time frame budget",
            file_name,
            avg_steady_ms
        );
    }
    println!("==========================================================================================================\n");
}

/// Benchmark 2: Multi-Stacked Concurrent Playback Performance
/// Measures concurrent layer decoding across independent streams (4K + 1080p/720p)
#[tokio::test]
async fn test_multi_stacked_concurrent_playback_performance() {
    let assets = get_available_test_assets();
    if assets.len() < 2 {
        eprintln!("[SKIP] Need at least 2 assets for multi-stacked playback benchmark");
        return;
    }

    let mut four_k_asset = None;
    let mut other_assets = Vec::new();

    for path in &assets {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.contains("Mod - Is Jude Bellingham") {
            four_k_asset = Some(path.clone());
        } else {
            other_assets.push(path.clone());
        }
    }

    let four_k = match four_k_asset {
        Some(f) => f,
        None => assets[0].clone(),
    };
    let second_video = other_assets.get(0).unwrap_or(&assets[1]).clone();
    let third_video = other_assets.get(1).unwrap_or(&assets[0]).clone();

    println!("\n==========================================================================================================");
    println!("                                MULTI-STACKED CONCURRENT DECODING BENCHMARK");
    println!("==========================================================================================================");

    // Test Scenario A: 2-Layer Stack (4K H.264 + HD Video)
    run_stacked_benchmark(
        "2-Layer Stack (4K H.264 + HD Video)",
        vec![
            (four_k.to_str().unwrap().to_string(), "stream-4k".to_string()),
            (second_video.to_str().unwrap().to_string(), "stream-hd".to_string()),
        ],
        30,
        35.0, // 30 FPS budget for 2 layers
    )
    .await;

    // Test Scenario B: 3-Layer Stack (4K H.264 + 2x HD Videos)
    run_stacked_benchmark(
        "3-Layer Stack (4K H.264 + 2x HD Videos)",
        vec![
            (four_k.to_str().unwrap().to_string(), "stream-4k".to_string()),
            (second_video.to_str().unwrap().to_string(), "stream-hd-1".to_string()),
            (third_video.to_str().unwrap().to_string(), "stream-hd-2".to_string()),
        ],
        30,
        50.0, // Multi-codec 3-stream heavy stack threshold (24 FPS cinema budget: 41.7ms)
    )
    .await;

    // Test Scenario C: 2 Independent Streams of the SAME 4K Video (GOP isolation test)
    run_stacked_benchmark(
        "2-Layer Dual 4K Independent Streams (GOP Isolation)",
        vec![
            (four_k.to_str().unwrap().to_string(), "stream-4k-a".to_string()),
            (four_k.to_str().unwrap().to_string(), "stream-4k-b".to_string()),
        ],
        30,
        35.0,
    )
    .await;

    println!("==========================================================================================================\n");
}

async fn run_stacked_benchmark(
    scenario_name: &str,
    layers: Vec<(String, String)>,
    num_frames: usize,
    budget_ms: f64,
) {
    let layer_count = layers.len();
    println!("\n--- Scenario: {} ({} concurrent streams) ---", scenario_name, layer_count);

    // Pre-open isolated decoders for each stream
    let mut decoders = Vec::with_capacity(layer_count);
    for (path, stream_id) in &layers {
        let dec = get_preview_decoder_for_stream(path, stream_id)
            .await
            .unwrap_or_else(|e| panic!("Failed to get decoder for stream {}: {}", stream_id, e));
        decoders.push((dec, stream_id.clone()));
    }

    let start_time = 1.0;
    let frame_interval = 1.0 / 30.0;
    let mut composite_latencies_ms = Vec::with_capacity(num_frames);

    for frame_idx in 0..num_frames {
        let target_time = start_time + (frame_idx as f64 * frame_interval);
        let frame_start = Instant::now();

        // Spawn concurrent decode tasks across all layers simultaneously
        let mut handles = Vec::with_capacity(layer_count);
        for (decoder_arc, stream_id) in &decoders {
            let decoder = Arc::clone(decoder_arc);
            let s_id = stream_id.clone();
            handles.push(tokio::spawn(async move {
                let mutex_start = Instant::now();
                let mut guard = decoder.lock().await;
                let mutex_wait_ms = mutex_start.elapsed().as_secs_f64() * 1000.0;

                let decode_start = Instant::now();
                let res = guard.decode_frame_raw_nv12(target_time);
                let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;

                let (w, h) = match &res {
                    Ok((_, _, w, h, _)) => (*w, *h),
                    Err(_) => (0, 0),
                };

                (s_id, res.is_ok(), decode_ms, mutex_wait_ms, w, h)
            }));
        }

        let mut layer_results = Vec::with_capacity(layer_count);
        for handle in handles {
            let res = handle.await.expect("task join failed");
            layer_results.push(res);
        }

        let composite_ms = frame_start.elapsed().as_secs_f64() * 1000.0;
        composite_latencies_ms.push(composite_ms);

        if frame_idx == 0 || frame_idx == 1 || frame_idx == num_frames - 1 {
            let details: Vec<String> = layer_results
                .iter()
                .map(|(id, ok, dec_ms, mtx_ms, w, h)| {
                    format!("{}({}x{}, dec:{:.1}ms, mtx:{:.1}ms, ok:{})", id, w, h, dec_ms, mtx_ms, ok)
                })
                .collect();
            println!(
                "  Frame #{:02}: composite {:<5.2}ms | {}",
                frame_idx,
                composite_ms,
                details.join(" | ")
            );
        }
    }

    let cold_start_ms = composite_latencies_ms[0];
    let steady_frames = &composite_latencies_ms[1..];
    let avg_steady_ms =
        steady_frames.iter().sum::<f64>() / steady_frames.len().max(1) as f64;

    let mut sorted = steady_frames.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p95_composite_ms = sorted[(sorted.len() as f64 * 0.95).floor() as usize];

    let steady_wall_secs = steady_frames.iter().sum::<f64>() / 1000.0;
    let steady_fps = (steady_frames.len() as f64) / steady_wall_secs;

    println!(
        "  -> RESULTS: Cold Start: {:.1}ms | Steady Avg: {:.2}ms | P95: {:.2}ms | Steady FPS: {:.1} fps (Budget: {:.1}ms)",
        cold_start_ms, avg_steady_ms, p95_composite_ms, steady_fps, budget_ms
    );

    assert!(
        avg_steady_ms < budget_ms,
        "Steady-state multi-stacked decode too slow ({:.2}ms avg), exceeds budget of {:.1}ms",
        avg_steady_ms,
        budget_ms
    );
}

/// Benchmark 3: Random Seeking and Forward Resumption
/// Validates that cold seeks across 4K and HEVC videos recover smoothly and forward
/// decoding accelerates immediately after the seek.
#[tokio::test]
async fn test_random_seeking_and_forward_resumption_performance() {
    let assets = get_available_test_assets();
    if assets.is_empty() {
        return;
    }

    // Pick 4K asset or first available
    let asset = assets
        .iter()
        .find(|p| p.to_str().unwrap_or("").contains("Mod - Is Jude Bellingham"))
        .unwrap_or(&assets[0]);

    let path_str = asset.to_str().unwrap();
    let file_name = asset.file_name().unwrap().to_str().unwrap();
    println!("\n--- Benchmark: Random Seeking & Forward Resumption ({}) ---", file_name);

    let mut decoder = VideoDecoder::open_hardware(path_str)
        .or_else(|_| VideoDecoder::open_software(path_str))
        .expect("open decoder");

    let seek_targets = [2.0, 8.5, 14.2, 5.0, 11.8];

    for (idx, &target_sec) in seek_targets.iter().enumerate() {
        // 1. Cold Seek
        let seek_start = Instant::now();
        let seek_res = decoder.decode_frame_raw_nv12(target_sec);
        let seek_ms = seek_start.elapsed().as_secs_f64() * 1000.0;
        assert!(seek_res.is_ok(), "Seek to {}s failed", target_sec);

        // 2. Immediate forward step (Frame + 1)
        let step_start = Instant::now();
        let step_res = decoder.decode_frame_raw_nv12(target_sec + (1.0 / 30.0));
        let step_ms = step_start.elapsed().as_secs_f64() * 1000.0;
        assert!(step_res.is_ok(), "Forward step failed");

        // 3. Third forward step (Frame + 2)
        let step2_start = Instant::now();
        let step2_res = decoder.decode_frame_raw_nv12(target_sec + (2.0 / 30.0));
        let step2_ms = step2_start.elapsed().as_secs_f64() * 1000.0;
        assert!(step2_res.is_ok(), "Second forward step failed");

        println!(
            "  Seek #{}: Target {:>4.1}s -> Seek Latency: {:>6.1}ms | Frame+1: {:>5.2}ms | Frame+2: {:>5.2}ms",
            idx + 1, target_sec, seek_ms, step_ms, step2_ms
        );

        assert!(
            step2_ms < 25.0,
            "Sequential resumption after seek took too long ({:.2}ms)",
            step2_ms
        );
    }
}

/// Benchmark 4: Occlusion Culling Performance Delta
/// Measures the performance difference between decoding stacked occluded streams
/// versus culling the occluded layer and decoding only the visible foreground.
#[tokio::test]
async fn test_occlusion_culling_performance_delta() {
    let assets = get_available_test_assets();
    if assets.len() < 2 {
        return;
    }

    let four_k = assets
        .iter()
        .find(|p| p.to_str().unwrap_or("").contains("Mod - Is Jude Bellingham"))
        .unwrap_or(&assets[0]);
    let hd = assets
        .iter()
        .find(|p| p != &four_k)
        .unwrap_or(&assets[1]);

    println!("\n==========================================================================================================");
    println!("                                OCCLUSION CULLING BENEFIT BENCHMARK");
    println!("==========================================================================================================");

    let four_k_path = four_k.to_str().unwrap();
    let hd_path = hd.to_str().unwrap();

    let dec_4k = get_preview_decoder_for_stream(four_k_path, "occlusion-4k").await.unwrap();
    let dec_hd = get_preview_decoder_for_stream(hd_path, "occlusion-hd").await.unwrap();

    let num_frames = 20;
    let frame_interval = 1.0 / 30.0;

    // Case 1: Unculled (Both 4K and HD decoders run concurrently)
    let start_1 = Instant::now();
    for i in 0..num_frames {
        let t = 2.0 + (i as f64 * frame_interval);
        let (d1, d2) = (Arc::clone(&dec_4k), Arc::clone(&dec_hd));
        let h1 = tokio::spawn(async move { d1.lock().await.decode_frame_raw_nv12(t) });
        let h2 = tokio::spawn(async move { d2.lock().await.decode_frame_raw_nv12(t) });
        let _ = tokio::join!(h1, h2);
    }
    let unculled_elapsed_ms = start_1.elapsed().as_secs_f64() * 1000.0;
    let unculled_avg_ms = unculled_elapsed_ms / num_frames as f64;

    // Case 2: Culled (Occlusion engine eliminated the HD layer, only foreground 4K decodes)
    let start_2 = Instant::now();
    for i in 0..num_frames {
        let t = 2.0 + (i as f64 * frame_interval);
        let d1 = Arc::clone(&dec_4k);
        let _ = d1.lock().await.decode_frame_raw_nv12(t);
    }
    let culled_elapsed_ms = start_2.elapsed().as_secs_f64() * 1000.0;
    let culled_avg_ms = culled_elapsed_ms / num_frames as f64;

    let savings_percent = ((unculled_avg_ms - culled_avg_ms) / unculled_avg_ms) * 100.0;
    let speedup = unculled_avg_ms / culled_avg_ms.max(0.001);

    println!("  Unculled (2 layers decoded): {:.2}ms avg/frame ({:.1} fps)", unculled_avg_ms, 1000.0 / unculled_avg_ms);
    println!("  Culled   (1 layer decoded):  {:.2}ms avg/frame ({:.1} fps)", culled_avg_ms, 1000.0 / culled_avg_ms);
    println!("  -> Occlusion culling saved {:.1}% decode time ({:.2}x speedup)!", savings_percent, speedup);
    println!("==========================================================================================================\n");

    assert!(
        culled_avg_ms < unculled_avg_ms,
        "Culled decode should be faster than unculled decode"
    );
}
