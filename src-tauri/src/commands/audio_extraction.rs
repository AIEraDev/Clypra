use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaStreamInfo {
    pub index: u32,
    #[serde(rename = "type")]
    pub stream_type: String,
    pub codec: String,
    pub codec_long_name: Option<String>,
    pub duration: Option<f64>,
    pub time_base_num: Option<i64>,
    pub time_base_den: Option<i64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub channel_layout: Option<String>,
    pub bitrate: Option<u64>,
    pub language: Option<String>,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r_frame_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avg_frame_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pix_fmt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_transfer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_primaries: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_vfr: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_high_risk: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_factors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExtractionRequest {
    pub source_asset_id: String,
    pub source_path: String,
    pub source_stream_index: u32,
    #[serde(default = "default_mode")]
    pub mode: String,
    pub output_codec: Option<String>,
    pub output_container: Option<String>,
}

fn default_mode() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJobUpdate {
    pub job_id: String,
    pub operation: String,
    pub state: String,
    pub progress: Option<f32>,
    pub resulting_asset_id: Option<String>,
    pub error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedMediaAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub media_type: String,
    pub duration: f64,
    pub size: u64,
    pub streams: Vec<MediaStreamInfo>,
    pub source_asset_id: String,
    pub source_stream_index: u32,
    pub extraction_method: String,
    pub operation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJobResult {
    pub job_id: String,
    pub state: String,
    pub asset: Option<ExtractedMediaAsset>,
    pub error_summary: Option<String>,
}

struct JobRecord {
    cancellation: CancellationToken,
    result: Option<MediaJobResult>,
}

static MEDIA_JOBS: Lazy<Arc<Mutex<HashMap<String, JobRecord>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

async fn probe_json(path: &str) -> Result<serde_json::Value, String> {
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

fn parse_streams(value: &serde_json::Value) -> Vec<MediaStreamInfo> {
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

#[tauri::command]
pub async fn probe_media_streams(path: String) -> Result<Vec<MediaStreamInfo>, String> {
    Ok(parse_streams(&probe_json(&path).await?))
}

fn plan_output(
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

fn fingerprint(
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

async fn emit_update(app: &tauri::AppHandle, update: MediaJobUpdate) {
    let _ = app.emit("media_job_update", update);
}

async fn validate_audio_file(path: &Path) -> Result<Vec<MediaStreamInfo>, String> {
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

async fn run_extraction(
    app: tauri::AppHandle,
    job_id: String,
    request: AudioExtractionRequest,
    cancellation: CancellationToken,
) {
    let finish =
        |state: &str, asset: Option<ExtractedMediaAsset>, error: Option<String>| MediaJobResult {
            job_id: job_id.clone(),
            state: state.to_string(),
            asset,
            error_summary: error,
        };
    let result = async {
        let probe = probe_json(&request.source_path).await?;
        let stream = parse_streams(&probe).into_iter().find(|candidate| candidate.index == request.source_stream_index && candidate.stream_type == "audio")
            .ok_or_else(|| format!("Audio stream {} was not found", request.source_stream_index))?;
        let (method, container, encoder) = plan_output(&stream, &request)?;
        let fingerprint = fingerprint(&request, &method, &container, &encoder);
        let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("media-cache").join("audio");
        tokio::fs::create_dir_all(&cache_dir).await.map_err(|e| format!("Failed to create media cache: {e}"))?;
        let final_path = cache_dir.join(format!("{fingerprint}.{container}"));
        let partial_path = cache_dir.join(format!("{fingerprint}.{container}.partial"));
        let asset_id = format!("asset-derived-{fingerprint}");

        let output_streams = if final_path.is_file() { validate_audio_file(&final_path).await.unwrap_or_default() } else { Vec::new() };
        if !output_streams.is_empty() {
            let duration = output_streams.iter().find(|s| s.stream_type == "audio").and_then(|s| s.duration).or(stream.duration).unwrap_or(0.0);
            return Ok(ExtractedMediaAsset { id: asset_id, name: format!("{} Audio", Path::new(&request.source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("Extracted")), path: final_path.to_string_lossy().to_string(), media_type: "audio".to_string(), duration, size: tokio::fs::metadata(&final_path).await.map(|m| m.len()).unwrap_or(0), streams: output_streams, source_asset_id: request.source_asset_id, source_stream_index: request.source_stream_index, extraction_method: method, operation_fingerprint: fingerprint });
        }

        let mut command = crate::commands::binary_resolver::create_async_command("ffmpeg");
        command.args(["-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", &request.source_path, "-map", &format!("0:{}", request.source_stream_index), "-vn"]);
        if method == "streamCopy" { command.args(["-c:a", "copy"]); } else { command.args(["-c:a", &encoder]); }
        command.args(["-map_metadata", "0", "-y", partial_path.to_string_lossy().as_ref()]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        let mut child = command.spawn().map_err(|e| format!("Failed to start FFmpeg: {e}"))?;
        let stdout = child.stdout.take().ok_or_else(|| "FFmpeg progress pipe unavailable".to_string())?;
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        loop {
            tokio::select! {
                _ = cancellation.cancelled() => {
                    let _ = child.kill().await;
                    let _ = tokio::fs::remove_file(&partial_path).await;
                    return Err("cancelled".to_string());
                }
                read = reader.read_line(&mut line) => {
                    let count = read.map_err(|e| format!("Failed to read FFmpeg progress: {e}"))?;
                    if count == 0 { break; }
                    if let Some(value) = line.strip_prefix("out_time_ms=").and_then(|v| v.trim().parse::<f64>().ok()) {
                        if last_emit.elapsed() >= Duration::from_millis(50) {
                            let progress = stream.duration.map(|duration| ((value / 1_000_000.0) / duration).clamp(0.0, 0.99) as f32);
                            emit_update(&app, MediaJobUpdate { job_id: job_id.clone(), operation: "audioExtraction".to_string(), state: "running".to_string(), progress, resulting_asset_id: None, error_summary: None }).await;
                            last_emit = Instant::now();
                        }
                    }
                    line.clear();
                }
            }
        }
        let status = child.wait().await.map_err(|e| format!("Failed waiting for FFmpeg: {e}"))?;
        if !status.success() { let _ = tokio::fs::remove_file(&partial_path).await; return Err("FFmpeg extraction failed".to_string()); }
        let streams = validate_audio_file(&partial_path).await?;
        tokio::fs::rename(&partial_path, &final_path).await.map_err(|e| format!("Failed to promote extracted media: {e}"))?;
        let duration = streams.iter().find(|s| s.stream_type == "audio").and_then(|s| s.duration).or(stream.duration).unwrap_or(0.0);
        Ok(ExtractedMediaAsset { id: asset_id, name: format!("{} Audio", Path::new(&request.source_path).file_stem().and_then(|s| s.to_str()).unwrap_or("Extracted")), path: final_path.to_string_lossy().to_string(), media_type: "audio".to_string(), duration, size: tokio::fs::metadata(&final_path).await.map(|m| m.len()).unwrap_or(0), streams, source_asset_id: request.source_asset_id, source_stream_index: request.source_stream_index, extraction_method: method, operation_fingerprint: fingerprint })
    }.await;

    let (state, asset, error) = match result {
        Ok(asset) => ("completed", Some(asset), None),
        Err(error) if error == "cancelled" => ("cancelled", None, None),
        Err(error) => ("failed", None, Some(error)),
    };
    let job_result = finish(state, asset.clone(), error.clone());
    MEDIA_JOBS
        .lock()
        .await
        .entry(job_id.clone())
        .and_modify(|job| job.result = Some(job_result));
    emit_update(
        &app,
        MediaJobUpdate {
            job_id,
            operation: "audioExtraction".to_string(),
            state: state.to_string(),
            progress: if state == "completed" {
                Some(1.0)
            } else {
                None
            },
            resulting_asset_id: asset.map(|a| a.id),
            error_summary: error,
        },
    )
    .await;
}

#[tauri::command]
pub async fn start_audio_extraction(
    app: tauri::AppHandle,
    request: AudioExtractionRequest,
) -> Result<String, String> {
    let job_id = format!("media-job-{}", uuid::Uuid::new_v4());
    let cancellation = CancellationToken::new();
    MEDIA_JOBS.lock().await.insert(
        job_id.clone(),
        JobRecord {
            cancellation: cancellation.clone(),
            result: None,
        },
    );
    emit_update(
        &app,
        MediaJobUpdate {
            job_id: job_id.clone(),
            operation: "audioExtraction".to_string(),
            state: "queued".to_string(),
            progress: Some(0.0),
            resulting_asset_id: None,
            error_summary: None,
        },
    )
    .await;
    tauri::async_runtime::spawn(run_extraction(app, job_id.clone(), request, cancellation));
    Ok(job_id)
}

#[tauri::command]
pub async fn cancel_media_job(job_id: String) -> Result<(), String> {
    let jobs = MEDIA_JOBS.lock().await;
    jobs.get(&job_id)
        .map(|job| job.cancellation.cancel())
        .ok_or_else(|| "Media job not found".to_string())
}

#[tauri::command]
pub async fn get_media_job_result(job_id: String) -> Result<Option<MediaJobResult>, String> {
    Ok(MEDIA_JOBS
        .lock()
        .await
        .get(&job_id)
        .and_then(|job| job.result.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(codec: &str) -> MediaStreamInfo {
        MediaStreamInfo {
            index: 2,
            stream_type: "audio".to_string(),
            codec: codec.to_string(),
            codec_long_name: None,
            duration: Some(4.0),
            time_base_num: Some(1),
            time_base_den: Some(48_000),
            sample_rate: Some(48_000),
            channels: Some(2),
            channel_layout: Some("stereo".to_string()),
            bitrate: None,
            language: None,
            label: None,
            ..Default::default()
        }
    }

    #[test]
    fn plans_copy_containers_for_editor_codecs() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        assert_eq!(
            plan_output(&stream("aac"), &request).unwrap().0,
            "streamCopy"
        );
        assert_eq!(plan_output(&stream("aac"), &request).unwrap().1, "m4a");
        assert_eq!(plan_output(&stream("mp3"), &request).unwrap().1, "mp3");
        assert_eq!(plan_output(&stream("opus"), &request).unwrap().1, "webm");
        assert_eq!(plan_output(&stream("flac"), &request).unwrap().1, "flac");
    }

    #[test]
    fn unsupported_auto_codec_falls_back_to_transcode() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        let (method, container, encoder) = plan_output(&stream("ac3"), &request).unwrap();
        assert_eq!(method, "transcode");
        assert_eq!(container, "m4a");
        assert_eq!(encoder, "aac");
    }

    #[test]
    fn fingerprint_is_deterministic_and_stream_specific() {
        let request = AudioExtractionRequest {
            source_asset_id: "asset".into(),
            source_path: "source.mp4".into(),
            source_stream_index: 2,
            mode: "auto".into(),
            output_codec: None,
            output_container: None,
        };
        let first = fingerprint(&request, "streamCopy", "m4a", "copy");
        let second = fingerprint(&request, "streamCopy", "m4a", "copy");
        assert_eq!(first, second);
        let mut other = request.clone();
        other.source_stream_index = 3;
        assert_ne!(first, fingerprint(&other, "streamCopy", "m4a", "copy"));
    }

    #[test]
    fn parse_streams_detects_google_pixel_vfr_and_high_risk() {
        let json_str = r#"{
            "format": {
                "tags": {
                    "com.android.manufacturer": "Google",
                    "com.android.model": "Pixel 7 Pro"
                }
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "hevc",
                    "width": 3840,
                    "height": 2160,
                    "r_frame_rate": "60/1",
                    "avg_frame_rate": "58.42/1",
                    "pix_fmt": "yuv420p10le",
                    "color_space": "bt2020nc",
                    "color_transfer": "arib-std-b67"
                }
            ]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let streams = parse_streams(&v);
        assert_eq!(streams.len(), 1);
        let s = &streams[0];
        assert_eq!(s.device_origin.as_deref(), Some("google-pixel"));
        assert_eq!(s.device_model.as_deref(), Some("Pixel 7 Pro"));
        assert_eq!(s.is_vfr, Some(true));
        assert_eq!(s.is_high_risk, Some(true));
        let risks = s.risk_factors.as_ref().unwrap();
        assert!(risks.contains(&"google-pixel-camera-source".to_string()));
        assert!(risks.contains(&"google-pixel-vfr-timing-instability".to_string()));
        assert!(risks.contains(&"google-pixel-10bit-hevc-seek-stall".to_string()));
    }

    #[test]
    fn parse_streams_detects_vfr_jitter_fixture() {
        let json_str = r#"{
            "format": {
                "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
                "duration": "0.800000"
            },
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 640,
                    "height": 360,
                    "r_frame_rate": "60/1",
                    "avg_frame_rate": "75/4"
                }
            ]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let streams = parse_streams(&v);
        assert_eq!(streams.len(), 1);
        let s = &streams[0];
        assert_eq!(s.is_vfr, Some(true), "60fps r_frame_rate vs 18.75fps avg_frame_rate must be flagged as VFR");
        let risks = s.risk_factors.as_ref().expect("Risk factors must be populated for VFR");
        assert!(risks.contains(&"variable-frame-rate".to_string()), "Must flag variable-frame-rate risk factor");
    }
}

