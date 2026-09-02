use crate::native_audio::NativeAudioClock;
use crate::native_core::playback::frame_for_audio_position;
use crate::native_core::{
    FrameRequest, FrameTime, NativeCoreError, NativePlaybackFrameDemand, PlaybackPlan,
    PlaybackSession, PlaybackState, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
use crate::thumbnail_engine::decoder::{
    acquire_preview_decoder_lease_for_stream, PreviewDecoderLease,
};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// Rendering is owned by a session separate from the platform-neutral
/// `PlaybackSession`. The latter intentionally has no Tauri, decoder, or wgpu
/// dependencies so its timing/state transitions remain deterministic and
/// independently testable.
struct NativeRenderSession {
    snapshot: Mutex<FrameRequest>,
    leases: Mutex<Vec<PreviewDecoderLease>>,
    pending: Mutex<LatestPlaybackDemand>,
    notify: tokio::sync::Notify,
    running: AtomicBool,
    generation: AtomicU64,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Default)]
struct LatestPlaybackDemand {
    value: Option<NativePlaybackFrameDemand>,
}

impl LatestPlaybackDemand {
    fn replace(&mut self, demand: NativePlaybackFrameDemand) {
        self.value = Some(demand);
    }

    fn take(&mut self) -> Option<NativePlaybackFrameDemand> {
        self.value.take()
    }
}

impl NativeRenderSession {
    async fn new(snapshot: FrameRequest) -> Result<Arc<Self>, String> {
        snapshot.validate().map_err(|error| error.to_string())?;
        let mut streams = HashSet::new();
        let mut leases = Vec::new();
        for layer in &snapshot.project.video_layers {
            let key = (layer.video_path.clone(), layer.layer_id.clone());
            if streams.insert(key) {
                leases.push(
                    acquire_preview_decoder_lease_for_stream(
                        &layer.video_path,
                        &layer.layer_id,
                    )
                    .await?,
                );
            }
        }
        Ok(Arc::new(Self {
            snapshot: Mutex::new(snapshot),
            leases: Mutex::new(leases),
            pending: Mutex::new(LatestPlaybackDemand::default()),
            notify: tokio::sync::Notify::new(),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            worker: Mutex::new(None),
        }))
    }

    fn start(self: &Arc<Self>, app: AppHandle) {
        if self.running.swap(true, Ordering::AcqRel) {
            return;
        }
        let session = Arc::clone(self);
        let handle = tauri::async_runtime::spawn(async move {
            session.render_loop(app).await;
        });
        if let Ok(mut worker) = self.worker.lock() {
            *worker = Some(handle);
        }
    }

