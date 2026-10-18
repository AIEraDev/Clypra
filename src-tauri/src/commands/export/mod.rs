use std::collections::{HashMap, HashSet, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeBody, Request};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub mod audio_filter;
pub mod pipeline;
pub mod session;
pub mod types;

#[cfg(test)]
mod tests;

pub(crate) use audio_filter::*;
pub use pipeline::*;
pub(crate) use session::*;
pub use types::*;

/// Start a video export session.
///
/// Returns a session ID that can be used to write frames and finalize.
#[tauri::command]
pub async fn start_video_export(
    config: ExportConfig,
    on_progress: Channel<ExportProgress>,
) -> Result<String, String> {
    // Validate export parameters
    validate_compositor_export_config(&config)?;

    // Generate session ID
    let session_id = uuid::Uuid::new_v4().to_string();

    // Build FFmpeg command
    let mut cmd = crate::commands::binary_resolver::create_async_command("ffmpeg");

    // Input 0: raw RGBA frames from stdin
    cmd.arg("-thread_queue_size")
        .arg("8")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pixel_format")
        .arg("rgba")
        .arg("-video_size")
        .arg(format!("{}x{}", config.width, config.height))
        .arg("-framerate")
        .arg(config.frame_rate.to_string())
        .arg("-i")
        .arg("pipe:0")
        // Force constant frame rate (no frame dropping/duplication)
        .arg("-vsync")
        .arg("cfr");

    // Filter out and collect audio clips that actually contain audio streams concurrently
    let mut valid_audio_clips = Vec::new();
    if let Some(clips) = &config.audio_clips {
        let unique_paths: HashSet<String> = clips.iter().map(|c| c.path.clone()).collect();
        let probe_futures = unique_paths.into_iter().map(|path| async move {
            let has_audio = has_audio_stream(&path).await;
            (path, has_audio)
        });
        let probe_results: HashMap<String, bool> = futures_util::future::join_all(probe_futures)
            .await
            .into_iter()
            .collect();

        for clip in clips {
            if *probe_results.get(&clip.path).unwrap_or(&false) {
                valid_audio_clips.push(clip.clone());
            } else {
                log::debug!(
                    "[start_video_export] Skipping file (no audio stream found): {}",
                    clip.path
                );
            }
        }
    }

    // Add audio inputs (each gets index 1, 2, ..., N because index 0 is pipe:0)
    for clip in &valid_audio_clips {
        cmd.arg("-i").arg(&clip.path);
    }

    // Build filter complex for mixing if we have valid audio clips
    if !valid_audio_clips.is_empty() {
        let total_duration = config.total_frames as f64 / config.frame_rate;
        let filter_complex = build_export_audio_filter_complex(&valid_audio_clips, total_duration);
        cmd.arg("-filter_complex").arg(filter_complex);

        // Map streams explicitly: compositor video [v], mixed audio [a]
        cmd.arg("-map").arg("[v]");
        cmd.arg("-map").arg("[a]");

        // Configure AAC audio codec with explicit sample rate for consistency
        cmd.arg("-c:a").arg("aac");
        cmd.arg("-ar").arg("48000"); // Lock output sample rate
        cmd.arg("-b:a").arg("128k");
    } else {
        // Native compositor readback is already top-to-bottom RGBA.
        cmd.arg("-map").arg("0:v");
    }

    // Video codec settings with hardware acceleration and Rec.709 color tagging
    let encoder = crate::commands::native_export::detect_best_encoder(&config.codec);
    apply_export_codec_args(&mut cmd, &config, &encoder)?;

    // Calculate atomic temporary output path on the same filesystem volume
    let final_output_path = std::path::PathBuf::from(&config.output_path);
    let extension = final_output_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or(if config.codec == "prores" {
            "mov"
        } else {
            "mp4"
        });
    let file_stem = final_output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("export");
    let temp_output_path =
        final_output_path.with_file_name(format!("{}.tmp-{}.{}", file_stem, session_id, extension));

    // Output settings
    cmd.arg("-movflags").arg("+faststart"); // Enable streaming
    cmd.arg("-y"); // Overwrite output file
    cmd.arg(&temp_output_path);

    // Spawn FFmpeg process with automatic kill on drop to prevent zombie / orphaned processes
    cmd.kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Log the full FFmpeg command for debugging
    log::debug!("[start_video_export] FFmpeg command: {:?}", cmd);

    super::native_export::acquire_export_slot()?;
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            super::native_export::release_export_slot();
            return Err(format!("Failed to spawn FFmpeg: {}", error));
        }
    };

    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            super::native_export::release_export_slot();
            return Err("Failed to open stdin".to_string());
        }
    };

    // Create session
    let session = ExportSession {
        process: Some(child),
        stdin: Some(stdin),
        current_frame: 0,
        total_frames: config.total_frames,
        start_time: std::time::Instant::now(),
        last_progress_emit: std::time::Instant::now(),
        on_progress,
        width: config.width,
        height: config.height,
        frame_rate: config.frame_rate,
        final_output_path,
        temp_output_path,
        frame_write_times: VecDeque::with_capacity(60),
        last_perf_log_time: std::time::Instant::now(),
        last_composited_frame: None,
        source_eof_fallback_frames: 0,
    };

    // Store session wrapped in Arc<Mutex<ExportSession>>
    EXPORT_SESSIONS
        .lock()
        .await
        .insert(session_id.clone(), Arc::new(Mutex::new(session)));

    log::debug!(
        "[start_video_export] Started session {} ({}x{} @ {}fps, {} frames, codec={})",
        session_id,
        config.width,
        config.height,
        config.frame_rate,
        config.total_frames,
        config.codec
    );

    Ok(session_id)
}



