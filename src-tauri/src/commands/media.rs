use crate::commands::export::augmented_path;
use crate::models::{MediaMetadata, VideoMetadata};
use crate::thumbnail_engine::decoder::{get_decoder, VideoStreamMetadata};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;

fn urlencoding_decode(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                if let Ok(val) =
                    u8::from_str_radix(std::str::from_utf8(&[c1, c2]).unwrap_or(""), 16)
                {
                    bytes.push(val);
                    continue;
                }
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn normalize_file_path(path: &str) -> String {
    let trimmed = path.trim();
    let stripped = if let Some(rest) = trimmed.strip_prefix("asset://localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("asset://localhost%2F") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://asset.localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("https://asset.localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("asset://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("file://") {
        rest
    } else {
        trimmed
    };

    if stripped == trimmed {
        return trimmed.to_string();
    }

    let mut decoded = urlencoding_decode(stripped);
    if decoded.starts_with("//") {
        while decoded.starts_with("//") {
            decoded.remove(0);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if decoded.starts_with('/') && decoded.len() > 2 && decoded.as_bytes()[2] == b':' {
            decoded = decoded[1..].to_string();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if !decoded.starts_with('/') {
            decoded.insert(0, '/');
        }
    }
    decoded
}

/// Unified media metadata extraction for images, videos, and audio.
/// Professional NLE approach: single probe pipeline for all media types.
#[tauri::command]
pub async fn get_media_metadata(path: String) -> Result<MediaMetadata, String> {
    let path = normalize_file_path(&path);
    let start = std::time::Instant::now();
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path);

    // Determine media type from extension
    let extension = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let result = match extension.as_str() {
        // Image formats - use image crate for native decoding
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "tif" => {
            get_image_metadata(&path).await
        }
        // Video/audio formats - use FFmpeg decoder
        _ => get_video_metadata_internal(&path).await,
    };

    if let Ok(ref meta) = result {
        eprintln!(
            "🦀 [get_media_metadata] [{}] Probed in {:?} ({}x{}, {:.2}s)",
            filename,
            start.elapsed(),
            meta.width,
            meta.height,
            meta.duration
        );
    } else if let Err(ref e) = result {
        eprintln!(
            "🦀 [get_media_metadata] [{}] Failed in {:?}: {}",
            filename,
            start.elapsed(),
            e
        );
    }

    result
}

/// Decode a still image into an exact-size RGBA8 buffer for the native
/// compositor. This is intentionally separate from the video frame decoder:
/// image layers must preserve alpha and must not be aspect-fit into a smaller
/// buffer than the layer contract declares.
#[tauri::command]
pub async fn decode_image_rgba(
    path: String,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err("Still image decode dimensions are outside the native limit".to_string());
    }

    let rgba =
        tauri::async_runtime::spawn_blocking(move || decode_image_rgba_bytes(&path, width, height))
            .await
            .map_err(|error| format!("Still image decode task failed: {}", error))??;
    Ok(tauri::ipc::Response::new(rgba))
}

pub(crate) fn decode_image_rgba_bytes(
    path: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let image = image::open(path)
        .map_err(|error| format!("Failed to decode still image {}: {}", path, error))?
        .to_rgba8();
    let resized = if image.width() == width && image.height() == height {
        image
    } else {
        image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle)
    };
    Ok(resized.into_raw())
}

/// Return the complete native stream contract used by deterministic preview
/// rendering. This intentionally remains separate from the legacy UI metadata
/// response so color and timestamp fields are not discarded.
#[tauri::command]
pub async fn get_video_render_metadata(path: String) -> Result<VideoStreamMetadata, String> {
    let decoder = get_decoder(&path).await?;
    let guard = decoder.lock().await;
    Ok(guard.metadata())
}

