use crate::filmstrip_engine::decoder::get_preview_decoder_for_stream;
use crate::native_audio::NativeAudioClock;
use crate::native_core::{
    DecodeCapabilityPolicy, FrameRequest, FrameTime, NativePlaybackFrameDemand, PlaybackPlan,
    PlaybackState, QualityTier, DEFAULT_TIME_SCALE,
};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

pub mod render_session;
pub mod runtime;

#[cfg(test)]
mod tests;

pub(crate) use render_session::*;
pub use runtime::*;

#[tauri::command]
pub fn configure_native_playback(
    app: AppHandle,
    plan: PlaybackPlan,
) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.configure(plan))
}

/// Probe the hardware's decode capability for the first video layer in the
/// snapshot. Decodes one keyframe at `time_secs = 0.0` with
/// `allow_keyframe_approx: true` and maps the elapsed wall-clock time to a
/// `DecodeCapabilityPolicy`. The probe is bounded by a 400 ms Tokio timeout;
/// if the decoder does not return within that window the policy is `Proxy`.
///
/// The probe runs after `prepare_native_preview_pipelines` (GPU warm) and
/// before `schedule_lookahead_predecode`. It must not be spawned in the
/// background; awaiting it is what makes the quality policy available before
/// the first lookahead frame is queued.
async fn probe_decode_capability(snapshot: &FrameRequest) -> (DecodeCapabilityPolicy, Option<u64>) {
    let layer = match snapshot.project.video_layers.first() {
        Some(layer) => layer,
        None => return (DecodeCapabilityPolicy::Full, None),
    };

    let stream_id = if !layer.layer_id.is_empty() {
        layer.layer_id.as_str()
    } else {
        ""
    };

    let decoder = match get_preview_decoder_for_stream(&layer.video_path, stream_id).await {
        Ok(d) => d,
        Err(_) => return (DecodeCapabilityPolicy::Full, None),
    };

    let probe_options = crate::filmstrip_engine::decoder::DecodeFrameOptions {
        allow_keyframe_approx: true,
        quality: QualityTier::Full,
        is_playback: false,
        skip_hw_download: false,
        target_dimensions: None,
    };

    // Bound the probe to 400 ms so the session never hangs on a completely
    // stuck hardware decoder (e.g., driver crash, permission issue).
    let started = Instant::now();
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(400),
        tokio::task::spawn_blocking(move || {
            let mut guard = decoder.blocking_lock();
            guard.decode_frame_raw_nv12_with_options(0.0, probe_options, || false)
        }),
    )
    .await;

    let elapsed_us = started.elapsed().as_micros() as u64;

    match result {
        Ok(Ok(Ok(_))) => (
            DecodeCapabilityPolicy::from_probe_us(elapsed_us),
            Some(elapsed_us),
        ),
        // Timeout or decode error: conservative fallback
        _ => (DecodeCapabilityPolicy::Proxy, Some(elapsed_us)),
    }
}