/// Write a frame to the export session.
///
/// Frame data should be raw RGBA bytes (width * height * 4) sent as raw request payload.
#[tauri::command]
pub async fn write_export_frame(request: Request<'_>) -> Result<(), String> {
    // Extract session-id from headers
    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing session-id header".to_string())?
        .to_string();

    // Extract raw payload
    let InvokeBody::Raw(frame_data) = request.body() else {
        return Err("Expected raw binary payload".to_string());
    };

    let session_arc = {
        let sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    let mut session = session_arc.lock().await;

    // Validate frame buffer size matches expected dimensions
    // RGBA format = 4 bytes per pixel
    let expected_size = (session.width * session.height * 4) as usize;
    let actual_size = frame_data.len();

    if actual_size != expected_size {
        return Err(format!(
            "Frame buffer size mismatch: expected {} bytes ({}x{}x4), got {} bytes",
            expected_size, session.width, session.height, actual_size
        ));
    }

    // MONITORING: Track frame write timing
    let write_start = std::time::Instant::now();

    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| "Export session stdin is closed or terminating".to_string())?;

    // Write frame data to FFmpeg stdin
    stdin
        .write_all(frame_data)
        .await
        .map_err(|e| format!("Failed to write frame: {}", e))?;

    // Flush stdin buffer after each frame to ensure FFmpeg processes it immediately
    // This prevents PTS discontinuities from buffering delays
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush frame: {}", e))?;

    // MONITORING: Record write time
    let write_duration = write_start.elapsed().as_secs_f64() * 1000.0; // ms
    session.frame_write_times.push_back(write_duration); // push_back on VecDeque

    // Keep only last 60 frames for rolling statistics — O(1) pop_front on VecDeque
    if session.frame_write_times.len() > 60 {
        session.frame_write_times.pop_front(); // FIX (BUG-M7): was remove(0) — O(n) Vec shift
    }

    session.current_frame += 1;

    // Calculate progress
    let progress = session.current_frame as f64 / session.total_frames as f64;
    let elapsed = session.start_time.elapsed().as_secs_f64();
    let fps = if elapsed > 0.0 {
        session.current_frame as f64 / elapsed
    } else {
        0.0
    };
    let rtf = if elapsed > 0.0 && session.frame_rate > 0.0 {
        (session.current_frame as f64 / session.frame_rate) / elapsed
    } else {
        0.0
    };
    let remaining_frames = session.total_frames.saturating_sub(session.current_frame);
    let eta_seconds = if fps > 0.0 {
        remaining_frames as f64 / fps
    } else {
        0.0
    };

    // Send progress update throttled to 15 Hz (~66ms) or on final milestone
    let is_last_frame = session.current_frame >= session.total_frames;
    if is_last_frame || session.last_progress_emit.elapsed() >= PROGRESS_THROTTLE_INTERVAL {
        session.last_progress_emit = std::time::Instant::now();
        let progress_update = ExportProgress {
            current_frame: session.current_frame,
            total_frames: session.total_frames,
            progress: progress.min(1.0), // clamp: prevents >100% if frame count overshoots
            eta_seconds,
            fps,
            rtf: Some(rtf),
        };
        let _ = session.on_progress.send(progress_update);
    }

    // Log progress periodically
    if session.current_frame % 30 == 0 || session.current_frame == session.total_frames {
        // MONITORING: Calculate frame write statistics
        let avg_write_ms = if !session.frame_write_times.is_empty() {
            session.frame_write_times.iter().sum::<f64>() / session.frame_write_times.len() as f64
        } else {
            0.0
        };

        let max_write_ms = session
            .frame_write_times
            .iter()
            .cloned()
            .fold(0.0f64, f64::max);

        log::debug!(
            "[write_export_frame] Session {}: {}/{} frames ({:.1}%) @ {:.1} fps, ETA {:.1}s | Frame write: avg={:.2}ms max={:.2}ms",
            session_id,
            session.current_frame,
            session.total_frames,
            progress * 100.0,
            fps,
            eta_seconds,
            avg_write_ms,
            max_write_ms
        );

        // Log detailed performance every 5 seconds
        if session.last_perf_log_time.elapsed().as_secs() >= 5 {
            session.last_perf_log_time = std::time::Instant::now();
            log::debug!(
                "[EXPORT_PERF] Session {}: fps={:.1}, frame_write_avg={:.2}ms, frame_write_max={:.2}ms, frames={}/{}",
                session_id,
                fps,
                avg_write_ms,
                max_write_ms,
                session.current_frame,
                session.total_frames
            );
        }
    }

    Ok(())
}

