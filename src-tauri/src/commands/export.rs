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
 *
 * Monitoring:
 * - Frame write timing (logged periodically)
 * - Export FPS tracking
 * - FFmpeg error logging
 */
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeBody, Request};
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

    /// Volume multiplier (0.0-1.0)
    /// This prevents precision loss during serialization round-trips
    pub volume: f64,

    /// Fade-in duration in seconds
    pub fade_in: Option<f64>,

    /// Fade-out duration in seconds
    pub fade_out: Option<f64>,

    /// Fade-in curve profile ("linear", "exponential", "logarithmic", "s-curve")
    pub fade_in_curve: Option<String>,

    /// Fade-out curve profile ("linear", "exponential", "logarithmic", "s-curve")
    pub fade_out_curve: Option<String>,

    /// Stereo pan (-1.0 to 1.0)
    pub pan: Option<f64>,

    /// Equalizer low gain (dB)
    pub eq_low: Option<f64>,

    /// Equalizer mid gain (dB)
    pub eq_mid: Option<f64>,

    /// Equalizer high gain (dB)
    pub eq_high: Option<f64>,

    /// Noise suppression level (0.0 to 1.0)
    pub noise_suppression: Option<f64>,

    /// Volume automation points rebased to this exported clip slice.
    pub volume_keyframes: Option<Vec<ExportAudioKeyframe>>,

    /// Explicit source-channel handling shared with preview.
    pub channel_mode: Option<String>,
    pub downmix: Option<String>,
    pub channel_map: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudioKeyframe {
    pub time: f64,
    pub gain: f64,
    pub easing: Option<String>,
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

    /// Last progress emission timestamp for 15 Hz rate limiting
    last_progress_emit: std::time::Instant,

    /// Channel for progress updates
    on_progress: Channel<ExportProgress>,

    /// Export configuration (for frame size validation)
    width: u32,
    height: u32,

    /// Final output destination path
    final_output_path: std::path::PathBuf,

    /// Ephemeral temporary output path (atomic swap target)
    temp_output_path: std::path::PathBuf,

    /// Performance monitoring
    frame_write_times: VecDeque<f64>, // Last 60 frame write times (ms) — VecDeque for O(1) front removal
    last_perf_log_time: std::time::Instant,
}

/// Type alias for the shared export session map.
type ExportSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<ExportSession>>>>>;

/// Global export sessions (keyed by session ID).
/// Uses Arc<Mutex<ExportSession>> so the map lock is released immediately after lookup,
/// eliminating deadlocks and lock contention during streaming stdin writes.
static EXPORT_SESSIONS: once_cell::sync::Lazy<ExportSessionMap> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Progress emission interval ceiling (15 Hz / ~66ms) to prevent IPC flooding and UI freezes
const PROGRESS_THROTTLE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(66);

/// Build an augmented PATH string that includes common Homebrew/system binary
/// locations. Tauri apps on macOS launch with a stripped environment, so
/// `ffmpeg` and `ffprobe` (typically in /opt/homebrew/bin or /usr/local/bin)
/// may not be found with the default PATH.
pub(crate) fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "windows") {
        return current;
    }
    let extra = "/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin";
    if current.is_empty() {
        extra.to_string()
    } else {
        format!("{}:{}", current, extra)
    }
}

