use std::path::PathBuf;
use tauri::Manager;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

mod ffmpeg_sidecar;

pub mod thumbnail_engine;
use thumbnail_engine::{DensityLevel, Priority, ThumbnailTile, init_thumbnail_engine, request_batch_thumbnails, request_thumbnail, generate_timestamp_grid, get_cache_stats, clear_video_thumbnail_cache};

#[cfg(test)]
mod thumbnail_engine_tests;

#[cfg(test)]
mod thumbnail_engine_proptest;

pub mod models;
pub mod commands;

/// Downsampled peak envelope of the first audio stream (for waveform UI). Returns ~`bucket_count`
/// values in 0..1. If there is no audio, returns zeros.
#[tauri::command]
async fn audio_waveform_peaks(input_path: String, bucket_count: u32) -> Result<Vec<f32>, String> {
    // Check FFmpeg availability first
    if let Err(_) = check_ffmpeg_available().await {
        // Return empty peaks if FFmpeg not available (non-critical feature)
        return Ok(vec![0.0; (bucket_count as usize).clamp(32, 512)]);
    }

    let buckets = (bucket_count as usize).clamp(32, 512);
    let has = ffmpeg_sidecar::ffprobe_output(&[
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        input_path.as_str(),
    ])
    .await?;

    let stream_list = String::from_utf8_lossy(&has.stdout);
    if !has.status.success() || stream_list.trim().is_empty() {
        return Ok(vec![0.0; buckets]);
    }

    let probe = ffmpeg_sidecar::ffprobe_output(&[
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input_path.as_str(),
    ])
    .await?;

    if !probe.status.success() {
        return Ok(vec![0.0; buckets]);
    }

    let duration: f64 = String::from_utf8_lossy(&probe.stdout)
        .trim()
        .parse()
        .unwrap_or(0.0);

    if !duration.is_finite() || duration <= 0.0 {
        return Ok(vec![0.0; buckets]);
    }

    const SR: u32 = 8000;
    let total_samples = ((duration * f64::from(SR)).floor() as usize).max(1);
    let samples_per_bucket = (total_samples / buckets).max(1);

    ffmpeg_sidecar::audio_peaks_f32le_buckets(input_path.as_str(), SR, buckets, samples_per_bucket).await
}

/// Trim `input_path` to `[start_sec, end_sec)` and write to `output_path` using stream copy (bundled ffmpeg sidecar).
#[tauri::command]
async fn trim_export(
    input_path: String,
    output_path: String,
    start_sec: f64,
    end_sec: f64,
) -> Result<(), String> {
    // Check FFmpeg availability first
    if let Err(e) = check_ffmpeg_available().await {
        return Err(e);
    }

    if !end_sec.is_finite() || !start_sec.is_finite() {
        return Err("Start and end times must be finite numbers.".into());
    }
    if end_sec <= start_sec {
        return Err("End time must be greater than start time.".into());
    }

    let ss = format!("{:.6}", start_sec);
    let to = format!("{:.6}", end_sec);

    let output = ffmpeg_sidecar::ffmpeg_output_strings(&[
        "-y".into(),
        "-i".into(),
        input_path.clone(),
        "-ss".into(),
        ss.clone(),
        "-to".into(),
        to.clone(),
        "-c".into(),
        "copy".into(),
        output_path.clone(),
    ])
    .await
    .map_err(|e| format!("Could not run ffmpeg sidecar ({e})."))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.trim();
        let msg = if tail.len() > 800 {
            format!("...{}", &tail[tail.len().saturating_sub(800)..])
        } else {
            tail.to_string()
        };
        return Err(format!("ffmpeg failed:\n{msg}"));
    }

    Ok(())
}