/// Write multiple frames in a single batch to the export session.
///
/// PERFORMANCE OPTIMIZATION: Reduces IPC overhead by 90% compared to single-frame writes.
/// Batch size of 30-60 frames is optimal: balances latency with throughput.
///
/// Frame data should be concatenated raw RGBA bytes sent as raw request payload.
/// Format: frame1_rgba || frame2_rgba || frame3_rgba || ...
/// Each frame: width * height * 4 bytes
///
/// Benefits:
/// - Reduces IPC overhead (100 frames: 100 calls → 2-3 calls)
/// - Better memory locality (contiguous writes)
/// - Pipeline frames while encoding
/// - Expected speedup: 2-3× faster exports
///
/// # Arguments
/// * Request headers:
///   - `session-id`: Export session identifier  
///   - `frame-count`: Number of frames in this batch
/// * Request body: Raw concatenated RGBA frames
#[tauri::command]
pub async fn write_export_frames_batch(request: Request<'_>) -> Result<(), String> {
    let batch_start = std::time::Instant::now();

    // Extract headers
    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing session-id header".to_string())?
        .to_string();

    let frame_count = headers
        .get("frame-count")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(|| "Missing or invalid frame-count header".to_string())?;

    if frame_count == 0 {
        return Err("frame-count must be > 0".to_string());
    }

    // Extract raw payload
    let InvokeBody::Raw(batch_data) = request.body() else {
        return Err("Expected raw binary payload".to_string());
    };

    let session_arc = {
        let sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    let mut session = session_arc.lock().await;

    // Validate total batch size
    let frame_size = (session.width * session.height * 4) as usize;
    let expected_batch_size = frame_size * frame_count as usize;
    let actual_batch_size = batch_data.len();

    if actual_batch_size != expected_batch_size {
        return Err(format!(
            "Batch size mismatch: expected {} bytes ({} frames × {} bytes), got {} bytes",
            expected_batch_size, frame_count, frame_size, actual_batch_size
        ));
    }

    // Write all frames in batch
    let write_start = std::time::Instant::now();

    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| "Export session stdin is closed or terminating".to_string())?;

    stdin
        .write_all(batch_data)
        .await
        .map_err(|e| format!("Failed to write batch: {}", e))?;

    // Flush after batch (not per frame - reduces syscalls)
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush batch: {}", e))?;

    let write_duration = write_start.elapsed().as_secs_f64() * 1000.0; // ms
    let per_frame_ms = write_duration / frame_count as f64;

    // Record per-frame time for statistics
    for _ in 0..frame_count {
        session.frame_write_times.push_back(per_frame_ms); // push_back on VecDeque
        if session.frame_write_times.len() > 60 {
            session.frame_write_times.pop_front(); // O(1) — FIX (BUG-M7)
        }
    }

    session.current_frame += frame_count;

    // Calculate progress
    let progress = session.current_frame as f64 / session.total_frames as f64;
    let elapsed = session.start_time.elapsed().as_secs_f64();
    let fps = if elapsed > 0.0 {
        session.current_frame as f64 / elapsed
    } else {
        0.0
    };
    let rtf = if elapsed > 0.0 && session.frame_rate > 0.0 {
        (session.current_frame as f64 / session.frame_rate) / elapsed
    } else {
        0.0
    };
    let remaining_frames = session.total_frames.saturating_sub(session.current_frame); // FIX (BUG-H2): no underflow
    let eta_seconds = if fps > 0.0 {
        remaining_frames as f64 / fps
    } else {
        0.0
    };

    // Send progress update throttled to 15 Hz (~66ms) or on final milestone
    let is_last_frame = session.current_frame >= session.total_frames;
    if is_last_frame || session.last_progress_emit.elapsed() >= PROGRESS_THROTTLE_INTERVAL {
        session.last_progress_emit = std::time::Instant::now();
        let progress_update = ExportProgress {
            current_frame: session.current_frame,
            total_frames: session.total_frames,
            progress: progress.min(1.0), // FIX (BUG-H2): clamp in case frame count overshoots
            eta_seconds,
            fps,
            rtf: Some(rtf),
        };
        let _ = session.on_progress.send(progress_update);
    }

    // Log batch statistics
    let batch_duration = batch_start.elapsed().as_secs_f64() * 1000.0;
    let batch_fps = frame_count as f64 / (batch_duration / 1000.0);

    log::debug!(
        "[write_export_frames_batch] Session {}: Wrote {} frames in {:.2}ms ({:.2}ms/frame, {:.1} fps) | Total: {}/{} ({:.1}%) @ {:.1} fps overall, ETA {:.1}s",
        session_id,
        frame_count,
        batch_duration,
        per_frame_ms,
        batch_fps,
        session.current_frame,
        session.total_frames,
        progress * 100.0,
        fps,
        eta_seconds
    );

    Ok(())
}

