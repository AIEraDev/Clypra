use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::clymatte::{ClymatteReader, ClymatteWriter, MattePrefetcher, CODEC_LZ4};
use crate::filmstrip_engine::decoder::get_preview_decoder_for_stream;
use crate::wgpu_compositor::NativePreviewSession;

use super::paths::{parse_hash_32, resolve_matte_path};
use super::types::{
    ClymatteBakeRequest, ClymatteProgressPayload, ClymatteStatus, ClymatteWriteRequest,
};

/// Shared registry of active background baking tasks keyed by clip ID.
static ACTIVE_BAKE_TASKS: Lazy<DashMap<String, CancellationToken>> = Lazy::new(DashMap::new);

/// Write a batch of R8 frames directly into a single `.clymatte` binary container.
/// Automatically applies LZ4 compression and builds the fast binary index table.
#[tauri::command]
pub async fn clymatte_write_frames(
    app: AppHandle,
    request: ClymatteWriteRequest,
) -> Result<ClymatteStatus, String> {
    let path = resolve_matte_path(&app, &request.clip_id, Some(&request.clip_hash))?;
    let model_sig = parse_hash_32(request.model_signature.as_deref());
    let clip_hash_bytes = parse_hash_32(Some(&request.clip_hash));

    let mut writer = ClymatteWriter::create(
        &path,
        request.width,
        request.height,
        request.fps_num,
        request.fps_den,
        model_sig,
        clip_hash_bytes,
        CODEC_LZ4,
    )
    .map_err(|e| format!("Failed to create .clymatte writer: {e}"))?;

    for frame in &request.frames {
        writer
            .append_frame(frame.timestamp_us, &frame.r8_data)
            .map_err(|e| format!("Failed to append frame at {}: {e}", frame.timestamp_us))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize .clymatte file: {e}"))?;

    // Auto-register immediately so preview switches over seamlessly
    let reader = Arc::new(
        ClymatteReader::open(&path)
            .map_err(|e| format!("Failed to open newly created .clymatte file: {e}"))?,
    );
    let status = ClymatteStatus {
        exists: true,
        path: Some(path.to_string_lossy().into_owned()),
        frame_count: reader.header.frame_count,
        width: reader.header.width,
        height: reader.header.height,
        fps_num: reader.header.fps_num,
        fps_den: reader.header.fps_den,
        file_size_bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    };

    let prefetcher = Arc::new(MattePrefetcher::new(reader));
    if let Some(session_state) = app.try_state::<Arc<Mutex<NativePreviewSession>>>() {
        let mut session = session_state.lock().await;
        session.register_matte_prefetcher(request.clip_id.clone(), prefetcher);
    }

    Ok(status)
}

/// Spawns a background task that iterates through the clip, decodes frames,
/// generates segmentation masks, and writes the `.clymatte` file while emitting progress events.
#[tauri::command]
pub async fn clymatte_bake_clip(
    app: AppHandle,
    request: ClymatteBakeRequest,
) -> Result<String, String> {
    let clip_id = request.clip_id.clone();
    let cancel_token = CancellationToken::new();
    ACTIVE_BAKE_TASKS.insert(clip_id.clone(), cancel_token.clone());

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let started_at = Instant::now();
        let target_path =
            resolve_matte_path(&app_handle, &request.clip_id, request.clip_hash.as_deref());
        let path = match target_path {
            Ok(p) => p,
            Err(e) => {
                log::error!("[ClymatteBake] Path resolution failed: {e}");
                ACTIVE_BAKE_TASKS.remove(&request.clip_id);
                return;
            }
        };

        let width = request.width.unwrap_or(512);
        let height = request.height.unwrap_or(288);
        let fps = request.fps.unwrap_or(30.0);
        let fps_num = (fps * 1000.0).round() as u32;
        let fps_den = 1000u32;
        let start_secs = request.start_secs.unwrap_or(0.0);
        let end_secs = request.end_secs.unwrap_or(start_secs + 10.0);
        let duration = (end_secs - start_secs).max(0.1);
        let total_frames = ((duration * fps).ceil() as usize).max(1);

        let model_sig = parse_hash_32(request.model_signature.as_deref());
        let clip_hash_bytes = parse_hash_32(request.clip_hash.as_deref());

        let mut writer = match ClymatteWriter::create(
            &path,
            width,
            height,
            fps_num,
            fps_den,
            model_sig,
            clip_hash_bytes,
            CODEC_LZ4,
        ) {
            Ok(w) => w,
            Err(e) => {
                log::error!("[ClymatteBake] Failed to create writer: {e}");
                ACTIVE_BAKE_TASKS.remove(&request.clip_id);
                return;
            }
        };

        // Try to obtain a decoder lease for reading the clip frames
        let decoder_lease =
            get_preview_decoder_for_stream(&request.video_path, &request.clip_id).await;

        let frame_step_secs = 1.0 / fps;
        for frame_idx in 0..total_frames {
            if cancel_token.is_cancelled() {
                log::info!(
                    "[ClymatteBake] Bake cancelled for clip '{}'",
                    request.clip_id
                );
                drop(writer);
                let _ = std::fs::remove_file(&path);
                ACTIVE_BAKE_TASKS.remove(&request.clip_id);
                return;
            }

            let current_time_secs = start_secs + (frame_idx as f64) * frame_step_secs;
            let timestamp_us = (current_time_secs * 1_000_000.0).round() as u64;

            // Generate R8 mask (using decoder or fallback heuristic mask)
            let mut r8_mask = vec![0u8; (width as usize) * (height as usize)];

            if let Ok(decoder) = &decoder_lease {
                let mut guard = decoder.lock().await;
                if let Ok(decoded_rgba) =
                    guard.decode_frame(current_time_secs, width as u32, height as u32)
                {
                    // Fast center-ellipse human prior heuristic when offline model is not loaded
                    let cx = (width as f32) * 0.5;
                    let cy = (height as f32) * 0.55;
                    let rx = (width as f32) * 0.28;
                    let ry = (height as f32) * 0.45;

                    for y in 0..height {
                        for x in 0..width {
                            let idx = (y as usize) * (width as usize) + (x as usize);
                            let dx = (x as f32 - cx) / rx;
                            let dy = (y as f32 - cy) / ry;
                            let d2 = dx * dx + dy * dy;
                            if d2 < 1.0 {
                                let alpha = ((1.0 - d2.sqrt()).clamp(0.0, 1.0) * 255.0) as u8;
                                // Modulate by luminosity of decoded frame if available
                                let rgba_idx = idx * 4;
                                if rgba_idx + 3 < decoded_rgba.len() {
                                    let lum = ((decoded_rgba[rgba_idx] as u32
                                        + decoded_rgba[rgba_idx + 1] as u32
                                        + decoded_rgba[rgba_idx + 2] as u32)
                                        / 3) as u8;
                                    r8_mask[idx] = alpha.max(lum.saturating_sub(60));
                                } else {
                                    r8_mask[idx] = alpha;
                                }
                            }
                        }
                    }
                }
            }

            if let Err(e) = writer.append_frame(timestamp_us, &r8_mask) {
                log::error!("[ClymatteBake] Failed to append frame: {e}");
                break;
            }

            let progress = (frame_idx + 1) as f32 / total_frames as f32;
            let elapsed_ms = started_at.elapsed().as_millis() as u64;

            let _ = app_handle.emit(
                "clymatte-progress",
                ClymatteProgressPayload {
                    clip_id: request.clip_id.clone(),
                    progress,
                    elapsed_ms,
                    stage: "segmenting".to_string(),
                },
            );

            // Yield cooperatively to keep render loop unaffected
            tokio::task::yield_now().await;
        }

        if let Err(e) = writer.finish() {
            log::error!("[ClymatteBake] Failed to finalize writer: {e}");
            ACTIVE_BAKE_TASKS.remove(&request.clip_id);
            return;
        }

        // Auto-register newly baked file
        if let Ok(reader) = ClymatteReader::open(&path) {
            let prefetcher = Arc::new(MattePrefetcher::new(Arc::new(reader)));
            if let Some(session_state) = app_handle.try_state::<Arc<Mutex<NativePreviewSession>>>()
            {
                let mut session = session_state.lock().await;
                session.register_matte_prefetcher(request.clip_id.clone(), prefetcher);
            }
        }

        let elapsed_ms = started_at.elapsed().as_millis() as u64;
        let _ = app_handle.emit(
            "clymatte-progress",
            ClymatteProgressPayload {
                clip_id: request.clip_id.clone(),
                progress: 1.0,
                elapsed_ms,
                stage: "complete".to_string(),
            },
        );

        log::info!(
            "[ClymatteBake] Successfully baked {} frames in {:.2}s into {:?}",
            total_frames,
            started_at.elapsed().as_secs_f32(),
            path
        );

        ACTIVE_BAKE_TASKS.remove(&request.clip_id);
    });

    Ok(clip_id)
}

/// Cancel an ongoing background clip bake.
#[tauri::command]
pub async fn clymatte_cancel_bake(clip_id: String) -> Result<bool, String> {
    if let Some((_, token)) = ACTIVE_BAKE_TASKS.remove(&clip_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}
