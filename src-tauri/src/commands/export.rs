/**
 * Video Export Commands
 *
 * FFmpeg-based video export with progress tracking and cancellation.
 *
 * Architecture:
 *   Frontend (Frame Scheduler) → Tauri Command → FFmpeg Process → MP4/MOV
 *
 * Key features:
 * - Streaming frame input (no temp files)
 * - Progress tracking via channel
 * - Cancellation support
 * - Multiple codec support (H.264, H.265, ProRes)
 * - Audio mixing (future)
 */
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::{Channel, Request, InvokeBody};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// Export progress update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    /// Current frame number
    pub current_frame: u32,
    
    /// Total frames to export
    pub total_frames: u32,
    
    /// Progress (0.0 - 1.0)
    pub progress: f64,
    
    /// Estimated time remaining in seconds
    pub eta_seconds: f64,
    
    /// Current FPS (frames per second)
    pub fps: f64,
}

/// Audio clip configuration for mixing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudioClip {
    /// Absolute local file path
    pub path: String,
    
    /// Start time in seconds (relative to the export video start)
    pub start_time: f64,
    
    /// Duration in seconds to play
    pub duration: f64,
    
    /// Trim in offset in seconds inside the source media file
    pub trim_in: f64,
    
    /// Volume multiplier
    pub volume: f32,

    /// Fade-in duration in seconds
    pub fade_in: Option<f64>,

    /// Fade-out duration in seconds
    pub fade_out: Option<f64>,
}

/// Export configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    /// Output file path
    pub output_path: String,
    
    /// Video width
    pub width: u32,
    
    /// Video height
    pub height: u32,
    
    /// Frame rate
    pub frame_rate: f64,
    
    /// Total frames to export
    pub total_frames: u32,
    
    /// Video codec (h264, h265, prores)
    pub codec: String,
    
    /// Quality preset (ultrafast, fast, medium, slow, veryslow)
    pub preset: String,
    
    /// CRF quality (0-51, lower = better quality)
    pub crf: u32,
    
    /// Pixel format (yuv420p, yuv444p)
    pub pixel_format: String,

    /// Audio clips to mix
    pub audio_clips: Option<Vec<ExportAudioClip>>,
}

/// Active export session.
struct ExportSession {
    /// FFmpeg child process
    process: Child,
    
    /// Stdin handle for writing frames
    stdin: tokio::process::ChildStdin,
    
    /// Current frame count
    current_frame: u32,
    
    /// Total frames
    total_frames: u32,
    
    /// Start time
    start_time: std::time::Instant,

    /// Channel for progress updates
    on_progress: Channel<ExportProgress>,
}

/// Global export sessions (keyed by session ID).
static EXPORT_SESSIONS: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, ExportSession>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Build an augmented PATH string that includes common Homebrew/system binary
/// locations. Tauri apps on macOS launch with a stripped environment, so
/// `ffmpeg` and `ffprobe` (typically in /opt/homebrew/bin or /usr/local/bin)
/// may not be found with the default PATH.
fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let extra = "/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin";
    if current.is_empty() {
        extra.to_string()
    } else {
        format!("{}:{}", current, extra)
    }
}

fn has_audio_stream(path: &str) -> bool {
    let path_env = augmented_path();

    let output = std::process::Command::new("ffprobe")
        .env("PATH", &path_env)
        .args([
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            path,
        ])
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let has_audio = stdout.contains("audio");
                eprintln!("[has_audio_stream] {} → has_audio={}", path, has_audio);
                has_audio
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                eprintln!("[has_audio_stream] ffprobe non-zero exit for {}: {}", path, stderr.trim());
                false
            }
        }
        Err(e) => {
            eprintln!("[has_audio_stream] Could not spawn ffprobe (PATH={}): {}", path_env, e);
            false
        }
    }
}