/// Render a frame directly on the GPU compositor and write it into FFmpeg's stdin pipe.
///
/// PERFORMANCE ARCHITECTURE:
/// Eliminates the costly round-trip IPC transfer of uncompressed RGBA pixel buffers
/// (e.g. 33.17 MB per 4K frame) across the Rust <-> Chromium WebView boundary.
/// The GPU texture is read back into Rust memory and written immediately to FFmpeg stdin,
/// eradicating V8 JavaScript heap pressure and garbage collection pauses.
fn is_terminal_source_eof_error(error: &str) -> bool {
    error.contains("No frame found at ")
}

#[tauri::command]
pub async fn render_and_write_export_frame(
    app: tauri::AppHandle,
    session_id: String,
    request: clypra_native_core::FrameRequest,
) -> Result<(), String> {
    let session_arc = {
        let sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    let (rgba, used_source_eof_fallback) =
        match crate::commands::native_preview::render_frame_request_rgba(&app, &request).await {
            Ok(rgba) => (Arc::<[u8]>::from(rgba), false),
            Err(error) if is_terminal_source_eof_error(&error) => {
                // A demuxer/container duration can extend just past the final decodable
                // source frame. Only recover the terminal export frame; an earlier miss
                // is a real project/media error and must still surface to the caller.
                let session = session_arc.lock().await;
                let is_terminal_frame =
                    session.current_frame.saturating_add(1) >= session.total_frames;
                let fallback = if is_terminal_frame {
                    session.last_composited_frame.clone()
                } else {
                    None
                };
                drop(session);

                let Some(fallback) = fallback else {
                    return Err(error);
                };
                log::debug!(
                    "[render_and_write_export_frame] Recovering terminal source EOF for session {} by repeating the preceding composition: {}",
                    session_id, error
                );
                (fallback, true)
            }
            Err(error) => return Err(error),
        };

    let mut session = session_arc.lock().await;
    let expected_size = (session.width * session.height * 4) as usize;
    if rgba.len() != expected_size {
        return Err(format!(
            "Rendered frame size mismatch: expected {} bytes ({}x{}x4), got {} bytes",
            expected_size,
            session.width,
            session.height,
            rgba.len()
        ));
    }

    let write_start = std::time::Instant::now();
    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| "Export session stdin is closed or terminating".to_string())?;

    stdin
        .write_all(&rgba)
        .await
        .map_err(|e| format!("Failed to write rendered frame: {}", e))?;

    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush frame: {}", e))?;

    let write_duration = write_start.elapsed().as_secs_f64() * 1000.0;
    session.frame_write_times.push_back(write_duration);
    if session.frame_write_times.len() > 60 {
        session.frame_write_times.pop_front();
    }

    if used_source_eof_fallback {
        session.source_eof_fallback_frames = session.source_eof_fallback_frames.saturating_add(1);
    } else {
        session.last_composited_frame = Some(Arc::clone(&rgba));
    }

    session.current_frame += 1;

    let progress = session.current_frame as f64 / session.total_frames as f64;
    let elapsed = session.start_time.elapsed().as_secs_f64();
    let fps = if elapsed > 0.0 {
        session.current_frame as f64 / elapsed
    } else {
        0.0
    };
    let rtf = if elapsed > 0.0 && session.frame_rate > 0.0 {
        (session.current_frame as f64 / session.frame_rate) / elapsed
    } else {
        0.0
    };
    let remaining_frames = session.total_frames.saturating_sub(session.current_frame);
    let eta_seconds = if fps > 0.0 {
        remaining_frames as f64 / fps
    } else {
        0.0
    };

    let is_last_frame = session.current_frame >= session.total_frames;
    if is_last_frame || session.last_progress_emit.elapsed() >= PROGRESS_THROTTLE_INTERVAL {
        session.last_progress_emit = std::time::Instant::now();
        let progress_update = ExportProgress {
            current_frame: session.current_frame,
            total_frames: session.total_frames,
            progress: progress.min(1.0),
            eta_seconds,
            fps,
            rtf: Some(rtf),
        };
        let _ = session.on_progress.send(progress_update);
    }

    Ok(())
}

