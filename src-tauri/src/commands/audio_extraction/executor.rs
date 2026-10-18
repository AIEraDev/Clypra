use super::models::{
    AudioExtractionRequest, ExtractedMediaAsset, MediaJobResult, MediaJobUpdate,
};
use super::probe::{fingerprint, parse_streams, plan_output, probe_json, validate_audio_file};
use super::MEDIA_JOBS;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

pub(super) async fn emit_update(app: &tauri::AppHandle, update: MediaJobUpdate) {
    let _ = app.emit("media_job_update", update);
}

pub(super) async fn run_extraction(
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