/// RAII guard for temp directory cleanup
/// Automatically removes directory when dropped, even on panic
pub(crate) struct TempDirGuard(pub PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        if self.0.exists() {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

/// Get hardware acceleration arguments for FFmpeg based on platform
/// Uses VideoToolbox on macOS, DXVA2/D3D11VA on Windows, VAAPI on Linux
pub(crate) fn get_hwaccel_args() -> Vec<&'static str> {
    #[cfg(target_os = "macos")]
    {
        vec!["-hwaccel", "videotoolbox"]
    }
    #[cfg(target_os = "windows")]
    {
        // Try D3D11VA first (newer), fallback to DXVA2
        vec!["-hwaccel", "d3d11va", "-hwaccel_output_format", "nv12"]
    }
    #[cfg(target_os = "linux")]
    {
        vec!["-hwaccel", "vaapi", "-vaapi_device", "/dev/dri/renderD128"]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![]
    }
}

/// Check that the bundled ffmpeg sidecar runs (`-version`).
pub(crate) async fn check_ffmpeg_available() -> Result<(), String> {
    match ffmpeg_sidecar::ffmpeg_output(&["-version"]).await {
        Ok(output) if output.status.success() => Ok(()),
        Ok(_) => Err("FFmpeg sidecar returned an error for -version.".into()),
        Err(e) => Err(format!("Failed to run FFmpeg sidecar: {e}")),
    }
}

/// Extract a single frame at the specified time from a video file.
/// Returns a base64-encoded PNG data URL for display in the frontend.
/// Uses FFmpeg for frame-accurate extraction with timeout protection.
#[tauri::command]
async fn extract_frame_at_time(
    input_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Validate inputs FIRST (before checking FFmpeg) for fast failure
    if !time_secs.is_finite() {
        return Err("Time must be a finite number".into());
    }
    if time_secs < 0.0 {
        return Err("Time must be non-negative".into());
    }
    // Reject unreasonably large values (> 24 hours)
    if time_secs > 86400.0 {
        return Err("Time must be a finite number within reasonable range".into());
    }
    if width == 0 || height == 0 {
        return Err("Width and height must be positive".into());
    }

    // Check FFmpeg availability
    if let Err(e) = check_ffmpeg_available().await {
        return Err(e);
    }

    let time_str = format!("{:.6}", time_secs);
    let scale_str = format!("{}:{}", width, height);

    use tokio::time::{timeout, Duration};

    // Hybrid seeking strategy for frame-accurate extraction:
    // 1. Fast seek to 2 seconds before target (keyframe, fast)
    // 2. Precise decode the remaining 2 seconds to exact frame (accurate)
    let fast_seek_time = (time_secs - 2.0).max(0.0);
    let fast_seek_str = format!("{:.3}", fast_seek_time);

    let hwaccel_args = get_hwaccel_args();
    let vf_filter = format!(
        "scale={}:force_original_aspect_ratio=increase,crop={}:{}",
        scale_str, width, height
    );
    let precise_seek_owned = if fast_seek_time > 0.0 {
        "2.0".to_string()
    } else {
        time_str.clone()
    };

    let mut ffmpeg_args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        fast_seek_str.clone(),
    ];
    for a in hwaccel_args {
        ffmpeg_args.push(a.to_string());
    }
    ffmpeg_args.extend([
        "-i".into(),
        input_path.clone(),
        "-ss".into(),
        precise_seek_owned,
        "-vframes".into(),
        "1".into(),
        "-vf".into(),
        vf_filter,
        "-f".into(),
        "image2".into(),
        "-vcodec".into(),
        "png".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "pipe:1".into(),
    ]);

    // Log the command for debugging
    eprintln!("[FFmpeg] Extracting frame at {}s from {}", time_secs, input_path);

    let ffmpeg_result = timeout(
        Duration::from_secs(15),
        ffmpeg_sidecar::ffmpeg_output_strings_raw(&ffmpeg_args),
    )
    .await;

    match ffmpeg_result {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[FFmpeg] Error: {}", stderr);
                return Err(format!("FFmpeg failed: {}", stderr));
            }

            // Encode PNG bytes to base64 data URL
            let base64_data = BASE64.encode(&output.stdout);
            eprintln!("[FFmpeg] Success: extracted {} bytes", output.stdout.len());
            Ok(format!("data:image/png;base64,{}", base64_data))
        }
        Ok(Err(e)) => {
            eprintln!("[FFmpeg] Failed to spawn: {}", e);
            Err(format!("Failed to spawn FFmpeg: {}", e))
        }
        Err(_) => {
            eprintln!("[FFmpeg] Timeout after 15s for {}", input_path);
            Err("Frame extraction timeout (15s exceeded) - file may be too large or codec not supported".into())
        }
    }
}

