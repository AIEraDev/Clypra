use base64::Engine;
use image::{ColorType, DynamicImage, ImageBuffer, ImageEncoder, ImageFormat, Rgba};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportThumbnailPayload {
    /// Base64 data URL (e.g. "data:image/png;base64,...") or raw base64 encoded bytes.
    pub data_url: Option<String>,
    /// Raw RGBA pixel bytes if not passing a data_url.
    pub rgba_bytes: Option<Vec<u8>>,
    /// Width in pixels (required if passing rgba_bytes).
    pub width: Option<u32>,
    /// Height in pixels (required if passing rgba_bytes).
    pub height: Option<u32>,
    /// Absolute target file path to save the thumbnail image to.
    pub output_path: String,
    /// Format: "png" | "jpeg" | "webp" (defaults to inferring from output_path extension or "png").
    pub format: Option<String>,
    /// Quality (1-100) for JPEG or WebP (default: 90).
    pub quality: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportThumbnailResult {
    pub output_path: String,
    pub bytes_written: usize,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

/// Export and save a creator thumbnail to the filesystem.
/// Supports both pre-rendered Canvas Data URLs (PNG/JPEG) and raw RGBA pixel buffers.
#[tauri::command]
pub async fn export_creator_thumbnail(
    payload: ExportThumbnailPayload,
) -> Result<ExportThumbnailResult, String> {
    let out_path = Path::new(&payload.output_path);

    // Ensure parent directory exists
    if let Some(parent) = out_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination directory: {}", e))?;
        }
    }

    // Determine target format
    let target_format_str = payload
        .format
        .as_deref()
        .or_else(|| {
            out_path
                .extension()
                .and_then(|ext| ext.to_str())
        })
        .unwrap_or("png")
        .to_lowercase();

    let (image_format, canonical_format) = match target_format_str.as_str() {
        "jpg" | "jpeg" => (ImageFormat::Jpeg, "jpeg"),
        "webp" => (ImageFormat::WebP, "webp"),
        _ => (ImageFormat::Png, "png"),
    };

    let quality = payload.quality.unwrap_or(90).clamp(1, 100);

    // Case 1: Raw RGBA pixel buffer
    if let Some(rgba) = payload.rgba_bytes {
        let width = payload
            .width
            .ok_or_else(|| "Width is required when exporting raw RGBA bytes".to_string())?;
        let height = payload
            .height
            .ok_or_else(|| "Height is required when exporting raw RGBA bytes".to_string())?;

        let expected_len = (width as usize) * (height as usize) * 4;
        if rgba.len() != expected_len {
            return Err(format!(
                "RGBA byte length mismatch: got {}, expected {} for {}x{}",
                rgba.len(),
                expected_len,
                width,
                height
            ));
        }

        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, rgba)
                .ok_or_else(|| "Failed to construct image buffer from RGBA data".to_string())?;
        let dynamic_img = DynamicImage::ImageRgba8(img_buffer);

        let mut encoded = Vec::new();
        match image_format {
            ImageFormat::Jpeg => {
                let rgb_img = dynamic_img.to_rgb8();
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, quality);
                encoder
                    .encode(
                        rgb_img.as_raw(),
                        width,
                        height,
                        ColorType::Rgb8.into(),
                    )
                    .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
            }
            ImageFormat::Png => {
                let encoder = image::codecs::png::PngEncoder::new(&mut encoded);
                encoder
                    .write_image(
                        dynamic_img.as_bytes(),
                        width,
                        height,
                        ColorType::Rgba8.into(),
                    )
                    .map_err(|e| format!("Failed to encode PNG: {}", e))?;
            }
            _ => {
                dynamic_img
                    .write_to(&mut Cursor::new(&mut encoded), image_format)
                    .map_err(|e| format!("Failed to encode image: {}", e))?;
            }
        }

        fs::write(out_path, &encoded)
            .map_err(|e| format!("Failed to write thumbnail file: {}", e))?;

        return Ok(ExportThumbnailResult {
            output_path: payload.output_path,
            bytes_written: encoded.len(),
            width,
            height,
            format: canonical_format.to_string(),
        });
    }

    // Case 2: Base64 Data URL or raw base64 string
    if let Some(data_url) = payload.data_url {
        let b64_str = if let Some(idx) = data_url.find(";base64,") {
            &data_url[idx + 8..]
        } else if let Some(stripped) = data_url.strip_prefix("data:") {
            if let Some(comma_idx) = stripped.find(',') {
                &stripped[comma_idx + 1..]
            } else {
                &data_url
            }
        } else {
            &data_url
        };

        let raw_bytes = base64::engine::general_purpose::STANDARD
            .decode(b64_str.trim())
            .map_err(|e| format!("Failed to decode base64 thumbnail data: {}", e))?;

        // Load image to verify dimensions and convert format if needed
        let img = image::load_from_memory(&raw_bytes)
            .map_err(|e| format!("Failed to decode image from data URL: {}", e))?;

        let width = img.width();
        let height = img.height();

        let mut encoded = Vec::new();
        match image_format {
            ImageFormat::Jpeg => {
                let rgb_img = img.to_rgb8();
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, quality);
                encoder
                    .encode(
                        rgb_img.as_raw(),
                        width,
                        height,
                        ColorType::Rgb8.into(),
                    )
                    .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
            }
            ImageFormat::Png => {
                let encoder = image::codecs::png::PngEncoder::new(&mut encoded);
                encoder
                    .write_image(
                        img.as_bytes(),
                        width,
                        height,
                        ColorType::Rgba8.into(),
                    )
                    .map_err(|e| format!("Failed to encode PNG: {}", e))?;
            }
            _ => {
                img.write_to(&mut Cursor::new(&mut encoded), image_format)
                    .map_err(|e| format!("Failed to encode image: {}", e))?;
            }
        }

        fs::write(out_path, &encoded)
            .map_err(|e| format!("Failed to write thumbnail to disk: {}", e))?;

        return Ok(ExportThumbnailResult {
            output_path: payload.output_path,
            bytes_written: encoded.len(),
            width,
            height,
            format: canonical_format.to_string(),
        });
    }

    Err("Either dataUrl or rgbaBytes must be provided to export_creator_thumbnail".to_string())
}
