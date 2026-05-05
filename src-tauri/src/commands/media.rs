use crate::ffmpeg_sidecar;
use crate::models::VideoMetadata;
use base64::Engine;
use std::fs;

#[tauri::command]
pub async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    let stream_check = ffmpeg_sidecar::ffprobe_output(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path.as_str(),
    ])
    .await
    .map_err(|e| format!("ffprobe stream check failed: {e}"))?;

    let has_video = !String::from_utf8_lossy(&stream_check.stdout)
        .trim()
        .is_empty();

    let output = if has_video {
        ffmpeg_sidecar::ffprobe_output(&[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.as_str(),
        ])
        .await
        .map_err(|e| format!("ffprobe execution failed: {e}"))?
    } else {
        ffmpeg_sidecar::ffprobe_output(&[
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.as_str(),
        ])
        .await
        .map_err(|e| format!("ffprobe execution failed: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = output_str.trim().lines().collect();

    let (width, height, fps, duration) = if has_video {
        if lines.len() < 4 {
            return Err(format!(
                "Invalid ffprobe output (got {} lines, expected 4): {}",
                lines.len(),
                output_str
            ));
        }
        let width = lines[0].parse::<u32>().unwrap_or(1920);
        let height = lines[1].parse::<u32>().unwrap_or(1080);
        let fps_str = lines[2];
        let fps = if let Some(idx) = fps_str.find('/') {
            let num = fps_str[..idx].parse::<f64>().unwrap_or(30.0);
            let den = fps_str[idx + 1..].parse::<f64>().unwrap_or(1.0);
            num / den
        } else {
            fps_str.parse::<f64>().unwrap_or(30.0)
        };
        let duration = lines[3].parse::<f64>().unwrap_or(0.0);
        (width, height, fps, duration)
    } else {
        if lines.is_empty() {
            return Err(format!("Invalid ffprobe output for audio: {}", output_str));
        }
        let duration = lines[0].parse::<f64>().unwrap_or(0.0);
        (0, 0, 0.0, duration)
    };

    let metadata = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    Ok(VideoMetadata {
        duration,
        width,
        height,
        fps,
        size: metadata,
    })
}

#[tauri::command]
pub async fn extract_poster_frame(path: String, time: f64) -> Result<String, String> {
    let t = time.to_string();
    let output = ffmpeg_sidecar::ffmpeg_output_strings_raw(&[
        "-ss".into(),
        t,
        "-i".into(),
        path.clone(),
        "-vframes".into(),
        "1".into(),
        "-f".into(),
        "image2".into(),
        "-vcodec".into(),
        "png".into(),
        "pipe:1".into(),
    ])
    .await
    .map_err(|e| format!("ffmpeg execution failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{}", encoded))
}