/// Extract multiple frames for filmstrip generation.
/// More efficient than multiple extract_frame_at_time calls.
#[tauri::command]
async fn extract_filmstrip_frames(
    input_path: String,
    frame_count: u32,
    width: u32,
    height: u32,
    time_start: Option<f64>,
    time_end: Option<f64>,
) -> Result<Vec<String>, String> {
    // Check FFmpeg availability first
    if let Err(e) = check_ffmpeg_available().await {
        return Err(e);
    }

    if frame_count == 0 || frame_count > 100 {
        return Err("Frame count must be between 1 and 100".into());
    }
    if width == 0 || height == 0 {
        return Err("Width and height must be positive".into());
    }
    if let Some(v) = time_start {
        if !v.is_finite() {
            return Err("time_start must be a finite number".into());
        }
    }
    if let Some(v) = time_end {
        if !v.is_finite() {
            return Err("time_end must be a finite number".into());
        }
    }

    use tokio::time::{timeout, Duration};

    let probe = ffmpeg_sidecar::ffprobe_output(&[
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=r_frame_rate",
        "-of",
        "default=noprint_wrappers=1",
        input_path.as_str(),
    ])
    .await
    .map_err(|e| format!("FFprobe failed: {}", e))?;

    if !probe.status.success() {
        return Err("Failed to probe video".into());
    }

    let probe_output = String::from_utf8_lossy(&probe.stdout);
    let mut duration = 0.0;
    let mut fps = 30.0; // Default fallback

    for line in probe_output.lines() {
        if line.starts_with("duration=") {
            duration = line.trim_start_matches("duration=").parse().unwrap_or(0.0);
        } else if line.starts_with("r_frame_rate=") {
            // Parse fraction like "30000/1001" for 29.97fps
            let fps_str = line.trim_start_matches("r_frame_rate=");
            if let Some((num, den)) = fps_str.split_once('/') {
                if let (Ok(n), Ok(d)) = (num.parse::<f64>(), den.parse::<f64>()) {
                    if d > 0.0 {
                        fps = n / d;
                    }
                }
            } else if let Ok(f) = fps_str.parse::<f64>() {
                fps = f;
            }
        }
    }

    if duration <= 0.0 {
        return Err("Invalid video duration".into());
    }

    let mut t0 = time_start.unwrap_or(0.0).clamp(0.0, duration);
    let mut t1 = time_end.unwrap_or(duration).clamp(0.0, duration);
    if t1 <= t0 {
        let eps = (1.0 / fps).min(0.05_f64).max(duration * 1e-9);
        t1 = (t0 + eps).min(duration);
        if t1 <= t0 {
            t1 = duration;
            t0 = (duration - eps).max(0.0_f64).min(t0);
        }
        if t1 <= t0 {
            return Err("Invalid trim segment for filmstrip".into());
        }
    }
    let segment_duration = t1 - t0;

    // Create temp directory for frames with RAII cleanup guard
    let temp_dir = std::env::temp_dir().join("clypra_filmstrip").join(
        &format!("{}_{}",
            input_path.replace(['/', '\\', ':'], "_"),
            std::process::id()
        )
    );
    
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let _temp_guard = TempDirGuard(temp_dir.clone()); // Auto-cleanup on drop

    let scale_str = format!("{}:{}", width, height);
    let output_pattern = temp_dir.join("frame_%03d.png").to_string_lossy().to_string();

    // Input seek before -i limits demux/decode to the segment; -t caps segment length.
    let ss_str = format!("{:.6}", t0);
    let dur_str = format!("{:.6}", segment_duration);

    // Evenly sample `frame_count` frames across the segment using the fps filter (constant
    // output rate = frame_count / segment_duration). The old `select=eq(n,a)+eq(n,b)+…`
    // approach often mapped many bins to the same output frame index n, so FFmpeg emitted
    // only a handful of PNGs while the UI still laid out 32 cells — thin vertical strips.
    let fps_rate = f64::from(frame_count) / segment_duration;
    if !fps_rate.is_finite() || fps_rate <= 0.0 {
        return Err("Invalid filmstrip sample rate".into());
    }

    // setpts=PTS-STARTPTS: timeline starts at 0 after trim so fps samples the full segment.
    // Crop slightly above vertical center (same bias as before) for talking-head framing.
    let filter_str = format!(
        "setpts=PTS-STARTPTS,fps={:.12},scale={}:force_original_aspect_ratio=increase,crop={}:{}:(in_w-{})/2:(in_h-{})/3",
        fps_rate, scale_str, width, height, width, height
    );

    // Longer timeout than single-frame extract: many thumbnails + decode-heavy codecs.
    let timeout_secs = 45u64
        .saturating_add((frame_count as u64).saturating_mul(8))
        .min(180);
    let timeout_dur = Duration::from_secs(timeout_secs);

    // Try with platform hwaccel first (faster when it works). Many MOV/ProRes files fail
    // with VideoToolbox/D3D11VA + complex vf while plain decode works — same as
    // `extract_poster_frame` which does not use hwaccel.
    let mut last_err: Option<String> = None;

    for (attempt, use_hwaccel) in [(0u32, true), (1, false)].iter() {
        if *attempt > 0 {
            for i in 1..=frame_count {
                let _ = std::fs::remove_file(temp_dir.join(format!("frame_{:03}.png", i)));
            }
        }

        let mut argv: Vec<String> = vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
        ];
        if *use_hwaccel {
            for a in get_hwaccel_args() {
                argv.push(a.to_string());
            }
        }
        argv.extend([
            "-ss".into(),
            ss_str.clone(),
            "-i".into(),
            input_path.clone(),
            "-t".into(),
            dur_str.clone(),
            "-vf".into(),
            filter_str.clone(),
            "-frames:v".into(),
            frame_count.to_string(),
            output_pattern.clone(),
        ]);

        let ffmpeg_result = timeout(
            timeout_dur,
            ffmpeg_sidecar::ffmpeg_output_strings(&argv),
        )
        .await;

        match ffmpeg_result {
            Ok(Ok(output)) => {
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let msg = format!("FFmpeg failed: {}", stderr);
                    eprintln!(
                        "[filmstrip] hwaccel={} attempt {}: {}",
                        use_hwaccel, attempt, msg
                    );
                    last_err = Some(msg);
                    continue;
                }

                let mut frames = Vec::new();
                for i in 1..=frame_count {
                    let frame_path = temp_dir.join(format!("frame_{:03}.png", i));
                    if let Ok(data) = std::fs::read(&frame_path) {
                        let base64_data = BASE64.encode(&data);
                        frames.push(format!("data:image/png;base64,{}", base64_data));
                    }
                }

                if frames.is_empty() {
                    let msg = "No frames extracted (empty output files)".to_string();
                    eprintln!(
                        "[filmstrip] hwaccel={} attempt {}: {}",
                        use_hwaccel, attempt, msg
                    );
                    last_err = Some(msg);
                    continue;
                }

                return Ok(frames);
            }
            Ok(Err(e)) => {
                let msg = format!("Failed to spawn FFmpeg: {}", e);
                eprintln!(
                    "[filmstrip] hwaccel={} attempt {}: {}",
                    use_hwaccel, attempt, msg
                );
                last_err = Some(msg);
            }
            Err(_) => {
                let msg = format!(
                    "Filmstrip extraction timeout ({}s exceeded, hwaccel={})",
                    timeout_secs, use_hwaccel
                );
                eprintln!("[filmstrip] {}", msg);
                last_err = Some(msg);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "Filmstrip extraction failed".into()))
}

