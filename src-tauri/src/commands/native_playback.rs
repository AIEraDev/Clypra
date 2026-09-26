use crate::native_audio::NativeAudioClock;
use crate::native_core::playback::frame_for_audio_position;
use crate::native_core::{
    DecodeCapabilityPolicy, FrameRequest, FrameTime, NativeCoreError, NativePlaybackFrameDemand,
    PlaybackPlan, PlaybackSession, PlaybackState, QualityTier, DEFAULT_TIME_SCALE,
    NATIVE_CORE_CONTRACT_VERSION,
};
use crate::thumbnail_engine::decoder::{
    acquire_preview_decoder_lease_for_stream, get_preview_decoder_for_stream, PreviewDecoderLease,
};
use parking_lot::RwLock;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

/// Rendering is owned by a session separate from the platform-neutral
/// `PlaybackSession`. The latter intentionally has no Tauri, decoder, or wgpu
/// dependencies so its timing/state transitions remain deterministic and
/// independently testable.
struct NativeRenderSession {
    snapshot: RwLock<Arc<FrameRequest>>,
    last_materialized: RwLock<Option<FrameRequest>>,
    active_streams: Mutex<HashSet<(String, String)>>,
    leases: Mutex<Vec<PreviewDecoderLease>>,
    actors: Mutex<Vec<Arc<crate::thumbnail_engine::stream_actor::StreamDecoderActorHandle>>>,
    pending: Mutex<LatestPlaybackDemand>,
    notify: tokio::sync::Notify,
    running: AtomicBool,
    generation: AtomicU64,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    configured_at: Instant,
    ready_after_us: AtomicU64,
    first_presented: AtomicBool,
}

