use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::codecs::webp::WebPEncoder;

use crate::filmstrip_engine::decoder::get_decoder;
use crate::filmstrip_engine::geometry::fit_preserving_aspect;

/// Extract a representative poster frame for clip representation in the media pool.
/// Uses a professional NLE heuristic: 15% into the video, floor at 1.0s (skips black frames),
/// cap at 30.0s (long intros don't represent content).
///
/// Formula: poster_time = clamp(duration * 0.15, 1.0, 30.0)
#[tauri::command]
pub async fn extract_poster_frame_command(
    video_path: String,
    duration: f64,
    dpr: f64,
) -> Result<String, String> {
    let total_start = std::time::Instant::now();
    let filename = std::path::Path::new(&video_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&video_path);

    // Professional thumbnail heuristic:
    // 15% into video, never < 1.0s (first GOP / black frames), never > 30.0s
    let poster_time = (duration * 0.15).clamp(1.0, 30.0);

    // Target max dimension for longest edge
    let max_size: u32 = if dpr >= 1.5 { 320 } else { 160 };

    let native_res = async {
        let decoder_arc = get_decoder(&video_path).await?;
        let mut decoder = decoder_arc.lock().await;

        // Get TRUE display dimensions (respects SAR + rotation)
        let (display_w, display_h) = decoder.display_dimensions();

        // Fit display dimensions to max_size (preserving aspect ratio)
        let (fit_w, fit_h) = fit_preserving_aspect(display_w, display_h, max_size, max_size);

        // Fast keyframe decode avoids GOP walk
        let bytes = decoder.decode_keyframe_frame(poster_time, fit_w, fit_h)?;
        Ok::<_, String>((bytes, fit_w, fit_h))
    }
    .await;

    match native_res {
        Ok((rgba_bytes, out_w, out_h)) => {
            // Encode RGBA to WebP
            let encode_start = std::time::Instant::now();
            let mut webp_data = Vec::new();
            let encoder = WebPEncoder::new_lossless(&mut webp_data);
            encoder
                .encode(&rgba_bytes, out_w, out_h, image::ExtendedColorType::Rgba8)
                .map_err(|e| format!("WebP encode failed: {}", e))?;

            let encode_ms = encode_start.elapsed().as_millis();
            let total_ms = total_start.elapsed().as_millis();

            log::debug!(
                "[extract_poster] [{}] total={}ms (webp_encode={}ms, size={}x{})",
                filename,
                total_ms,
                encode_ms,
                out_w,
                out_h
            );

            // Convert to base64 data URL
            let base64_data = BASE64.encode(&webp_data);
            Ok(format!("data:image/webp;base64,{}", base64_data))
        }
        Err(native_err) => {
            log::warn!(
                "[extract_poster] Native decode failed for {}: {}; attempting CLI fallback",
                filename,
                native_err
            );
            extract_poster_frame_cli(&video_path, poster_time, max_size).await
        }
    }
}

pub(crate) async fn extract_poster_frame_cli(
    video_path: &str,
    poster_time: f64,
    max_size: u32,
) -> Result<String, String> {
    let scale_filter = format!("scale='min({max_size},iw)':-1:flags=lanczos");
    let output = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args([
            "-ss",
            &format!("{:.3}", poster_time),
            "-i",
            video_path,
            "-vframes",
            "1",
            "-vf",
            &scale_filter,
            "-c:v",
            "webp",
            "-f",
            "image2pipe",
            "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg CLI failed to spawn: {e}"))?;

    if output.status.success() && !output.stdout.is_empty() {
        let base64_data = BASE64.encode(&output.stdout);
        return Ok(format!("data:image/webp;base64,{}", base64_data));
    }

    // Fallback: extract first video frame or attached picture (cover art)
    let output_cover = crate::commands::binary_resolver::create_async_command("ffmpeg")
        .args([
            "-i",
            video_path,
            "-map",
            "0:v:0",
            "-vframes",
            "1",
            "-vf",
            &scale_filter,
            "-c:v",
            "webp",
            "-f",
            "image2pipe",
            "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg CLI fallback failed to spawn: {e}"))?;

    if output_cover.status.success() && !output_cover.stdout.is_empty() {
        let base64_data = BASE64.encode(&output_cover.stdout);
        return Ok(format!("data:image/webp;base64,{}", base64_data));
    }

    Err(format!(
        "Failed to extract poster frame via CLI (exit: {:?}, stderr: {})",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    ))
}

pub(crate) fn encode_rgba_to_webp_data_url(
    rgba_bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(rgba_bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encoding failed: {}", e))?;

    // Encode to base64 data URL
    let base64_data = BASE64.encode(&webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}