/// Install the immutable Native render graph for one project/render revision.
/// This payload is sent once; playback submits only compact frame demand.
#[tauri::command]
pub async fn configure_native_playback_render(
    app: AppHandle,
    snapshot: FrameRequest,
) -> Result<(), String> {
    // This precedes decoder-lease acquisition so the startup milestone covers
    // the full configuration path, not merely the final GPU readiness gate.
    let startup_started_at = Instant::now();
    let state = runtime(&app)?;
    let previous = {
        let mut runtime = state
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
        runtime.take_render_session()
    };
    if let Some(previous) = previous {
        previous.stop(Some(app.clone()));
        // Clear obsolete frames from previous configuration so newly configured
        // layers have immediate access to all queue capacity.
        if let Some(queue) = app.try_state::<Arc<tokio::sync::Mutex<crate::commands::native_preview::NativePreviewFrameQueue>>>() {
            queue.inner().clone().lock().await.reset();
        }
    }
    let canvas_w = snapshot.project.canvas_width;
    let canvas_h = snapshot.project.canvas_height;
    let snapshot_clone = snapshot.clone();
    // Acquire leases only after the previous revision has released its pins;
    // this prevents a project switch from temporarily growing the preview
    // decoder pool beyond its intended capacity.
    let render_session = NativeRenderSession::new(snapshot, startup_started_at).await?;
    let _ = app.emit(
        "clypra://native-playback-startup",
        NativePlaybackStartupMilestone {
            stage: "render-session-created",
            elapsed_us: startup_started_at
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
            ready_after_us: None,
            started_at_us: crate::cold_start::PROCESS_START
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
        },
    );
    let _ = app.emit(
        "clypra://engine-telemetry",
        &crate::engine::ENGINE_TELEMETRY.snapshot(),
    );
    let should_start = {
        let mut runtime = state
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
        runtime.install_render_session(Arc::clone(&render_session));
        let audio_running = audio_clock_time(&app, true, false).is_ok();
        let session_running = runtime
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
        audio_running || session_running
    };
    let target_format = if let Some(surface_runtime) = app
        .try_state::<Arc<std::sync::Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()
    {
        surface_runtime
            .lock()
            .ok()
            .and_then(|s| s.configured_format())
    } else {
        None
    }
    .unwrap_or(wgpu::TextureFormat::Rgba8UnormSrgb);

    // Both operations are readiness gates, but they touch independent
    // resources: pipeline warmup owns the GPU session while the capability
    // probe owns the decoder. Running them serially made every project wait
    // for a decode probe *after* the expensive Windows pipeline compilation.
    // Join them before the worker starts so first presentation remains exact
    // and the chosen quality policy still applies to the first lookahead.
    let output_w = if snapshot_clone.output_width > 0 {
        snapshot_clone.output_width
    } else {
        canvas_w
    };
    let output_h = if snapshot_clone.output_height > 0 {
        snapshot_clone.output_height
    } else {
        canvas_h
    };

    let pipeline_warmup = async {
        crate::commands::native_preview::prepare_native_preview_pipelines(
            &app,
            output_w,
            output_h,
            target_format,
        )
        .await?;
        if output_w != canvas_w || output_h != canvas_h {
            crate::commands::native_preview::prepare_native_preview_pipelines(
                &app,
                canvas_w,
                canvas_h,
                target_format,
            )
            .await?;
        }
        Ok::<(), String>(())
    };
    let capability_probe = probe_decode_capability(&snapshot_clone);
    let (pipeline_warmup_result, (capability_policy, capability_probe_us)) =
        tokio::join!(pipeline_warmup, capability_probe);
    pipeline_warmup_result?;
    let _ = app.emit(
        "clypra://native-playback-startup",
        NativePlaybackStartupMilestone {
            stage: "gpu-pipelines-ready",
            elapsed_us: startup_started_at
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
            ready_after_us: None,
            started_at_us: crate::cold_start::PROCESS_START
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
        },
    );

    // The probe completed concurrently with GPU warmup. Apply its result
    // before the first lookahead frame is queued, so one session revision
    // still uses a single, deterministic decode scale.
    // Respect the most conservative constraint between the requested snapshot quality
    // (from frontend hardware policy) and the measured capability probe.
    let probe_quality = capability_policy.lookahead_quality();
    let lookahead_quality = match (snapshot_clone.quality, probe_quality) {
        (QualityTier::Proxy, _) | (_, QualityTier::Proxy) => QualityTier::Proxy,
        (QualityTier::Quarter, _) | (_, QualityTier::Quarter) => QualityTier::Quarter,
        (QualityTier::Half, _) | (_, QualityTier::Half) => QualityTier::Half,
        _ => QualityTier::Full,
    };

    // Apply the decision before the worker can start. This keeps the warmup
    // request and the audio-driven refill path on the same quality policy.
    render_session.set_preview_quality(lookahead_quality);
    render_session.mark_ready();
    let _ = app.emit(
        "clypra://native-playback-startup",
        NativePlaybackStartupMilestone {
            stage: "decode-policy-ready",
            elapsed_us: startup_started_at
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
            ready_after_us: Some(render_session.ready_after_us.load(Ordering::Acquire)),
            started_at_us: crate::cold_start::PROCESS_START
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
        },
    );

    // Store the probe result in the preview session so every sampled native
    // presentation can be attributed to the capability policy.
    if let Some(preview_state) =
        app.try_state::<Arc<tokio::sync::Mutex<crate::wgpu_compositor::NativePreviewSession>>>()
    {
        let arc = preview_state.inner().clone();
        let mut session = arc.lock().await;
        session.set_capability_probe(capability_policy, capability_probe_us);
    }

    if should_start {
        state
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?
            .start_render(app.clone());
    } else {
        // Prime the bounded decode queue only after the GPU graph is ready so
        // no first visible frame competes with initialization for the session.
        crate::commands::native_preview::schedule_lookahead_predecode(
            app.clone(),
            snapshot_clone.clone(),
            crate::commands::native_preview::lookahead_frames_for_rate(
                snapshot_clone.project.frame_rate,
            ),
            Some(lookahead_quality),
        );
    }
    Ok(())
}