/// Start a video export session.
///
/// Returns a session ID that can be used to write frames and finalize.
#[tauri::command]
pub async fn start_video_export(
    config: ExportConfig,
    on_progress: Channel<ExportProgress>,
) -> Result<String, String> {
    // Generate session ID
    let session_id = uuid::Uuid::new_v4().to_string();
    
    // Build FFmpeg command
    let mut cmd = Command::new("ffmpeg");
    cmd.env("PATH", augmented_path());
    
    // Input 0: raw RGBA frames from stdin
    cmd.arg("-f")
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

    // Filter out and collect audio clips that actually contain audio streams
    let mut valid_audio_clips = Vec::new();
    if let Some(clips) = &config.audio_clips {
        for clip in clips {
            if has_audio_stream(&clip.path) {
                valid_audio_clips.push(clip.clone());
            } else {
                eprintln!(
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
        let mut filter_complex = String::new();
        
        for (idx, clip) in valid_audio_clips.iter().enumerate() {
            let input_idx = idx + 1; // input 0 is pipe:0 (video)
            let delay_ms = (clip.start_time * 1000.0) as i64;
            let end_time = clip.trim_in + clip.duration;
            
            let fade_in = clip.fade_in.unwrap_or(0.0).max(0.0).min(clip.duration);
            let fade_out = clip.fade_out.unwrap_or(0.0).max(0.0).min(clip.duration);
            let mut chain = format!(
                "[{}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS",
                input_idx, clip.trim_in, end_time
            );
            if fade_in > 0.001 {
                chain.push_str(&format!(",afade=t=in:st=0:d={:.3}", fade_in));
            }
            if fade_out > 0.001 {
                let fade_start = (clip.duration - fade_out).max(0.0);
                chain.push_str(&format!(",afade=t=out:st={:.3}:d={:.3}", fade_start, fade_out));
            }
            chain.push_str(&format!(",adelay={}:all=1,volume={:.3}[a{}];", delay_ms, clip.volume, input_idx));
            filter_complex.push_str(&chain);
        }
        
        // Map all processed streams into amix
        for idx in 0..valid_audio_clips.len() {
            filter_complex.push_str(&format!("[a{}]", idx + 1));
        }
        filter_complex.push_str(&format!(
            "amix=inputs={}:duration=longest[a]",
            valid_audio_clips.len()
        ));
        
        cmd.arg("-filter_complex").arg(filter_complex);
        
        // Map streams explicitly: input 0 video, mixed audio
        cmd.arg("-map").arg("0:v");
        cmd.arg("-map").arg("[a]");
        
        // Configure AAC audio codec
        cmd.arg("-c:a").arg("aac");
        cmd.arg("-b:a").arg("128k");
    } else {
        // Map only the video stream from input 0
        cmd.arg("-map").arg("0:v");
    }
    
    // Video codec settings
    match config.codec.as_str() {
        "h264" => {
            cmd.arg("-c:v").arg("libx264");
            cmd.arg("-preset").arg(&config.preset);
            cmd.arg("-crf").arg(config.crf.to_string());
            cmd.arg("-pix_fmt").arg(&config.pixel_format);
            // Set GOP size to 2 seconds worth of frames (minimum for seekability)
            let gop_size = (config.frame_rate * 2.0).round() as i32;
            cmd.arg("-g").arg(gop_size.to_string());
            cmd.arg("-keyint_min").arg(gop_size.to_string());
            // Force IDR frames at every keyframe for maximum compatibility
            cmd.arg("-x264-params").arg("scenecut=0:open_gop=0");
        }
        "h265" => {
            cmd.arg("-c:v").arg("libx265");
            cmd.arg("-preset").arg(&config.preset);
            cmd.arg("-crf").arg(config.crf.to_string());
            cmd.arg("-pix_fmt").arg(&config.pixel_format);
            // Set GOP size to 2 seconds worth of frames
            let gop_size = (config.frame_rate * 2.0).round() as i32;
            cmd.arg("-g").arg(gop_size.to_string());
            cmd.arg("-keyint_min").arg(gop_size.to_string());
            cmd.arg("-x265-params").arg("scenecut=0:open-gop=0");
        }
        "prores" => {
            cmd.arg("-c:v").arg("prores_ks");
            cmd.arg("-profile:v").arg("3"); // ProRes 422 HQ
            cmd.arg("-pix_fmt").arg("yuv422p10le");
            // ProRes is all-intra (every frame is a keyframe), no GOP setting needed
        }
        _ => {
            return Err(format!("Unsupported codec: {}", config.codec));
        }
    }
    
    // Output settings
    cmd.arg("-movflags").arg("+faststart"); // Enable streaming
    cmd.arg("-y"); // Overwrite output file
    cmd.arg(&config.output_path);
    
    // Spawn FFmpeg process
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    // Log the full FFmpeg command for debugging
    eprintln!("[start_video_export] FFmpeg command: {:?}", cmd);
    
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;
    
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open stdin".to_string())?;
    
    // Create session
    let session = ExportSession {
        process: child,
        stdin,
        current_frame: 0,
        total_frames: config.total_frames,
        start_time: std::time::Instant::now(),
        on_progress,
    };
    
    // Store session
    EXPORT_SESSIONS.lock().await.insert(session_id.clone(), session);
    
    eprintln!(
        "[start_video_export] Started session {} ({}x{} @ {}fps, {} frames, codec={})",
        session_id, config.width, config.height, config.frame_rate, config.total_frames, config.codec
    );
    
    Ok(session_id)
}

/// Write a frame to the export session.
///
/// Frame data should be raw RGBA bytes (width * height * 4) sent as raw request payload.
#[tauri::command]
pub async fn write_export_frame(
    request: Request<'_>,
) -> Result<(), String> {
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

    let mut sessions = EXPORT_SESSIONS.lock().await;
    
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Export session not found: {}", session_id))?;
    
    // Write frame data to FFmpeg stdin
    session
        .stdin
        .write_all(frame_data)
        .await
        .map_err(|e| format!("Failed to write frame: {}", e))?;
    
    // Flush stdin buffer after each frame to ensure FFmpeg processes it immediately
    // This prevents PTS discontinuities from buffering delays
    session
        .stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush frame: {}", e))?;
    
    session.current_frame += 1;
    
    // Calculate progress
    let progress = session.current_frame as f64 / session.total_frames as f64;
    let elapsed = session.start_time.elapsed().as_secs_f64();
    let fps = session.current_frame as f64 / elapsed;
    let remaining_frames = session.total_frames - session.current_frame;
    let eta_seconds = if fps > 0.0 {
        remaining_frames as f64 / fps
    } else {
        0.0
    };
    
    // Send progress update
    let progress_update = ExportProgress {
        current_frame: session.current_frame,
        total_frames: session.total_frames,
        progress,
        eta_seconds,
        fps,
    };
    
    let _ = session.on_progress.send(progress_update);
    
    // Log progress periodically
    if session.current_frame % 30 == 0 || session.current_frame == session.total_frames {
        eprintln!(
            "[write_export_frame] Session {}: {}/{} frames ({:.1}%) @ {:.1} fps, ETA {:.1}s",
            session_id,
            session.current_frame,
            session.total_frames,
            progress * 100.0,
            fps,
            eta_seconds
        );
    }
    
    Ok(())
}

/// Finalize the export session.
///
/// Closes stdin and waits for FFmpeg to finish encoding.
#[tauri::command]
pub async fn finalize_video_export(session_id: String) -> Result<(), String> {
    let mut sessions = EXPORT_SESSIONS.lock().await;
    
    let session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("Export session not found: {}", session_id))?;
    
    // Close stdin to signal end of input
    drop(session.stdin);
    
    // Wait for FFmpeg to finish
    let output = session
        .process
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for FFmpeg: {}", e))?;
    
    let elapsed = session.start_time.elapsed();
    
    if output.status.success() {
        eprintln!(
            "[finalize_video_export] Session {} completed successfully in {:.2}s ({} frames)",
            session_id,
            elapsed.as_secs_f64(),
            session.current_frame
        );
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!(
            "[finalize_video_export] Session {} failed:\n{}",
            session_id, stderr
        );
        Err(format!("FFmpeg failed: {}", stderr))
    }
}

/// Cancel an export session.
///
/// Kills the FFmpeg process and cleans up resources.
#[tauri::command]
pub async fn cancel_video_export(session_id: String) -> Result<(), String> {
    let mut sessions = EXPORT_SESSIONS.lock().await;
    
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("Export session not found: {}", session_id))?;
    
    // Kill FFmpeg process
    session
        .process
        .kill()
        .await
        .map_err(|e| format!("Failed to kill FFmpeg: {}", e))?;
    
    eprintln!(
        "[cancel_video_export] Session {} cancelled ({} frames written)",
        session_id, session.current_frame
    );
    
    Ok(())
}

/// Check if FFmpeg is available on the system.
#[tauri::command]
pub async fn check_ffmpeg_available() -> Result<bool, String> {
    let output = Command::new("ffmpeg")
        .env("PATH", augmented_path())
        .arg("-version")
        .output()
        .await;
    
    match output {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get FFmpeg version information.
#[tauri::command]
pub async fn get_ffmpeg_version() -> Result<String, String> {
    let output = Command::new("ffmpeg")
        .env("PATH", augmented_path())
        .arg("-version")
        .output()
        .await
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;
    
    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("Unknown");
        Ok(first_line.to_string())
    } else {
        Err("FFmpeg not available".to_string())
    }
}