    fn stop(&self) {
        self.running.store(false, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            pending.value = None;
        }
        self.notify.notify_one();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                handle.abort();
            }
        }
    }

    /// Invalidate queued work without stopping the playback session. This is
    /// used by seek/project-generation boundaries; an in-progress decoder may
    /// finish, but it can never reach presentation afterward.
    fn invalidate(&self, generation: u64) {
        self.generation.fetch_max(generation, Ordering::AcqRel);
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .value
                .as_ref()
                .and_then(|demand| demand.generation)
                .map(|pending_generation| pending_generation < generation)
                .unwrap_or(false)
            {
                pending.value = None;
            }
        }
        self.notify.notify_one();
    }

    fn submit(&self, demand: NativePlaybackFrameDemand) -> Result<(), String> {
        if demand.contract_version != NATIVE_CORE_CONTRACT_VERSION {
            return Err(format!(
                "Unsupported native playback demand contract version: {}",
                demand.contract_version
            ));
        }
        if demand.request_id.trim().is_empty() || demand.frame_time.timescale == 0 {
            return Err("Native playback demand requires request_id and frame time".to_string());
        }
        let generation = demand.generation.unwrap_or(0);
        let current = self.generation.load(Ordering::Acquire);
        if generation < current {
            return Ok(());
        }
        self.generation.store(generation, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            // This assignment is the latest-frame-wins slot: a slow decode can
            // never cause obsolete playback work to accumulate.
            pending.replace(demand);
        }
        self.notify.notify_one();
        Ok(())
    }

    fn materialize_request(
        &self,
        demand: Option<&NativePlaybackFrameDemand>,
    ) -> Result<FrameRequest, String> {
        let mut request = self
            .snapshot
            .lock()
            .map_err(|_| "Native render snapshot lock is poisoned".to_string())?
            .clone();
        if let Some(demand) = demand {
            if demand.video_layers.len() != request.project.video_layers.len()
                || demand.raster_layers.len() != request.project.raster_layers.len()
                || demand.text_layers.len() != request.project.text_layers.len()
            {
                return Err(
                    "Native playback demand does not match the configured render snapshot".to_string(),
                );
            }
            request.request_id = demand.request_id.clone();
            request.frame_time = demand.frame_time;
            request.generation = demand.generation;
            request.mode = demand.mode.clone();
            for (layer, update) in request
                .project
                .video_layers
                .iter_mut()
                .zip(&demand.video_layers)
            {
                layer.source_time = update.source_time;
                layer.x = update.x;
                layer.y = update.y;
                layer.width = update.width;
                layer.height = update.height;
                layer.rotation = update.rotation;
                layer.opacity = update.opacity;
                layer.z_index = update.z_index;
            }
            for (layer, update) in request
                .project
                .raster_layers
                .iter_mut()
                .zip(&demand.raster_layers)
            {
                if !update.asset_id.is_empty() {
                    layer.asset_id = update.asset_id.clone();
                }
                if update.width > 0 {
                    layer.width = update.width;
                }
                if update.height > 0 {
                    layer.height = update.height;
                }
                layer.display_width = update.display_width;
                layer.display_height = update.display_height;
                layer.x = update.x;
                layer.y = update.y;
                layer.rotation = update.rotation;
                layer.opacity = update.opacity;
                layer.z_index = update.z_index;
            }
            for (layer, update) in request
                .project
                .text_layers
                .iter_mut()
                .zip(&demand.text_layers)
            {
                layer.x = update.x;
                layer.y = update.y;
                layer.rotation = update.rotation;
                layer.opacity = update.opacity;
                layer.z_index = update.z_index;
            }
            if let Some(progress) = demand.transition_progress {
                if let Some(transition) = request.project.transition.as_mut() {
                    transition.progress = progress;
                }
            }
        }
        Ok(request)
    }

    async fn render_loop(self: Arc<Self>, app: AppHandle) {
        let frame_rate = {
            self.snapshot
                .lock()
                .map(|s| s.project.frame_rate.max(1) as u64)
                .unwrap_or(60)
        };
        let tick_duration = std::time::Duration::from_nanos(1_000_000_000 / frame_rate);
        let mut ticker = tokio::time::interval(tick_duration);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_rendered_frame_index: Option<u64> = None;

        while self.running.load(Ordering::Acquire) {
            tokio::select! {
                _ = ticker.tick() => {},
                _ = self.notify.notified() => {},
            }

            if !self.running.load(Ordering::Acquire) {
                break;
            }

            let generation = self.generation.load(Ordering::Acquire);
            let dynamic_demand = self.pending.lock().ok().and_then(|mut slot| slot.take());
            if let Some(demand) = &dynamic_demand {
                if demand.generation.unwrap_or(0) < generation {
                    continue;
                }
            }

            let base_request = match self.materialize_request(dynamic_demand.as_ref()) {
                Ok(req) => req,
                Err(error) => {
                    log::debug!("native playback demand materialize failed: {error}");
                    continue;
                }
            };

            // Reading the lease collection here documents and enforces the
            // ownership boundary: these decoder entries stay pinned for the
            // complete lifetime of the render session, while their mutexes
            // are acquired only inside the decode stage.
            let _active_decoder_lease_count =
                self.leases.lock().map(|leases| leases.len()).unwrap_or(0);

            // The JS demand carries the evaluated layer state, but the
            // authoritative frame address is always taken from Rust's native
            // audio clock. This prevents a delayed WebView RAF from selecting
            // a frame independently of audio.
            if let Ok(audio_time) = audio_clock_time(&app, true, false) {
                if let Ok(frame_index) = frame_for_audio_position(
                    audio_time,
                    &PlaybackPlan {
                        contract_version: base_request.contract_version,
                        project_revision: base_request.project.project_revision.clone(),
                        frame_rate: base_request.project.frame_rate,
                        duration_frames: u64::MAX,
                        audio_track_count: 0,
                    },
                ) {
                    if last_rendered_frame_index == Some(frame_index) && dynamic_demand.is_none() {
                        continue;
                    }
                    last_rendered_frame_index = Some(frame_index);

                    let mut request = base_request;
                    let base_timeline_secs = (request.frame_time.ticks as f64)
                        / (request.frame_time.timescale.max(1) as f64);
                    request.frame_time.frame_index = frame_index;
                    request.frame_time.ticks = audio_time.ticks;
                    request.frame_time.timescale = audio_time.timescale;

                    if dynamic_demand.is_none() {
                        let audio_time_secs =
                            (audio_time.ticks as f64) / (audio_time.timescale as f64);
                        let delta_secs = (audio_time_secs - base_timeline_secs).max(0.0);
                        for layer in &mut request.project.video_layers {
                            let base_source_time_secs = (layer.source_time.ticks as f64)
                                / (layer.source_time.timescale.max(1) as f64);
                            let current_source_secs = (base_source_time_secs + delta_secs).max(0.0);
                            let source_frame_index = (current_source_secs
                                * request.project.frame_rate as f64)
                                .round() as u64;
                            let ticks =
                                (current_source_secs * DEFAULT_TIME_SCALE as f64).round() as i64;
                            if let Ok(ft) =
                                FrameTime::new(source_frame_index, ticks, DEFAULT_TIME_SCALE)
                            {
                                layer.source_time = ft;
                            }
                        }
                    }

                    self.render_one(&app, request, generation).await;
                    continue;
                }
            }

            self.render_one(&app, base_request, generation).await;
        }
    }

    async fn render_one(&self, app: &AppHandle, request: FrameRequest, generation: u64) {
        if generation < self.generation.load(Ordering::Acquire) {
            // Recency cancellation is deliberately before the shared
            // audio-clock lateness decision in present_native_frame.
            return;
        }
        let frame_index = request.frame_time.frame_index;
        match crate::commands::native_preview::present_native_frame_internal(app.clone(), request)
            .await
        {
            Ok(presentation) => {
                if presentation.presented {
                    if let Some(surface) = app
                        .try_state::<Arc<Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>(
                        )
                    {
                        if let Ok(surface) = surface.inner().clone().lock() {
                            let _ = surface.show_surface();
                        }
                    }
                } else if presentation.dropped {
                    log::warn!("[NativePlayback] frame #{} DROPPED (late for audio)", frame_index);
                }
            }
            Err(error) => {
                if !error.contains("stale") {
                    log::warn!("[NativePlayback] frame #{} presentation failed: {error}", frame_index);
                }
            }
        }
    }
}

