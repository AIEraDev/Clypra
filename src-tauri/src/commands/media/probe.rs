use std::fs;

use base64::Engine;
use crate::models::{MediaMetadata, VideoMetadata};
use crate::filmstrip_engine::decoder::{get_decoder, VideoStreamMetadata};

use super::path::normalize_file_path;

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
        log::debug!(
            "🦀 [get_media_metadata] [{}] Probed in {:?} ({}x{}, {:.2}s)",
            filename,
            start.elapsed(),
            meta.width,
            meta.height,
            meta.duration
        );
    } else if let Err(ref e) = result {
        log::debug!(
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

pub fn decode_image_rgba_bytes(
    path: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let image = if path.starts_with("data:image/") || path.starts_with("data:") {
        let b64_str = if let Some(idx) = path.find(";base64,") {
            &path[idx + 8..]
        } else if let Some(idx) = path.find(',') {
            &path[idx + 1..]
        } else {
            path
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64_str.trim())
            .map_err(|e| format!("Failed to decode base64 data URL: {}", e))?;
        image::load_from_memory(&bytes)
            .map_err(|error| format!("Failed to decode image from memory: {}", error))?
            .to_rgba8()
    } else {
        image::open(path)
            .map_err(|error| format!("Failed to decode still image {}: {}", path, error))?
            .to_rgba8()
    };
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
pub(super) async fn get_image_metadata(path: &str) -> Result<MediaMetadata, String> {
    use image::GenericImageView;

    log::debug!("🦀 [get_image_metadata] Loading image: {}", path);

    let img = image::open(path).map_err(|e| format!("Failed to open image: {}", e))?;

    let (width, height) = img.dimensions();

    let has_alpha = matches!(
        img.color(),
        image::ColorType::La8
            | image::ColorType::La16
            | image::ColorType::Rgba8
            | image::ColorType::Rgba16
            | image::ColorType::Rgba32F
    );

    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    log::debug!(
        "🦀 [get_image_metadata] Dimensions: {}×{}, Alpha: {}",
        width,
        height,
        has_alpha
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
pub(super) async fn get_video_metadata_internal(path: &str) -> Result<MediaMetadata, String> {
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

            log::debug!(
                "🦀 [get_video_metadata_internal] Display dimensions: {}×{}, Rotation: {}°",
                width,
                height,
                rotation
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
    log::debug!("⚠️  DEPRECATED: get_video_metadata called, use get_media_metadata instead");
    get_video_metadata_internal(&path).await
}

pub(super) async fn get_audio_duration(path: &str) -> Result<f64, String> {
    log::debug!(
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
            log::debug!("[get_audio_duration] Failed to run ffprobe: {}", e);
            format!("Failed to run ffprobe: {}", e)
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::debug!("[get_audio_duration] ffprobe failed: {}", stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    log::debug!("[get_audio_duration] ffprobe output: {}", duration_str);

    let duration = duration_str.trim().parse::<f64>().map_err(|e| {
        log::debug!(
            "[get_audio_duration] Failed to parse duration '{}': {}",
            duration_str,
            e
        );
        format!("Failed to parse duration: {}", e)
    })?;

    log::debug!(
        "[get_audio_duration] Successfully parsed duration: {}s",
        duration
    );
    Ok(duration)
}
