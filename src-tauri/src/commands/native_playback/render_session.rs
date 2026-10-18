use super::runtime::audio_clock_time;
use crate::filmstrip_engine::decoder::{
    acquire_preview_decoder_lease_for_stream, PreviewDecoderLease,
};
use crate::native_core::playback::frame_for_audio_position;
use crate::native_core::{
    FrameRequest, FrameTime, NativePlaybackFrameDemand, PlaybackPlan, QualityTier,
    DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
use parking_lot::RwLock;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) struct NativeRenderSession {
    pub(crate) snapshot: RwLock<Arc<FrameRequest>>,
    pub(crate) last_materialized: RwLock<Option<FrameRequest>>,
    pub(crate) active_streams: Mutex<HashSet<(String, String)>>,
    pub(crate) leases: Mutex<HashMap<(String, String), PreviewDecoderLease>>,
    pub(crate) actors: Mutex<
        HashMap<
            (String, String),
            Arc<crate::filmstrip_engine::stream_actor::StreamDecoderActorHandle>,
        >,
    >,
    pub(crate) pending: Mutex<LatestPlaybackDemand>,
    pub(crate) notify: tokio::sync::Notify,
    pub(crate) running: AtomicBool,
    pub(crate) generation: AtomicU64,
    pub(crate) worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub(crate) configured_at: Instant,
    pub(crate) ready_after_us: AtomicU64,
    pub(crate) first_presented: AtomicBool,
    /// Playback lookahead may need a more conservative scale than the
    /// startup keyframe probe selected. This is deliberately separate from
    /// `snapshot.quality`: exact paused/scrub requests must keep their
    /// requested quality even when continuous playback misses deadlines.
    pub(crate) playback_quality: AtomicU8,
    pub(crate) playback_lookahead_miss_streak: AtomicU8,
    /// Misses before the first successful queued playback frame are startup
    /// or pause/resume transition noise, not evidence that the active GOP is
    /// too expensive. Arm adaptive lookahead only after the queue proves it
    /// can feed presentation.
    pub(crate) playback_lookahead_feedback_armed: AtomicBool,
}

const LOOKAHEAD_QUALITY_DOWNGRADE_MISS_STREAK: u8 = 2;

pub(crate) fn quality_to_code(quality: QualityTier) -> u8 {
    match quality {
        QualityTier::Full => 0,
        QualityTier::Half => 1,
        QualityTier::Quarter => 2,
        QualityTier::Proxy => 3,
    }
}

fn quality_from_code(code: u8) -> QualityTier {
    match code {
        1 => QualityTier::Half,
        2 => QualityTier::Quarter,
        3 => QualityTier::Proxy,
        _ => QualityTier::Full,
    }
}

/// One keyframe can underestimate the cost of later GOPs. After two
/// consecutive missed presentation deadlines, reduce only the background
/// playback lookahead scale by one useful tier. `Quarter` and `Proxy` have
/// the same decoder scale, so neither is reduced further.
pub(crate) fn playback_quality_after_lookahead_misses(
    quality: QualityTier,
    consecutive_misses: u8,
) -> QualityTier {
    if consecutive_misses < LOOKAHEAD_QUALITY_DOWNGRADE_MISS_STREAK {
        return quality;
    }
    match quality {
        QualityTier::Full => QualityTier::Half,
        QualityTier::Half => QualityTier::Quarter,
        QualityTier::Quarter | QualityTier::Proxy => quality,
    }
}

/// One-shot, non-content startup milestones persisted by the frontend in the
/// session archive. They expose the otherwise invisible interval between
/// render-session configuration and first visible native frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativePlaybackStartupMilestone {
    pub(crate) stage: &'static str,
    pub(crate) elapsed_us: u64,
    pub(crate) ready_after_us: Option<u64>,
    pub(crate) started_at_us: u64,
}

#[derive(Default)]
pub(crate) struct LatestPlaybackDemand {
    pub(crate) value: Option<NativePlaybackFrameDemand>,
}

/// Exact paused/scrub demands are distinct from continuous playback. They
/// must not be coalesced by the audio-clock frame-address fast path because
/// the WebView awaits their matching completion event.
pub(crate) fn should_follow_audio_clock(has_explicit_demand: bool) -> bool {
    !has_explicit_demand
}