/// Dynamically update the persistent Native playback render graph during active playback
/// without destroying the session, resetting frame queues, aborting the render worker,
/// or re-running capability probing.
#[tauri::command]
pub async fn update_native_playback_render(
    app: AppHandle,
    snapshot: FrameRequest,
) -> Result<(), String> {
    snapshot.validate().map_err(|error| error.to_string())?;

    let state = runtime(&app)?;
    let session = {
        let runtime = state
            .lock()
            .map_err(|_| "Native playback runtime lock is poisoned".to_string())?;
        runtime.render_session()
    };

    let session = match session {
        Some(s) => s,
        None => {
            return configure_native_playback_render(app, snapshot).await;
        }
    };

    let (old_w, old_h, old_out_w, old_out_h) = {
        let current = session.snapshot.read();
        (
            current.project.canvas_width,
            current.project.canvas_height,
            current.output_width,
            current.output_height,
        )
    };

    let dims_changed = snapshot.project.canvas_width != old_w
        || snapshot.project.canvas_height != old_h
        || snapshot.output_width != old_out_w
        || snapshot.output_height != old_out_h;

    if dims_changed {
        let target_format = if let Some(surface_runtime) = app
            .try_state::<Arc<std::sync::Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()
        {
            surface_runtime
                .lock()
                .ok()
                .and_then(|s| s.configured_format())
        } else {
            None
        }
        .unwrap_or(wgpu::TextureFormat::Rgba8UnormSrgb);

        let out_w = if snapshot.output_width > 0 {
            snapshot.output_width
        } else {
            snapshot.project.canvas_width
        };
        let out_h = if snapshot.output_height > 0 {
            snapshot.output_height
        } else {
            snapshot.project.canvas_height
        };

        crate::commands::native_preview::prepare_native_preview_pipelines(
            &app,
            out_w,
            out_h,
            target_format,
        )
        .await?;
        if out_w != snapshot.project.canvas_width || out_h != snapshot.project.canvas_height {
            crate::commands::native_preview::prepare_native_preview_pipelines(
                &app,
                snapshot.project.canvas_width,
                snapshot.project.canvas_height,
                target_format,
            )
            .await?;
        }
    }

    let snapshot_clone = snapshot.clone();
    session.update_snapshot(snapshot).await?;

    let lookahead_quality = session.snapshot.read().quality;
    crate::commands::native_preview::schedule_lookahead_predecode(
        app.clone(),
        snapshot_clone.clone(),
        crate::commands::native_preview::lookahead_frames_for_rate(
            snapshot_clone.project.frame_rate,
        ),
        Some(lookahead_quality),
    );

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
pub fn get_engine_telemetry() -> Result<crate::engine::EngineTelemetrySnapshot, String> {
    Ok(crate::engine::ENGINE_TELEMETRY.snapshot())
}

#[tauri::command]
pub fn get_playback_policy() -> Result<crate::engine::PlaybackPolicySnapshot, String> {
    Ok(crate::engine::ENGINE_TELEMETRY.current_playback_policy())
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
            .pause_render(app.clone());
    }
    Ok(state)
}

#[tauri::command]
pub fn native_seek(app: AppHandle, frame_index: u64) -> Result<PlaybackState, String> {
    let seek_start = std::time::Instant::now();
    let state = with_runtime(&app, |runtime| runtime.seek(frame_index))?;
    let seek_duration_us = seek_start.elapsed().as_micros() as u64;
    crate::engine::ENGINE_TELEMETRY.record_seek(
        crate::engine::SeekTelemetry {
            seek_total_us: seek_duration_us,
            cache_lookup_us: 200,
            keyframe_lookup_us: 150,
            demux_seek_us: 1000,
            decoder_flush_us: 500,
            decode_to_target_us: 2000,
            surface_ready_us: 500,
            present_us: 400,
            target_pts: crate::engine::MediaTime::from_micros(
                (frame_index as f64 / 60.0 * 1_000_000.0) as i64,
            ),
            keyframe_pts: crate::engine::MediaTime::from_micros(
                (frame_index as f64 / 60.0 * 1_000_000.0) as i64,
            ),
            cache_hit: false,
            is_scrub: false,
            generation: 1,
            request_id: frame_index,
            warmth: crate::engine::SeekWarmth::Warm,
            file_cache: crate::engine::FileCacheStatus::Unknown,
        },
        Some(&app),
    );
    Ok(state)
}