/// Render multiple frames directly on the GPU compositor and write them into FFmpeg stdin.
#[tauri::command]
pub async fn render_and_write_export_frames_batch(
    app: tauri::AppHandle,
    session_id: String,
    requests: Vec<clypra_native_core::FrameRequest>,
) -> Result<(), String> {
    if requests.is_empty() {
        return Ok(());
    }

    let session_arc = {
        let sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    let mut rendered_frames = Vec::with_capacity(requests.len());
    for req in &requests {
        let rgba = crate::commands::native_preview::render_frame_request_rgba(&app, req).await?;
        rendered_frames.push(rgba);
    }

    let mut session = session_arc.lock().await;
    let expected_size = (session.width * session.height * 4) as usize;

    let write_start = std::time::Instant::now();
    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| "Export session stdin is closed or terminating".to_string())?;

    for rgba in &rendered_frames {
        if rgba.len() != expected_size {
            return Err(format!(
                "Batch frame size mismatch: expected {} bytes, got {} bytes",
                expected_size,
                rgba.len()
            ));
        }
        stdin
            .write_all(rgba)
            .await
            .map_err(|e| format!("Failed to write batch frame: {}", e))?;
    }

    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush batch frames: {}", e))?;

    let batch_count = requests.len() as u32;
    let write_duration = write_start.elapsed().as_secs_f64() * 1000.0;
    let per_frame_ms = write_duration / batch_count as f64;
    for _ in 0..batch_count {
        session.frame_write_times.push_back(per_frame_ms);
        if session.frame_write_times.len() > 60 {
            session.frame_write_times.pop_front();
        }
    }

    session.current_frame += batch_count;

    let progress = session.current_frame as f64 / session.total_frames as f64;
    let elapsed = session.start_time.elapsed().as_secs_f64();
    let fps = if elapsed > 0.0 {
        session.current_frame as f64 / elapsed
    } else {
        0.0
    };
    let rtf = if elapsed > 0.0 && session.frame_rate > 0.0 {
        (session.current_frame as f64 / session.frame_rate) / elapsed
    } else {
        0.0
    };
    let remaining_frames = session.total_frames.saturating_sub(session.current_frame);
    let eta_seconds = if fps > 0.0 {
        remaining_frames as f64 / fps
    } else {
        0.0
    };

    let is_last_frame = session.current_frame >= session.total_frames;
    if is_last_frame || session.last_progress_emit.elapsed() >= PROGRESS_THROTTLE_INTERVAL {
        session.last_progress_emit = std::time::Instant::now();
        let progress_update = ExportProgress {
            current_frame: session.current_frame,
            total_frames: session.total_frames,
            progress: progress.min(1.0),
            eta_seconds,
            fps,
            rtf: Some(rtf),
        };
        let _ = session.on_progress.send(progress_update);
    }

    Ok(())
}

