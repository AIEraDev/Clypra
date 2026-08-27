use crate::native_audio::NativeAudioClock;
use crate::native_core::{
    FrameTime, NativeCoreError, PlaybackPlan, PlaybackSession, PlaybackState, DEFAULT_TIME_SCALE,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// Native playback coordination is intentionally separate from the current
/// browser playback adapter. It can be driven by a future native audio clock
/// without creating a second authority inside the active editor session.
pub struct NativePlaybackRuntime {
    session: Option<PlaybackSession>,
}

impl NativePlaybackRuntime {
    pub fn new() -> Self {
        Self { session: None }
    }

    pub fn configure(&mut self, plan: PlaybackPlan) -> Result<PlaybackState, NativeCoreError> {
        let session = PlaybackSession::new(plan)?;
        let state = session.state();
        self.session = Some(session);
        Ok(state)
    }

    pub fn state(&self) -> Result<PlaybackState, NativeCoreError> {
        self.session
            .as_ref()
            .map(PlaybackSession::state)
            .ok_or_else(|| {
                NativeCoreError::InvalidContract("Native playback is not configured".to_string())
            })
    }

    pub fn play(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        self.session
            .as_mut()
            .ok_or_else(|| {
                NativeCoreError::InvalidContract("Native playback is not configured".to_string())
            })?
            .play(clock)
    }

    pub fn play_from_audio(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        let session = self.session.as_mut().ok_or_else(|| {
            NativeCoreError::InvalidContract("Native playback is not configured".to_string())
        })?;
        let frame_rate = session.plan().frame_rate as u128;
        let frame_index = (clock.ticks.max(0) as u128)
            .saturating_mul(frame_rate)
            .checked_div(clock.timescale as u128)
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or(0);
        session.seek(frame_index)?;
        session.play(clock)
    }

    pub fn pause(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        self.session
            .as_mut()
            .ok_or_else(|| {
                NativeCoreError::InvalidContract("Native playback is not configured".to_string())
            })?
            .pause(clock)
    }

    pub fn seek(&mut self, frame_index: u64) -> Result<PlaybackState, NativeCoreError> {
        self.session
            .as_mut()
            .ok_or_else(|| {
                NativeCoreError::InvalidContract("Native playback is not configured".to_string())
            })?
            .seek(frame_index)
    }

    pub fn seek_from_audio(
        &mut self,
        frame_index: u64,
        clock: FrameTime,
    ) -> Result<PlaybackState, NativeCoreError> {
        let session = self.session.as_mut().ok_or_else(|| {
            NativeCoreError::InvalidContract("Native playback is not configured".to_string())
        })?;
        let was_playing = matches!(
            session.state().clock_status,
            crate::native_core::PlaybackClockStatus::MonotonicFallback
                | crate::native_core::PlaybackClockStatus::Audio
        );
        let state = session.seek(frame_index)?;
        if was_playing {
            session.play(clock)
        } else {
            Ok(state)
        }
    }

    pub fn tick(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        self.session
            .as_mut()
            .ok_or_else(|| {
                NativeCoreError::InvalidContract("Native playback is not configured".to_string())
            })?
            .tick(clock)
    }
}

fn runtime(app: &AppHandle) -> Result<Arc<Mutex<NativePlaybackRuntime>>, String> {
    app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Native playback runtime is not initialized".to_string())
}

fn map_error(error: NativeCoreError) -> String {
    error.to_string()
}

fn with_runtime<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut NativePlaybackRuntime) -> Result<T, NativeCoreError>,
) -> Result<T, String> {
    let state = runtime(app)?;
    let mut runtime = state
        .lock()
        .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
    operation(&mut runtime).map_err(map_error)
}

fn audio_clock_time(
    app: &AppHandle,
    require_running: bool,
    start_if_needed: bool,
) -> Result<FrameTime, String> {
    let state = app
        .try_state::<Arc<Mutex<NativeAudioClock>>>()
        .ok_or_else(|| "Native audio clock is not initialized".to_string())?;
    let mut clock = state
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?;
    let status = if start_if_needed && !clock.status().running {
        clock.start()?
    } else {
        clock.status()
    };
    if require_running && !status.running {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Native audio clock is not running".to_string()));
    }
    let ticks = i64::try_from(status.audio_position_ticks)
        .map_err(|_| "Native audio clock position exceeds the supported time range".to_string())?;
    FrameTime::new(0, ticks, DEFAULT_TIME_SCALE).map_err(|error| error.to_string())
}