/// One-shot, non-content startup milestones persisted by the frontend in the
/// session archive. They expose the otherwise invisible interval between
/// render-session configuration and first visible native frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePlaybackStartupMilestone {
    stage: &'static str,
    elapsed_us: u64,
    ready_after_us: Option<u64>,
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
    async fn new(snapshot: FrameRequest, configured_at: Instant) -> Result<Arc<Self>, String> {
        snapshot.validate().map_err(|error| error.to_string())?;
        let mut streams = HashSet::new();
        let mut leases = Vec::new();
        let mut actors = Vec::new();
        for layer in &snapshot.project.video_layers {
            if layer.layer_id.ends_with(":subject-cutout") {
                continue;
            }
            let key = (layer.video_path.clone(), layer.layer_id.clone());
            if streams.insert(key) {
                leases.push(
                    acquire_preview_decoder_lease_for_stream(&layer.video_path, &layer.layer_id)
                        .await?,
                );
                actors.push(
                    crate::thumbnail_engine::stream_actor::get_preview_decoder_actor_for_stream(
                        &layer.video_path,
                        &layer.layer_id,
                    )
                    .await?,
                );
            }
        }
        Ok(Arc::new(Self {
            snapshot: RwLock::new(Arc::new(snapshot)),
            last_materialized: RwLock::new(None),
            active_streams: Mutex::new(streams),
            leases: Mutex::new(leases),
            actors: Mutex::new(actors),
            pending: Mutex::new(LatestPlaybackDemand::default()),
            notify: tokio::sync::Notify::new(),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            worker: Mutex::new(None),
            configured_at,
            ready_after_us: AtomicU64::new(0),
            first_presented: AtomicBool::new(false),
        }))
    }

    /// The startup probe chooses one quality policy for the complete
    /// render-session revision. Persist it in the immutable render snapshot so
    /// the worker's initial prime and every subsequent refill use the same
    /// decode scale, rather than only the paused configuration path.
    fn set_preview_quality(&self, quality: QualityTier) {
        let mut snapshot = (**self.snapshot.read()).clone();
        snapshot.quality = quality;
        *self.snapshot.write() = Arc::new(snapshot);
    }

    /// Dynamically update the render snapshot during active playback without
    /// destroying the session, resetting queues, or interrupting presentation.
    async fn update_snapshot(&self, new_snapshot: FrameRequest) -> Result<(), String> {
        new_snapshot.validate().map_err(|error| error.to_string())?;

        let mut streams_to_acquire = Vec::new();
        {
            let mut active = self
                .active_streams
                .lock()
                .map_err(|_| "Active streams lock poisoned".to_string())?;
            for layer in &new_snapshot.project.video_layers {
                if layer.layer_id.ends_with(":subject-cutout") {
                    continue;
                }
                let key = (layer.video_path.clone(), layer.layer_id.clone());
                if active.insert(key.clone()) {
                    streams_to_acquire.push(key);
                }
            }
        }

        let mut new_leases = Vec::new();
        let mut new_actors = Vec::new();
        for (video_path, layer_id) in streams_to_acquire {
            let lease = acquire_preview_decoder_lease_for_stream(&video_path, &layer_id).await?;
            let actor =
                crate::thumbnail_engine::stream_actor::get_preview_decoder_actor_for_stream(
                    &video_path,
                    &layer_id,
                )
                .await?;
            new_leases.push(lease);
            new_actors.push(actor);
        }

        if !new_leases.is_empty() {
            let mut leases_guard = self
                .leases
                .lock()
                .map_err(|_| "Leases lock poisoned".to_string())?;
            leases_guard.extend(new_leases);
        }
        if !new_actors.is_empty() {
            let mut actors_guard = self
                .actors
                .lock()
                .map_err(|_| "Actors lock poisoned".to_string())?;
            actors_guard.extend(new_actors);
        }

        let quality = self.snapshot.read().quality;
        let mut snapshot_to_store = new_snapshot;
        snapshot_to_store.quality = quality;
        if let Some(gen) = snapshot_to_store.generation {
            self.generation.fetch_max(gen, Ordering::AcqRel);
        }
        *self.snapshot.write() = Arc::new(snapshot_to_store);
        *self.last_materialized.write() = None;

        self.notify.notify_one();
        Ok(())
    }

    fn mark_ready(&self) {
        self.ready_after_us.store(
            self.configured_at
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
            Ordering::Release,
        );
    }

    fn start(self: &Arc<Self>, app: AppHandle) {
        if self.running.swap(true, Ordering::AcqRel) {
            return;
        }
        let base_request = (**self.snapshot.read()).clone();
        crate::commands::native_preview::schedule_lookahead_predecode(
            app.clone(),
            base_request,
            16,
            None,
        );
        let session = Arc::clone(self);
        let handle = tauri::async_runtime::spawn(async move {
            session.render_loop(app).await;
        });
        if let Ok(mut worker) = self.worker.lock() {
            *worker = Some(handle);
        }
    }

    fn stop(&self, app: Option<AppHandle>) {
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
        if let Ok(actors) = self.actors.lock() {
            for actor in actors.iter() {
                let a = actor.clone();
                tauri::async_runtime::spawn(async move {
                    a.clear_prime_cache().await;
                });
            }
        }
        if let Some(app) = app {
            tauri::async_runtime::spawn(async move {
                crate::commands::native_preview::reset_native_preview_queue(&app).await;
            });
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
        if let Ok(actors) = self.actors.lock() {
            for actor in actors.iter() {
                actor.invalidate(generation);
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
        let mut request = match demand {
            Some(_) => (**self.snapshot.read()).clone(),
            None => {
                if let Some(last) = self.last_materialized.read().as_ref() {
                    return Ok(last.clone());
                }
                (**self.snapshot.read()).clone()
            }
        };
        if let Some(demand) = demand {
            request.request_id = demand.request_id.clone();
            request.frame_time = demand.frame_time;
            request.generation = demand.generation;
            request.mode = demand.mode.clone();

            if demand.video_layers.is_empty() {
                request.project.video_layers.clear();
            } else if demand.video_layers.len() == request.project.video_layers.len()
                && demand.video_layers.iter().all(|u| u.layer_id.is_none())
            {
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
                    if update.color_grade.is_some() {
                        layer.color_grade = update.color_grade.clone();
                    }
                    if update.body_effect.is_some() {
                        layer.body_effect = update.body_effect.clone();
                    }
                }
            } else {
                let mut new_video_layers = Vec::with_capacity(demand.video_layers.len());
                for (idx, update) in demand.video_layers.iter().enumerate() {
                    let lid = update.layer_id.as_deref().unwrap_or("");
                    if let Some(existing) = request
                        .project
                        .video_layers
                        .iter()
                        .find(|l| !lid.is_empty() && l.layer_id == lid)
                    {
                        let mut layer = existing.clone();
                        layer.source_time = update.source_time;
                        layer.x = update.x;
                        layer.y = update.y;
                        layer.width = update.width;
                        layer.height = update.height;
                        layer.rotation = update.rotation;
                        layer.opacity = update.opacity;
                        layer.z_index = update.z_index;
                        if update.color_grade.is_some() {
                            layer.color_grade = update.color_grade.clone();
                        }
                        if update.body_effect.is_some() {
                            layer.body_effect = update.body_effect.clone();
                        }
                        new_video_layers.push(layer);
                    } else if lid.ends_with(":subject-cutout") {
                        let base_id = lid.strip_suffix(":subject-cutout").unwrap_or("");
                        if let Some(base_layer) = request
                            .project
                            .video_layers
                            .iter()
                            .find(|l| l.layer_id == base_id)
                        {
                            let mut layer = base_layer.clone();
                            layer.layer_id = lid.to_string();
                            layer.source_time = update.source_time;
                            layer.x = update.x;
                            layer.y = update.y;
                            layer.width = update.width;
                            layer.height = update.height;
                            layer.rotation = update.rotation;
                            layer.opacity = update.opacity;
                            layer.z_index = update.z_index;
                            if update.color_grade.is_some() {
                                layer.color_grade = update.color_grade.clone();
                            }
                            layer.body_effect = update.body_effect.clone().or_else(|| {
                                Some(crate::native_core::BodyEffectSnapshot {
                                    mask_asset_id: format!("{lid}_fx-body-cutout-{base_id}"),
                                    renderer: "body_cutout".to_string(),
                                    color_r: 1.0,
                                    color_g: 1.0,
                                    color_b: 1.0,
                                    strength: 1.0,
                                    radius: 4.0,
                                    time: 0.0,
                                })
                            });
                            new_video_layers.push(layer);
                        }
                    } else if let Some(existing) = request.project.video_layers.get(idx) {
                        let mut layer = existing.clone();
                        if !lid.is_empty() {
                            layer.layer_id = lid.to_string();
                        }
                        layer.source_time = update.source_time;
                        layer.x = update.x;
                        layer.y = update.y;
                        layer.width = update.width;
                        layer.height = update.height;
                        layer.rotation = update.rotation;
                        layer.opacity = update.opacity;
                        layer.z_index = update.z_index;
                        if update.color_grade.is_some() {
                            layer.color_grade = update.color_grade.clone();
                        }
                        if update.body_effect.is_some() {
                            layer.body_effect = update.body_effect.clone();
                        }
                        new_video_layers.push(layer);
                    } else if let Some(first) = request.project.video_layers.first() {
                        let mut layer = first.clone();
                        if !lid.is_empty() {
                            layer.layer_id = lid.to_string();
                        }
                        layer.source_time = update.source_time;
                        layer.x = update.x;
                        layer.y = update.y;
                        layer.width = update.width;
                        layer.height = update.height;
                        layer.rotation = update.rotation;
                        layer.opacity = update.opacity;
                        layer.z_index = update.z_index;
                        if update.color_grade.is_some() {
                            layer.color_grade = update.color_grade.clone();
                        }
                        if update.body_effect.is_some() {
                            layer.body_effect = update.body_effect.clone();
                        }
                        new_video_layers.push(layer);
                    }
                }
                if !new_video_layers.is_empty() || demand.video_layers.is_empty() {
                    request.project.video_layers = new_video_layers;
                } else {
                    return Err(
                        "Native playback demand video layers could not be resolved from snapshot"
                            .to_string(),
                    );
                }
            }

            if demand.raster_layers.len() == request.project.raster_layers.len()
                && demand.text_layers.len() == request.project.text_layers.len()
            {
                for (layer, update) in request
                    .project
                    .raster_layers
                    .iter_mut()
                    .zip(&demand.raster_layers)
                {
                    if let Some(layer_id) = &update.layer_id {
                        layer.layer_id = Some(layer_id.clone());
                    }
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
                    if let Some(blend_mode) = &update.blend_mode {
                        layer.blend_mode = blend_mode.clone();
                    }
                    layer.is_mask = update.is_mask;
                }
                for (layer, update) in request
                    .project
                    .text_layers
                    .iter_mut()
                    .zip(&demand.text_layers)
                {
                    if let Some(layer_id) = &update.layer_id {
                        layer.layer_id = Some(layer_id.clone());
                    }
                    layer.x = update.x;
                    layer.y = update.y;
                    layer.rotation = update.rotation;
                    layer.opacity = update.opacity;
                    layer.z_index = update.z_index;
                }
            } else {
                // Dynamic overlay addition / removal / transition (e.g. text clip begins or ends).
                // Rebuild raster_layers and text_layers to match the active demand representation.
                let mut new_raster_layers = Vec::with_capacity(demand.raster_layers.len());
                for (i, update) in demand.raster_layers.iter().enumerate() {
                    let existing = if let Some(lid) = &update.layer_id {
                        request
                            .project
                            .raster_layers
                            .iter()
                            .find(|r| r.layer_id.as_deref() == Some(lid))
                            .cloned()
                    } else {
                        request.project.raster_layers.get(i).cloned()
                    };
                    if let Some(mut layer) = existing {
                        if let Some(layer_id) = &update.layer_id {
                            layer.layer_id = Some(layer_id.clone());
                        }
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
                        if let Some(blend_mode) = &update.blend_mode {
                            layer.blend_mode = blend_mode.clone();
                        }
                        layer.is_mask = update.is_mask;
                        new_raster_layers.push(layer);
                    } else {
                        new_raster_layers.push(crate::native_core::RasterLayerSnapshot {
                            layer_id: update.layer_id.clone(),
                            asset_id: update.asset_id.clone(),
                            rgba: None,
                            width: update.width,
                            height: update.height,
                            display_width: update.display_width,
                            display_height: update.display_height,
                            x: update.x,
                            y: update.y,
                            rotation: update.rotation,
                            opacity: update.opacity,
                            z_index: update.z_index,
                            blend_mode: update
                                .blend_mode
                                .clone()
                                .unwrap_or_else(|| "normal".to_string()),
                            color_grade: None,
                            is_mask: update.is_mask,
                            is_text: true,
                        });
                    }
                }
                request.project.raster_layers = new_raster_layers;

                let mut new_text_layers = Vec::with_capacity(demand.text_layers.len());
                for (i, update) in demand.text_layers.iter().enumerate() {
                    if let Some(existing) = request.project.text_layers.get(i) {
                        let mut layer = existing.clone();
                        if let Some(layer_id) = &update.layer_id {
                            layer.layer_id = Some(layer_id.clone());
                        }
                        layer.x = update.x;
                        layer.y = update.y;
                        layer.rotation = update.rotation;
                        layer.opacity = update.opacity;
                        layer.z_index = update.z_index;
                        new_text_layers.push(layer);
                    }
                }
                request.project.text_layers = new_text_layers;
            }

            if let Some(progress) = demand.transition_progress {
                if let Some(transition) = request.project.transition.as_mut() {
                    transition.progress = progress;
                }
            }

            // Update last_materialized with the successfully applied demand.
            // This ensures subsequent ticks without a new demand fall back to the
            // last known good state rather than reverting to t=0 (preventing text blinking),
            // while preserving self.snapshot as the immutable multi-track project graph.
            *self.last_materialized.write() = Some(request.clone());
        }
        Ok(request)
    }

    async fn render_loop(self: Arc<Self>, app: AppHandle) {
        let frame_rate = self.snapshot.read().project.frame_rate.max(1) as u64;
        let tick_duration = std::time::Duration::from_nanos(1_000_000_000 / frame_rate);
        let mut ticker = tokio::time::interval(tick_duration);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_rendered_frame_index: Option<u64> = None;
        let mut frames_rendered: u64 = 0;
        let mut queue_hits: u64 = 0;
        let mut total_time_sum_us: u64 = 0;
        let mut decode_time_sum_us: u64 = 0;
        let mut max_frame_us: u64 = 0;
        let mut dropped_frames: u64 = 0;
        let mut last_report = Instant::now();

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
                Err(_) => continue,
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
                    if last_rendered_frame_index == Some(frame_index) {
                        continue;
                    }
                    last_rendered_frame_index = Some(frame_index);

                    let mut request = base_request;
                    request.mode = Some("playback".to_string());
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
                            let source_frame_index =
                                (current_source_secs * request.project.frame_rate as f64).round()
                                    as u64;
                            let ticks =
                                (current_source_secs * DEFAULT_TIME_SCALE as f64).round() as i64;
                            if let Ok(ft) =
                                FrameTime::new(source_frame_index, ticks, DEFAULT_TIME_SCALE)
                            {
                                layer.source_time = ft;
                            }
                        }
                    }

                    if let Some(presentation) = self.render_one(&app, request, generation).await {
                        if presentation.presented {
                            frames_rendered += 1;
                            if let Some(t) = &presentation.timings {
                                if t.queue_hit {
                                    queue_hits += 1;
                                }
                                total_time_sum_us += t.total_us;
                                decode_time_sum_us += t.decode_us as u64;
                                max_frame_us = max_frame_us.max(t.total_us);
                            }
                        } else if presentation.dropped {
                            dropped_frames += 1;
                        }

                        #[allow(clippy::manual_is_multiple_of)]
                        if frames_rendered > 0 && frames_rendered % 60 == 0 {
                            let elapsed_secs = last_report.elapsed().as_secs_f64();
                            let fps = if elapsed_secs > 0.0 {
                                (60.0 / elapsed_secs).round()
                            } else {
                                30.0
                            };
                            let hit_rate = (queue_hits as f64 / frames_rendered as f64) * 100.0;
                            let avg_total_ms =
                                (total_time_sum_us as f64 / frames_rendered as f64) / 1000.0;
                            let avg_decode_ms =
                                (decode_time_sum_us as f64 / frames_rendered as f64) / 1000.0;
                            let peak_ms = (max_frame_us as f64) / 1000.0;
                            let stream_count = _active_decoder_lease_count;

                            #[derive(Clone, Serialize)]
                            #[serde(rename_all = "camelCase")]
                            struct PlaybackStatsPayload {
                                frames_rendered: u64,
                                fps: f64,
                                hit_rate_percent: f64,
                                avg_total_ms: f64,
                                avg_decode_ms: f64,
                                max_frame_ms: f64,
                                dropped: u64,
                                stacked_streams: usize,
                            }

                            let _ = app.emit(
                                "native-playback-stats",
                                PlaybackStatsPayload {
                                    frames_rendered,
                                    fps,
                                    hit_rate_percent: hit_rate,
                                    avg_total_ms,
                                    avg_decode_ms,
                                    max_frame_ms: peak_ms,
                                    dropped: dropped_frames,
                                    stacked_streams: stream_count,
                                },
                            );

                            last_report = Instant::now();
                        }
                    }
                    continue;
                }
            }

            // When the audio clock is not running, only render if an explicit
            // dynamic demand was submitted. If dynamic_demand is None, playback
            // is paused or idle; repeatedly rendering and forcing show_surface
            // causes the preview to leak onto the desktop while paused.
            if dynamic_demand.is_none() {
                continue;
            }

            let _ = self.render_one(&app, base_request, generation).await;
        }
    }

    async fn render_one(
        &self,
        app: &AppHandle,
        request: FrameRequest,
        generation: u64,
    ) -> Option<crate::native_core::NativeSurfacePresentation> {
        if generation < self.generation.load(Ordering::Acquire) {
            // Recency cancellation is deliberately before the shared
            // audio-clock lateness decision in present_native_frame.
            return None;
        }
        match crate::commands::native_preview::present_native_frame_internal(app.clone(), request)
            .await
        {
            Ok(presentation) => {
                if presentation.presented {
                    if !self.first_presented.swap(true, Ordering::AcqRel) {
                        let ready_after_us = self.ready_after_us.load(Ordering::Acquire);
                        let _ = app.emit(
                            "clypra://native-playback-startup",
                            NativePlaybackStartupMilestone {
                                stage: "first-native-frame-presented",
                                elapsed_us: self
                                    .configured_at
                                    .elapsed()
                                    .as_micros()
                                    .min(u64::MAX as u128)
                                    as u64,
                                ready_after_us: (ready_after_us > 0).then_some(ready_after_us),
                            },
                        );
                    }
                    if let Some(surface) = app
                        .try_state::<Arc<Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>(
                        )
                    {
                        if let Ok(surface) = surface.inner().clone().lock() {
                            let _ = surface.show_surface();
                        }
                    }
                }
                Some(presentation)
            }
            Err(_) => None,
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
            previous.stop(None);
        }
        self.render_session = Some(render_session);
    }

    fn take_render_session(&mut self) -> Option<Arc<NativeRenderSession>> {
        self.render_session.take()
    }

    fn render_session(&self) -> Option<Arc<NativeRenderSession>> {
        self.render_session.clone()
    }

    /// Expose the capability-probe-selected quality tier for inter-module use
    /// (e.g. the lookahead predecode worker in native_preview.rs).  Returns
    /// `None` when no render session is active.
    pub fn render_session_quality(&self) -> Option<crate::native_core::QualityTier> {
        self.render_session
            .as_ref()
            .map(|s| s.snapshot.read().quality)
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

pub(crate) fn audio_clock_time(
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

    let probe_options = crate::thumbnail_engine::decoder::DecodeFrameOptions {
        allow_keyframe_approx: true,
        quality: QualityTier::Full,
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
        },
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
    let pipeline_warmup = crate::commands::native_preview::prepare_native_preview_pipelines(
        &app,
        canvas_w,
        canvas_h,
        target_format,
    );
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
            snapshot_clone,
            16,
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

    let (old_w, old_h) = {
        let current = session.snapshot.read();
        (current.project.canvas_width, current.project.canvas_height)
    };

    if snapshot.project.canvas_width != old_w || snapshot.project.canvas_height != old_h {
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

        crate::commands::native_preview::prepare_native_preview_pipelines(
            &app,
            snapshot.project.canvas_width,
            snapshot.project.canvas_height,
            target_format,
        )
        .await?;
    }

    let snapshot_clone = snapshot.clone();
    session.update_snapshot(snapshot).await?;

    let lookahead_quality = session.snapshot.read().quality;
    crate::commands::native_preview::schedule_lookahead_predecode(
        app.clone(),
        snapshot_clone,
        16,
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
            .stop_render(app.clone());
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
    let clock = audio_clock_time(&app, false, false)
        .unwrap_or_else(|_| FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap());
    let state = with_runtime(&app, |runtime| runtime.pause(clock));
    let _ = set_audio_playing(&app, false);
    if let Some(runtime) = app.try_state::<Arc<Mutex<NativePlaybackRuntime>>>() {
        if let Ok(runtime) = runtime.inner().clone().lock() {
            runtime.stop_render(app.clone());
        }
    }
    if let Some(surface) =
        app.try_state::<Arc<Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()
    {
        if let Ok(surface) = surface.inner().clone().lock() {
            let _ = surface.hide_surface();
        }
    }
    state
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
    fn coordinator_auto_configures_when_unconfigured() {
        let mut runtime = NativePlaybackRuntime::new();
        assert!(runtime.state().is_ok());
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

    fn test_snapshot_with_text() -> FrameRequest {
        FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "init".to_string(),
            frame_time: clock(0),
            output_width: 1920,
            output_height: 1080,
            quality: crate::native_core::QualityTier::Full,
            color_policy: crate::native_core::ColorPolicy::default(),
            render_graph_version: 1,
            generation: Some(1),
            mode: Some("playback".to_string()),
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
            project: crate::native_core::ProjectSnapshot {
                schema_version: 1,
                project_revision: "test:1".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: Vec::new(),
                raster_layers: Vec::new(),
                text_layers: vec![crate::native_core::TextLayerSnapshot {
                    layer_id: Some("title".to_string()),
                    text: "Hello".to_string(),
                    font_id: "inter".to_string(),
                    font_size: 48.0,
                    font_weight: "normal".to_string(),
                    font_style: "normal".to_string(),
                    letter_spacing: 0.0,
                    line_height: 1.2,
                    color: [1.0, 1.0, 1.0, 1.0],
                    text_align: "center".to_string(),
                    vertical_align: "middle".to_string(),
                    x: 100.0,
                    y: 100.0,
                    box_width: Some(200.0),
                    box_height: Some(100.0),
                    rotation: 0.0,
                    opacity: 0.0,
                    z_index: 1,
                    blend_mode: "normal".to_string(),
                    stroke_color: None,
                    stroke_width: None,
                    shadow_color: None,
                    shadow_offset: None,
                    shadow_blur: None,
                    background: None,
                    runs: Vec::new(),
                    template_id: None,
                    template_data: None,
                    effect: None,
                }],
                transition: None,
            },
        }
    }

    fn test_snapshot() -> FrameRequest {
        let mut s = test_snapshot_with_text();
        s.project.text_layers.clear();
        s
    }

    fn test_session(snapshot: FrameRequest) -> NativeRenderSession {
        NativeRenderSession {
            snapshot: RwLock::new(Arc::new(snapshot)),
            last_materialized: RwLock::new(None),
            active_streams: Mutex::new(HashSet::new()),
            leases: Mutex::new(Vec::new()),
            actors: Mutex::new(Vec::new()),
            pending: Mutex::new(LatestPlaybackDemand::default()),
            notify: tokio::sync::Notify::new(),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(1),
            worker: Mutex::new(None),
            configured_at: Instant::now(),
            ready_after_us: AtomicU64::new(0),
            first_presented: AtomicBool::new(false),
        }
    }

    #[test]
    fn materialize_request_handles_sdf_to_raster_transition() {
        let session = test_session(test_snapshot_with_text());

        let mut d = demand("demand-1", 1);
        d.raster_layers = vec![crate::native_core::NativePlaybackRasterLayerUpdate {
            layer_id: Some("title".to_string()),
            asset_id: "native-text:title:abc".to_string(),
            width: 640,
            height: 120,
            display_width: Some(300.0),
            display_height: Some(60.0),
            x: 150.0,
            y: 120.0,
            rotation: 5.0,
            opacity: 0.85,
            z_index: 2,
            blend_mode: None,
            is_mask: false,
        }];
        d.text_layers = Vec::new();

        let materialized = session
            .materialize_request(Some(&d))
            .expect("transition should succeed");
        assert_eq!(materialized.project.raster_layers.len(), 1);
        assert_eq!(materialized.project.text_layers.len(), 0);
        let raster = &materialized.project.raster_layers[0];
        assert_eq!(raster.asset_id, "native-text:title:abc");
        assert_eq!(raster.opacity, 0.85);
        assert_eq!(raster.display_width, Some(300.0));
    }

    #[test]
    fn materialize_request_retains_last_known_good_state_on_missed_demand_tick() {
        let session = test_session(test_snapshot_with_text());

        // Tick 1: dynamic demand arrives with opacity 0.75
        let mut d = demand("demand-1", 1);
        d.text_layers = vec![crate::native_core::NativePlaybackTextLayerUpdate {
            layer_id: Some("title".to_string()),
            x: 100.0,
            y: 100.0,
            rotation: 0.0,
            opacity: 0.75,
            z_index: 1,
        }];
        let mat1 = session.materialize_request(Some(&d)).unwrap();
        assert_eq!(mat1.project.text_layers[0].opacity, 0.75);

        // Tick 2: demand was taken by slot.take(), leaving None for a synthetic missed tick
        let mat2 = session.materialize_request(None).unwrap();
        // Crucial Fix 1 assertion: opacity must NOT revert to 0.0 (clip start snapshot),
        // it must retain 0.75 (the last applied dynamic state)!
        assert_eq!(mat2.project.text_layers[0].opacity, 0.75);
    }

    #[test]
    fn materialize_request_dynamically_adds_and_removes_overlay_layers() {
        // Session configured with base video only (zero raster layers, zero text layers)
        let session = test_session(test_snapshot());

        // Frame 114: text clip enters on the timeline
        let mut d1 = demand("demand-enter", 114);
        d1.raster_layers = vec![crate::native_core::NativePlaybackRasterLayerUpdate {
            layer_id: Some("clip-title".to_string()),
            asset_id: "native-text:clip-title:v1".to_string(),
            width: 400,
            height: 100,
            display_width: Some(200.0),
            display_height: Some(50.0),
            x: 100.0,
            y: 200.0,
            rotation: 0.0,
            opacity: 0.5,
            z_index: 3,
            blend_mode: Some("screen".to_string()),
            is_mask: false,
        }];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("dynamic addition should succeed");
        assert_eq!(mat1.project.raster_layers.len(), 1);
        let layer = &mat1.project.raster_layers[0];
        assert_eq!(layer.layer_id.as_deref(), Some("clip-title"));
        assert_eq!(layer.asset_id, "native-text:clip-title:v1");
        assert_eq!(layer.opacity, 0.5);
        assert_eq!(layer.display_width, Some(200.0));
        assert_eq!(layer.blend_mode, "screen");

        // Frame 428: text clip exits timeline
        let mut d2 = demand("demand-exit", 428);
        d2.raster_layers = Vec::new();
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("dynamic removal should succeed");
        assert_eq!(mat2.project.raster_layers.len(), 0);

        // Frame 429: missed tick after exit retains empty overlay state
        let mat3 = session.materialize_request(None).unwrap();
        assert_eq!(mat3.project.raster_layers.len(), 0);
    }

    #[test]
    fn materialize_request_dynamically_adds_and_removes_subject_cutout_layers() {
        // Session configured with base video only (layer_id: "video-1")
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![crate::native_core::VideoLayerSnapshot {
            layer_id: "video-1".to_string(),
            asset_id: "video-1".to_string(),
            video_path: "/test/video.mp4".to_string(),
            source_time: FrameTime::new(0, 0, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
            color_grade: None,
            body_effect: None,
        }];
        let session = test_session(snapshot);

        // Frame 50: Behind-subject text clip begins -> cutout synthesized
        let mut d1 = demand("demand-cutout-enter", 50);
        d1.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("video-1".to_string()),
                source_time: FrameTime::new(50, 50, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("video-1:subject-cutout".to_string()),
                source_time: FrameTime::new(50, 50, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 0.0, // Buffering segmentation mask
                z_index: 2,
                color_grade: None,
                body_effect: None,
            },
        ];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("dynamic cutout addition should succeed");
        assert_eq!(mat1.project.video_layers.len(), 2);
        assert_eq!(mat1.project.video_layers[0].layer_id, "video-1");
        assert_eq!(
            mat1.project.video_layers[1].layer_id,
            "video-1:subject-cutout"
        );
        assert_eq!(mat1.project.video_layers[1].opacity, 0.0);
        assert!(mat1.project.video_layers[1].body_effect.is_some());
        assert_eq!(
            mat1.project.video_layers[1]
                .body_effect
                .as_ref()
                .unwrap()
                .renderer,
            "body_cutout"
        );

        // Frame 120: Cutout ends, reverting to single base video layer
        let mut d2 = demand("demand-cutout-exit", 120);
        d2.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("video-1".to_string()),
            source_time: FrameTime::new(120, 120, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("dynamic cutout removal should succeed");
        assert_eq!(mat2.project.video_layers.len(), 1);
        assert_eq!(mat2.project.video_layers[0].layer_id, "video-1");
    }

    #[test]
    fn materialize_request_preserves_body_effect_on_cutout_layers_across_steady_playback() {
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![crate::native_core::VideoLayerSnapshot {
            layer_id: "vid-main".to_string(),
            asset_id: "vid-main".to_string(),
            video_path: "/test/v.mp4".to_string(),
            source_time: FrameTime::new(0, 0, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1280.0,
            height: 720.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            blend_mode: "normal".to_string(),
            color_grade: None,
            body_effect: None,
        }];
        let session = test_session(snapshot);

        // Tick 1: Behind-subject cutout enters with active body_effect mask
        let mut d1 = demand("demand-1", 100);
        d1.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main".to_string()),
                source_time: FrameTime::new(100, 100, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main:subject-cutout".to_string()),
                source_time: FrameTime::new(100, 100, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 2,
                color_grade: None,
                body_effect: Some(crate::native_core::BodyEffectSnapshot {
                    mask_asset_id: "vid-main:subject-cutout_fx:100".to_string(),
                    renderer: "body_cutout".to_string(),
                    color_r: 1.0,
                    color_g: 1.0,
                    color_b: 1.0,
                    strength: 1.0,
                    radius: 4.0,
                    time: 3.33,
                }),
            },
        ];
        let mat1 = session.materialize_request(Some(&d1)).unwrap();
        assert_eq!(mat1.project.video_layers.len(), 2);
        let cutout1 = &mat1.project.video_layers[1];
        assert_eq!(cutout1.layer_id, "vid-main:subject-cutout");
        assert_eq!(cutout1.opacity, 1.0);
        assert!(cutout1.body_effect.is_some());
        assert_eq!(
            cutout1.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:100"
        );

        // Tick 2: Steady state (video layer count unchanged, mask updated)
        let mut d2 = demand("demand-2", 101);
        d2.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main".to_string()),
                source_time: FrameTime::new(101, 101, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("vid-main:subject-cutout".to_string()),
                source_time: FrameTime::new(101, 101, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 2,
                color_grade: None,
                body_effect: Some(crate::native_core::BodyEffectSnapshot {
                    mask_asset_id: "vid-main:subject-cutout_fx:101".to_string(),
                    renderer: "body_cutout".to_string(),
                    color_r: 1.0,
                    color_g: 1.0,
                    color_b: 1.0,
                    strength: 1.0,
                    radius: 4.0,
                    time: 3.36,
                }),
            },
        ];
        let mat2 = session.materialize_request(Some(&d2)).unwrap();
        assert_eq!(mat2.project.video_layers.len(), 2);
        let cutout2 = &mat2.project.video_layers[1];
        assert_eq!(
            cutout2.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:101"
        );

        // Tick 3: Synthetic missed tick (demand is None). Snapshot must retain body_effect!
        let mat3 = session.materialize_request(None).unwrap();
        assert_eq!(mat3.project.video_layers.len(), 2);
        let cutout3 = &mat3.project.video_layers[1];
        assert!(cutout3.body_effect.is_some());
        assert_eq!(
            cutout3.body_effect.as_ref().unwrap().mask_asset_id,
            "vid-main:subject-cutout_fx:101"
        );
        assert_eq!(cutout3.opacity, 1.0);
    }

    #[test]
    fn materialize_request_supports_varying_video_layer_counts_in_multitrack_timeline() {
        let mut snapshot = test_snapshot();
        snapshot.project.video_layers = vec![
            crate::native_core::VideoLayerSnapshot {
                layer_id: "track-1-clip".to_string(),
                asset_id: "asset-1".to_string(),
                video_path: "/test/v1.mp4".to_string(),
                source_time: FrameTime::new(0, 0, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::VideoLayerSnapshot {
                layer_id: "track-2-clip".to_string(),
                asset_id: "asset-2".to_string(),
                video_path: "/test/v2.mp4".to_string(),
                source_time: FrameTime::new(0, 0, 30).unwrap(),
                x: 200.0,
                y: 200.0,
                width: 640.0,
                height: 360.0,
                rotation: 0.0,
                opacity: 0.8,
                z_index: 1,
                blend_mode: "normal".to_string(),
                color_grade: None,
                body_effect: None,
            },
        ];
        let session = test_session(snapshot);

        // Frame 10: Single track active (demand has only track 1)
        let mut d1 = demand("demand-t1", 10);
        d1.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("track-1-clip".to_string()),
            source_time: FrameTime::new(10, 10, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat1 = session
            .materialize_request(Some(&d1))
            .expect("single track demand should succeed on multitrack session");
        assert_eq!(mat1.project.video_layers.len(), 1);
        assert_eq!(mat1.project.video_layers[0].layer_id, "track-1-clip");

        // Frame 30: Both tracks active (PIP overlay)
        let mut d2 = demand("demand-pip", 30);
        d2.video_layers = vec![
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("track-1-clip".to_string()),
                source_time: FrameTime::new(30, 30, 30).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                color_grade: None,
                body_effect: None,
            },
            crate::native_core::NativePlaybackVideoLayerUpdate {
                layer_id: Some("track-2-clip".to_string()),
                source_time: FrameTime::new(15, 15, 30).unwrap(),
                x: 250.0,
                y: 180.0,
                width: 640.0,
                height: 360.0,
                rotation: 5.0,
                opacity: 0.9,
                z_index: 1,
                color_grade: None,
                body_effect: None,
            },
        ];
        let mat2 = session
            .materialize_request(Some(&d2))
            .expect("pip multitrack demand should succeed");
        assert_eq!(mat2.project.video_layers.len(), 2);
        assert_eq!(mat2.project.video_layers[0].layer_id, "track-1-clip");
        assert_eq!(mat2.project.video_layers[1].layer_id, "track-2-clip");
        assert_eq!(mat2.project.video_layers[1].rotation, 5.0);

        // Frame 50: Gap / title card (zero video layers)
        let mut d3 = demand("demand-gap", 50);
        d3.video_layers = Vec::new();
        let mat3 = session
            .materialize_request(Some(&d3))
            .expect("gap with 0 video layers should succeed");
        assert!(mat3.project.video_layers.is_empty());

        // Frame 70: Track 2 only active
        let mut d4 = demand("demand-t2-only", 70);
        d4.video_layers = vec![crate::native_core::NativePlaybackVideoLayerUpdate {
            layer_id: Some("track-2-clip".to_string()),
            source_time: FrameTime::new(55, 55, 30).unwrap(),
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 0,
            color_grade: None,
            body_effect: None,
        }];
        let mat4 = session
            .materialize_request(Some(&d4))
            .expect("track 2 only demand should succeed");
        assert_eq!(mat4.project.video_layers.len(), 1);
        assert_eq!(mat4.project.video_layers[0].layer_id, "track-2-clip");
        assert_eq!(mat4.project.video_layers[0].video_path, "/test/v2.mp4");
    }
}