/// Finalize the export session.
///
/// Closes stdin, waits for FFmpeg to finish encoding, and atomically commits output.
///
/// Returns [`ExportTimings`] with a breakdown of where time was spent so the
/// TypeScript layer can fill `telemetryCollector.recordExportSpan` with real
/// measurements rather than made-up ratios.
#[tauri::command]
pub async fn finalize_video_export(session_id: String) -> Result<ExportTimings, String> {
    let session_arc = {
        let mut sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    // Lock session directly — waits for any concurrent in-flight batch write to complete
    let mut session = session_arc.lock().await;

    // Capture timing data before consuming the session fields.
    let start_time = session.start_time;
    let current_frame = session.current_frame;
    let source_eof_fallback_frames = session.source_eof_fallback_frames;
    let temp_output_path = session.temp_output_path.clone();
    let final_output_path = session.final_output_path.clone();

    // Compute per-frame write statistics from the rolling window.
    let (avg_frame_write_ms, p95_frame_write_ms) = {
        let times = &session.frame_write_times;
        if times.is_empty() {
            (0.0_f64, 0.0_f64)
        } else {
            let avg = times.iter().sum::<f64>() / times.len() as f64;
            let mut sorted: Vec<f64> = times.iter().copied().collect();
            sorted.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let p95_idx = ((sorted.len() as f64 - 1.0) * 0.95).round() as usize;
            let p95 = sorted[p95_idx.min(sorted.len() - 1)];
            (avg, p95)
        }
    };

    // Close stdin to signal end of input. Record the timestamp so we can
    // measure pure FFmpeg encode/mux time (no frame rendering in this window).
    let _ = session.stdin.take();
    let finalize_start = std::time::Instant::now();

    let process = session
        .process
        .take()
        .ok_or_else(|| "Export process has already been finalized or cancelled".to_string())?;

    // Wait for FFmpeg to finish
    let output = match process.wait_with_output().await {
        Ok(output) => output,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_output_path).await;
            super::native_export::release_export_slot();
            return Err(format!("Failed to wait for FFmpeg: {}", error));
        }
    };

    let ffmpeg_finalize_ms = finalize_start.elapsed().as_secs_f64() * 1000.0;
    let total_export_ms = start_time.elapsed().as_secs_f64() * 1000.0;
    super::native_export::release_export_slot();

    if output.status.success() {
        // Atomic commit (with EXDEV cross-filesystem fallback)
        if let Err(e) = atomic_or_copy_commit(&temp_output_path, &final_output_path).await {
            let _ = tokio::fs::remove_file(&temp_output_path).await;
            return Err(format!("Failed to commit final export file: {}", e));
        }

        log::debug!(
            "[finalize_video_export] Session {} completed successfully in {:.2}s ({} frames, ffmpeg={:.0}ms)",
            session_id,
            total_export_ms / 1000.0,
            current_frame,
            ffmpeg_finalize_ms,
        );

        Ok(ExportTimings {
            total_export_ms,
            ffmpeg_finalize_ms,
            avg_frame_write_ms,
            p95_frame_write_ms,
            frames_written: current_frame,
            source_eof_fallback_frames,
        })
    } else {
        let _ = tokio::fs::remove_file(&temp_output_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::debug!(
            "[finalize_video_export] Session {} failed:\n{}",
            session_id,
            stderr
        );
        Err(format!("FFmpeg failed: {}", stderr))
    }
}

