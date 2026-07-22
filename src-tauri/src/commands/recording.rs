/**
 * Screen Recording Commands
 *
 * Post-processing commands for screen recordings captured by the frontend.
 * Currently provides lossless video trimming via the bundled FFmpeg binary.
 */
use std::process::Command;

/// Trim a video file using FFmpeg stream copy (lossless, near-instant).
///
/// Uses `-ss` before `-i` for fast keyframe seeking, then copies streams
/// without re-encoding. Adds `-avoid_negative_ts make_zero` for clean
/// trim boundaries.
///
/// # Arguments
/// * `input_path`    - Absolute path to the source video
/// * `output_path`   - Absolute path for the trimmed output
/// * `start_seconds` - Trim start point in seconds
/// * `end_seconds`   - Trim end point in seconds
///
/// # Returns
/// The output path on success, or an error string on failure.
#[tauri::command]
pub async fn trim_video(
    input_path: String,
    output_path: String,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<String, String> {
    let duration = end_seconds - start_seconds;

    if duration <= 0.0 {
        return Err("Trim duration must be positive (end must be after start)".to_string());
    }

    eprintln!(
        "🦀 [trim_video] Trimming: {} → {} ({}s – {}s, duration: {:.2}s)",
        input_path, output_path, start_seconds, end_seconds, duration
    );

    let output = Command::new("ffmpeg")
        .args([
            "-y", // Overwrite output without asking
            "-ss",
            &format!("{:.3}", start_seconds), // Seek before -i for fast keyframe seek
            "-i",
            &input_path,
            "-t",
            &format!("{:.3}", duration), // Duration, not end time
            "-c",
            "copy", // Stream copy — no re-encode
            "-avoid_negative_ts",
            "make_zero", // Clean trim start
            "-movflags",
            "+faststart", // Web-friendly MP4 structure
            &output_path,
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg for trim: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("🦀 [trim_video] FFmpeg trim failed: {}", stderr);
        return Err(format!("FFmpeg trim failed: {}", stderr));
    }

    eprintln!("🦀 [trim_video] Trim successful: {}", output_path);
    Ok(output_path)
}
