use crate::native_audio::{
    decode_native_audio_clip, NativeAudioClipStatus, NativeAudioClock, NativeAudioDiagnostics,
    NativeAudioKeyframe, NativeAudioStatus, NativePcmClip,
};
use crate::sync_metrics::SYNC_METRICS;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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

    let mut decoded: Vec<NativePcmClip> = Vec::with_capacity(clips.len());
    for request in clips {
        decoded.push(
            decode_native_audio_clip(
                &PathBuf::from(request.path),
                request.clip_id,
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
            .await?,
        );
    }

    let statuses: Vec<NativeAudioClipStatus> = decoded.iter().map(NativePcmClip::status).collect();
    log::info!(
        "[NativeAudio] Installed {} audio clips: {:?}",
        decoded.len(),
        statuses
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
