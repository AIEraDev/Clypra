use crate::commands::export::augmented_path;
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
        .env("PATH", augmented_path())
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

/// Process a camera recording:
/// - Mirror horizontally (hflip) so the recording matches the front camera viewfinder
/// - Crop to the requested aspect ratio ("9:16", "1:1", "4:3", "16:9")
/// - Re-encode to MP4 (H.264 + AAC) with faststart
#[tauri::command]
pub async fn process_camera_recording(
    input_path: String,
    output_path: String,
    aspect_ratio: String,
    mirror: bool,
) -> Result<String, String> {
    eprintln!(
        "🦀 [process_camera_recording] Processing: {} → {} (ratio: {}, mirror: {})",
        input_path, output_path, aspect_ratio, mirror
    );

    // Build filter chain
    let mut filters = Vec::new();
    if mirror {
        filters.push("hflip".to_string());
    }

    match aspect_ratio.as_str() {
        "9:16" => {
            // Crop to center 9:16 (ensure even dimensions for libx264)
            filters.push("crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2':x='(iw-out_w)/2':y='(ih-out_h)/2'".to_string());
        }
        "1:1" => {
            // Crop to center square (ensure even dimensions)
            filters.push("crop=w='trunc(min(iw,ih)/2)*2':h='trunc(min(iw,ih)/2)*2':x='(iw-out_w)/2':y='(ih-out_h)/2'".to_string());
        }
        "4:3" => {
            // Crop to center 4:3 (ensure even dimensions)
            filters.push("crop=w='trunc(min(iw,ih*4/3)/2)*2':h='trunc(min(ih,iw*3/4)/2)*2':x='(iw-out_w)/2':y='(ih-out_h)/2'".to_string());
        }
        "16:9" => {
            // Standard landscape crop to exact 16:9 (ensure even dimensions)
            filters.push("crop=w='trunc(min(iw,ih*16/9)/2)*2':h='trunc(min(ih,iw*9/16)/2)*2':x='(iw-out_w)/2':y='(ih-out_h)/2'".to_string());
        }
        _ => {}
    }

    let filter_str = if filters.is_empty() {
        "null".to_string()
    } else {
        filters.join(",")
    };

    let mut cmd = Command::new("ffmpeg");
    cmd.env("PATH", augmented_path())
        .args([
            "-y",
            "-i",
            &input_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            &filter_str,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "ultrafast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            &output_path,
        ]);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg for camera processing: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("🦀 [process_camera_recording] FFmpeg processing failed: {}", stderr);
        return Err(format!("FFmpeg processing failed: {}", stderr));
    }

    // Remove the temporary un-processed input file if distinct
    if input_path != output_path {
        let _ = std::fs::remove_file(&input_path);
    }

    eprintln!("🦀 [process_camera_recording] Success: {}", output_path);
    Ok(output_path)
}
