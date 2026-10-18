use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::Channel;
use tokio::sync::{Mutex, Notify};
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

use crate::commands::export::ExportProgress;

use super::builder::{build_concat_args, build_mux_args, build_segment_args, ffconcat_path};
use super::encoder::{detect_best_encoder, software_fallback_encoder};
use super::models::{
    number, HwAccelType, NativeExportCompletion, NativeTimelineExportPlan, MAX_FFMPEG_RSS_BYTES,
};

pub async fn probe_has_audio(path: &str, cancellation: &CancellationToken) -> bool {
    let mut child = match crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };

    let stdout = child.stdout.take();
    tokio::select! {
        _ = cancellation.cancelled() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            false
        }
        status = child.wait() => {
            if let Ok(s) = status {
                if s.success() {
                    if let Some(mut stream) = stdout {
                        use tokio::io::AsyncReadExt;
                        let mut buf = [0u8; 64];
                        let n = stream.read(&mut buf).await.unwrap_or(0);
                        return n > 0;
                    }
                }
            }
            false
        }
    }
}

pub async fn process_rss_bytes(pid: u32) -> Option<u64> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = crate::process_util::hidden_tokio_command("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .await
            .ok()?;
        let kib = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .ok()?;
        Some(kib * 1024)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        None
    }
}

pub async fn run_ffmpeg(args: &[String], cancellation: &CancellationToken) -> Result<u64, String> {
    let mut child = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to spawn FFmpeg: {error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "FFmpeg did not expose a process ID".to_string())?;

    let stderr_pipe = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        if let Some(reader) = stderr_pipe {
            use tokio::io::AsyncReadExt;
            let mut buffer = Vec::new();
            let _ = reader.take(65536).read_to_end(&mut buffer).await;
            String::from_utf8_lossy(&buffer).to_string()
        } else {
            String::new()
        }
    });

    let mut peak_rss = 0u64;
    let mut interval = tokio::time::interval(Duration::from_millis(500));

    loop {
        tokio::select! {
            // Immediate zero-latency cancellation wakeup
            _ = cancellation.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await; // Reap zombie PID and release OS file locks
                let _ = stderr_task.await;
                return Err("Export cancelled".into());
            }
            // Child process exit
            status = child.wait() => {
                let status = status.map_err(|error| format!("Failed to inspect FFmpeg: {error}"))?;
                let captured_stderr = stderr_task.await.unwrap_or_default();
                return if status.success() {
                    Ok(peak_rss)
                } else {
                    let trimmed = captured_stderr.trim();
                    if trimmed.is_empty() {
                        Err(format!("FFmpeg exited with status {status}"))
                    } else {
                        Err(format!("FFmpeg exited with status {status}: {trimmed}"))
                    }
                };
            }
            // Periodic memory check
            _ = interval.tick() => {
                if let Some(rss) = process_rss_bytes(pid).await {
                    peak_rss = peak_rss.max(rss);
                    if rss > MAX_FFMPEG_RSS_BYTES {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        let _ = stderr_task.await;
                        return Err(format!(
                            "FFmpeg exceeded the {} MiB memory safety ceiling",
                            MAX_FFMPEG_RSS_BYTES / 1024 / 1024
                        ));
                    }
                }
            }
        }
    }
}