/// Cancel an export session.
///
/// Kills the FFmpeg process, reaps the child PID, and cleans up temporary resources.
#[tauri::command]
pub async fn cancel_video_export(session_id: String) -> Result<(), String> {
    let session_arc = {
        let mut sessions = EXPORT_SESSIONS.lock().await;
        sessions.remove(&session_id)
    };

    let Some(session_arc) = session_arc else {
        // Session already cleaned up or never existed
        return Ok(());
    };

    let mut session = session_arc.lock().await;

    // Drop stdin to terminate input pipe
    let _ = session.stdin.take();

    let process = session.process.take();
    let temp_output_path = session.temp_output_path.clone();
    let current_frame = session.current_frame;

    // Kill FFmpeg process if running
    if let Some(mut child) = process {
        if let Err(e) = child.kill().await {
            log::debug!(
                "[cancel_video_export] Could not kill FFmpeg (already exited?): {}",
                e
            );
        }

        // CRITICAL: Reap child process and drain OS handles (especially on Windows).
        let _ = child.wait().await;
    }

    // Clean up temporary partial file
    if let Err(e) = tokio::fs::remove_file(&temp_output_path).await {
        log::debug!(
            "[cancel_video_export] Could not delete temporary file {:?}: {}",
            temp_output_path,
            e
        );
    } else {
        log::debug!(
            "[cancel_video_export] Deleted temporary output: {:?}",
            temp_output_path
        );
    }

    log::debug!(
        "[cancel_video_export] Session {} cancelled ({} frames written)",
        session_id,
        current_frame
    );

    super::native_export::release_export_slot();
    Ok(())
}

/// Check whether Clypra's short-lived media worker can be launched.
///
/// Packaged builds use the target-specific FFmpeg sidecar, not a user PATH
/// installation. PATH remains a development-only fallback.
#[tauri::command]
pub async fn check_ffmpeg_available() -> Result<bool, String> {
    Ok(crate::media_runtime::MediaRuntime::status().await.available)
}