fn set_audio_playing(app: &AppHandle, playing: bool) -> Result<(), String> {
    let state = app
        .try_state::<Arc<Mutex<NativeAudioClock>>>()
        .ok_or_else(|| "Native audio clock is not initialized".to_string())?;
    let clock = state
        .lock()
        .map_err(|_| "Native audio clock lock is poisoned".to_string())?;
    if playing {
        clock.resume();
    } else {
        clock.pause();
    }
    Ok(())
}

#[tauri::command]
pub fn configure_native_playback(
    app: AppHandle,
    plan: PlaybackPlan,
) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.configure(plan))
}

#[tauri::command]
pub fn get_native_playback_state(app: AppHandle) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.state())
}

#[tauri::command]
pub fn native_play(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.play(clock))
}

#[tauri::command]
pub fn native_pause(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.pause(clock))
}

#[tauri::command]
pub fn native_seek(app: AppHandle, frame_index: u64) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.seek(frame_index))
}

#[tauri::command]
pub fn native_seek_from_audio(app: AppHandle, frame_index: u64) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, false, false)?;
    with_runtime(&app, |runtime| runtime.seek_from_audio(frame_index, clock))
}

#[tauri::command]
pub fn native_tick(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.tick(clock))
}

#[tauri::command]
pub fn native_play_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, true, true)?;
    let state = with_runtime(&app, |runtime| runtime.play_from_audio(clock))?;
    set_audio_playing(&app, true)?;
    Ok(state)
}

#[tauri::command]
pub fn native_pause_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, false, false)?;
    let state = with_runtime(&app, |runtime| runtime.pause(clock))?;
    set_audio_playing(&app, false)?;
    Ok(state)
}

#[tauri::command]
pub fn native_tick_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, true, false)?;
    with_runtime(&app, |runtime| runtime.tick(clock))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_core::{PlaybackClockStatus, DEFAULT_TIME_SCALE};

    fn plan() -> PlaybackPlan {
        PlaybackPlan {
            contract_version: crate::native_core::NATIVE_CORE_CONTRACT_VERSION,
            project_revision: "test:1".to_string(),
            frame_rate: 30,
            duration_frames: 30,
            audio_track_count: 0,
        }
    }

    fn clock(ticks: i64) -> FrameTime {
        FrameTime::new(0, ticks, DEFAULT_TIME_SCALE).unwrap()
    }

    #[test]
    fn coordinator_preserves_native_frame_addressing() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();
        runtime.play(clock(0)).unwrap();
        let state = runtime.tick(clock(500_000)).unwrap();
        assert_eq!(state.presented_frame, Some(15));
        assert_eq!(state.project_revision, "test:1");
    }

    #[test]
    fn play_from_audio_reanchors_runtime_to_audio_position() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();

        let state = runtime.play_from_audio(clock(500_000)).unwrap();

        assert_eq!(state.audio_position_ticks, 500_000);
        assert_eq!(state.presented_frame, Some(15));
        assert_eq!(state.clock_status, PlaybackClockStatus::MonotonicFallback);
    }

    #[test]
    fn coordinator_rejects_commands_before_configuration() {
        let runtime = NativePlaybackRuntime::new();
        assert!(runtime.state().is_err());
    }

    #[test]
    fn seek_from_audio_reanchors_continuous_playback() {
        let mut runtime = NativePlaybackRuntime::new();
        runtime.configure(plan()).unwrap();
        runtime.play(clock(0)).unwrap();

        let state = runtime.seek_from_audio(12, clock(500_000)).unwrap();
        assert_eq!(state.presented_frame, Some(12));

        let state = runtime.tick(clock(600_000)).unwrap();
        assert_eq!(state.presented_frame, Some(15));
    }
}
