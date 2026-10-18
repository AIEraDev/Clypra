use base64::Engine;
use super::path::normalize_file_path;

const PREVIEW_CACHE_VERSION: &str = "v5";

#[tauri::command]
pub async fn extract_poster_frame(path: String, time: f64) -> Result<String, String> {
    log::debug!(
        "[extract_poster_frame] Extracting frame at {}s from {}",
        time,
        path
    );
    crate::commands::thumbnail::extract_poster_frame_command(path, time.max(1.0), 1.0).await
}

#[tauri::command]
pub async fn extract_audio_artwork(path: String) -> Result<Option<String>, String> {
    log::debug!("[extract_audio_artwork] Extracting artwork from: {}", path);

    let output = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args([
            "-i",
            &path,
            "-an", // No audio
            "-vcodec",
            "copy",
            "-f",
            "image2pipe",
            "-vframes",
            "1",
            "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() || output.stdout.is_empty() {
        log::debug!("[extract_audio_artwork] No artwork found");
        return Ok(None);
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    let mime_type = "image/jpeg"; // Most audio artwork is JPEG

    log::debug!(
        "[extract_audio_artwork] Extracted artwork ({} bytes)",
        output.stdout.len()
    );
    Ok(Some(format!("data:{};base64,{}", mime_type, encoded)))
}

#[tauri::command]
pub async fn extract_audio_track(path: String) -> Result<String, String> {
    log::debug!("🦀 [extract_audio_track] Extracting audio from: {}", path);

    // Use system temp directory to avoid triggering file watchers in dev mode
    let temp_dir = std::env::temp_dir();

    // Create a clypra-specific subdirectory
    let clypra_temp = temp_dir.join("clypra-audio");
    if !clypra_temp.exists() {
        tokio::fs::create_dir_all(&clypra_temp)
            .await
            .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    }

    // Generate a unique filename using MD5 of path
    let hash = format!("{:x}", md5::compute(path.as_bytes()));
    let output_filename = format!("{}.mp3", hash);
    let output_path = clypra_temp.join(output_filename);
    let output_path_str = output_path
        .to_str()
        .ok_or("Failed to convert output path to string")?
        .to_string();

    // Call ffmpeg command to extract audio asynchronously
    let output = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args([
            "-i",
            &path,
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-y",
            &output_path_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffmpeg for audio extraction: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio extraction failed: {}", stderr));
    }

    let abs_path = std::fs::canonicalize(&output_path)
        .map_err(|e| format!("Failed to resolve absolute path of extracted audio: {}", e))?;

    let abs_path_str = abs_path
        .to_str()
        .ok_or("Failed to convert absolute path to string")?
        .to_string();
    log::debug!(
        "🦀 [extract_audio_track] Extracted audio saved to: {}",
        abs_path_str
    );

    Ok(abs_path_str)
}

/// Returns a WebKit-compatible MP4 preview video path for a given media file.
/// If the video is already in a native container, the original path is returned.
/// Otherwise generates a fast stream-copied or lightweight proxy MP4.
pub async fn probe_video_codec(path: &str) -> Option<String> {
    let output = crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let codec = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_lowercase();
        if !codec.is_empty() {
            return Some(codec);
        }
    }
    None
}

pub async fn probe_audio_codec(path: &str) -> Option<String> {
    let output = crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let codec = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_lowercase();
        if !codec.is_empty() {
            return Some(codec);
        }
    }
    None
}

pub fn is_browser_playable_audio(codec: Option<&str>) -> bool {
    let Some(codec) = codec else {
        return true;
    };
    match codec {
        "aac" | "mp3" | "opus" | "vorbis" | "flac" | "pcm_s16le" | "pcm_s24le" => true,
        "ac3" | "eac3" => {
            #[cfg(target_os = "macos")]
            {
                true
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        _ => false,
    }
}

pub fn is_browser_playable_video(codec: Option<&str>, ext: &str) -> bool {
    let Some(codec) = codec else {
        return matches!(ext, "mp4" | "mov" | "m4v" | "webm");
    };

    match codec {
        "h264" | "avc1" => matches!(ext, "mp4" | "mov" | "m4v"),
        "hevc" | "hvc1" => {
            #[cfg(target_os = "macos")]
            {
                matches!(ext, "mp4" | "mov" | "m4v")
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        "prores" => {
            #[cfg(target_os = "macos")]
            {
                ext == "mov"
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        "vp8" | "vp9" => ext == "webm",
        "av1" | "av01" => {
            #[cfg(target_os = "macos")]
            {
                crate::filmstrip_engine::decoder::VideoDecoder::macos_supports_hw_av1()
                    && matches!(ext, "mp4" | "mov" | "webm")
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        _ => false,
    }
}

pub fn can_stream_copy_video(codec: Option<&str>) -> bool {
    let Some(codec) = codec else {
        return false;
    };
    match codec {
        "h264" | "avc1" => true,
        "hevc" | "hvc1" => {
            #[cfg(target_os = "macos")]
            {
                true
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        "av1" | "av01" => {
            #[cfg(target_os = "macos")]
            {
                crate::filmstrip_engine::decoder::VideoDecoder::macos_supports_hw_av1()
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn get_or_create_preview_video(
    app: tauri::AppHandle,
    path: String,
    force_transcode: Option<bool>,
) -> Result<String, String> {
    use tauri::Manager;
    let path = normalize_file_path(&path);
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let ext = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let probed_codec = probe_video_codec(&path).await;
    let codec_ref = probed_codec.as_deref();
    let probed_audio_codec = probe_audio_codec(&path).await;
    let audio_codec_ref = probed_audio_codec.as_deref();

    let audio_playable = is_browser_playable_audio(audio_codec_ref);
    let video_playable = is_browser_playable_video(codec_ref, &ext);
    let force = force_transcode.unwrap_or(false);

    if !force && video_playable && audio_playable {
        log::debug!(
            "🦀 [get_or_create_preview_video] Asset is natively browser playable (video: {:?}, audio: {:?}): {}",
            codec_ref,
            audio_codec_ref,
            path
        );
        return Ok(path);
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get app cache dir: {e}"))?
        .join("preview_video");

    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("Failed to create preview cache dir: {e}"))?;

    let meta = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read metadata for {}: {e}", path))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Versioned key that includes OS platform so platform-specific decode support (like HEVC on macOS vs Windows)
    // produces distinct, correct cache artifacts.
    let key = format!(
        "{}:{}:{}:{}:{}",
        PREVIEW_CACHE_VERSION,
        std::env::consts::OS,
        path,
        meta.len(),
        modified
    );
    let hash = format!("{:x}", md5::compute(key.as_bytes()));
    let output_path = cache_dir.join(format!("{}.mp4", hash));
    let out_str = output_path.to_string_lossy().to_string();

    if !force && output_path.exists() {
        if let Ok(m) = std::fs::metadata(&output_path) {
            if m.len() > 1024 {
                // Defensive verification: verify the cached file's video stream is actually browser-playable on this OS.
                let cached_vcodec = probe_video_codec(&out_str).await;
                if is_browser_playable_video(cached_vcodec.as_deref(), "mp4") {
                    return Ok(out_str);
                } else {
                    log::warn!(
                        "🦀 [get_or_create_preview_video] Existing cache {:?} has non-playable video codec {:?}; removing and regenerating",
                        output_path, cached_vcodec
                    );
                    let _ = std::fs::remove_file(&output_path);
                }
            }
        }
    } else if force && output_path.exists() {
        let _ = std::fs::remove_file(&output_path);
    }

    let is_hevc = matches!(codec_ref, Some("hevc" | "hvc1"));

    if !force && can_stream_copy_video(codec_ref) {
        if audio_playable {
            // Stage 1: Ultra-fast stream remux (-c:v copy -c:a copy -sn)
            let mut stage1_args = vec!["-y", "-i", &path, "-c:v", "copy", "-c:a", "copy", "-sn"];
            if is_hevc {
                stage1_args.extend(["-tag:v", "hvc1"]);
            }
            stage1_args.extend(["-movflags", "+faststart", &out_str]);

            let stage1_status = crate::commands::binary_resolver::create_async_command("ffmpeg")
                .args(&stage1_args)
                .output()
                .await;

            if let Ok(ref output) = stage1_status {
                if output.status.success() && output_path.exists() {
                    if let Ok(m) = std::fs::metadata(&output_path) {
                        if m.len() > 1024 {
                            log::debug!(
                                "🦀 [get_or_create_preview_video] Stage 1 (stream copy) succeeded for {}",
                                path
                            );
                            return Ok(out_str);
                        }
                    }
                }
            }
        } else {
            log::debug!(
                "🦀 [get_or_create_preview_video] Audio codec {:?} is not browser playable; skipping Stage 1 stream copy to re-encode audio to AAC in Stage 2",
                audio_codec_ref
            );
        }

        // Stage 2: Audio re-encode fallback (-c:v copy -c:a aac -b:a 192k -sn)
        let mut stage2_args = vec![
            "-y", "-i", &path, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-sn",
        ];
        if is_hevc {
            stage2_args.extend(["-tag:v", "hvc1"]);
        }
        stage2_args.extend(["-movflags", "+faststart", &out_str]);

        let stage2_status = crate::commands::binary_resolver::create_async_command("ffmpeg")
            .args(&stage2_args)
            .output()
            .await;

        if let Ok(ref output) = stage2_status {
            if output.status.success() && output_path.exists() {
                if let Ok(m) = std::fs::metadata(&output_path) {
                    if m.len() > 1024 {
                        log::debug!("🦀 [get_or_create_preview_video] Stage 2 (video copy + aac) succeeded for {}", path);
                        return Ok(out_str);
                    }
                }
            }
        }
    } else {
        log::debug!(
            "🦀 [get_or_create_preview_video] Video codec {:?} cannot be stream copied for browser preview (force={}); jumping to Stage 3 transcode for {}",
            codec_ref, force, path
        );
    }

    // Stage 3: Fast proxy transcode (-c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p -c:a aac -sn)
    let stage3_status = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args([
            "-y",
            "-i",
            &path,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-sn",
            "-movflags",
            "+faststart",
            &out_str,
        ])
        .output()
        .await;

    match stage3_status {
        Ok(output) if output.status.success() => {
            log::debug!(
                "🦀 [get_or_create_preview_video] Stage 3 (ultrafast proxy) succeeded for {}",
                path
            );
            Ok(out_str)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("FFmpeg preview creation failed: {}", stderr))
        }
        Err(e) => Err(format!("Failed to execute FFmpeg: {}", e)),
    }
}
