use crate::native_audio::{
    decode_native_audio_clip, NativeAudioClipStatus, NativeAudioClock, NativeAudioDiagnostics,
    NativeAudioKeyframe, NativeAudioStatus, NativePcmClip,
};
use crate::sync_metrics::SYNC_METRICS;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager};

fn audio_clock(app: &AppHandle) -> Result<Arc<Mutex<NativeAudioClock>>, String> {
    app.try_state::<Arc<Mutex<NativeAudioClock>>>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Native audio clock is not initialized".to_string())
}

#[tauri::command]
pub fn start_native_audio(app: AppHandle) -> Result<NativeAudioStatus, String> {
    let clock = audio_clock(&app)?;
    let result = clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .start();
    result
}

#[tauri::command]
pub fn stop_native_audio(app: AppHandle) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .stop();
    Ok(())
}

#[tauri::command]
pub fn get_native_audio_status(app: AppHandle) -> Result<NativeAudioStatus, String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())
        .map(|clock| clock.status())
}

/// Reports derived evidence from the live native audio authority. This is a
/// diagnostic endpoint only; it never swaps to or feeds a fallback renderer.
#[tauri::command]
pub fn get_native_audio_diagnostics(app: AppHandle) -> Result<NativeAudioDiagnostics, String> {
    let clock = audio_clock(&app)?;
    let diagnostics = clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())
        .map(|clock| clock.diagnostics())?;
    Ok(diagnostics)
}

#[tauri::command]
pub fn pause_native_audio(app: AppHandle) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .pause();
    Ok(())
}

#[tauri::command]
pub fn resume_native_audio(app: AppHandle) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .resume();
    Ok(())
}

#[tauri::command]
pub fn set_native_audio_speed(app: AppHandle, speed: f32) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .set_speed(speed);
    Ok(())
}

#[tauri::command]
pub fn set_native_audio_output(app: AppHandle, volume: f32, muted: bool) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .set_output(volume, muted);
    Ok(())
}

#[tauri::command]
pub fn seek_native_audio(app: AppHandle, position_ticks: i64) -> Result<(), String> {
    SYNC_METRICS.record_seek_requested(position_ticks);
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .seek(position_ticks);
    Ok(())
}