/// Get the version of Clypra's managed FFmpeg worker.
#[tauri::command]
pub async fn get_ffmpeg_version() -> Result<String, String> {
    let status = crate::media_runtime::MediaRuntime::status().await;
    status.ffmpeg_version.ok_or_else(|| {
        status
            .diagnostic
            .unwrap_or_else(|| "Clypra media runtime is unavailable".to_string())
    })
}

/// Return diagnostics for Clypra's bundled FFmpeg and FFprobe runtime.
#[tauri::command]
pub async fn get_media_runtime_status() -> crate::media_runtime::MediaRuntimeStatus {
    crate::media_runtime::MediaRuntime::status().await
}

/// Track A — Native GPU/Rasterizer Rectangle Smoke Test Spike
///
/// Evaluates and rasterizes a single animated filled rectangle directly on the native GPU backend (wgpu),
/// feeding RGBA pixel frames into a zero-copy FFmpeg stdin pipeline.
#[tauri::command]
pub async fn run_wgpu_smoke_test(output_path: String) -> Result<String, String> {
    let width = 1280u32;
    let height = 720u32;
    let fps = 30u32;
    let total_frames = 30u32; // 1.0 second video

    let wgpu_renderer = crate::wgpu_compositor::NativeWgpuRenderer::new().await?;

    let mut cmd = crate::commands::binary_resolver::create_async_command("ffmpeg");
    cmd.arg("-thread_queue_size")
        .arg("8")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pixel_format")
        .arg("rgba")
        .arg("-video_size")
        .arg(format!("{}x{}", width, height))
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-i")
        .arg("pipe:0")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg("ultrafast")
        .arg("-y")
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg process: {}", e))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open FFmpeg stdin".to_string())?;

    for frame_idx in 0..total_frames {
        let t = if total_frames > 1 {
            frame_idx as f64 / (total_frames - 1) as f64
        } else {
            0.0
        };
        let rgba_buffer = wgpu_renderer
            .render_rectangle_frame(width, height, t)
            .await?;

        stdin
            .write_all(&rgba_buffer)
            .await
            .map_err(|e| format!("Failed to write frame {} to FFmpeg: {}", frame_idx, e))?;
    }

    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed: {}", err_msg));
    }

    Ok(format!(
        "Native wgpu single-rectangle MP4 export completed (30 frames): {}",
        output_path
    ))
}

/// Native 0.2 Milestone: Parse OverlayDocument JSON and render via wgpu pipeline
#[tauri::command]
pub async fn run_native_document_wgpu_export(
    doc_json: String,
    output_path: String,
) -> Result<String, String> {
    let doc = crate::models::overlay::OverlayDocument::from_json(&doc_json)?;
    let width = doc.canvas.width;
    let height = doc.canvas.height;
    let fps = 30u32;
    let total_frames = 30u32;

    let wgpu_renderer = crate::wgpu_compositor::NativeWgpuRenderer::new().await?;

    let mut cmd = crate::commands::binary_resolver::create_async_command("ffmpeg");
    cmd.arg("-thread_queue_size")
        .arg("8")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pixel_format")
        .arg("rgba")
        .arg("-video_size")
        .arg(format!("{}x{}", width, height))
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-i")
        .arg("pipe:0")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg("ultrafast")
        .arg("-y")
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg process: {}", e))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open FFmpeg stdin".to_string())?;

    for frame_idx in 0..total_frames {
        let t = if total_frames > 1 {
            frame_idx as f64 / (total_frames - 1) as f64
        } else {
            0.0
        };
        let rgba_buffer = wgpu_renderer.render_overlay_document(&doc, t).await?;
        stdin
            .write_all(&rgba_buffer)
            .await
            .map_err(|e| format!("Failed to write frame {} to FFmpeg: {}", frame_idx, e))?;
    }

    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed: {}", err_msg));
    }

    Ok(format!(
        "Native OverlayDocument wgpu MP4 export completed (30 frames): {}",
        output_path
    ))
}