/// Native playback coordination remains separate from the render session.
/// `PlaybackSession` is the platform-neutral state machine; this runtime adds
/// the Tauri-owned render worker without making the core state machine depend
/// on platform rendering.
pub struct NativePlaybackRuntime {
    session: Option<PlaybackSession>,
    render_session: Option<Arc<NativeRenderSession>>,
}

impl NativePlaybackRuntime {
    pub fn new() -> Self {
        Self {
            session: None,
            render_session: None,
        }
    }

    fn install_render_session(&mut self, render_session: Arc<NativeRenderSession>) {
        if let Some(previous) = self.render_session.take() {
            previous.stop();
        }
        self.render_session = Some(render_session);
    }

    fn take_render_session(&mut self) -> Option<Arc<NativeRenderSession>> {
        self.render_session.take()
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

    pub fn stop_render(&self) {
        if let Some(session) = &self.render_session {
            session.stop();
        }
    }

    pub fn invalidate_render_generation(&self, generation: u64) {
        if let Some(session) = &self.render_session {
            session.invalidate(generation);
        }
    }

    pub fn configure(&mut self, plan: PlaybackPlan) -> Result<PlaybackState, NativeCoreError> {
        if let Some(render_session) = self.render_session.take() {
            render_session.stop();
        }
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

    /// Drop the session from the previous project so the next project starts
    /// clean. Called as part of project-close runtime reset.
    pub fn reset(&mut self) {
        if let Some(render_session) = self.render_session.take() {
            render_session.stop();
        }
        self.session = None;
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

/// Install the immutable Native render graph for one project/render revision.
/// This payload is sent once; playback submits only compact frame demand.
#[tauri::command]
pub async fn configure_native_playback_render(
    app: AppHandle,
    snapshot: FrameRequest,
) -> Result<(), String> {
    let state = runtime(&app)?;
    let previous = {
        let mut runtime = state
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
        runtime.take_render_session()
    };
    if let Some(previous) = previous {
        previous.stop();
    }
    // Acquire leases only after the previous revision has released its pins;
    // this prevents a project switch from temporarily growing the preview
    // decoder pool beyond its intended capacity.
    let render_session = NativeRenderSession::new(snapshot).await?;
    let mut runtime = state
        .lock()
        .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
    runtime.install_render_session(render_session);
    let should_start = runtime
        .session
        .as_ref()
        .map(|session| {
            matches!(
                session.state().clock_status,
                crate::native_core::PlaybackClockStatus::Audio
                    | crate::native_core::PlaybackClockStatus::MonotonicFallback
            )
        })
        .unwrap_or(false);
    if should_start {
        runtime.start_render(app.clone());
    }
    Ok(())
}

/// Replace the single pending Native playback demand. This command returns
/// without waiting for decode, composition, or surface presentation.
#[tauri::command]
pub fn submit_native_playback_demand(
    app: AppHandle,
    demand: NativePlaybackFrameDemand,
) -> Result<(), String> {
    let state = runtime(&app)?;
    let runtime = state
        .lock()
        .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
    runtime.submit_render_demand(demand)
}

#[tauri::command]
pub fn get_native_playback_state(app: AppHandle) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.state())
}

#[tauri::command]
pub fn native_play(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    let state = with_runtime(&app, |runtime| runtime.play(clock))?;
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        runtime
            .inner()
            .clone()
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?
            .start_render(app.clone());
    }
    Ok(state)
}

#[tauri::command]
pub fn native_pause(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    let state = with_runtime(&app, |runtime| runtime.pause(clock))?;
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        runtime
            .inner()
            .clone()
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?
            .stop_render();
    }
    Ok(state)
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
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        runtime
            .inner()
            .clone()
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?
            .start_render(app.clone());
    }
    Ok(state)
}

#[tauri::command]
pub fn native_pause_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, false, false)?;
    let state = with_runtime(&app, |runtime| runtime.pause(clock))?;
    set_audio_playing(&app, false)?;
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        runtime
            .inner()
            .clone()
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?
            .stop_render();
    }
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

    fn demand(request_id: &str, frame_index: u64) -> NativePlaybackFrameDemand {
        NativePlaybackFrameDemand {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request_id.to_string(),
            frame_time: FrameTime::new(frame_index, frame_index as i64, DEFAULT_TIME_SCALE)
                .unwrap(),
            generation: Some(1),
            mode: Some("playback".to_string()),
            video_layers: Vec::new(),
            raster_layers: Vec::new(),
            text_layers: Vec::new(),
            transition_progress: None,
        }
    }

    #[test]
    fn latest_playback_demand_replaces_obsolete_pending_frame() {
        let mut slot = LatestPlaybackDemand::default();
        slot.replace(demand("old", 1));
        slot.replace(demand("new", 2));
        let current = slot.take().unwrap();
        assert_eq!(current.request_id, "new");
        assert!(slot.take().is_none());
    }
}
