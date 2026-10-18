use crate::native_audio::{
    decode_native_audio_clip, NativeAudioClipStatus, NativeAudioKeyframe, NativePcmClip,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use super::audio_clock;
use super::types::{NativeAudioClipFailure, NativeAudioClipRequest};

type AudioCacheKey = (String, i64, i64, String, String);

/// Process-wide bounded cache of decoded PCM samples keyed by source parameters
/// (path, source_start_ticks, duration_ticks, channel_mode, downmix).
/// Persists across `replace_native_audio_clips` IPC calls so timeline mutations
/// (moving, splitting, parameter changes) do not re-decode all clips from disk (CLY-BUG-020).
fn persistent_pcm_cache() -> &'static Mutex<HashMap<AudioCacheKey, Arc<[f32]>>> {
    static CACHE: OnceLock<Mutex<HashMap<AudioCacheKey, Arc<[f32]>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::with_capacity(64)))
}

fn cache_get(key: &AudioCacheKey) -> Option<Arc<[f32]>> {
    persistent_pcm_cache().lock().ok()?.get(key).cloned()
}

fn cache_insert(key: AudioCacheKey, samples: Arc<[f32]>) {
    if let Ok(mut cache) = persistent_pcm_cache().lock() {
        if cache.len() >= 128 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(key, samples);
    }
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
    volume_keyframes: Vec<NativeAudioKeyframe>,
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

        if let Some(cached_samples) = cache_get(&cache_key) {
            log::debug!(
                "[NativeAudio] Reusing decoded PCM for cached source clip {} (path: {})",
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
                samples: cached_samples,
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
                cache_insert(cache_key, Arc::clone(&clip.samples));
                decoded.push(clip);
            }
            Err(error) => {
                log::warn!(
                    "[NativeAudio] Skipping failed audio clip {}: {} (path: {})",
                    request.clip_id,
                    error,
                    request.path
                );
                let is_cap_exceeded = error.contains("exceeds maximum") || error.contains("MiB limit");
                let _ = app.emit(
                    "clypra://native-audio-clip-failed",
                    NativeAudioClipFailure {
                        clip_id: request.clip_id.clone(),
                        path: request.path.clone(),
                        error: error.clone(),
                        is_cap_exceeded,
                    },
                );
                decoded.push(NativePcmClip {
                    id: request.clip_id.clone(),
                    sample_rate,
                    channels,
                    samples: Arc::from(Vec::<f32>::new()),
                    timeline_start_ticks: request.timeline_start_ticks,
                    duration_ticks: request.duration_ticks,
                    gain: 0.0,
                    pan: request.pan.clamp(-1.0, 1.0),
                    fade_in_ticks: 0,
                    fade_out_ticks: 0,
                    fade_in_curve: "linear".to_string(),
                    fade_out_curve: "linear".to_string(),
                    volume_keyframes: Vec::new(),
                    channel_mode: "auto".to_string(),
                    downmix: "auto".to_string(),
                    channel_map: None,
                    preserve_pitch: false,
                });
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

/// Applies parameter-only updates for multiple clips in a single Tauri IPC
/// invocation and a single mixer lock acquisition, replacing the N parallel
/// `updateNativeAudioClipParameters` calls that violated Architecture Invariant 5
/// (CLY-BUG-023).
#[tauri::command]
pub fn update_native_audio_clip_parameters_batch(
    app: AppHandle,
    updates: Vec<super::types::NativeAudioClipParameterUpdate>,
) -> Result<Vec<NativeAudioClipStatus>, String> {
    let clock = audio_clock(&app)?;
    let mut clock_guard = clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?;
    let mut statuses = Vec::with_capacity(updates.len());
    for update in updates {
        match clock_guard.update_clip_parameters(
            &update.clip_id,
            update.gain,
            update.pan,
            update.fade_in_ticks,
            update.fade_out_ticks,
            update.fade_in_curve,
            update.fade_out_curve,
            update.volume_keyframes,
        ) {
            Ok(status) => statuses.push(status),
            Err(e) => {
                log::warn!("[NativeAudio] Batch parameter update failed for clip {}: {}", update.clip_id, e);
            }
        }
    }
    Ok(statuses)
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
