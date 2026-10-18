use crate::native_audio::{NativeAudioDiagnostics, NativeAudioStatus};
use crate::sync_metrics::SYNC_METRICS;
use tauri::AppHandle;

use super::audio_clock;

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