impl LatestPlaybackDemand {
    pub(crate) fn replace(&mut self, demand: NativePlaybackFrameDemand) {
        self.value = Some(demand);
    }

    pub(crate) fn take(&mut self) -> Option<NativePlaybackFrameDemand> {
        self.value.take()
    }
}

impl NativeRenderSession {
    pub(crate) async fn new(
        snapshot: FrameRequest,
        configured_at: Instant,
    ) -> Result<Arc<Self>, String> {
        snapshot.validate().map_err(|error| error.to_string())?;
        let initial_playback_quality = snapshot.quality;
        let mut streams = HashSet::new();
        let mut leases = HashMap::new();
        let mut actors = HashMap::new();
        for layer in &snapshot.project.video_layers {
            if layer.layer_id.ends_with(":subject-cutout") {
                continue;
            }
            let key = (layer.video_path.clone(), layer.layer_id.clone());
            if streams.insert(key.clone()) {
                leases.insert(
                    key.clone(),
                    acquire_preview_decoder_lease_for_stream(&layer.video_path, &layer.layer_id)
                        .await?,
                );
                actors.insert(
                    key,
                    crate::filmstrip_engine::stream_actor::get_preview_decoder_actor_for_stream(
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
            playback_quality: AtomicU8::new(quality_to_code(initial_playback_quality)),
            playback_lookahead_miss_streak: AtomicU8::new(0),
            playback_lookahead_feedback_armed: AtomicBool::new(false),
        }))
    }

    /// The startup probe chooses one quality policy for the complete
    /// render-session revision. Persist it in the immutable render snapshot so
    /// the worker's initial prime and every subsequent refill use the same
    /// decode scale, rather than only the paused configuration path.
    pub(crate) fn set_preview_quality(&self, quality: QualityTier) {
        let mut snapshot = (**self.snapshot.read()).clone();
        snapshot.quality = quality;
        *self.snapshot.write() = Arc::new(snapshot);
        self.playback_quality
            .store(quality_to_code(quality), Ordering::Release);
        self.reset_playback_lookahead_feedback();
    }

    pub(crate) fn playback_quality(&self) -> QualityTier {
        quality_from_code(self.playback_quality.load(Ordering::Acquire))
    }

    /// Record a visible playback deadline that could not consume a queued
    /// frame. This only changes the quality used by future lookahead work;
    /// the immutable snapshot remains the authority for paused P0 renders.
    pub(crate) fn record_playback_lookahead_miss(&self) -> QualityTier {
        if !self
            .playback_lookahead_feedback_armed
            .load(Ordering::Acquire)
        {
            return self.playback_quality();
        }
        let consecutive_misses = self
            .playback_lookahead_miss_streak
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        let current = self.playback_quality();
        let next = playback_quality_after_lookahead_misses(current, consecutive_misses);
        if next != current {
            self.playback_quality
                .store(quality_to_code(next), Ordering::Release);
            // A further downgrade requires another consecutive miss pair at
            // the new scale, avoiding a Full -> Quarter jump from one stall.
            self.playback_lookahead_miss_streak
                .store(0, Ordering::Release);
        }
        next
    }

    pub(crate) fn record_playback_lookahead_hit(&self) {
        self.playback_lookahead_feedback_armed
            .store(true, Ordering::Release);
        self.playback_lookahead_miss_streak
            .store(0, Ordering::Release);
    }

    /// Start a fresh measurement epoch for continuous playback. A pause is
    /// intentionally *not* a render-session teardown: the latest-only worker
    /// must remain alive to present the explicit paused-frame demand submitted
    /// by the WebView after audio stops.
    pub(crate) fn pause_continuous_playback(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.value = None;
        }
        self.reset_playback_lookahead_feedback();
        self.notify.notify_one();
    }

    pub(crate) fn reset_playback_lookahead_feedback(&self) {
        self.playback_lookahead_feedback_armed
            .store(false, Ordering::Release);
        self.playback_lookahead_miss_streak
            .store(0, Ordering::Release);
    }