/// Probe whether a media file has an audio stream.
///
/// FIX (BUG-H4): This is now async using tokio::process::Command.
/// Previously it used std::process::Command (blocking), which stalled the
/// Tokio async runtime for the entire duration of each ffprobe call —
/// starving other concurrent async tasks (progress updates, IPC responses).
async fn has_audio_stream(path: &str) -> bool {
    let path_env = augmented_path();

    let output = Command::new("ffprobe")
        .env("PATH", &path_env)
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
        .output()
        .await;

    match output {
        Ok(out) => {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let has_audio = stdout.contains("audio");
                eprintln!("[has_audio_stream] {} → has_audio={}", path, has_audio);
                has_audio
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                eprintln!(
                    "[has_audio_stream] ffprobe non-zero exit for {}: {}",
                    path,
                    stderr.trim()
                );
                false
            }
        }
        Err(e) => {
            eprintln!(
                "[has_audio_stream] Could not spawn ffprobe (PATH={}): {}",
                path_env, e
            );
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
    // Validate frame dimensions before starting export
    if config.width == 0 || config.height == 0 {
        return Err(format!(
            "Invalid export dimensions: {}x{}",
            config.width, config.height
        ));
    }
    if config.width > 7680 || config.height > 4320 {
        return Err(format!(
            "Export dimensions too large: {}x{} (max 7680x4320)",
            config.width, config.height
        ));
    }

    // Generate session ID
    let session_id = uuid::Uuid::new_v4().to_string();

    // Build FFmpeg command
    let mut cmd = Command::new("ffmpeg");
    cmd.env("PATH", augmented_path());

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

    // Filter out and collect audio clips that actually contain audio streams
    let mut valid_audio_clips = Vec::new();
    if let Some(clips) = &config.audio_clips {
        for clip in clips {
            if has_audio_stream(&clip.path).await {
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

        // Apply vertical flip to the input video stream (since WebGL readPixels is bottom-left oriented)
        filter_complex.push_str("[0:v]vflip[v];");

        // Generate a silent audio track matching the exact video duration.
        // This serves as a duration anchor. When mixed with duration=longest,
        // it ensures that the mixed audio stream has the exact same duration
        // as the video, preventing early audio cut-off from other clips ending.
        let total_duration = config.total_frames as f64 / config.frame_rate;
        filter_complex.push_str(&format!(
            "anullsrc=channel_layout=stereo:sample_rate=48000:duration={:.3}[asilence];",
            total_duration
        ));

        for (idx, clip) in valid_audio_clips.iter().enumerate() {
            let input_idx = idx + 1; // input 0 is pipe:0 (video)
            let delay_ms = (clip.start_time * 1000.0) as i64;
            let end_time = clip.trim_in + clip.duration;

            let fade_in = clip.fade_in.unwrap_or(0.0).max(0.0).min(clip.duration);
            let fade_out = clip.fade_out.unwrap_or(0.0).max(0.0).min(clip.duration);

            // Ensure audio timebase alignment with video to prevent A/V drift
            // Resample to consistent 48kHz before processing to match video timebase
            let mut chain = format!(
                "[{}:a]aresample=48000,atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS",
                input_idx, clip.trim_in, end_time
            );

            let in_curve = match clip.fade_in_curve.as_deref() {
                Some("exponential") => ":curve=exp",
                Some("logarithmic") => ":curve=log",
                Some("s-curve") => ":curve=qsin",
                _ => ":curve=tri",
            };
            let out_curve = match clip.fade_out_curve.as_deref() {
                Some("exponential") => ":curve=exp",
                Some("logarithmic") => ":curve=log",
                Some("s-curve") => ":curve=qsin",
                _ => ":curve=tri",
            };

            if fade_in > 0.001 {
                chain.push_str(&format!(",afade=t=in:st=0:d={:.3}{}", fade_in, in_curve));
            }
            if fade_out > 0.001 {
                let fade_start = (clip.duration - fade_out).max(0.0);
                chain.push_str(&format!(
                    ",afade=t=out:st={:.3}:d={:.3}{}",
                    fade_start, fade_out, out_curve
                ));
            }

            // Apply 3-Band Equalizer if configured
            if let (Some(low), Some(mid), Some(high)) = (clip.eq_low, clip.eq_mid, clip.eq_high) {
                if low.abs() > 0.1 || mid.abs() > 0.1 || high.abs() > 0.1 {
                    chain.push_str(&format!(
                        ",equalizer=f=100:t=q:w=1:g={:.1},equalizer=f=1000:t=q:w=1:g={:.1},equalizer=f=8000:t=q:w=1:g={:.1}",
                        low, mid, high
                    ));
                }
            }

            // Route channels before pan so the pan control always operates on
            // the audible left/right pair. `aformat` uses FFmpeg's layout-aware
            // downmix coefficients instead of assuming every source is stereo.
            if let Some(map) = clip.channel_map.as_ref().filter(|map| !map.is_empty()) {
                let left = map[0];
                let right = *map.get(1).unwrap_or(&left);
                chain.push_str(&format!(",pan=stereo|c0=c{}|c1=c{}", left, right));
            } else if clip.channel_mode.as_deref() == Some("mono")
                || clip.downmix.as_deref() == Some("mono")
            {
                chain.push_str(",aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0");
            } else if clip.channel_mode.as_deref() == Some("stereo")
                || clip.downmix.as_deref() == Some("stereo")
            {
                chain.push_str(",aformat=channel_layouts=stereo");
            }

            // Apply Stereo Panning if configured
            if let Some(pan_val) = clip.pan {
                if pan_val.abs() > 0.01 {
                    let left_gain = (1.0 - pan_val).clamp(0.0, 1.0);
                    let right_gain = (1.0 + pan_val).clamp(0.0, 1.0);
                    chain.push_str(&format!(
                        ",pan=stereo|c0={:.2}*c0|c1={:.2}*c1",
                        left_gain, right_gain
                    ));
                }
            }

            // Apply Noise Suppression if configured
            if let Some(ns) = clip.noise_suppression {
                if ns > 0.05 {
                    chain.push_str(&format!(",highpass=f=80,afftdn=nr={:.0}", ns * 30.0));
                }
            }

            if let Some(points) = &clip.volume_keyframes {
                if let Some(expression) = build_automation_volume_expression(points) {
                    chain.push_str(&format!(",volume='{}':eval=frame", expression));
                }
            }

            chain.push_str(&format!(
                ",adelay={}:all=1,volume={:.3}[a{}];",
                delay_ms, clip.volume, input_idx
            ));
            filter_complex.push_str(&chain);
        }

        // Map all processed streams (including silence) into amix
        filter_complex.push_str("[asilence]");
        for idx in 0..valid_audio_clips.len() {
            filter_complex.push_str(&format!("[a{}]", idx + 1));
        }

        // Mix with duration=longest. The silence stream guarantees the audio
        // output has exactly the same duration as the video, preventing both
        // early cut-off (BUG-shortest) and trailing audio bloat.
        filter_complex.push_str(&format!(
            "amix=inputs={}:duration=longest[a]",
            valid_audio_clips.len() + 1
        ));

        cmd.arg("-filter_complex").arg(filter_complex);

        // Map streams explicitly: vflipped video [v], mixed audio [a]
        cmd.arg("-map").arg("[v]");
        cmd.arg("-map").arg("[a]");

        // Configure AAC audio codec with explicit sample rate for consistency
        cmd.arg("-c:a").arg("aac");
        cmd.arg("-ar").arg("48000"); // Lock output sample rate
        cmd.arg("-b:a").arg("128k");
    } else {
        // Map only the video stream from input 0, and apply vflip
        cmd.arg("-vf").arg("vflip");
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
            // Guarantee a clean first keyframe for thumbnail extraction.
            // Desktop apps (Finder, Explorer) use the first keyframe as the thumbnail.
            cmd.arg("-force_key_frames").arg("expr:eq(n,0)");
        }
        "h265" => {
            cmd.arg("-c:v").arg("libx265");
            cmd.arg("-tag:v").arg("hvc1"); // Enable compatibility with Apple (macOS Quick Look, Safari, iOS)
            cmd.arg("-preset").arg(&config.preset);
            cmd.arg("-crf").arg(config.crf.to_string());
            cmd.arg("-pix_fmt").arg(&config.pixel_format);
            // Set GOP size to 2 seconds worth of frames
            let gop_size = (config.frame_rate * 2.0).round() as i32;
            cmd.arg("-g").arg(gop_size.to_string());
            cmd.arg("-keyint_min").arg(gop_size.to_string());
            // FIX (BUG-H3): Combine scenecut/open-gop settings with force-idr in a
            // single -x265-params string. Using -force_key_frames expr:eq(n,0) alongside
            // -x265-params can conflict on some FFmpeg builds because libavcodec and
            // libx265 have competing frame-type control. force-idr=1 is the canonical
            // x265 mechanism and is processed after open-gop/scenecut, guaranteeing
            // an IDR at frame 0 for thumbnail extraction.
            cmd.arg("-x265-params")
                .arg("scenecut=0:open-gop=0:force-idr=1");
        }
        "prores" => {
            cmd.arg("-c:v").arg("prores_ks");
            // FIX (BUG-H1): Map pixel_format from config to the correct prores_ks profile.
            // Previously hardcoded to profile 3 / yuv422p10le, making ProRes 4444,
            // LT, and Proxy unreachable even when requested via config.pixel_format.
            let (prores_profile, prores_pix_fmt) = match config.pixel_format.as_str() {
                "yuva444p10le" => ("4444", "yuva444p10le"),
                "yuv444p10le" => ("4444", "yuv444p10le"),
                "yuv422p10le" => ("hq", "yuv422p10le"),
                "yuv422p" => ("standard", "yuv422p10le"),
                _ => ("hq", "yuv422p10le"),
            };
            cmd.arg("-profile:v").arg(prores_profile);
            cmd.arg("-pix_fmt").arg(prores_pix_fmt);
            // ProRes is all-intra (every frame is a keyframe), no GOP setting needed
        }
        "vp9" | "webm" => {
            cmd.arg("-c:v").arg("libvpx-vp9");
            cmd.arg("-crf").arg(config.crf.to_string());
            cmd.arg("-b:v").arg("0");
            cmd.arg("-pix_fmt").arg("yuv420p");
        }
        "gif" => {
            cmd.arg("-c:v").arg("gif");
            cmd.arg("-loop").arg("0");
        }
        _ => {
            return Err(format!("Unsupported codec: {}", config.codec));
        }
    }

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
    eprintln!("[start_video_export] FFmpeg command: {:?}", cmd);

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
        process: child,
        stdin,
        current_frame: 0,
        total_frames: config.total_frames,
        start_time: std::time::Instant::now(),
        last_progress_emit: std::time::Instant::now(),
        on_progress,
        width: config.width,
        height: config.height,
        final_output_path,
        temp_output_path,
        frame_write_times: VecDeque::with_capacity(60),
        last_perf_log_time: std::time::Instant::now(),
    };

    // Store session wrapped in Arc<Mutex<ExportSession>>
    EXPORT_SESSIONS
        .lock()
        .await
        .insert(session_id.clone(), Arc::new(Mutex::new(session)));

    eprintln!(
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

/// Build a safe FFmpeg expression for rebased volume automation. Commas are
/// escaped because this is embedded inside a filter_complex chain.
fn build_automation_volume_expression(points: &[ExportAudioKeyframe]) -> Option<String> {
    if points.is_empty() {
        return None;
    }
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.time.total_cmp(&b.time));
    let expression_for = |from: &ExportAudioKeyframe, to: &ExportAudioKeyframe| {
        let duration = (to.time - from.time).max(0.000_001);
        let t = format!("((t-{:.6})/{:.6})", from.time, duration);
        match to.easing.as_deref() {
            Some("exponential") if from.gain > 0.0001 && to.gain > 0.0001 => {
                format!("{:.6}*pow({:.6}\\,{})", from.gain, to.gain / from.gain, t)
            }
            Some("bezier") => format!(
                "{:.6}+({:.6})*(3*pow({}\\,2)-2*pow({}\\,3))",
                from.gain,
                to.gain - from.gain,
                t,
                t
            ),
            _ => format!("{:.6}+({:.6})*{}", from.gain, to.gain - from.gain, t),
        }
    };
    let mut expression = format!("{:.6}", sorted.last()?.gain);
    for pair in sorted.windows(2).rev() {
        let from = &pair[0];
        let to = &pair[1];
        expression = format!(
            "if(lt(t\\,{:.6})\\,{}\\,{})",
            to.time,
            expression_for(from, to),
            expression
        );
    }
    Some(expression)
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

        eprintln!(
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
            eprintln!(
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

    session
        .stdin
        .write_all(batch_data)
        .await
        .map_err(|e| format!("Failed to write batch: {}", e))?;

    // Flush after batch (not per frame - reduces syscalls)
    session
        .stdin
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
        };
        let _ = session.on_progress.send(progress_update);
    }

    // Log batch statistics
    let batch_duration = batch_start.elapsed().as_secs_f64() * 1000.0;
    let batch_fps = frame_count as f64 / (batch_duration / 1000.0);

    eprintln!(
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

/// Finalize the export session.
///
/// Closes stdin, waits for FFmpeg to finish encoding, and atomically commits output.
#[tauri::command]
pub async fn finalize_video_export(session_id: String) -> Result<(), String> {
    let session_arc = {
        let mut sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    // Take exclusive ownership of the session by unwrapping the Arc.
    // Since we just removed it from the map, no other holder exists.
    let session = Arc::try_unwrap(session_arc)
        .map_err(|_| "Export session is still referenced; cannot finalize".to_string())?
        .into_inner();

    // Destructure to obtain owned fields needed for async moves
    let ExportSession {
        process,
        stdin,
        current_frame,
        start_time,
        temp_output_path,
        final_output_path,
        ..
    } = session;

    // Close stdin to signal end of input
    drop(stdin);

    // Wait for FFmpeg to finish
    let output = match process.wait_with_output().await {
        Ok(output) => output,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_output_path).await;
            super::native_export::release_export_slot();
            return Err(format!("Failed to wait for FFmpeg: {}", error));
        }
    };

    let elapsed = start_time.elapsed();

    super::native_export::release_export_slot();

    if output.status.success() {
        // Atomic commit: rename temporary file to destination path
        if let Err(e) = tokio::fs::rename(&temp_output_path, &final_output_path).await {
            let _ = tokio::fs::remove_file(&temp_output_path).await;
            return Err(format!("Failed to commit final export file: {}", e));
        }

        eprintln!(
            "[finalize_video_export] Session {} completed successfully in {:.2}s ({} frames)",
            session_id,
            elapsed.as_secs_f64(),
            current_frame
        );
        Ok(())
    } else {
        let _ = tokio::fs::remove_file(&temp_output_path).await;
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
/// Kills the FFmpeg process, reaps the child PID, and cleans up temporary resources.
#[tauri::command]
pub async fn cancel_video_export(session_id: String) -> Result<(), String> {
    let session_arc = {
        let mut sessions = EXPORT_SESSIONS.lock().await;
        sessions
            .remove(&session_id)
            .ok_or_else(|| format!("Export session not found: {}", session_id))?
    };

    // Take exclusive ownership of the session by unwrapping the Arc.
    // Since we just removed it from the map, no other holder exists.
    let session = Arc::try_unwrap(session_arc)
        .map_err(|_| "Export session is still referenced; cannot cancel".to_string())?
        .into_inner();

    let ExportSession {
        mut process,
        current_frame,
        temp_output_path,
        ..
    } = session;

    // Kill FFmpeg process
    if let Err(e) = process.kill().await {
        eprintln!(
            "[cancel_video_export] Could not kill FFmpeg (already exited?): {}",
            e
        );
    }

    // CRITICAL: Reap child process and drain OS handles (especially on Windows).
    // This prevents zombie PIDs on POSIX and file-lock lingering on Windows.
    let _ = process.wait().await;

    // Clean up temporary partial file (never touches the user's final path)
    if let Err(e) = tokio::fs::remove_file(&temp_output_path).await {
        eprintln!(
            "[cancel_video_export] Could not delete temporary file {:?}: {}",
            temp_output_path, e
        );
    } else {
        eprintln!(
            "[cancel_video_export] Deleted temporary output: {:?}",
            temp_output_path
        );
    }

    eprintln!(
        "[cancel_video_export] Session {} cancelled ({} frames written)",
        session_id, current_frame
    );

    super::native_export::release_export_slot();
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

    let mut cmd = Command::new("ffmpeg");
    cmd.env("PATH", augmented_path());
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
        let t = frame_idx as f64 / (total_frames - 1) as f64;
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

    let mut cmd = Command::new("ffmpeg");
    cmd.env("PATH", augmented_path());
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
        let t = frame_idx as f64 / (total_frames - 1) as f64;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_automation_expression_contains_rebased_linear_and_exponential_segments() {
        let expression = build_automation_volume_expression(&[
            ExportAudioKeyframe {
                time: 0.0,
                gain: 0.5,
                easing: Some("linear".to_string()),
            },
            ExportAudioKeyframe {
                time: 1.0,
                gain: 1.0,
                easing: Some("linear".to_string()),
            },
            ExportAudioKeyframe {
                time: 2.0,
                gain: 0.25,
                easing: Some("exponential".to_string()),
            },
        ])
        .expect("automation expression");

        assert!(expression.contains("if(lt(t\\,2.000000)"));
        assert!(expression.contains("pow("));
        assert!(expression.contains("0.500000"));
    }

    /// GPU rendering tests — require a real hardware adapter.
    /// Run locally with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_run_wgpu_smoke_test() {
        let test_output = std::env::temp_dir().join("wgpu_smoke_test.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result = run_wgpu_smoke_test(path_str.clone()).await;
        assert!(result.is_ok(), "wgpu smoke test failed: {:?}", result.err());

        let metadata = std::fs::metadata(&test_output);
        assert!(metadata.is_ok(), "Exported MP4 file does not exist");
        assert!(metadata.unwrap().len() > 0, "Exported MP4 file is 0 bytes");

        println!(
            "Successfully generated native single-rectangle MP4 at: {}",
            path_str
        );
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_native_document_wgpu_export() {
        let fixture_json = include_str!("../fixtures/basic_rectangle_doc.json");
        let test_output = std::env::temp_dir().join("native_doc_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(fixture_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Native OverlayDocument wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported MP4 file from OverlayDocument does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported MP4 file from OverlayDocument is 0 bytes"
        );

        println!(
            "Successfully rendered & exported OverlayDocument fixture to MP4: {}",
            path_str
        );
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_revenue_data_story_wgpu_export() {
        let fixture_json = include_str!("../fixtures/revenue_data_story_doc.json");
        let test_output = std::env::temp_dir().join("revenue_story_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(fixture_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Native Revenue Data Story wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported Revenue Data Story MP4 file does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported Revenue Data Story MP4 file is 0 bytes"
        );

        println!("Successfully rendered & exported Revenue Data Story OverlayDocument fixture to MP4: {}", path_str);
    }

    #[tokio::test]
    #[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
    async fn test_published_artifact_wgpu_export() {
        let artifact_json = include_str!("../fixtures/published_revenue_story.json");
        let test_output = std::env::temp_dir().join("published_artifact_wgpu_export.mp4");
        let path_str = test_output.to_string_lossy().to_string();

        let result =
            run_native_document_wgpu_export(artifact_json.to_string(), path_str.clone()).await;
        assert!(
            result.is_ok(),
            "Published OverlayArtifact wgpu export failed: {:?}",
            result.err()
        );

        let metadata = std::fs::metadata(&test_output);
        assert!(
            metadata.is_ok(),
            "Exported Published OverlayArtifact MP4 file does not exist"
        );
        assert!(
            metadata.unwrap().len() > 0,
            "Exported Published OverlayArtifact MP4 file is 0 bytes"
        );

        println!(
            "Successfully extracted & rendered PublishedOverlayArtifact (rev 17) to MP4: {}",
            path_str
        );
    }
}