#[tauri::command]
pub async fn load_native_audio_clip(
    app: AppHandle,
    path: String,
    clip_id: String,
    timeline_start_ticks: i64,
    source_start_ticks: i64,
    duration_ticks: i64,
    gain: f32,
    pan: f32,
    fade_in_ticks: i64,
    fade_out_ticks: i64,
    fade_in_curve: String,
    fade_out_curve: String,
    volume_keyframes: Vec<crate::native_audio::NativeAudioKeyframe>,
    channel_mode: String,
    downmix: String,
    channel_map: Option<Vec<usize>>,
    preserve_pitch: bool,
) -> Result<NativeAudioClipStatus, String> {
    let clock = audio_clock(&app)?;
    let (sample_rate, channels) = {
        let mut clock_guard = clock
            .lock()
            .map_err(|_| "Native audio clock lock is poisoned".to_string())?;
        let status = clock_guard.start()?;
        (
            status
                .sample_rate
                .ok_or_else(|| "Native audio output did not report a sample rate".to_string())?,
            status
                .channels
                .ok_or_else(|| "Native audio output did not report channel count".to_string())?,
        )
    };

    let clip = decode_native_audio_clip(
        &PathBuf::from(path),
        clip_id,
        timeline_start_ticks,
        source_start_ticks,
        duration_ticks,
        gain,
        pan,
        fade_in_ticks,
        fade_out_ticks,
        fade_in_curve,
        fade_out_curve,
        volume_keyframes,
        channel_mode,
        downmix,
        channel_map,
        preserve_pitch,
        sample_rate,
        channels,
    )
    .await?;
    let status = clip.status();
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .install_clip(clip)?;
    Ok(status)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipRequest {
    pub path: String,
    pub clip_id: String,
    pub timeline_start_ticks: i64,
    pub source_start_ticks: i64,
    pub duration_ticks: i64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub fade_in_curve: String,
    pub fade_out_curve: String,
    pub volume_keyframes: Vec<NativeAudioKeyframe>,
    pub channel_mode: String,
    pub downmix: String,
    pub channel_map: Option<Vec<usize>>,
    pub preserve_pitch: bool,
}

/// Decode a complete candidate graph before replacing the live native graph.
/// A decode failure leaves the previous graph untouched.
#[tauri::command]
pub async fn replace_native_audio_clips(
    app: AppHandle,
    clips: Vec<NativeAudioClipRequest>,
) -> Result<Vec<NativeAudioClipStatus>, String> {
    // INVESTIGATION ONLY — remove before Phase 6
    log::debug!("[TR5] replace_native_audio_clips: {} clips requested", clips.len());
    
    let clock = audio_clock(&app)?;
    let (sample_rate, channels) = {
        let mut clock_guard = clock
            .lock()
            .map_err(|_| "Native audio clock lock is poisoned".to_string())?;
        let status = clock_guard.start()?;
        (
            status
                .sample_rate
                .ok_or_else(|| "Native audio output did not report a sample rate".to_string())?,
            status
                .channels
                .ok_or_else(|| "Native audio output did not report channel count".to_string())?,
        )
    };

    let audio_decode_started = Instant::now();
    let clip_count = clips.len();
    let mut decoded: Vec<NativePcmClip> = Vec::with_capacity(clips.len());
    let mut pcm_cache: HashMap<(String, i64, i64, String, String), Arc<[f32]>> = HashMap::new();

    for request in clips {
        let is_muted = request.gain <= 0.0001
            && (request.volume_keyframes.is_empty()
                || request.volume_keyframes.iter().all(|k| k.gain <= 0.0001));

        if is_muted {
            log::debug!(
                "[NativeAudio] Skipping decode for muted clip {} (gain: {})",
                request.clip_id,
                request.gain
            );
            decoded.push(NativePcmClip {
                id: request.clip_id,
                sample_rate,
                channels,
                samples: Arc::from(Vec::<f32>::new()),
                timeline_start_ticks: request.timeline_start_ticks,
                duration_ticks: request.duration_ticks,
                gain: 0.0,
                pan: request.pan.clamp(-1.0, 1.0),
                fade_in_ticks: request.fade_in_ticks.max(0),
                fade_out_ticks: request.fade_out_ticks.max(0),
                fade_in_curve: request.fade_in_curve,
                fade_out_curve: request.fade_out_curve,
                volume_keyframes: request.volume_keyframes,
                channel_mode: request.channel_mode,
                downmix: request.downmix,
                channel_map: request.channel_map,
                preserve_pitch: request.preserve_pitch,
            });
            continue;
        }

        let cache_key = (
            request.path.clone(),
            request.source_start_ticks,
            request.duration_ticks,
            request.channel_mode.clone(),
            request.downmix.clone(),
        );

        if let Some(cached_samples) = pcm_cache.get(&cache_key) {
            log::debug!(
                "[NativeAudio] Reusing decoded PCM for duplicate source clip {} (path: {})",
                request.clip_id,
                request.path
            );
            let mut volume_keyframes = request.volume_keyframes;
            volume_keyframes.sort_by_key(|point| point.time);
            let channel_mode = match request.channel_mode.as_str() {
                "mono" | "stereo" | "multichannel" => request.channel_mode,
                _ => "auto".to_string(),
            };
            let downmix = match request.downmix.as_str() {
                "mono" | "stereo" => request.downmix,
                _ => "auto".to_string(),
            };
            let decode_channels = if channel_mode == "mono" || downmix == "mono" {
                1
            } else if channel_mode == "stereo" || downmix == "stereo" {
                2
            } else {
                channels
            };
            decoded.push(NativePcmClip {
                id: request.clip_id,
                sample_rate,
                channels: decode_channels,
                samples: Arc::clone(cached_samples),
                timeline_start_ticks: request.timeline_start_ticks,
                duration_ticks: request.duration_ticks,
                gain: request.gain.clamp(0.0, 4.0),
                pan: request.pan.clamp(-1.0, 1.0),
                fade_in_ticks: request.fade_in_ticks.max(0),
                fade_out_ticks: request.fade_out_ticks.max(0),
                fade_in_curve: request.fade_in_curve,
                fade_out_curve: request.fade_out_curve,
                volume_keyframes,
                channel_mode,
                downmix,
                channel_map: request.channel_map.filter(|map| !map.is_empty()),
                preserve_pitch: request.preserve_pitch,
            });
            continue;
        }

        match decode_native_audio_clip(
            &PathBuf::from(&request.path),
            request.clip_id.clone(),
            request.timeline_start_ticks,
            request.source_start_ticks,
            request.duration_ticks,
            request.gain,
            request.pan,
            request.fade_in_ticks,
            request.fade_out_ticks,
            request.fade_in_curve,
            request.fade_out_curve,
            request.volume_keyframes,
            request.channel_mode,
            request.downmix,
            request.channel_map,
            request.preserve_pitch,
            sample_rate,
            channels,
        )
        .await
        {
            Ok(clip) => {
                // PHASE 2 INSTRUMENTATION: Log successful decode (before move)
                eprintln!("[PHASE2-RUST-AUDIO] decode SUCCESS: clip={} path='{}' samples={} channels={}", 
                    request.clip_id, request.path, clip.samples.len(), clip.channels);
                pcm_cache.insert(cache_key, Arc::clone(&clip.samples));
                decoded.push(clip);
            }
            Err(error) => {
                // PHASE 2 INSTRUMENTATION: Log decode failure
                eprintln!("[PHASE2-RUST-AUDIO] decode FAILED: clip={} path='{}' error='{}'", 
                    request.clip_id, request.path, error);
                log::warn!(
                    "[NativeAudio] Skipping failed audio clip {}: {} (path: {})",
                    request.clip_id,
                    error,
                    request.path
                );
            }
        }
    }

    let audio_work_us = audio_decode_started
        .elapsed()
        .as_micros()
        .min(u64::MAX as u128) as u64;
    let audio_start_us = audio_decode_started
        .duration_since(*crate::cold_start::PROCESS_START)
        .as_micros()
        .min(u64::MAX as u128) as u64;
    let audio_end_us = audio_start_us.saturating_add(audio_work_us);
    let first_frame_us = crate::cold_start::get_first_frame_painted_at_us();
    let overlapped_with_critical_path_us = if first_frame_us > 0 {
        if first_frame_us > audio_start_us {
            Some(first_frame_us.min(audio_end_us).saturating_sub(audio_start_us))
        } else {
            Some(0)
        }
    } else {
        None
    };

    // Audio decoding occurs in the background and does NOT block the UI thread (waited = 0).
    // The background overlap with the critical path is recorded in overlapped_with_critical_path_us.
    crate::cold_start::record_span_with_overlap(
        "c1_audio_decode_all",
        audio_decode_started,
        0,
        overlapped_with_critical_path_us,
        false,
        None,
    );
    log::debug!(
        "[ColdStart] c1_audio_decode_all: {} clips (waited: 0 us, overlap: {:?} us)",
        clip_count,
        overlapped_with_critical_path_us
    );

    let statuses: Vec<NativeAudioClipStatus> = decoded.iter().map(NativePcmClip::status).collect();
    
    // PHASE 2 INSTRUMENTATION: Log before return
    eprintln!("[PHASE2-RUST-AUDIO] replace_native_audio_clips RETURN: decoded_count={} status_count={} ts={:?}", 
        decoded.len(), statuses.len(), Instant::now());
    for (idx, status) in statuses.iter().enumerate() {
        eprintln!("[PHASE2-RUST-AUDIO] status[{}] id={} sample_count={} duration_ticks={}", 
            idx, status.id, status.sample_count, status.duration_ticks);
    }
    
    log::debug!(
        "[NativeAudio] Installed {} audio clips: {:?}",
        decoded.len(),
        statuses
            .iter()
            .map(|s| (&s.id, s.duration_ticks))
            .collect::<Vec<_>>()
    );
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .replace_clips(decoded)?;
    Ok(statuses)
}

#[tauri::command]
pub fn update_native_audio_clip_parameters(
    app: AppHandle,
    clip_id: String,
    gain: f32,
    pan: f32,
    fade_in_ticks: i64,
    fade_out_ticks: i64,
    fade_in_curve: String,
    fade_out_curve: String,
    volume_keyframes: Vec<NativeAudioKeyframe>,
) -> Result<NativeAudioClipStatus, String> {
    let clock = audio_clock(&app)?;
    let result = clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .update_clip_parameters(
            &clip_id,
            gain,
            pan,
            fade_in_ticks,
            fade_out_ticks,
            fade_in_curve,
            fade_out_curve,
            volume_keyframes,
        );
    result
}

#[tauri::command]
pub fn clear_native_audio_clip(app: AppHandle) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .clear_clip();
    Ok(())
}

#[tauri::command]
pub fn get_native_audio_clip(app: AppHandle) -> Result<Option<NativeAudioClipStatus>, String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())
        .map(|clock| clock.clip_status())
}

#[tauri::command]
pub fn get_native_audio_clips(app: AppHandle) -> Result<Vec<NativeAudioClipStatus>, String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())
        .map(|clock| clock.clip_statuses())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_muted_clip_gain_detection() {
        let muted_req = NativeAudioClipRequest {
            path: "/path/to/audio.mp4".to_string(),
            clip_id: "clip_muted".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 1_000_000,
            gain: 0.0,
            pan: 0.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: vec![],
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let is_muted = muted_req.gain <= 0.0001
            && (muted_req.volume_keyframes.is_empty()
                || muted_req.volume_keyframes.iter().all(|k| k.gain <= 0.0001));
        assert!(is_muted);

        let audible_req = NativeAudioClipRequest {
            gain: 1.0,
            ..muted_req.clone()
        };
        let is_audible_muted = audible_req.gain <= 0.0001
            && (audible_req.volume_keyframes.is_empty()
                || audible_req.volume_keyframes.iter().all(|k| k.gain <= 0.0001));
        assert!(!is_audible_muted);
    }
}