    /// Reconcile active streams with the current snapshot, dropping leases and actors
    /// for clips that have exited playback to prevent resource exhaustion (CLY-BUG-012).
    pub(crate) fn reconcile_active_streams(&self, new_active: &HashSet<(String, String)>) {
        if let Ok(mut active) = self.active_streams.lock() {
            *active = new_active.clone();
        }
        if let Ok(mut leases) = self.leases.lock() {
            leases.retain(|key, _| new_active.contains(key));
        }
        if let Ok(mut actors) = self.actors.lock() {
            actors.retain(|key, _| new_active.contains(key));
        }
    }

    /// Dynamically update the render snapshot during active playback without
    /// destroying the session, resetting queues, or interrupting presentation.
    pub(crate) async fn update_snapshot(&self, new_snapshot: FrameRequest) -> Result<(), String> {
        new_snapshot.validate().map_err(|error| error.to_string())?;

        let mut new_active_streams = HashSet::new();
        for layer in &new_snapshot.project.video_layers {
            if layer.layer_id.ends_with(":subject-cutout") {
                continue;
            }
            new_active_streams.insert((layer.video_path.clone(), layer.layer_id.clone()));
        }

        let streams_to_acquire: Vec<(String, String)> = {
            let active = self
                .active_streams
                .lock()
                .map_err(|_| "Active streams lock poisoned".to_string())?;
            new_active_streams
                .iter()
                .filter(|key| !active.contains(*key))
                .cloned()
                .collect()
        };

        let mut new_leases = Vec::new();
        let mut new_actors = Vec::new();
        for (video_path, layer_id) in streams_to_acquire {
            let lease = acquire_preview_decoder_lease_for_stream(&video_path, &layer_id).await?;
            let actor =
                crate::filmstrip_engine::stream_actor::get_preview_decoder_actor_for_stream(
                    &video_path,
                    &layer_id,
                )
                .await?;
            new_leases.push(((video_path.clone(), layer_id.clone()), lease));
            new_actors.push(((video_path, layer_id), actor));
        }

        // Reconcile before inserting newly acquired streams so exited clip decoders
        // are cleanly dropped and freed back into the pool.
        self.reconcile_active_streams(&new_active_streams);

        if !new_leases.is_empty() {
            let mut leases_guard = self
                .leases
                .lock()
                .map_err(|_| "Leases lock poisoned".to_string())?;
            for (key, lease) in new_leases {
                leases_guard.insert(key, lease);
            }
        }
        if !new_actors.is_empty() {
            let mut actors_guard = self
                .actors
                .lock()
                .map_err(|_| "Actors lock poisoned".to_string())?;
            for (key, actor) in new_actors {
                actors_guard.insert(key, actor);
            }
        }

        // The snapshot remains the requested-quality source for explicit
        // paused demands. Adaptive quality is playback-lookahead-only.
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

    pub(crate) fn mark_ready(&self) {
        self.ready_after_us.store(
            self.configured_at
                .elapsed()
                .as_micros()
                .min(u64::MAX as u128) as u64,
            Ordering::Release,
        );
    }

    pub(crate) fn start(self: &Arc<Self>, app: AppHandle) {
        // Do not carry missed-deadline history from a stopped/paused audio
        // clock into a new playback epoch.
        self.reset_playback_lookahead_feedback();
        let was_running = self.running.swap(true, Ordering::AcqRel);
        let generation = self.generation.load(Ordering::Acquire);
        let quality = self.playback_quality();
        let mut base_request = (**self.snapshot.read()).clone();
        base_request.generation = Some(generation);

        if was_running {
            *self.last_materialized.write() = None;
            crate::commands::native_preview::schedule_lookahead_predecode(
                app.clone(),
                base_request.clone(),
                crate::commands::native_preview::lookahead_frames_for_rate(
                    base_request.project.frame_rate,
                ),
                Some(quality),
            );
            self.notify.notify_one();
            return;
        }

        crate::commands::native_preview::schedule_lookahead_predecode(
            app.clone(),
            base_request,
            crate::commands::native_preview::lookahead_frames_for_rate(
                self.snapshot.read().project.frame_rate,
            ),
            Some(quality),
        );
        let session = Arc::clone(self);
        let handle = tauri::async_runtime::spawn(async move {
            session.render_loop(app).await;
        });
        if let Ok(mut worker) = self.worker.lock() {
            *worker = Some(handle);
        }
    }

    pub(crate) fn stop(&self, app: Option<AppHandle>) {
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
            for actor in actors.values() {
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
    pub(crate) fn invalidate(&self, generation: u64) {
        self.generation.fetch_max(generation, Ordering::AcqRel);
        *self.last_materialized.write() = None;
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
            for actor in actors.values() {
                actor.invalidate(generation);
            }
        }
        self.notify.notify_one();
    }

    pub(crate) fn submit(&self, demand: NativePlaybackFrameDemand) -> Result<(), String> {
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

    pub(crate) fn materialize_request(
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
        let mut last_rendered_generation: u64 = 0;
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
            if generation != last_rendered_generation {
                last_rendered_generation = generation;
                last_rendered_frame_index = None;
            }
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

            // Continuous playback follows Rust's native audio clock. An
            // explicit paused/scrub demand deliberately bypasses this branch:
            // it is an exact P0 request and must render (and acknowledge) even
            // when it targets the same frame the audio clock last produced.
            // Otherwise the `last_rendered_frame_index` fast path swallows the
            // demand and leaves the WebView waiting forever for its event.
            let audio_time = if should_follow_audio_clock(dynamic_demand.is_some()) {
                audio_clock_time(&app, true, false).ok()
            } else {
                None
            };
            if let Some(audio_time) = audio_time {
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
                    let mut base_timeline_secs = (request.frame_time.ticks as f64)
                        / (request.frame_time.timescale.max(1) as f64);
                    request.frame_time.frame_index = frame_index;
                    request.frame_time.ticks = audio_time.ticks;
                    request.frame_time.timescale = audio_time.timescale;

                    if dynamic_demand.is_none() {
                        let audio_time_secs =
                            (audio_time.ticks as f64) / (audio_time.timescale as f64);
                        if audio_time_secs < base_timeline_secs - 0.25 {
                            // Temporal regression: audio jumped backward relative to old materialized request.
                            // Invalidate stale materialized state and re-anchor from baseline snapshot.
                            *self.last_materialized.write() = None;
                            request = (**self.snapshot.read()).clone();
                            request.mode = Some("playback".to_string());
                            request.frame_time.frame_index = frame_index;
                            request.frame_time.ticks = audio_time.ticks;
                            request.frame_time.timescale = audio_time.timescale;
                            base_timeline_secs = (request.frame_time.ticks as f64)
                                / (request.frame_time.timescale.max(1) as f64);
                        }
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
            // dynamic demand was submitted, or if the session has not yet presented
            // its initial frame. Presenting the initial frame immediately (<16ms)
            // upon session start eliminates the startup freeze while CPAL audio initializes.
            if dynamic_demand.is_none() && self.first_presented.load(Ordering::Acquire) {
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
                let is_explicit_paused_demand = presentation.mode.as_deref() != Some("playback");
                if presentation.presented {
                    if !self.first_presented.swap(true, Ordering::AcqRel) {
                        crate::cold_start::record_first_frame();
                        let elapsed_us = self
                            .configured_at
                            .elapsed()
                            .as_micros()
                            .min(u64::MAX as u128) as u64;
                        crate::cold_start::record_span(
                            "c4_first_frame",
                            self.configured_at,
                            elapsed_us,
                            false,
                        );
                        let ready_after_us = self.ready_after_us.load(Ordering::Acquire);
                        let _ = app.emit(
                            "clypra://native-playback-startup",
                            NativePlaybackStartupMilestone {
                                stage: "first-native-frame-presented",
                                elapsed_us,
                                ready_after_us: (ready_after_us > 0).then_some(ready_after_us),
                                started_at_us: crate::cold_start::PROCESS_START
                                    .elapsed()
                                    .as_micros()
                                    .min(u64::MAX as u128)
                                    as u64,
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
                if is_explicit_paused_demand {
                    // Paused/scrub demands use the session's latest-only
                    // worker. Notify the WebView only after the worker has
                    // completed the request. A dropped result matters too:
                    // it releases the latest key so the current seek can run.
                    let _ = app.emit(
                        "clypra://native-playback-demand-presented",
                        presentation.clone(),
                    );
                }
                Some(presentation)
            }
            Err(_) => None,
        }
    }
}