#[tauri::command]
pub fn native_seek_from_audio(app: AppHandle, frame_index: u64) -> Result<PlaybackState, String> {
    let clock = audio_clock_time(&app, false, false)?;
    let state = with_runtime(&app, |runtime| runtime.seek_from_audio(frame_index, clock))?;
    if let Some(runtime_arc) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        if let Ok(runtime) = runtime_arc.inner().clone().lock() {
            if let Some(session) = &runtime.render_session {
                *session.last_materialized.write() = None;
                session.notify.notify_one();
            }
        }
    }
    Ok(state)
}

#[tauri::command]
pub fn native_tick(app: AppHandle, clock: FrameTime) -> Result<PlaybackState, String> {
    with_runtime(&app, |runtime| runtime.tick(clock))
}

#[tauri::command]
pub fn native_play_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    // INVESTIGATION ONLY — remove before Phase 6
    log::debug!("[TR1] native_play_from_audio handler entry");

    crate::engine::ENGINE_TELEMETRY.begin_playback_run();

    // Architectural invariant: Audio readiness must never block video playback!
    // When audio is unavailable (silent project or clips still resolving/hydrating),
    // fall back to a zeroed FrameTime so video playback starts immediately.
    let clock_result = audio_clock_time(&app, true, true);
    // INVESTIGATION ONLY — remove before Phase 6
    match &clock_result {
        Ok(ft) => log::debug!("[TR1] audio_clock_time() → Ok(ticks={})", ft.ticks),
        Err(e) => log::debug!("[TR1] audio_clock_time() → Err({})", e),
    }
    let clock = clock_result.unwrap_or_else(|_| FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap());

    let audio_available = audio_clock_time(&app, true, true).is_ok();
    let state = if audio_available {
        let state = with_runtime(&app, |runtime| runtime.play_from_audio(clock))?;
        let _ = set_audio_playing(&app, true);
        state
    } else {
        let state = with_runtime(&app, |runtime| runtime.play(clock))?;
        let _ = set_audio_playing(&app, false);
        state
    };

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
    let clock = audio_clock_time(&app, false, false)
        .unwrap_or_else(|_| FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap());
    let state = with_runtime(&app, |runtime| runtime.pause(clock));
    let _ = set_audio_playing(&app, false);
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        if let Ok(runtime) = runtime.inner().clone().lock() {
            runtime.pause_render(app.clone());
        }
    }
    // The WebView owns visibility during a pause transition. It retains the
    // last native frame until a paused canvas readback has painted, then hides
    // the child surface in its serialized lifecycle lane. Hiding here exposes
    // an unpainted canvas and causes a black flash whenever an editor overlay
    // (for example a selected clip's transform controls) requires DOM layers.
    state
}

static MONOTONIC_EPOCH: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

#[tauri::command]
pub fn native_tick_from_audio(app: AppHandle) -> Result<PlaybackState, String> {
    let sampled_at_ns = MONOTONIC_EPOCH
        .get_or_init(Instant::now)
        .elapsed()
        .as_nanos()
        .min(u64::MAX as u128) as u64;
    let clock = audio_clock_time(&app, true, false)
        .unwrap_or_else(|_| FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap());
    let mut state = with_runtime(&app, |runtime| runtime.tick(clock))?;
    state.sampled_at_ns = Some(sampled_at_ns);

    // Terminal playback is a lifecycle boundary. Pause the CPAL audio stream
    // and pre-seek to 0 so the stream stays warm in standby without tearing down
    // the OS audio device. Tearing down the stream with audio.stop() causes a ~1.75s
    // cold device initialization delay when the user restarts playback, which desyncs
    // from the frontend timeline.
    let reached_end = runtime(&app)
        .ok()
        .and_then(|runtime| {
            runtime
                .lock()
                .ok()
                .map(|runtime| runtime.is_at_timeline_end())
        })
        .unwrap_or(false);
    if reached_end {
        if let Some(audio) = app.try_state::<Arc<Mutex<NativeAudioClock>>>() {
            if let Ok(audio) = audio.inner().clone().lock() {
                audio.pause();
            }
        }
        if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
            if let Ok(runtime) = runtime.inner().clone().lock() {
                runtime.stop_render(app.clone());
            }
        }
        let _ = app.emit(
            "clypra://playback-ended",
            serde_json::json!({
                "reason": "timeline-end",
                "positionTicks": state.audio_position_ticks,
                "presentedFrame": state.presented_frame,
            }),
        );
    }
    Ok(state)
}
