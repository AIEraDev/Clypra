use super::render_session::NativeRenderSession;
use crate::native_audio::NativeAudioClock;
use crate::native_core::{
    FrameTime, NativeCoreError, NativePlaybackFrameDemand, PlaybackPlan, PlaybackSession,
    PlaybackState, DEFAULT_TIME_SCALE,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// Native playback coordination remains separate from the render session.
/// `PlaybackSession` is the platform-neutral state machine; this runtime adds
/// the Tauri-owned render worker without making the core state machine depend
/// on platform rendering.
pub struct NativePlaybackRuntime {
    pub(crate) session: Option<PlaybackSession>,
    pub(crate) render_session: Option<Arc<NativeRenderSession>>,
}

impl NativePlaybackRuntime {
    pub fn new() -> Self {
        Self {
            session: None,
            render_session: None,
        }
    }

    pub(crate) fn install_render_session(&mut self, render_session: Arc<NativeRenderSession>) {
        if let Some(previous) = self.render_session.take() {
            previous.stop(None);
        }
        self.render_session = Some(render_session);
    }

    pub(crate) fn take_render_session(&mut self) -> Option<Arc<NativeRenderSession>> {
        self.render_session.take()
    }

    pub(crate) fn render_session(&self) -> Option<Arc<NativeRenderSession>> {
        self.render_session.clone()
    }

    /// Expose the capability-probe-selected quality tier for inter-module use
    /// (e.g. the lookahead predecode worker in native_preview.rs).  Returns
    /// `None` when no render session is active.
    pub fn render_session_quality(&self) -> Option<crate::native_core::QualityTier> {
        self.render_session.as_ref().map(|s| s.playback_quality())
    }

    pub(crate) fn record_playback_lookahead_miss(&self) -> Option<crate::native_core::QualityTier> {
        self.render_session
            .as_ref()
            .map(|session| session.record_playback_lookahead_miss())
    }

    pub(crate) fn record_playback_lookahead_hit(&self) {
        if let Some(session) = &self.render_session {
            session.record_playback_lookahead_hit();
        }
    }

    pub fn submit_render_demand(&self, demand: NativePlaybackFrameDemand) -> Result<(), String> {
        self.render_session
            .as_ref()
            .ok_or_else(|| "Native playback render snapshot is not configured".to_string())?
            .submit(demand)
    }

    pub fn start_render(&self, app: AppHandle) {
        if let Some(session) = &self.render_session {
            session.start(app);
        }
    }

    pub fn stop_render(&self, app: AppHandle) {
        if let Some(session) = &self.render_session {
            session.stop(Some(app));
        }
    }

    /// Pause background playback work without terminating the render worker.
    /// Explicit P0 paused/scrub demands continue through that worker after the
    /// audio clock has stopped.
    pub fn pause_render(&self, app: AppHandle) {
        if let Some(session) = &self.render_session {
            session.pause_continuous_playback();
            tauri::async_runtime::spawn(async move {
                crate::commands::native_preview::reset_native_preview_queue(&app).await;
            });
        }
    }

    pub(crate) fn is_at_timeline_end(&self) -> bool {
        self.session
            .as_ref()
            .map(PlaybackSession::is_at_timeline_end)
            .unwrap_or(false)
    }

    pub fn invalidate_render_generation(&self, generation: u64) {
        if let Some(session) = &self.render_session {
            session.invalidate(generation);
        }
    }

    pub fn configure(&mut self, plan: PlaybackPlan) -> Result<PlaybackState, NativeCoreError> {
        let session = PlaybackSession::new(plan)?;
        let state = session.state();
        self.session = Some(session);
        Ok(state)
    }

    fn ensure_session(&mut self) -> Result<&mut PlaybackSession, NativeCoreError> {
        if self.session.is_none() {
            let plan = if let Some(render_session) = &self.render_session {
                let snapshot = render_session.snapshot.read();
                PlaybackPlan {
                    contract_version: snapshot.contract_version,
                    project_revision: snapshot.project.project_revision.clone(),
                    frame_rate: snapshot.project.frame_rate.max(1),
                    duration_frames: u64::MAX,
                    audio_track_count: 0,
                }
            } else {
                PlaybackPlan {
                    contract_version: crate::native_core::NATIVE_CORE_CONTRACT_VERSION,
                    project_revision: "default".to_string(),
                    frame_rate: 30,
                    duration_frames: u64::MAX,
                    audio_track_count: 0,
                }
            };
            self.session = Some(PlaybackSession::new(plan)?);
        }
        Ok(self.session.as_mut().unwrap())
    }

    pub fn state(&mut self) -> Result<PlaybackState, NativeCoreError> {
        Ok(self.ensure_session()?.state())
    }

    pub fn play(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        self.ensure_session()?.play(clock)
    }

    pub fn play_from_audio(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        let session = self.ensure_session()?;
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
        self.ensure_session()?.pause(clock)
    }

    pub fn seek(&mut self, frame_index: u64) -> Result<PlaybackState, NativeCoreError> {
        self.ensure_session()?.seek(frame_index)
    }

    pub fn seek_from_audio(
        &mut self,
        frame_index: u64,
        clock: FrameTime,
    ) -> Result<PlaybackState, NativeCoreError> {
        let session = self.ensure_session()?;
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
        self.ensure_session()?.tick(clock)
    }

    /// Drop the session from the previous project so the next project starts
    /// clean. Called as part of project-close runtime reset.
    pub fn reset(&mut self) {
        if let Some(render_session) = self.render_session.take() {
            render_session.stop(None);
        }
        self.session = None;
    }
}

pub(crate) fn runtime(app: &AppHandle) -> Result<Arc<Mutex<NativePlaybackRuntime>>, String> {
    app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Native playback runtime is not initialized".to_string())
}

fn map_error(error: NativeCoreError) -> String {
    error.to_string()
}

pub(crate) fn with_runtime<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut NativePlaybackRuntime) -> Result<T, NativeCoreError>,
) -> Result<T, String> {
    let state = runtime(app)?;
    let mut runtime = state
        .lock()
        .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
    operation(&mut runtime).map_err(map_error)
}

pub fn audio_clock_time(
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

pub(crate) fn set_audio_playing(app: &AppHandle, playing: bool) -> Result<(), String> {
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