pub async fn run_native_export(
    session_id: &str,
    plan: NativeTimelineExportPlan,
    on_progress: Channel<ExportProgress>,
    cancellation: CancellationToken,
) -> Result<NativeExportCompletion, String> {
    let started = Instant::now();
    let total_frames = (plan.total_duration * plan.frame_rate).round() as u32;
    let output_path = PathBuf::from(&plan.output_path);

    // Prefer creating workspace adjacent to final output to avoid EXDEV cross-device issues
    let temp_dir = if let Some(parent) = output_path.parent() {
        if parent.exists() {
            let candidate = parent.join(format!(".clypra-export-tmp-{session_id}"));
            if tokio::fs::create_dir_all(&candidate).await.is_ok() {
                candidate
            } else {
                std::env::temp_dir().join(format!("clypra-export-{session_id}"))
            }
        } else {
            std::env::temp_dir().join(format!("clypra-export-{session_id}"))
        }
    } else {
        std::env::temp_dir().join(format!("clypra-export-{session_id}"))
    };

    let encoder = detect_best_encoder(&plan.codec);
    let segment_extension = if plan.codec == "prores" { "mov" } else { "mp4" };
    let result = async {
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|error| format!("Failed to create export workspace: {error}"))?;

        // Pre-probe audio streams across unique clips concurrently
        let unique_audio_paths: HashSet<String> =
            plan.clips.iter().map(|clip| clip.path.clone()).collect();
        let probe_futures = unique_audio_paths.into_iter().map(|path| {
            let cancel = cancellation.clone();
            async move {
                let has_audio = probe_has_audio(&path, &cancel).await;
                (path, has_audio)
            }
        });
        let probe_map: HashMap<String, bool> =
            futures_util::future::join_all(probe_futures).await.into_iter().collect();

        let mut audio_streams = Vec::with_capacity(plan.clips.len());
        for clip in &plan.clips {
            audio_streams.push(*probe_map.get(&clip.path).unwrap_or(&false));
        }

        let mut segment_paths = Vec::with_capacity(plan.clips.len());
        let mut completed_duration = 0.0f64;
        let mut peak_rss = 0u64;

        let mut active_encoder = encoder;
        for (index, clip) in plan.clips.iter().enumerate() {
            if cancellation.is_cancelled() {
                return Err("Export cancelled".into());
            }
            let segment_path = temp_dir.join(format!("segment-{index:04}.{segment_extension}"));
            let args = build_segment_args(&plan, clip, &segment_path, &active_encoder);
            let segment_rss = match run_ffmpeg(&args, &cancellation).await {
                Ok(rss) => rss,
                Err(err) if active_encoder.hw_type != HwAccelType::Software => {
                    log::debug!(
                        "[run_native_export] Hardware encoder {:?} failed on segment {}: {}. Falling back to software encoder.",
                        active_encoder.hw_type, index, err
                    );
                    active_encoder = software_fallback_encoder(&plan.codec);
                    let fallback_args = build_segment_args(&plan, clip, &segment_path, &active_encoder);
                    run_ffmpeg(&fallback_args, &cancellation).await?
                }
                Err(err) => return Err(err),
            };
            peak_rss = peak_rss.max(segment_rss);
            segment_paths.push(segment_path);
            completed_duration += clip.duration;

            let current_frame = (completed_duration * plan.frame_rate).round() as u32;
            let elapsed = started.elapsed().as_secs_f64();
            let fps = if elapsed > 0.0 {
                current_frame as f64 / elapsed
            } else {
                0.0
            };
            let rtf = if elapsed > 0.0 && plan.frame_rate > 0.0 {
                (current_frame as f64 / plan.frame_rate) / elapsed
            } else {
                0.0
            };
            let remaining_frames = total_frames.saturating_sub(current_frame);
            let _ = on_progress.send(ExportProgress {
                current_frame,
                total_frames,
                progress: (current_frame as f64 / total_frames as f64).min(0.98),
                eta_seconds: if fps > 0.0 {
                    remaining_frames as f64 / fps
                } else {
                    0.0
                },
                fps,
                rtf: Some(rtf),
            });
        }

        let concat_path = temp_dir.join("segments.ffconcat");
        let mut concat = String::from("ffconcat version 1.0\n");
        for (path, clip) in segment_paths.iter().zip(&plan.clips) {
            concat.push_str(&format!(
                "file '{}'\nduration {}\n",
                ffconcat_path(path),
                number(clip.frame_count as f64 / plan.frame_rate),
            ));
        }
        tokio::fs::write(&concat_path, concat)
            .await
            .map_err(|error| format!("Failed to write concat plan: {error}"))?;
        let video_path = temp_dir.join(format!("video-only.{segment_extension}"));
        peak_rss = peak_rss
            .max(run_ffmpeg(&build_concat_args(&concat_path, &video_path), &cancellation).await?);

        let muxed_temp_path = temp_dir.join(format!("muxed-final.{segment_extension}"));
        peak_rss = peak_rss.max(
            run_ffmpeg(
                &build_mux_args(
                    &plan,
                    &video_path,
                    &muxed_temp_path,
                    &audio_streams,
                    cfg!(target_os = "macos"),
                ),
                &cancellation,
            )
            .await?,
        );

        // Atomic commit: rename temporary muxed file to destination output_path (with EXDEV fallback)
        crate::commands::export::atomic_or_copy_commit(&muxed_temp_path, &output_path)
            .await
            .map_err(|error| format!("Failed to commit native export file: {error}"))?;

        let elapsed = started.elapsed().as_secs_f64();
        let final_rtf = if elapsed > 0.0 && plan.frame_rate > 0.0 {
            (total_frames as f64 / plan.frame_rate) / elapsed
        } else {
            0.0
        };
        let _ = on_progress.send(ExportProgress {
            current_frame: total_frames,
            total_frames,
            progress: 1.0,
            eta_seconds: 0.0,
            fps: if elapsed > 0.0 {
                total_frames as f64 / elapsed
            } else {
                0.0
            },
            rtf: Some(final_rtf),
        });

        Ok(NativeExportCompletion {
            total_frames,
            total_time_ms: started.elapsed().as_millis() as u64,
            peak_rss_bytes: peak_rss,
        })
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&output_path).await;
    }
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    result
}

pub async fn wait_for_native_job(
    result: Arc<Mutex<Option<Result<NativeExportCompletion, String>>>>,
    completed: Arc<Notify>,
) -> Result<NativeExportCompletion, String> {
    loop {
        let notified = completed.notified();
        if let Some(result) = result.lock().await.clone() {
            return result;
        }
        tokio::select! {
            _ = notified => {}
            _ = sleep(Duration::from_millis(100)) => {}
        }
    }
}