/// Extract metadata from image files using the image crate.
/// Handles: dimensions, alpha channel, EXIF orientation.
async fn get_image_metadata(path: &str) -> Result<MediaMetadata, String> {
    use image::GenericImageView;

    eprintln!("🦀 [get_image_metadata] Loading image: {}", path);

    // Load image to extract metadata
    let img = image::open(path).map_err(|e| format!("Failed to open image: {}", e))?;

    let (width, height) = img.dimensions();

    // Check for alpha channel
    let has_alpha = matches!(
        img.color(),
        image::ColorType::La8
            | image::ColorType::La16
            | image::ColorType::Rgba8
            | image::ColorType::Rgba16
            | image::ColorType::Rgba32F
    );

    // Get file size
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    eprintln!(
        "🦀 [get_image_metadata] Dimensions: {}×{}, Alpha: {}",
        width, height, has_alpha
    );

    Ok(MediaMetadata {
        duration: 0.0,
        width,
        height,
        fps: 0.0,
        size,
        rotation: None,
        has_alpha: Some(has_alpha),
    })
}

/// Extract metadata from video/audio files using FFmpeg decoder.
/// Handles: dimensions, duration, fps, rotation, SAR.
async fn get_video_metadata_internal(path: &str) -> Result<MediaMetadata, String> {
    match get_decoder(path).await {
        Ok(decoder) => {
            let guard = decoder.lock().await;

            // ✅ Use display_dimensions() which handles SAR + rotation
            let (width, height) = guard.display_dimensions();

            let duration = guard.duration;
            let fps = guard.fps();
            let rotation = guard.rotation();

            drop(guard);

            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

            eprintln!(
                "🦀 [get_video_metadata_internal] Display dimensions: {}×{}, Rotation: {}°",
                width, height, rotation
            );

            Ok(MediaMetadata {
                duration,
                width,
                height,
                fps,
                size,
                rotation: if rotation != 0 { Some(rotation) } else { None },
                has_alpha: None,
            })
        }
        Err(e) if e.contains("No video stream") => {
            // Audio-only file
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let duration = get_audio_duration(path).await.unwrap_or(0.0);

            Ok(MediaMetadata {
                duration,
                width: 0,
                height: 0,
                fps: 0.0,
                size,
                rotation: None,
                has_alpha: None,
            })
        }
        Err(e) => Err(e),
    }
}

/// Legacy command for backward compatibility.
/// New code should use get_media_metadata instead.
///
/// Use get_media_metadata for unified media type handling
#[deprecated(note = "Use get_media_metadata instead")]
#[tauri::command]
pub async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    eprintln!("⚠️  DEPRECATED: get_video_metadata called, use get_media_metadata instead");
    get_video_metadata_internal(&path).await
}