/// Get the frame cache directory path
/// Creates the directory if it doesn't exist
#[tauri::command]
fn get_frame_cache_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get app cache dir: {}", e))?
        .join("frames");
    
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    
    Ok(cache_dir.to_string_lossy().to_string())
}

/// Check if a cached frame exists and return its path
#[tauri::command]
fn get_cached_frame_path(
    app_handle: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Option<String>, String> {
    let cache_dir = get_frame_cache_dir(app_handle)?;
    
    // Create a unique hash for this frame request
    let frame_key = format!("{}_{:.3}_{}x{}", video_path, time_secs, width, height);
    let hash = format!("{:x}", md5::compute(&frame_key));
    let frame_path = std::path::PathBuf::from(&cache_dir).join(format!("{}.png", hash));
    
    if frame_path.exists() {
        Ok(Some(frame_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// Save a frame (from data URL) to persistent cache
#[tauri::command]
fn save_frame_to_cache(
    app_handle: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
    data_url: String,
) -> Result<String, String> {
    let cache_dir = get_frame_cache_dir(app_handle)?;
    
    // Create a unique hash for this frame request
    let frame_key = format!("{}_{:.3}_{}x{}", video_path, time_secs, width, height);
    let hash = format!("{:x}", md5::compute(&frame_key));
    let frame_path = std::path::PathBuf::from(&cache_dir).join(format!("{}.png", hash));
    
    // Parse data URL and save
    if let Some(base64_data) = data_url.strip_prefix("data:image/png;base64,") {
        let decoded = BASE64.decode(base64_data)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;
        std::fs::write(&frame_path, decoded)
            .map_err(|e| format!("Failed to write frame: {}", e))?;
        Ok(frame_path.to_string_lossy().to_string())
    } else {
        Err("Invalid data URL format".into())
    }
}

/// Read a cached frame and return as base64 data URL
#[tauri::command]
fn read_cached_frame(
    app_handle: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Option<String>, String> {
    if let Some(path) = get_cached_frame_path(app_handle, video_path, time_secs, width, height)? {
        let data = std::fs::read(&path)
            .map_err(|e| format!("Failed to read cached frame: {}", e))?;
        let base64_data = BASE64.encode(&data);
        Ok(Some(format!("data:image/png;base64,{}", base64_data)))
    } else {
        Ok(None)
    }
}
#[tauri::command]
fn clear_frame_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = get_frame_cache_dir(app_handle)?;
    let _ = std::fs::remove_dir_all(&cache_dir);
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to recreate cache dir: {}", e))?;
    Ok(())
}

/// Get cache size in MB
#[tauri::command]
fn get_frame_cache_size(app_handle: tauri::AppHandle) -> Result<f64, String> {
    let cache_dir = get_frame_cache_dir(app_handle)?;
    let mut total_size = 0u64;
    
    for entry in walkdir::WalkDir::new(&cache_dir).into_iter().flatten() {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                total_size += metadata.len();
            }
        }
    }
    
    Ok(total_size as f64 / (1024.0 * 1024.0)) // Convert to MB
}

/// Initialize the thumbnail engine with app cache directory
#[tauri::command]
async fn init_thumbnail_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Initialize cache directory
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;
    init_thumbnail_engine(cache_dir).await
}

/// Get thumbnails for visible time range using CapCut-style grid sampling
#[tauri::command]
async fn get_thumbnails_for_range(
    video_path: String,
    visible_start: f64,
    visible_end: f64,
    px_per_sec: f64,
    ruler_interval: f64,
    thumbs_per_interval: u32,
    dpr: f64,
) -> Result<Vec<(f64, String, f64)>, String> {
    // Calculate time per thumbnail using the zoom level configuration
    // time_per_thumb = ruler_interval / thumbs_per_interval
    let time_per_thumb = ruler_interval / thumbs_per_interval as f64;

    // Calculate density based on zoom (for cache organization)
    let density = DensityLevel::from_zoom(px_per_sec);

    // Generate timestamp grid
    let timestamps = generate_timestamp_grid(visible_start, visible_end, time_per_thumb);

    if timestamps.is_empty() {
        return Ok(vec![]);
    }

    // Request batch extraction with critical priority (visible range)
    let results = request_batch_thumbnails(
        &video_path,
        timestamps.clone(),
        density,
        Priority::Critical,
        160,  // Width: 160px as per spec (Requirement 15.1)
        90,   // Height: 90px as per spec (Requirement 15.1)
        dpr,
    ).await;

    // Convert results to (time, data_url, x_position) tuples
    let mut thumbnails = Vec::with_capacity(results.len());

    for (i, result) in results.iter().enumerate() {
        let time = timestamps[i];
        let x = (time - visible_start) / time_per_thumb * 80.0;

        match result {
            Ok(path) => {
                // Read the cached frame and convert to data URL
                if let Ok(data) = std::fs::read(path) {
                    let base64_data = BASE64.encode(&data);
                    let data_url = format!("data:image/webp;base64,{}", base64_data);
                    thumbnails.push((time, data_url, x));
                }
            }
            Err(e) => {
                eprintln!("[ThumbnailEngine] Failed to get thumbnail at {}: {}", time, e);
            }
        }
    }

    Ok(thumbnails)
}

/// Get thumbnail cache statistics
#[tauri::command]
fn get_thumbnail_cache_stats() -> serde_json::Value {
    get_cache_stats()
}

/// Clear thumbnail cache for a specific video
#[tauri::command]
async fn clear_thumbnail_cache(video_path: String) {
    clear_video_thumbnail_cache(&video_path).await;
}

/// Extract poster frame at 10% mark of clip duration
/// 
/// Requirements: 1.1, 1.2, 1.4
/// Returns base64-encoded WebP data URL for immediate display
#[tauri::command]
async fn extract_poster_frame_command(
    video_path: String,
    duration: f64,
    dpr: f64,
) -> Result<String, String> {
    // Calculate poster frame time (10% of duration, or 0.5s for short clips)
    let poster_time = if duration < 1.0 {
        0.5
    } else {
        duration * 0.1
    };
    
    // Extract frame using existing thumbnail system
    let poster_path = request_thumbnail(
        &video_path,
        poster_time,
        DensityLevel::Medium,
        Priority::Critical,
        160,
        90,
        dpr,
    ).await?;
    
    // Read the cached frame and convert to data URL
    let data = std::fs::read(&poster_path)
        .map_err(|e| format!("Failed to read poster frame: {}", e))?;
    
    let base64_data = BASE64.encode(&data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}



/// Get thumbnails for specific timestamps (streaming)
/// 
/// This command implements the time-based caching architecture for zoom-stable thumbnail rendering.
/// It checks the cache synchronously for each timestamp and streams results as they become available.
/// 
/// # Parameters
/// - `video_path`: Path to the video file
/// - `timestamps`: List of timestamps (in seconds) to extract
/// - `density`: Target density level for extraction
/// - `width`: Thumbnail width in pixels
/// - `height`: Thumbnail height in pixels
/// - `duration`: Video duration in seconds (for cache initialization)
/// - `on_tile`: Channel for streaming thumbnail results
/// 
/// # Channel Lifetime
/// The channel remains open after this command returns because the frontend Channel object
/// keeps it alive. This is intentional — we stream results as they become available from
/// the background extraction queue.
#[tauri::command]
async fn get_thumbnails_for_timestamps(
    video_path: String,
    timestamps: Vec<f64>,
    density: DensityLevel,
    width: u32,
    height: u32,
    duration: f64,
    on_tile: tauri::ipc::Channel<ThumbnailTile>,
) -> Result<(), String> {
    let video_id = format!("{:x}", md5::compute(&video_path));
    
    // Get or create video cache entry
    let video_cache = thumbnail_engine::get_video_cache(&video_path, duration).await;
    
    // Cancel stale timestamps from previous requests before processing
    let _cancelled = thumbnail_engine::ACTIVE_TRACKER.cancel_stale_timestamps(&video_id, &timestamps);
    
    // Synchronously check cache for each timestamp using fallback chain
    // TEMPORARY: Performance instrumentation for Task 5.1 and 5.3
    let mut cache_hit_latencies: Vec<u128> = Vec::new();
    let mut missing_times = Vec::new();
    let mut cache_hits = 0u32;
    let mut cache_misses = 0u32;
    
    for &time in &timestamps {
        let start = std::time::Instant::now();
        
        if let Some((path, found_density)) = video_cache.get_frame_path(time, density) {
            let latency = start.elapsed().as_micros();
            cache_hit_latencies.push(latency);
            cache_hits += 1;
            
            // Send cached tile immediately
            let _ = on_tile.send(ThumbnailTile {
                time,
                path: path.to_string_lossy().to_string(),
                density: found_density,
            });
        } else {
            missing_times.push(time);
            cache_misses += 1;
        }
    }
    
    // TEMPORARY: Log performance metrics (Task 5.1) and hit rate (Task 5.3)
    let total_requests = cache_hits + cache_misses;
    if total_requests > 0 {
        let hit_rate = (cache_hits as f64 / total_requests as f64) * 100.0;
        
        // Log hit rate for all requests (Task 5.3)
        eprintln!(
            "[PERF] Cache Hit Rate: {}/{} = {:.1}% (target: >=85% for zoom within bucket)",
            cache_hits, total_requests, hit_rate
        );
        
        // Warn if hit rate below target
        if hit_rate < 85.0 {
            eprintln!(
                "[PERF WARNING] Cache hit rate {:.1}% below 85% target!",
                hit_rate
            );
        }
        
        // Log latency metrics for cache hits (Task 5.1)
        if !cache_hit_latencies.is_empty() {
            let total_hits = cache_hit_latencies.len();
            let total_us: u128 = cache_hit_latencies.iter().sum();
            let avg_us = total_us / total_hits as u128;
            let max_us = *cache_hit_latencies.iter().max().unwrap_or(&0);
            let min_us = *cache_hit_latencies.iter().min().unwrap_or(&0);
            
            // Sort for percentile calculation
            let mut sorted = cache_hit_latencies.clone();
            sorted.sort();
            let p95_idx = ((total_hits as f64 * 0.95) as usize).min(total_hits - 1);
            let p95_us = sorted[p95_idx];
            
            // Convert to milliseconds for readability
            let avg_ms = avg_us as f64 / 1000.0;
            let p95_ms = p95_us as f64 / 1000.0;
            let max_ms = max_us as f64 / 1000.0;
            let min_ms = min_us as f64 / 1000.0;
            
            eprintln!(
                "[PERF] Cache Hit Latency: n={}, avg={:.3}ms, p95={:.3}ms, max={:.3}ms, min={:.3}ms",
                total_hits, avg_ms, p95_ms, max_ms, min_ms
            );
            
            // Validate 95th percentile < 5ms
            if p95_ms > 5.0 {
                eprintln!(
                    "[PERF WARNING] 95th percentile cache hit latency ({:.3}ms) exceeds 5ms threshold!",
                    p95_ms
                );
            }
        }
    }
    
    // Register this request as active after cache check
    thumbnail_engine::ACTIVE_TRACKER.register_request(&video_id, &timestamps);
    
    // If all timestamps are cached, return early
    if missing_times.is_empty() {
        return Ok(());
    }
    
    // Spawn background task for missing timestamps
    // NOTE: Channel stays open after command returns - frontend keeps it alive
    tokio::spawn(async move {
        // Determine DPR from width (80px = 1x, 160px = 2x)
        let dpr = if width >= 160 { 2.0 } else { 1.0 };
        
        // Extract missing frames with Critical priority (visible range)
        for time in missing_times {
            let result = request_thumbnail(
                &video_path,
                time,
                density,
                Priority::Critical,
                width,
                height,
                dpr,
            )
            .await;
            
            if let Ok(path) = result {
                // Stream result via channel as it completes
                let _ = on_tile.send(ThumbnailTile {
                    time,
                    path: path.to_string_lossy().to_string(),
                    density,
                });
            } else if let Err(e) = result {
                eprintln!("[get_thumbnails_for_timestamps] Failed to extract frame at {}: {}", time, e);
            }
        }
    });
    
    Ok(())
}

/// Preload video thumbnails with cascading density levels
/// 
/// This command triggers background thumbnail extraction at import time.
/// It chains density levels: Low → Medium → High, with each level starting
/// after the previous completes. This ensures instant zoom response.
/// 
/// # Parameters
/// - `video_path`: Path to the video file
/// - `duration`: Video duration in seconds
/// 
/// # Cascade Behavior
/// The cascade happens in Rust (not frontend):
/// 1. Extract Low density first (5s intervals)
/// 2. If Low succeeds, extract Medium density (1s intervals)
/// 3. If Medium succeeds, extract High density (0.2s intervals)
/// 4. Errors are logged but don't block the cascade
/// 
/// All extractions use Priority::Normal (background priority).
#[tauri::command]
async fn preload_video_thumbnails(
    video_path: String,
    duration: f64,
) -> Result<(), String> {
    // Spawn background task for cascading extraction
    // This returns immediately without blocking the import
    tokio::spawn(async move {
        // TEMPORARY: Performance instrumentation for Task 5.2
        let preload_start = std::time::Instant::now();
        
        // Use default DPR of 1.0 for preloading (1x resolution)
        let dpr = 1.0;
        
        // Extract Low density first
        eprintln!("[preload_video_thumbnails] Starting Low density extraction for {} (duration: {}s)", video_path, duration);
        let low_start = std::time::Instant::now();
        
        match thumbnail_engine::preload_density_level(
            &video_path,
            DensityLevel::Low,
            duration,
            dpr,
        ).await {
            Ok(_) => {
                let low_elapsed_ms = low_start.elapsed().as_millis() as f64;
                let total_elapsed_ms = preload_start.elapsed().as_millis() as f64;
                
                eprintln!(
                    "[PERF] Low density extraction complete: {:.1}ms (target: <1000ms for 60s video)",
                    low_elapsed_ms
                );
                eprintln!(
                    "[PERF] Pre-extraction summary: video_duration={}s, low_density_time={:.1}ms, total_time={:.1}ms",
                    duration, low_elapsed_ms, total_elapsed_ms
                );
                
                // Warn if significantly over target (for 60s videos)
                if duration >= 50.0 && duration <= 70.0 && low_elapsed_ms > 1000.0 {
                    eprintln!(
                        "[PERF WARNING] Low density extraction ({:.1}ms) exceeded 1000ms target for 60s video!",
                        low_elapsed_ms
                    );
                }
            }
            Err(e) => {
                let low_elapsed_ms = low_start.elapsed().as_millis() as f64;
                eprintln!(
                    "[preload_video_thumbnails] Low density failed after {:.1}ms for {}: {}",
                    low_elapsed_ms, video_path, e
                );
                return; // Return early if Low fails
            }
        }
        
        // Extract Medium density after Low completes
        eprintln!("[preload_video_thumbnails] Starting Medium density extraction for {}", video_path);
        match thumbnail_engine::preload_density_level(
            &video_path,
            DensityLevel::Medium,
            duration,
            dpr,
        ).await {
            Ok(_) => {
                eprintln!("[preload_video_thumbnails] Medium density complete for {}", video_path);
            }
            Err(e) => {
                eprintln!("[preload_video_thumbnails] Medium density failed for {}: {}", video_path, e);
                return; // Return early if Medium fails
            }
        }
        
        // Extract High density after Medium completes
        eprintln!("[preload_video_thumbnails] Starting High density extraction for {}", video_path);
        match thumbnail_engine::preload_density_level(
            &video_path,
            DensityLevel::High,
            duration,
            dpr,
        ).await {
            Ok(_) => {
                eprintln!("[preload_video_thumbnails] High density complete for {}", video_path);
            }
            Err(e) => {
                eprintln!("[preload_video_thumbnails] High density failed for {}: {}", video_path, e);
                // Don't return - this is the last level
            }
        }
    });
    
    // Return immediately - cascade happens in background
    Ok(())
}

#[cfg(test)]
mod lib_test;

#[cfg(test)]
mod preload_test;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            ffmpeg_sidecar::set_app_handle(app.handle());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_cache_dir() {
                    let _ = init_thumbnail_engine(dir).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            trim_export,
            audio_waveform_peaks,
            extract_frame_at_time,
            extract_filmstrip_frames,
            get_thumbnails_for_timestamps,
            preload_video_thumbnails,
            get_frame_cache_dir,
            get_cached_frame_path,
            save_frame_to_cache,
            read_cached_frame,
            clear_frame_cache,
            get_frame_cache_size,
            init_thumbnail_cache,
            get_thumbnails_for_range,
            get_thumbnail_cache_stats,
            clear_thumbnail_cache,
            extract_poster_frame_command,
            commands::media::get_video_metadata,
            commands::media::extract_poster_frame,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::get_recent_projects,
            commands::project::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
