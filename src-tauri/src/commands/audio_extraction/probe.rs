use super::models::{AudioExtractionRequest, MediaStreamInfo};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Run ffprobe on the given path and return the raw JSON output.
pub(super) async fn probe_json(path: &str) -> Result<serde_json::Value, String> {
    let output = crate::commands::binary_resolver::create_async_command("ffprobe")
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid ffprobe response: {e}"))
}

/// Parse the ffprobe JSON value into a list of `MediaStreamInfo` entries,
/// annotating each stream with device origin, VFR detection, and risk factors.
pub(super) fn parse_streams(value: &serde_json::Value) -> Vec<MediaStreamInfo> {
    let check_tag_pair = |mfg: Option<&str>, mdl: Option<&str>| -> (Option<String>, Option<String>) {
        let mfg_lower = mfg.unwrap_or("").to_lowercase();
        let mdl_lower = mdl.unwrap_or("").to_lowercase();
        if mfg_lower.contains("google") || mdl_lower.contains("pixel") {
            (Some("google-pixel".to_string()), mdl.map(|s| s.to_string()))
        } else if mfg_lower.contains("apple") || mdl_lower.contains("iphone") {
            (Some("apple-iphone".to_string()), mdl.map(|s| s.to_string()))
        } else if mfg_lower.contains("samsung") || mdl_lower.contains("galaxy") {
            (Some("samsung-galaxy".to_string()), mdl.map(|s| s.to_string()))
        } else if mfg_lower.contains("sony") {
            (Some("sony-camera".to_string()), mdl.map(|s| s.to_string()))
        } else if mfg_lower.contains("dji") {
            (Some("dji-drone".to_string()), mdl.map(|s| s.to_string()))
        } else if mfg_lower.contains("gopro") {
            (Some("gopro".to_string()), mdl.map(|s| s.to_string()))
        } else {
            (None, None)
        }
    };

    let mut format_device_origin: Option<String> = None;
    let mut format_device_model: Option<String> = None;
    if let Some(tags) = value.get("format").and_then(|f| f.get("tags")) {
        let mfg = tags
            .get("com.android.manufacturer")
            .or_else(|| tags.get("make"))
            .and_then(|v| v.as_str());
        let mdl = tags
            .get("com.android.model")
            .or_else(|| tags.get("model"))
            .or_else(|| tags.get("com.google.android.videos.device"))
            .and_then(|v| v.as_str());
        let (orig, model) = check_tag_pair(mfg, mdl);
        format_device_origin = orig;
        format_device_model = model;
    }

    let parse_fraction = |s: Option<&str>| -> Option<f64> {
        let s = s?;
        let mut parts = s.split('/');
        let num: f64 = parts.next()?.parse().ok()?;
        let den: f64 = parts.next()?.parse().ok()?;
        if den == 0.0 {
            None
        } else {
            Some(num / den)
        }
    };

    value
        .get("streams")
        .and_then(|v| v.as_array())
        .map(|streams| {
            streams
                .iter()
                .filter_map(|stream| {
                    let index = stream.get("index")?.as_u64()? as u32;
                    let stream_type = stream.get("codec_type")?.as_str()?.to_string();
                    let codec = stream
                        .get("codec_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let parse_rate = |key: &str| {
                        stream
                            .get(key)
                            .and_then(|v| v.as_str())
                            .and_then(|v| v.parse::<u32>().ok())
                    };
                    let (time_base_num, time_base_den) = stream
                        .get("time_base")
                        .and_then(|v| v.as_str())
                        .and_then(|v| {
                            let mut parts = v.split('/');
                            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
                        })
                        .unwrap_or((0, 1));

                    let width = stream.get("width").and_then(|v| v.as_u64()).map(|v| v as u32);
                    let height = stream.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);
                    let r_frame_rate = stream.get("r_frame_rate").and_then(|v| v.as_str()).map(str::to_string);
                    let avg_frame_rate = stream.get("avg_frame_rate").and_then(|v| v.as_str()).map(str::to_string);
                    let pix_fmt = stream.get("pix_fmt").and_then(|v| v.as_str()).map(str::to_string);
                    let color_space = stream.get("color_space").and_then(|v| v.as_str()).map(str::to_string);
                    let color_transfer = stream.get("color_transfer").and_then(|v| v.as_str()).map(str::to_string);
                    let color_primaries = stream.get("color_primaries").and_then(|v| v.as_str()).map(str::to_string);

                    let mut device_origin = format_device_origin.clone();
                    let mut device_model = format_device_model.clone();
                    if device_origin.is_none() {
                        if let Some(stags) = stream.get("tags") {
                            let mfg = stags
                                .get("com.android.manufacturer")
                                .or_else(|| stags.get("make"))
                                .and_then(|v| v.as_str());
                            let mdl = stags
                                .get("com.android.model")
                                .or_else(|| stags.get("model"))
                                .and_then(|v| v.as_str());
                            let (orig, model) = check_tag_pair(mfg, mdl);
                            if orig.is_some() {
                                device_origin = orig;
                                device_model = model;
                            }
                        }
                    }

                    let is_vfr = if stream_type == "video" {
                        let r_fps = parse_fraction(r_frame_rate.as_deref());
                        let avg_fps = parse_fraction(avg_frame_rate.as_deref());
                        match (r_fps, avg_fps) {
                            (Some(rf), Some(af)) if (rf - af).abs() > 0.08 => Some(true),
                            _ => None,
                        }
                    } else {
                        None
                    };

                    let is_10bit = pix_fmt.as_ref().map(|p| p.contains("10") || p.contains("p010")).unwrap_or(false);
                    let is_hdr = color_transfer.as_ref().map(|t| t.contains("arib") || t.contains("smpte2084") || t.contains("hlg")).unwrap_or(false);
                    let is_pixel = device_origin.as_deref() == Some("google-pixel");

                    let mut risk_factors = Vec::new();
                    if is_pixel {
                        risk_factors.push("google-pixel-camera-source".to_string());
                    }
                    if is_vfr == Some(true) {
                        risk_factors.push("variable-frame-rate".to_string());
                        if is_pixel {
                            risk_factors.push("google-pixel-vfr-timing-instability".to_string());
                        }
                    }
                    if is_10bit {
                        risk_factors.push("hevc-10bit-hardware-decode".to_string());
                        if is_pixel {
                            risk_factors.push("google-pixel-10bit-hevc-seek-stall".to_string());
                        }
                    }
                    if is_hdr {
                        risk_factors.push("hdr-color-transfer".to_string());
                    }
                    if let (Some(w), Some(h)) = (width, height) {
                        if w >= 3840 || h >= 2160 {
                            risk_factors.push("4k-high-resolution-throughput".to_string());
                        }
                    }

                    let is_high_risk = if is_pixel || (is_vfr == Some(true) && (is_10bit || width.unwrap_or(0) >= 3840)) {
                        Some(true)
                    } else if !risk_factors.is_empty() {
                        Some(false)
                    } else {
                        None
                    };

                    let risk_factors_opt = if risk_factors.is_empty() {
                        None
                    } else {
                        Some(risk_factors)
                    };

                    Some(MediaStreamInfo {
                        index,
                        stream_type,
                        codec,
                        codec_long_name: stream
                            .get("codec_long_name")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        duration: stream
                            .get("duration")
                            .and_then(|v| v.as_str())
                            .and_then(|v| v.parse().ok()),
                        time_base_num: Some(time_base_num),
                        time_base_den: Some(time_base_den),
                        sample_rate: parse_rate("sample_rate"),
                        channels: stream
                            .get("channels")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u16),
                        channel_layout: stream
                            .get("channel_layout")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        bitrate: stream
                            .get("bit_rate")
                            .and_then(|v| v.as_str())
                            .and_then(|v| v.parse().ok()),
                        language: stream
                            .get("tags")
                            .and_then(|v| v.get("language"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        label: stream
                            .get("tags")
                            .and_then(|v| v.get("title"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        width,
                        height,
                        r_frame_rate,
                        avg_frame_rate,
                        pix_fmt,
                        color_space,
                        color_transfer,
                        color_primaries,
                        device_origin,
                        device_model,
                        is_vfr,
                        is_high_risk,
                        risk_factors: risk_factors_opt,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Determine the extraction method, output container, and encoder for a given
/// stream and request. Returns `(method, container, encoder)`.
pub(super) fn plan_output(
    stream: &MediaStreamInfo,
    request: &AudioExtractionRequest,
) -> Result<(String, String, String), String> {
    let codec = request
        .output_codec
        .clone()
        .unwrap_or_else(|| stream.codec.clone())
        .to_lowercase();
    let requested_codec_matches = request
        .output_codec
        .as_deref()
        .map(|requested| requested.eq_ignore_ascii_case(&stream.codec))
        .unwrap_or(true);
    let copy_compatible = requested_codec_matches
        && matches!(
            stream.codec.to_lowercase().as_str(),
            "aac" | "mp3" | "opus" | "flac" | "pcm_s16le" | "pcm_s24le" | "pcm_s32le"
        );
    let requested_copy = request.mode.eq_ignore_ascii_case("streamCopy")
        || request.mode.eq_ignore_ascii_case("stream_copy");
    let transcode =
        request.mode.eq_ignore_ascii_case("transcode") || (!requested_copy && !copy_compatible);
    if requested_copy && !copy_compatible {
        return Err(format!("Stream-copy is not supported for codec {codec}"));
    }
    let method = if transcode { "transcode" } else { "streamCopy" }.to_string();
    let container = request.output_container.clone().unwrap_or_else(|| {
        match codec.as_str() {
            "aac" => "m4a",
            "mp3" => "mp3",
            "opus" => "webm",
            "flac" => "flac",
            "pcm_s16le" | "pcm_s24le" | "pcm_s32le" => "wav",
            _ => "m4a",
        }
        .to_string()
    });
    let encoder = if transcode {
        request.output_codec.clone().unwrap_or_else(|| {
            if codec == "opus" {
                "libopus".to_string()
            } else {
                "aac".to_string()
            }
        })
    } else {
        "copy".to_string()
    };
    Ok((method, container, encoder))
}

/// Stable SHA-256 fingerprint of an extraction operation, used as a cache key.
pub(super) fn fingerprint(
    request: &AudioExtractionRequest,
    method: &str,
    container: &str,
    encoder: &str,
) -> String {
    let input = format!(
        "{}\0{}\0{}\0{}\0{}\0{}",
        request.source_asset_id,
        request.source_stream_index,
        request.mode.to_lowercase(),
        encoder,
        container,
        method
    );
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Verify an output file exists and contains at least one audio stream.
pub(super) async fn validate_audio_file(path: &Path) -> Result<Vec<MediaStreamInfo>, String> {
    if !path.is_file() {
        return Err("Extraction output is missing".to_string());
    }
    let value = probe_json(path.to_string_lossy().as_ref()).await?;
    let streams = parse_streams(&value);
    if !streams.iter().any(|stream| stream.stream_type == "audio") {
        return Err("Extraction output contains no audio stream".to_string());
    }
    Ok(streams)
}

/// Probe the streams of a media file — Tauri command surface.
#[tauri::command]
pub async fn probe_media_streams(path: String) -> Result<Vec<MediaStreamInfo>, String> {
    Ok(parse_streams(&probe_json(&path).await?))
}