async fn get_audio_duration(path: &str) -> Result<f64, String> {
    eprintln!(
        "[get_audio_duration] Attempting to get duration for: {}",
        path
    );

    let output = crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .map_err(|e| {
            eprintln!("[get_audio_duration] Failed to run ffprobe: {}", e);
            format!("Failed to run ffprobe: {}", e)
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[get_audio_duration] ffprobe failed: {}", stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    eprintln!("[get_audio_duration] ffprobe output: {}", duration_str);

    let duration = duration_str.trim().parse::<f64>().map_err(|e| {
        eprintln!(
            "[get_audio_duration] Failed to parse duration '{}': {}",
            duration_str, e
        );
        format!("Failed to parse duration: {}", e)
    })?;

    eprintln!(
        "[get_audio_duration] Successfully parsed duration: {}s",
        duration
    );
    Ok(duration)
}

#[tauri::command]
pub async fn extract_poster_frame(path: String, time: f64) -> Result<String, String> {
    eprintln!(
        "[extract_poster_frame] Extracting frame at {}s from {}",
        time, path
    );
    crate::commands::thumbnail::extract_poster_frame_command(path, time.max(1.0), 1.0).await
}

#[tauri::command]
pub async fn extract_audio_artwork(path: String) -> Result<Option<String>, String> {
    eprintln!("[extract_audio_artwork] Extracting artwork from: {}", path);

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
        eprintln!("[extract_audio_artwork] No artwork found");
        return Ok(None);
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    let mime_type = "image/jpeg"; // Most audio artwork is JPEG

    eprintln!(
        "[extract_audio_artwork] Extracted artwork ({} bytes)",
        output.stdout.len()
    );
    Ok(Some(format!("data:{};base64,{}", mime_type, encoded)))
}

#[tauri::command]
pub async fn extract_audio_track(path: String) -> Result<String, String> {
    eprintln!("🦀 [extract_audio_track] Extracting audio from: {}", path);

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
    eprintln!(
        "🦀 [extract_audio_track] Extracted audio saved to: {}",
        abs_path_str
    );

    Ok(abs_path_str)
}

/// Returns a WebKit-compatible MP4 preview video path for a given media file.
/// If the video is already in a native container (.mp4, .mov, .m4v, .webm), the original path is returned.
/// If the video is in an unsupported container (.mkv, .avi, .flv, .wmv, etc.) or fails playback,
async fn probe_video_codec(path: &str) -> Option<String> {
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

fn is_browser_playable_video(codec: Option<&str>, ext: &str) -> bool {
    let Some(codec) = codec else {
        return matches!(ext, "mp4" | "mov" | "m4v" | "webm");
    };

    match codec {
        "h264" | "avc1" => matches!(ext, "mp4" | "mov" | "m4v"),
        "hevc" | "hvc1" => matches!(ext, "mp4" | "mov" | "m4v"),
        "prores" => ext == "mov",
        "vp8" | "vp9" => ext == "webm",
        "av1" | "av01" => {
            #[cfg(target_os = "macos")]
            {
                crate::thumbnail_engine::decoder::VideoDecoder::macos_supports_hw_av1()
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

fn can_stream_copy_video(codec: Option<&str>) -> bool {
    let Some(codec) = codec else {
        return true;
    };
    match codec {
        "h264" | "avc1" | "hevc" | "hvc1" => true,
        "av1" | "av01" => {
            #[cfg(target_os = "macos")]
            {
                crate::thumbnail_engine::decoder::VideoDecoder::macos_supports_hw_av1()
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }
        _ => false,
    }
}

/// this generates a fast stream-copied or lightweight proxy MP4 in the app cache directory.
#[tauri::command]
pub async fn get_or_create_preview_video(
    app: tauri::AppHandle,
    path: String,
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

    if is_browser_playable_video(codec_ref, &ext) {
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

    let key = format!("{}:{}:{}", path, meta.len(), modified);
    let hash = format!("{:x}", md5::compute(key.as_bytes()));
    let output_path = cache_dir.join(format!("{}.mp4", hash));

    if output_path.exists() {
        if let Ok(m) = std::fs::metadata(&output_path) {
            if m.len() > 1024 {
                return Ok(output_path.to_string_lossy().to_string());
            }
        }
    }

    let out_str = output_path.to_string_lossy().to_string();

    if can_stream_copy_video(codec_ref) {
        // Stage 1: Ultra-fast stream remux (-c:v copy -c:a copy -sn -tag:v hvc1 -movflags +faststart)
        let stage1_status = crate::commands::binary_resolver::create_async_command("ffmpeg")
            .args([
                "-y",
                "-i",
                &path,
                "-c:v",
                "copy",
                "-c:a",
                "copy",
                "-sn",
                "-tag:v",
                "hvc1",
                "-movflags",
                "+faststart",
                &out_str,
            ])
            .output()
            .await;

        if let Ok(ref output) = stage1_status {
            if output.status.success() && output_path.exists() {
                if let Ok(m) = std::fs::metadata(&output_path) {
                    if m.len() > 1024 {
                        eprintln!(
                            "🦀 [get_or_create_preview_video] Stage 1 (stream copy) succeeded for {}",
                            path
                        );
                        return Ok(out_str);
                    }
                }
            }
        }

        // Stage 2: Audio re-encode fallback (-c:v copy -c:a aac -b:a 192k -sn)
        let stage2_status = crate::commands::binary_resolver::create_async_command("ffmpeg")
            .args([
                "-y",
                "-i",
                &path,
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-sn",
                "-tag:v",
                "hvc1",
                "-movflags",
                "+faststart",
                &out_str,
            ])
            .output()
            .await;

        if let Ok(ref output) = stage2_status {
            if output.status.success() && output_path.exists() {
                if let Ok(m) = std::fs::metadata(&output_path) {
                    if m.len() > 1024 {
                        eprintln!("🦀 [get_or_create_preview_video] Stage 2 (video copy + aac) succeeded for {}", path);
                        return Ok(out_str);
                    }
                }
            }
        }
    } else {
        eprintln!(
            "🦀 [get_or_create_preview_video] Video codec {:?} cannot be stream copied for browser preview; jumping to Stage 3 transcode for {}",
            codec_ref, path
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
            eprintln!(
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

#[tauri::command]
pub async fn transcribe_audio_local(
    audio_path: String,
    model_size: Option<String>,
    language: Option<String>,
    language_hints: Option<Vec<String>>,
) -> Result<String, String> {
    use std::path::PathBuf;

    let model = model_size.unwrap_or_else(|| "tiny".to_string());
    let lang_param = language.unwrap_or_else(|| "auto".to_string());

    eprintln!(
        "🦀 [transcribe_audio_local] Transcribing: {} (model: {}, lang: {})",
        audio_path, model, lang_param
    );

    // Get app data directory for models
    let app_data_dir: String = std::env::var("TAURI_APP_DATA_DIR")
        .or_else(|_| -> Result<String, String> {
            // Fallback: construct it manually
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "Could not determine home directory".to_string())?;

            #[cfg(target_os = "macos")]
            let path = format!("{}/Library/Application Support/com.clypra.editor", home);

            #[cfg(target_os = "windows")]
            let path = format!("{}\\AppData\\Roaming\\com.clypra.editor", home);

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let path = format!("{}/.local/share/com.clypra.editor", home);

            Ok(path)
        })
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = PathBuf::from(&app_data_dir)
        .join("models")
        .join("whisper")
        .to_string_lossy()
        .to_string();
    eprintln!(
        "🦀 [transcribe_audio_local] Models directory: {}",
        models_dir
    );

    // Verify Python script exists
    let mut script_path = PathBuf::from("src/features/text-effects/transcribe.py");
    if !script_path.exists() {
        script_path = PathBuf::from("../src/features/text-effects/transcribe.py");
    }
    if !script_path.exists() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mut dir = exe_dir.to_path_buf();
                for _ in 0..5 {
                    let test_path = dir.join("src/features/text-effects/transcribe.py");
                    if test_path.exists() {
                        script_path = test_path;
                        break;
                    }
                    if let Some(parent) = dir.parent() {
                        dir = parent.to_path_buf();
                    } else {
                        break;
                    }
                }
            }
        }
    }
    if !script_path.exists() {
        let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for _ in 0..4 {
            let test_path = dir.join("src/features/text-effects/transcribe.py");
            if test_path.exists() {
                script_path = test_path;
                break;
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }

    if !script_path.exists() {
        return Err(format!(
            "Transcription script not found. Expected at: {:?}",
            script_path
        ));
    }

    let script_path_str = script_path
        .to_str()
        .ok_or("Failed to convert script path to string")?
        .to_string();
    eprintln!(
        "🦀 [transcribe_audio_local] Resolved script path: {}",
        script_path_str
    );

    // Build language hint prompt if hints are provided
    let prompt = if let Some(hints) = language_hints {
        if !hints.is_empty() {
            let lang_names: Vec<String> = hints
                .iter()
                .map(|code| {
                    match code.as_str() {
                        "en" => "English",
                        "es" => "Spanish",
                        "fr" => "French",
                        "de" => "German",
                        "it" => "Italian",
                        "pt" => "Portuguese",
                        "ru" => "Russian",
                        "ja" => "Japanese",
                        "ko" => "Korean",
                        "zh" => "Chinese",
                        "ar" => "Arabic",
                        "hi" => "Hindi",
                        _ => code.as_str(),
                    }
                    .to_string()
                })
                .collect();
            Some(format!(
                "This audio may contain speech in {}. Transcribe accordingly.",
                lang_names.join(", ")
            ))
        } else {
            None
        }
    } else {
        None
    };

    if let Some(ref p) = prompt {
        eprintln!(
            "🦀 [transcribe_audio_local] Using language hint prompt: {}",
            p
        );
    }

    // Build command arguments with model, language, model directory, and optional prompt
    let mut args = vec![
        "run".to_string(),
        script_path_str.clone(),
        audio_path.clone(),
        format!("--model={}", model),
        format!("--model-dir={}", models_dir),
    ];

    // Add language argument if not auto
    if lang_param != "auto" {
        args.push(format!("--language={}", lang_param));
    }

    // Add prompt if generated from hints
    if let Some(p) = prompt {
        args.push(format!("--prompt={}", p));
    }

    eprintln!(
        "🦀 [transcribe_audio_local] Executing command: uv {}",
        args.join(" ")
    );

    // Call uv command to run our python script asynchronously
    let output = tokio::process::Command::new("uv")
        .env("PATH", augmented_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute uv transcription: {}", e))?;

    eprintln!(
        "🦀 [transcribe_audio_local] Command completed with status: {}",
        output.status
    );

    // Only delete the audio file if it is confirmed to be an internal temp file (in clypra-audio or system temp)
    let is_temp_audio = audio_path.contains("clypra-audio")
        || audio_path.starts_with(&std::env::temp_dir().to_string_lossy().to_string());
    if is_temp_audio {
        if let Err(e) = tokio::fs::remove_file(&audio_path).await {
            eprintln!(
                "⚠️ [transcribe_audio_local] Failed to clean up temporary audio file: {}",
                e
            );
        }
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        eprintln!("🦀 [transcribe_audio_local] Transcription failed!");
        eprintln!("  stdout: {}", stdout);
        eprintln!("  stderr: {}", stderr);
        return Err(format!("Whisper transcription failed: {}", stderr));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    eprintln!(
        "🦀 [transcribe_audio_local] Transcription successful, output length: {} bytes",
        stdout_str.len()
    );
    Ok(stdout_str.trim().to_string())
}

/// Waveform bucket containing both peak and RMS amplitude data.
/// Professional NLE approach: peak shows transients, RMS shows perceived loudness.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WaveformBucket {
    /// Peak amplitude (absolute max sample in bucket) - range [0.0, 1.0]
    pub peak: f32,
    /// RMS amplitude (root mean square energy) - range [0.0, 1.0]
    pub rms: f32,
}

/// Extract professional waveform data from audio file.
/// Computes both peak and RMS values for each pixel bucket.
/// Used for timeline waveform rendering with proper dynamic range visualization.
#[tauri::command]
pub async fn extract_waveform_data(
    path: String,
    num_buckets: usize,
    start_time: Option<f64>,
    duration: Option<f64>,
) -> Result<Vec<WaveformBucket>, String> {
    // Use ffmpeg to decode audio to raw PCM samples (mono, 16kHz for efficiency)
    let mut cmd = crate::commands::binary_resolver::create_std_command("ffmpeg");
    if let Some(start) = start_time.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-ss").arg(format!("{:.3}", start));
    }
    cmd.arg("-i").arg(&path);
    if let Some(len) = duration.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-t").arg(format!("{:.3}", len));
    }
    let output = cmd
        .args([
            "-f", "f32le", // 32-bit float PCM
            "-ac", "1", // Mono (mix to single channel)
            "-ar", "16000", // 16kHz sample rate (sufficient for visualization)
            "-",     // Output to stdout
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio decoding failed: {}", stderr));
    }

    // Zero-copy cast bytes to f32 samples using bytemuck
    let samples: &[f32] = bytemuck::cast_slice(&output.stdout);

    if samples.is_empty() {
        return Err("No audio samples extracted".to_string());
    }

    // Compute peak and RMS for each bucket in parallel
    let buckets = compute_waveform_buckets(samples, num_buckets);
    Ok(buckets)
}

/// Compute peak and RMS amplitudes for each pixel bucket using parallel chunk processing.
/// Professional audio analysis: peak captures transients, RMS captures energy.
fn compute_waveform_buckets(samples: &[f32], num_buckets: usize) -> Vec<WaveformBucket> {
    use rayon::prelude::*;

    if samples.is_empty() || num_buckets == 0 {
        return vec![
            WaveformBucket {
                peak: 0.0,
                rms: 0.0
            };
            num_buckets
        ];
    }

    let total_samples = samples.len();

    (0..num_buckets)
        .into_par_iter()
        .map(|i| {
            let start = (i * total_samples) / num_buckets;
            let end = (((i + 1) * total_samples) / num_buckets).min(total_samples);
            let bucket = if start < end {
                &samples[start..end]
            } else {
                &[]
            };

            let mut peak = 0.0f32;
            let mut sum_squares = 0.0f32;
            for &s in bucket {
                let abs_s = s.abs();
                if abs_s > peak {
                    peak = abs_s;
                }
                sum_squares += s * s;
            }
            let rms = if !bucket.is_empty() {
                (sum_squares / bucket.len() as f32).sqrt()
            } else {
                0.0
            };

            WaveformBucket { peak, rms }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_still_image_decode_preserves_alpha_and_exact_dimensions() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/clypra.png");
        let rgba = decode_image_rgba_bytes(
            fixture
                .to_str()
                .expect("repository fixture path should be valid UTF-8"),
            37,
            23,
        )
        .expect("RGBA PNG should decode natively");

        assert_eq!(rgba.len(), 37 * 23 * 4);
        assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] < 255));
    }

    #[test]
    fn test_browser_video_playability_rules() {
        assert!(is_browser_playable_video(Some("h264"), "mp4"));
        assert!(is_browser_playable_video(Some("avc1"), "mp4"));
        assert!(is_browser_playable_video(Some("hevc"), "mov"));
        assert!(is_browser_playable_video(Some("prores"), "mov"));
        assert!(is_browser_playable_video(Some("vp9"), "webm"));

        // Non-web codecs
        assert!(!is_browser_playable_video(Some("mpeg4"), "mp4"));
        assert!(!is_browser_playable_video(Some("wmv3"), "wmv"));
        assert!(!is_browser_playable_video(Some("flv1"), "flv"));

        #[cfg(target_os = "macos")]
        {
            if !crate::thumbnail_engine::decoder::VideoDecoder::macos_supports_hw_av1() {
                assert!(!is_browser_playable_video(Some("av1"), "mp4"));
                assert!(!can_stream_copy_video(Some("av1")));
            }
        }
        assert!(can_stream_copy_video(Some("h264")));
        assert!(can_stream_copy_video(Some("hevc")));
        assert!(!can_stream_copy_video(Some("mpeg4")));
    }

    #[tokio::test]
    async fn test_probe_video_codec_on_av1_asset() {
        let path = "/Users/AIEraDev/Documents/clypra-testing-assets/54M views · 868K reactions ｜ Guest arrivals at the Guinness World Record Attempt and Birthday Party of @djprettyplay last night ｜ Oga Yenne TV [974631751768961].mp4";
        if std::path::Path::new(path).exists() {
            let codec = probe_video_codec(path).await;
            assert_eq!(codec.as_deref(), Some("av1"));
            #[cfg(target_os = "macos")]
            if !crate::thumbnail_engine::decoder::VideoDecoder::macos_supports_hw_av1() {
                assert!(!is_browser_playable_video(codec.as_deref(), "mp4"));
                assert!(!can_stream_copy_video(codec.as_deref()));
            }
        }
    }
}
