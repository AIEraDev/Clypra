use crate::native_audio::{
    decode_native_audio_clip, NativeAudioClipStatus, NativeAudioClock, NativeAudioStatus,
};
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
pub fn set_native_audio_output(
    app: AppHandle,
    volume: f32,
    muted: bool,
) -> Result<(), String> {
    let clock = audio_clock(&app)?;
    clock
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?
        .set_output(volume, muted);
    Ok(())
}

#[tauri::command]
pub fn seek_native_audio(app: AppHandle, position_ticks: i64) -> Result<(), String> {
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
    fade_in_ticks: i64,
    fade_out_ticks: i64,
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
        fade_in_ticks,
        fade_out_ticks,
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
