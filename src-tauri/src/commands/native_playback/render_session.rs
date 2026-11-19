use super::runtime::audio_clock_time;
use crate::filmstrip_engine::decoder::{
    acquire_preview_decoder_lease_for_stream, PreviewDecoderLease,
};
use crate::native_core::playback::frame_for_audio_position;
use crate::native_core::{
    FrameRequest, FrameTime, NativeDemandOutcome, NativePlaybackFrameDemand, NativeScrubDirection,
    PlaybackPlan, QualityTier,
    DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
use crate::wgpu_compositor::{
    AbandonReason, FrameLifecycleRegistry, FrameRequestId, LifecycleState,
    RenderLifecycleContext, RequestDropReason, RequestTerminalDisposition,
    WorkloadMode,
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
    /// Frame lifecycle tracking for request, frame, and presentation identities.
    pub(crate) lifecycle_registry: Mutex<FrameLifecycleRegistry>,
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

/// Terminal result for an explicit demand that did not reach surface
/// presentation. This closes the latest-value mailbox observability gap.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativePlaybackDemandTerminal {
    pub(crate) request_id: String,
    /// Internal lifecycle identity. The public request ID may be reused by
    /// the continuous frontend loop and is not sufficient for correlation.
    #[serde(default)]
    pub(crate) lifecycle_request_id: Option<String>,
    /// UI target identity. It must not alias the cancellation epoch: forward
    /// scrub targets can advance while decoder work remains valid.
    pub(crate) generation: Option<u64>,
    pub(crate) cancellation_epoch: u64,
    pub(crate) frame_index: u64,
    pub(crate) disposition: &'static str,
    /// Owning pipeline boundary. This lets telemetry distinguish a mailbox
    /// replacement from decode/actor or presentation work without guessing.
    pub(crate) stage: &'static str,
    pub(crate) reason: &'static str,
    pub(crate) outcome: NativeDemandOutcome,
    pub(crate) workload: WorkloadMode,
    #[serde(default)]
    pub(crate) experiment_context: Option<crate::wgpu_compositor::ScrubExperimentContext>,
    #[serde(default)]
    pub(crate) scrub_direction: Option<NativeScrubDirection>,
    #[serde(default)]
    pub(crate) actor_wait_us: Option<u64>,
    #[serde(default)]
    pub(crate) actor_queue_wait_us: Option<u64>,
    #[serde(default)]
    pub(crate) decoder_mutex_wait_us: Option<u64>,
    #[serde(default)]
    pub(crate) queue_residency_us: Option<u64>,
    #[serde(default)]
    pub(crate) queue_hit: Option<bool>,
    /// Native presentation errors are kept separate from the stable reason
    /// category so telemetry can retain the concrete wgpu/surface failure.
    #[serde(default)]
    pub(crate) error: Option<String>,
    #[serde(default)]
    pub(crate) surface_state:
        Option<crate::commands::native_surface::NativeSurfaceDiagnosticState>,
}

#[derive(Default)]
pub(crate) struct LatestPlaybackDemand {
    pub(crate) value: Option<NativePlaybackFrameDemand>,
    /// Internal lifecycle identity allocated when this demand was accepted.
    pub(crate) internal_request_id: Option<FrameRequestId>,
}

/// Exact paused/scrub demands are distinct from continuous playback. They
/// must not be coalesced by the audio-clock frame-address fast path because
/// the WebView awaits their matching completion event. Continuous playback
/// demands, by contrast, must always follow the native audio clock's
/// authoritative frame index.
pub(crate) fn should_follow_audio_clock(demand: Option<&NativePlaybackFrameDemand>) -> bool {
    match demand {
        None => true,
        Some(d) => !d.is_scrubbing && d.mode.as_deref() == Some("playback"),
    }
}

pub(crate) fn tracks_explicit_request(demand: &NativePlaybackFrameDemand) -> bool {
    demand.mode.as_deref() != Some("playback") || demand.is_scrubbing
}

fn workload_for_mode(mode: Option<&str>, is_scrubbing: bool) -> WorkloadMode {
    if is_scrubbing {
        return WorkloadMode::Scrub;
    }
    match mode {
        Some("playback") | Some("playback-lookahead") => WorkloadMode::Playback,
        Some("scrub") => WorkloadMode::Scrub,
        Some("seek") => WorkloadMode::SeekWarm,
        Some("frameStep") | Some("frame-step") => WorkloadMode::FrameStep,
        _ => WorkloadMode::PausedInteraction,
    }
}

fn workload_for_demand(demand: &NativePlaybackFrameDemand) -> WorkloadMode {
    workload_for_mode(demand.mode.as_deref(), demand.is_scrubbing)
}

/// Continuous audio-clock ticks are scheduling events, not explicit user or
/// scheduler demands. They deliberately carry no request identity: allocating
/// one per tick would create unbounded orphaned request records and falsely
/// imply that a user operation caused the frame.
pub(crate) fn audio_clock_lifecycle_context() -> RenderLifecycleContext {
    RenderLifecycleContext::empty()
}

impl LatestPlaybackDemand {
    pub(crate) fn replace(
        &mut self,
        demand: NativePlaybackFrameDemand,
        internal_id: Option<FrameRequestId>,
    ) {
        self.value = Some(demand);
        self.internal_request_id = internal_id;
    }

    pub(crate) fn take(&mut self) -> Option<(NativePlaybackFrameDemand, Option<FrameRequestId>)> {
        let demand = self.value.take()?;
        let internal_id = self.internal_request_id.take();
        Some((demand, internal_id))
    }
}

impl NativeRenderSession {
    /// A newer explicit demand must establish the native cancellation fence
    /// before it is accepted. Otherwise a previous generation can remain in
    /// decode long enough to reach the retained surface after the user has
    /// issued a newer seek.
    pub(crate) fn demand_requires_recency_barrier(&self, cancellation_epoch: u64) -> bool {
        cancellation_epoch > self.generation.load(Ordering::Acquire)
    }

    fn cancellation_epoch(demand: &NativePlaybackFrameDemand) -> u64 {
        demand.cancellation_epoch.or(demand.generation).unwrap_or(0)
    }

    fn terminal(
        demand: &NativePlaybackFrameDemand,
        lifecycle_request_id: Option<&FrameRequestId>,
        disposition: &'static str,
        reason: &'static str,
        outcome: NativeDemandOutcome,
    ) -> NativePlaybackDemandTerminal {
        NativePlaybackDemandTerminal {
            request_id: demand.request_id.clone(),
            lifecycle_request_id: lifecycle_request_id.map(|id| id.as_str().to_string()),
            generation: demand.generation,
            cancellation_epoch: Self::cancellation_epoch(demand),
            frame_index: demand.frame_time.frame_index,
            disposition,
            stage: match disposition {
                "superseded" => "mailbox",
                "cancelled" => "recency-fence",
                "coalesced" => "audio-clock",
                _ => "presentation",
            },
            reason,
            outcome,
            workload: workload_for_demand(demand),
            experiment_context: None,
            scrub_direction: demand.scrub_direction,
            actor_wait_us: None,
            actor_queue_wait_us: None,
            decoder_mutex_wait_us: None,
            queue_residency_us: None,
            queue_hit: None,
            error: None,
            surface_state: None,
        }
    }

    pub(crate) fn emit_terminal(app: &AppHandle, mut terminal: NativePlaybackDemandTerminal) {
        if terminal.experiment_context.is_none() {
            terminal.experiment_context = Self::experiment_context(app);
        }
        if let Some(collector) =
            app.try_state::<Arc<crate::wgpu_compositor::SessionTelemetryCollector>>()
        {
            if !collector.record_request_terminal_once(
                &terminal.request_id,
                terminal.workload,
                terminal.outcome,
            ) {
                return;
            }
        }
        let _ = app.emit("clypra://native-playback-demand-terminal", terminal);
    }

    fn experiment_context(
        app: &AppHandle,
    ) -> Option<crate::wgpu_compositor::ScrubExperimentContext> {
        app.try_state::<Arc<crate::wgpu_compositor::SessionTelemetryCollector>>()
            .and_then(|collector| collector.experiment_context())
    }

    fn finish_request_if_active(
        &self,
        request_id: &FrameRequestId,
        disposition: RequestTerminalDisposition,
    ) {
        let Ok(mut registry) = self.lifecycle_registry.lock() else {
            return;
        };
        if matches!(registry.request_state(request_id), Ok(LifecycleState::Active)) {
            let _ = registry.finish_request(request_id, disposition);
        }
    }

    pub(crate) fn finalize_abandoned_demand(
        &self,
        payload: &super::NativePlaybackDemandAbandonment,
    ) -> Result<Option<NativePlaybackDemandTerminal>, String> {
        let mut registry = self
            .lifecycle_registry
            .lock()
            .map_err(|_| "Lifecycle registry lock poisoned".to_string())?;
        let Some(internal_id) = registry.active_request_for_external_id(&payload.request_id) else {
            return Ok(None);
        };
        let disposition = match payload.outcome {
            NativeDemandOutcome::Superseded => RequestTerminalDisposition::SupersededWithoutSuccessor,
            NativeDemandOutcome::Cancelled => RequestTerminalDisposition::Cancelled,
            NativeDemandOutcome::DroppedBeforePresent => {
                RequestTerminalDisposition::DroppedBeforePresent {
                    reason: RequestDropReason::Backpressure,
                }
            }
            NativeDemandOutcome::Failed => RequestTerminalDisposition::Failed {
                reason: crate::wgpu_compositor::RequestFailureReason::PipelineFailure,
            },
            NativeDemandOutcome::Presented
            | NativeDemandOutcome::Coalesced => {
                return Err("abandonment must use a non-presented terminal outcome".to_string());
            }
        };
        registry
            .finish_request(&internal_id, disposition)
            .map_err(|error| error.to_string())?;
        let (disposition, stage) = match payload.outcome {
            NativeDemandOutcome::Superseded => ("superseded", "mailbox"),
            NativeDemandOutcome::Cancelled => ("cancelled", "presentation"),
            NativeDemandOutcome::DroppedBeforePresent => {
                ("dropped-before-present", "presentation")
            }
            NativeDemandOutcome::Failed => ("failed", "presentation"),
            NativeDemandOutcome::Presented | NativeDemandOutcome::Coalesced => unreachable!(),
        };
        Ok(Some(NativePlaybackDemandTerminal {
            request_id: payload.request_id.clone(),
            lifecycle_request_id: Some(internal_id.as_str().to_string()),
            generation: payload.generation,
            cancellation_epoch: payload.cancellation_epoch,
            frame_index: payload.frame_index,
            disposition,
            stage,
            reason: "frontend-abandonment",
            outcome: payload.outcome,
            workload: workload_for_mode(payload.mode.as_deref(), payload.is_scrubbing),
            experiment_context: None,
            scrub_direction: payload.scrub_direction,
            actor_wait_us: None,
            actor_queue_wait_us: None,
            decoder_mutex_wait_us: None,
            queue_residency_us: None,
            queue_hit: None,
            error: Some(payload.reason.clone()),
            surface_state: None,
        }))
    }

    fn terminal_for_presentation(
        request_id: &str,
        target_generation: Option<u64>,
        frame_index: u64,
        lifecycle_request_id: &FrameRequestId,
        generation: u64,
        scrub_direction: Option<NativeScrubDirection>,
        is_scrubbing: bool,
        presentation: &crate::native_core::NativeSurfacePresentation,
    ) -> NativePlaybackDemandTerminal {
        let (disposition, stage, reason) = match presentation.outcome {
            Some(crate::native_core::NativePresentationOutcome::Presented) => {
                ("presented", "presentation", "presented")
            }
            Some(crate::native_core::NativePresentationOutcome::Superseded) => {
                ("superseded", "presentation", "superseded")
            }
            Some(crate::native_core::NativePresentationOutcome::DroppedBeforePresent) => {
                match presentation.drop_reason_code {
                    Some(crate::native_core::NativePresentationDropReason::LookaheadMiss) => {
                        ("dropped-before-present", "decode", "lookahead-miss")
                    }
                    Some(crate::native_core::NativePresentationDropReason::LateForAudio) => {
                        ("dropped-before-present", "presentation", "late-for-audio")
                    }
                    _ => ("dropped-before-present", "presentation", "backpressure"),
                }
            }
            None if presentation.presented => ("presented", "presentation", "presented"),
            None => ("dropped-before-present", "presentation", "backpressure"),
        };
        let timings = presentation.timings.as_ref();
        NativePlaybackDemandTerminal {
            request_id: request_id.to_string(),
            lifecycle_request_id: Some(lifecycle_request_id.as_str().to_string()),
            generation: target_generation,
            cancellation_epoch: generation,
            frame_index,
            disposition,
            stage,
            reason,
            outcome: match presentation.outcome {
                Some(crate::native_core::NativePresentationOutcome::Presented) => {
                    NativeDemandOutcome::Presented
                }
                Some(crate::native_core::NativePresentationOutcome::Superseded) => {
                    NativeDemandOutcome::Superseded
                }
                Some(crate::native_core::NativePresentationOutcome::DroppedBeforePresent) => {
                    NativeDemandOutcome::DroppedBeforePresent
                }
                None if presentation.presented => NativeDemandOutcome::Presented,
                None => NativeDemandOutcome::DroppedBeforePresent,
            },
            workload: workload_for_mode(presentation.mode.as_deref(), is_scrubbing),
            experiment_context: None,
            scrub_direction,
            actor_wait_us: timings.map(|value| value.actor_wait_us),
            actor_queue_wait_us: timings.map(|value| value.actor_queue_wait_us),
            decoder_mutex_wait_us: timings.map(|value| value.decoder_mutex_wait_us),
            queue_residency_us: timings.map(|value| value.queue_residency_us),
            queue_hit: timings.map(|value| value.queue_hit),
            error: None,
            surface_state: None,
        }
    }

    fn presentation_failure_terminal(
        request_id: String,
        lifecycle_request_id: Option<String>,
        generation: Option<u64>,
        cancellation_epoch: u64,
        frame_index: u64,
        scrub_direction: Option<NativeScrubDirection>,
        workload: WorkloadMode,
        outcome: NativeDemandOutcome,
        error: String,
        surface_state: Option<crate::commands::native_surface::NativeSurfaceDiagnosticState>,
    ) -> NativePlaybackDemandTerminal {
        let (disposition, stage, reason) = match outcome {
            NativeDemandOutcome::Superseded => ("superseded", "decode", "latest-value-mailbox"),
            NativeDemandOutcome::Cancelled => ("cancelled", "recency-fence", "recency-fence"),
            _ => ("failed", "presentation", "presentation-pipeline"),
        };
        NativePlaybackDemandTerminal {
            request_id,
            lifecycle_request_id,
            generation,
            cancellation_epoch,
            frame_index,
            disposition,
            stage,
            reason,
            outcome,
            workload,
            experiment_context: None,
            scrub_direction,
            actor_wait_us: None,
            actor_queue_wait_us: None,
            decoder_mutex_wait_us: None,
            queue_residency_us: None,
            queue_hit: None,
            error: Some(error),
            surface_state,
        }
    }

    fn classify_presentation_error(
        &self,
        error: &crate::commands::native_preview::NativePresentationError,
        request: &FrameRequest,
        generation: u64,
    ) -> NativeDemandOutcome {
        // A decoder error is a terminal failure even when a newer target is
        // waiting in the mailbox. Supersession only describes work that was
        // intentionally replaced before it failed; a real decode failure is
        // actionable and must remain visible to telemetry.
        if error.is_decode_failure() {
            return NativeDemandOutcome::Failed;
        }
        if matches!(
            error,
            crate::commands::native_preview::NativePresentationError::Superseded
        ) {
            return NativeDemandOutcome::Superseded;
        }
        if matches!(
            error,
            crate::commands::native_preview::NativePresentationError::Cancelled
        ) {
            return NativeDemandOutcome::Cancelled;
        }
        if matches!(
            error,
            crate::commands::native_preview::NativePresentationError::InvalidContract(_)
                | crate::commands::native_preview::NativePresentationError::SurfaceNotConfigured
                | crate::commands::native_preview::NativePresentationError::Pipeline(_)
        ) {
            return NativeDemandOutcome::Failed;
        }
        let has_newer_pending_target = self
            .pending
            .lock()
            .ok()
            .and_then(|pending| pending.value.as_ref().map(|demand| {
                demand.frame_time.frame_index != request.frame_time.frame_index
                    || demand.generation.unwrap_or(0) > request.target_generation.unwrap_or(0)
            }))
            .unwrap_or(false);
        if has_newer_pending_target {
            return NativeDemandOutcome::Superseded;
        }
        if self.generation.load(Ordering::Acquire) > generation {
            return NativeDemandOutcome::Cancelled;
        }
        NativeDemandOutcome::Failed
    }

    fn surface_diagnostic_state(
        app: &AppHandle,
    ) -> Option<crate::commands::native_surface::NativeSurfaceDiagnosticState> {
        let state = app
            .try_state::<Arc<Mutex<crate::commands::native_surface::NativeSurfaceRuntime>>>()?;
        let runtime = state.inner().clone();
        let guard = runtime.lock().ok()?;
        Some(guard.diagnostic_state())
    }

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
            lifecycle_registry: Mutex::new(FrameLifecycleRegistry::default()),
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
    pub(crate) fn pause_continuous_playback(&self) -> Option<NativePlaybackDemandTerminal> {
        let mut terminal = None;
        if let Ok(mut pending) = self.pending.lock() {
            // Cancel the pending demand if it exists
            if let Some(internal_id) = pending.internal_request_id.take() {
                if let Ok(mut registry) = self.lifecycle_registry.lock() {
                    use crate::wgpu_compositor::{RequestTerminalDisposition};
                    if registry
                        .finish_request(&internal_id, RequestTerminalDisposition::Cancelled)
                        .is_ok()
                    {
                        if let Some(demand) = pending.value.as_ref() {
                            terminal = Some(Self::terminal(
                                demand,
                                Some(&internal_id),
                                "cancelled",
                                "pause",
                                NativeDemandOutcome::Cancelled,
                            ));
                        }
                    }
                }
            }
            pending.value = None;
        }
        self.reset_playback_lookahead_feedback();
        self.notify.notify_one();
        terminal
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
            // Cancel any pending demand before clearing
            if let Some(internal_id) = pending.internal_request_id.take() {
                if let Ok(mut registry) = self.lifecycle_registry.lock() {
                    use crate::wgpu_compositor::{RequestTerminalDisposition};
                    let _ = registry.finish_request(&internal_id, RequestTerminalDisposition::Cancelled);
                }
            }
            pending.value = None;
        }
        // Abandon all active lifecycle requests on session shutdown
        if let Ok(mut registry) = self.lifecycle_registry.lock() {
            registry.abandon_active(AbandonReason::SessionShutdown);
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
    pub(crate) fn invalidate(&self, generation: u64) -> Option<NativePlaybackDemandTerminal> {
        self.generation.fetch_max(generation, Ordering::AcqRel);
        *self.last_materialized.write() = None;
        let mut terminal = None;
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .value
                .as_ref()
                .map(Self::cancellation_epoch)
                .map(|pending_generation| pending_generation < generation)
                .unwrap_or(false)
            {
                // Cancel the obsolete pending demand
                if let Some(internal_id) = pending.internal_request_id.take() {
                    if let Ok(mut registry) = self.lifecycle_registry.lock() {
                        use crate::wgpu_compositor::{RequestTerminalDisposition};
                        if registry
                            .finish_request(&internal_id, RequestTerminalDisposition::Cancelled)
                            .is_ok()
                        {
                            if let Some(demand) = pending.value.as_ref() {
                                terminal = Some(Self::terminal(
                                    demand,
                                    Some(&internal_id),
                                    "cancelled",
                                    "recency-invalidation",
                                    NativeDemandOutcome::Cancelled,
                                ));
                            }
                        }
                    }
                }
                pending.value = None;
            }
        }
        if let Ok(actors) = self.actors.lock() {
            for actor in actors.values() {
                actor.invalidate(generation);
            }
        }
        self.notify.notify_one();
        terminal
    }

    pub(crate) fn submit(
        &self,
        demand: NativePlaybackFrameDemand,
    ) -> Result<Option<NativePlaybackDemandTerminal>, String> {
        if demand.contract_version != NATIVE_CORE_CONTRACT_VERSION {
            return Err(format!(
                "Unsupported native playback demand contract version: {}",
                demand.contract_version
            ));
        }
        if demand.request_id.trim().is_empty() || demand.frame_time.timescale == 0 {
            return Err("Native playback demand requires request_id and frame time".to_string());
        }
        // Pointer targets change continuously. Only a lifecycle epoch is a
        // cancellation fence, so forward scrub can replace its pending target
        // without killing the decode operation already making progress.
        let generation = Self::cancellation_epoch(&demand);
        let current = self.generation.load(Ordering::Acquire);
        if generation < current {
            return Ok(tracks_explicit_request(&demand).then(|| {
                Self::terminal(
                    &demand,
                    None,
                    "cancelled",
                    "stale-epoch",
                    NativeDemandOutcome::Cancelled,
                )
            }));
        }
        self.generation.store(generation, Ordering::Release);
        
        // Continuous playback is an audio-clock scheduling signal rather than
        // an explicit user demand. Do not allocate one request lifecycle per
        // RAF tick; only exact scrub/seek/frame-step demands need a request
        // terminal outcome.
        let internal_request_id = if tracks_explicit_request(&demand) {
            let mut registry = self
                .lifecycle_registry
                .lock()
                .map_err(|_| "Lifecycle registry lock poisoned".to_string())?;
            Some(
                registry
                    .begin_request(&demand.request_id)
                    .map_err(|e| format!("Failed to allocate request ID: {e}"))?,
            )
        } else {
            None
        };
        
        let mut superseded_terminal = None;
        if let Ok(mut pending) = self.pending.lock() {
            // This assignment is the latest-frame-wins slot: a slow decode can
            // never cause obsolete playback work to accumulate.
            // Cancel the superseded request if one exists
            let superseded_id = pending.internal_request_id.take();
            if let Some(superseded_id) = superseded_id.as_ref() {
                if let Ok(mut registry) = self.lifecycle_registry.lock() {
                    let _ = registry.finish_request(
                        superseded_id,
                        match internal_request_id.as_ref() {
                            Some(by_request_id) => RequestTerminalDisposition::Superseded {
                                by_request_id: by_request_id.clone(),
                            },
                            None => RequestTerminalDisposition::SupersededWithoutSuccessor,
                        },
                    );
                }
            }
            if let (Some(superseded), Some(superseded_id)) =
                (pending.value.as_ref(), superseded_id.as_ref())
            {
                superseded_terminal = Some(Self::terminal(
                    superseded,
                    Some(superseded_id),
                    "superseded",
                    "latest-value-mailbox",
                    NativeDemandOutcome::Superseded,
                ));
            }
            pending.replace(demand, internal_request_id);
        }
        self.notify.notify_one();
        Ok(superseded_terminal)
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
            // Keep the existing frame generation as the native cancellation
            // fence. The visible target travels separately so forward scrub
            // does not invalidate decoder progress on every pointer move.
            request.generation = Some(Self::cancellation_epoch(demand));
            request.target_generation = demand.generation;
            request.mode = demand.mode.clone();
            request.is_scrubbing = Some(demand.is_scrubbing);

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
                            .or_else(|| {
                                request
                                    .project
                                    .raster_layers
                                    .iter()
                                    .find(|r| !r.asset_id.is_empty() && r.asset_id == update.asset_id)
                                    .cloned()
                            })
                    } else {
                        request
                            .project
                            .raster_layers
                            .iter()
                            .find(|r| !r.asset_id.is_empty() && r.asset_id == update.asset_id)
                            .cloned()
                            .or_else(|| request.project.raster_layers.get(i).cloned())
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
                            is_text: update.asset_id.starts_with("native-text:"),
                            is_premultiplied: false,
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
            let dynamic_demand_with_id = self.pending.lock().ok().and_then(|mut slot| slot.take());
            let (dynamic_demand, internal_request_id) = match dynamic_demand_with_id {
                Some((demand, internal_id)) => (Some(demand), internal_id),
                None => (None, None),
            };
            if let Some(demand) = &dynamic_demand {
                if Self::cancellation_epoch(demand) < generation {
                    // Coalesced by generation mismatch - cancel the internal request
                    if let Some(internal_id) = internal_request_id.as_ref() {
                        if let Ok(mut registry) = self.lifecycle_registry.lock() {
                            // This is coalescing, not supersession (no successor known yet)
                            let _ = registry.finish_request(
                                internal_id,
                                RequestTerminalDisposition::Cancelled,
                            );
                        }
                        Self::emit_terminal(
                            &app,
                            Self::terminal(
                                demand,
                                Some(internal_id),
                                "cancelled",
                                "stale-epoch",
                                NativeDemandOutcome::Cancelled,
                            ),
                        );
                    }
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
            let audio_time = if should_follow_audio_clock(dynamic_demand.as_ref()) {
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
                        if let (Some(demand), Some(internal_id)) =
                            (dynamic_demand.as_ref(), internal_request_id.as_ref())
                        {
                            self.finish_request_if_active(
                                internal_id,
                                RequestTerminalDisposition::CoalescedWithoutSuccessor,
                            );
                            Self::emit_terminal(
                                &app,
                                Self::terminal(
                                    demand,
                                    Some(internal_id),
                                    "coalesced",
                                    "same-frame-audio-clock",
                                    NativeDemandOutcome::Coalesced,
                                ),
                            );
                        }
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

                    let audio_time_secs =
                        (audio_time.ticks as f64) / (audio_time.timescale.max(1) as f64);
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
                    if delta_secs > 0.0001 || dynamic_demand.is_none() {
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

                    if let Some(presentation) = self.render_one(
                        &app,
                        request,
                        generation,
                        audio_clock_lifecycle_context(),
                    )
                    .await
                    {
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

                        // Emit registry retention snapshot every 50 frames (Task 1: Registry Retention Audit)
                        #[allow(clippy::manual_is_multiple_of)]
                        if frames_rendered > 0 && frames_rendered % 50 == 0 {
                            if let Ok(registry) = self.lifecycle_registry.lock() {
                                let snapshot = registry.diagnostic_snapshot();
                                let timestamp_us = self.configured_at.elapsed().as_micros().min(u64::MAX as u128) as u64;
                                
                                #[derive(Clone, Serialize)]
                                #[serde(rename_all = "camelCase")]
                                struct RegistrySnapshotTrace {
                                    timestamp_us: u64,
                                    frames_rendered: u64,
                                    snapshot: crate::wgpu_compositor::RegistrySnapshot,
                                }
                                
                                let _ = app.emit(
                                    "lifecycle-registry-snapshot",
                                    RegistrySnapshotTrace {
                                        timestamp_us,
                                        frames_rendered,
                                        snapshot,
                                    },
                                );
                            }
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

            let lifecycle_context = internal_request_id
                .map(|id| {
                    RenderLifecycleContext::new(id)
                        .with_scrub_direction(dynamic_demand.as_ref().and_then(|d| d.scrub_direction))
                })
                .unwrap_or_else(RenderLifecycleContext::empty);
            let _ = self
                .render_one(&app, base_request, generation, lifecycle_context)
                .await;
        }
    }

    async fn render_one(
        &self,
        app: &AppHandle,
        request: FrameRequest,
        generation: u64,
        lifecycle_context: RenderLifecycleContext,
    ) -> Option<crate::native_core::NativeSurfacePresentation> {
        if generation < self.generation.load(Ordering::Acquire) {
            // Recency cancellation is deliberately before the shared
            // audio-clock lateness decision in present_native_frame.
            if let Some(internal_id) = lifecycle_context.request_ids.first() {
                self.finish_request_if_active(internal_id, RequestTerminalDisposition::Cancelled);
            }
            if lifecycle_context.request_ids.first().is_some() {
                Self::emit_terminal(
                    app,
                    NativePlaybackDemandTerminal {
                        request_id: request.request_id.clone(),
                        lifecycle_request_id: lifecycle_context
                            .request_ids
                            .first()
                            .map(|id| id.as_str().to_string()),
                        generation: request.target_generation.or(request.generation),
                        cancellation_epoch: generation,
                        frame_index: request.frame_time.frame_index,
                        disposition: "cancelled",
                        stage: "recency-fence",
                        reason: "recency-fence",
                        outcome: NativeDemandOutcome::Cancelled,
                        workload: workload_for_mode(
                            request.mode.as_deref(),
                            request.is_scrubbing.unwrap_or(false),
                        ),
                        experiment_context: None,
                        scrub_direction: lifecycle_context.scrub_direction,
                        actor_wait_us: None,
                        actor_queue_wait_us: None,
                        decoder_mutex_wait_us: None,
                        queue_residency_us: None,
                        queue_hit: None,
                        error: None,
                        surface_state: None,
                    },
                );
            }
            return None;
        }
        match crate::commands::native_preview::present_native_frame_internal(
            app.clone(),
            request.clone(),
            lifecycle_context.clone(),
            Some(&self.lifecycle_registry),
        )
            .await
        {
            Ok(mut presentation) => {
                // Surface and decoder cancellation use FrameRequest.generation,
                // but the completion is correlated to the visible target.
                if let Some(target_generation) = request.target_generation {
                    presentation.generation = Some(target_generation);
                }
                // The lifecycle identity, not the presentation mode string,
                // is the authoritative marker for an exact interactive
                // demand. A scrub may still carry `mode=playback` while the
                // pointer is down and must receive the matching completion.
                let is_explicit_paused_demand =
                    lifecycle_context.request_ids.first().is_some();
                if let Some(internal_id) = lifecycle_context.request_ids.first() {
                    let request_disposition = match presentation.outcome {
                        Some(crate::native_core::NativePresentationOutcome::Presented) => None,
                        Some(crate::native_core::NativePresentationOutcome::Superseded) => {
                            Some(RequestTerminalDisposition::SupersededWithoutSuccessor)
                        }
                        Some(crate::native_core::NativePresentationOutcome::DroppedBeforePresent) => {
                            Some(RequestTerminalDisposition::DroppedBeforePresent {
                                reason: match presentation.drop_reason_code {
                                    Some(crate::native_core::NativePresentationDropReason::LookaheadMiss) => RequestDropReason::LookaheadMiss,
                                    Some(crate::native_core::NativePresentationDropReason::LateForAudio) => RequestDropReason::LateForAudio,
                                    _ => RequestDropReason::Backpressure,
                                },
                            })
                        }
                        None if presentation.presented => None,
                        None => Some(RequestTerminalDisposition::Failed {
                            reason: crate::wgpu_compositor::RequestFailureReason::PipelineFailure,
                        }),
                    };
                    if let Some(request_disposition) = request_disposition {
                        self.finish_request_if_active(internal_id, request_disposition);
                    }
                }
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
                if let Some(internal_id) = lifecycle_context.request_ids.first() {
                    Self::emit_terminal(
                        app,
                        Self::terminal_for_presentation(
                            &request.request_id,
                            request.target_generation.or(request.generation),
                            request.frame_time.frame_index,
                            internal_id,
                            generation,
                            lifecycle_context.scrub_direction,
                            request.is_scrubbing.unwrap_or(false),
                            &presentation,
                        ),
                    );
                }
                Some(presentation)
            }
            Err(error) => {
                let outcome = self.classify_presentation_error(&error, &request, generation);
                if let Some(internal_id) = lifecycle_context.request_ids.first() {
                    let disposition = match outcome {
                        NativeDemandOutcome::Superseded => {
                            RequestTerminalDisposition::SupersededWithoutSuccessor
                        }
                        NativeDemandOutcome::Cancelled => RequestTerminalDisposition::Cancelled,
                        _ => RequestTerminalDisposition::Failed {
                            reason: crate::wgpu_compositor::RequestFailureReason::PipelineFailure,
                        },
                    };
                    self.finish_request_if_active(internal_id, disposition);
                }
                if lifecycle_context.request_ids.first().is_some() {
                    Self::emit_terminal(
                        app,
                        Self::presentation_failure_terminal(
                            request.request_id,
                            lifecycle_context
                                .request_ids
                                .first()
                                .map(|id| id.as_str().to_string()),
                            request.target_generation.or(request.generation),
                            generation,
                            request.frame_time.frame_index,
                            lifecycle_context.scrub_direction,
                            workload_for_mode(request.mode.as_deref(), request.is_scrubbing.unwrap_or(false)),
                            outcome,
                            error.to_string(),
                            Self::surface_diagnostic_state(app),
                        ),
                    );
                }
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wgpu_compositor::{LifecycleState, RequestTerminalDisposition};

    fn mock_demand(request_id: &str, generation: u64) -> NativePlaybackFrameDemand {
        NativePlaybackFrameDemand {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request_id.to_string(),
            frame_time: FrameTime {
                frame_index: 0,
                ticks: 0,
                timescale: DEFAULT_TIME_SCALE,
            },
            generation: Some(generation),
            cancellation_epoch: None,
            mode: Some("scrub".to_string()),
            is_scrubbing: true,
            scrub_direction: Some(NativeScrubDirection::Forward),
            video_layers: Vec::new(),
            raster_layers: Vec::new(),
            text_layers: Vec::new(),
            transition_progress: None,
        }
    }

    fn mock_session() -> Arc<NativeRenderSession> {
        let snapshot = FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "initial".to_string(),
            frame_time: FrameTime {
                frame_index: 0,
                ticks: 0,
                timescale: DEFAULT_TIME_SCALE,
            },
            project: crate::native_core::ProjectSnapshot {
                schema_version: 1,
                project_revision: "test-rev".to_string(),
                frame_rate: 30,
                canvas_width: 1920,
                canvas_height: 1080,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: Vec::new(),
                raster_layers: Vec::new(),
                text_layers: Vec::new(),
                effect_layers: Vec::new(),
                transition: None,
            },
            output_width: 1920,
            output_height: 1080,
            quality: QualityTier::Full,
            color_policy: crate::native_core::ColorPolicy::default(),
            render_graph_version: 1,
            generation: Some(0),
            target_generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
            lookahead_horizon_frames: None,
            lookahead_clamp_reason: None,
        };
        
        Arc::new(NativeRenderSession {
            snapshot: RwLock::new(Arc::new(snapshot)),
            last_materialized: RwLock::new(None),
            active_streams: Mutex::new(HashSet::new()),
            leases: Mutex::new(HashMap::new()),
            actors: Mutex::new(HashMap::new()),
            pending: Mutex::new(LatestPlaybackDemand::default()),
            notify: tokio::sync::Notify::new(),
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            worker: Mutex::new(None),
            configured_at: Instant::now(),
            ready_after_us: AtomicU64::new(0),
            first_presented: AtomicBool::new(false),
            playback_quality: AtomicU8::new(0),
            playback_lookahead_miss_streak: AtomicU8::new(0),
            playback_lookahead_feedback_armed: AtomicBool::new(false),
            lifecycle_registry: Mutex::new(FrameLifecycleRegistry::default()),
        })
    }

    #[test]
    fn presentation_failure_terminal_preserves_error_and_surface_state() {
        let surface_state =
            crate::commands::native_surface::NativeSurfaceRuntime::new().diagnostic_state();
        let terminal = NativeRenderSession::presentation_failure_terminal(
            "request-1".to_string(),
            Some("lifecycle-1".to_string()),
            Some(7),
            7,
            42,
            None,
            WorkloadMode::PausedInteraction,
            NativeDemandOutcome::Failed,
            "Native surface acquisition timed out".to_string(),
            Some(surface_state),
        );

        assert_eq!(terminal.disposition, "failed");
        assert_eq!(terminal.outcome, NativeDemandOutcome::Failed);
        assert_eq!(terminal.reason, "presentation-pipeline");
        assert_eq!(
            terminal.error.as_deref(),
            Some("Native surface acquisition timed out")
        );
        let state = terminal.surface_state.expect("surface diagnostic state");
        assert!(!state.configured);
        assert!(!state.has_surface);
        assert!(!state.shown);
    }

    #[test]
    fn decode_failure_after_newer_queued_target_is_classified_failed() {
        let session = mock_session();
        session.generation.store(1, Ordering::Release);

        let older = mock_demand("older", 1);
        let newer = mock_demand("newer", 2);
        session.submit(newer).expect("newer target accepted");

        let mut request = session.snapshot.read().as_ref().clone();
        request.request_id = older.request_id;
        request.generation = Some(1);
        request.target_generation = Some(1);

        let outcome = session.classify_presentation_error(
            &crate::commands::native_preview::NativePresentationError::Decode(
                "decoder rejected frame".to_string(),
            ),
            &request,
            1,
        );

        assert_eq!(
            outcome,
            NativeDemandOutcome::Failed,
            "a real decode failure must not be relabeled as supersession"
        );
    }

    #[test]
    fn typed_decoder_cancellation_and_supersession_keep_request_outcomes_distinct() {
        let session = mock_session();
        let frame_request = session.snapshot.read().as_ref().clone();

        assert_eq!(
            session.classify_presentation_error(
                &crate::commands::native_preview::NativePresentationError::Cancelled,
                &frame_request,
                4,
            ),
            NativeDemandOutcome::Cancelled,
        );
        assert_eq!(
            session.classify_presentation_error(
                &crate::commands::native_preview::NativePresentationError::Superseded,
                &frame_request,
                4,
            ),
            NativeDemandOutcome::Superseded,
        );
    }

    #[test]
    fn frontend_abandonment_finalizes_the_matching_active_request_once() {
        let session = mock_session();
        let demand = mock_demand("abandon-me", 8);
        let internal_id = {
            session.submit(demand.clone()).expect("demand accepted");
            session
                .pending
                .lock()
                .unwrap()
                .internal_request_id
                .clone()
                .expect("lifecycle ID allocated")
        };
        let payload = crate::commands::native_playback::NativePlaybackDemandAbandonment {
            request_id: demand.request_id.clone(),
            frame_index: demand.frame_time.frame_index,
            generation: demand.generation,
            cancellation_epoch: demand.cancellation_epoch.unwrap_or(0),
            is_scrubbing: true,
            mode: demand.mode.clone(),
            scrub_direction: demand.scrub_direction,
            outcome: NativeDemandOutcome::Cancelled,
            reason: "ack-timeout".to_string(),
        };

        let terminal = session
            .finalize_abandoned_demand(&payload)
            .expect("abandonment finalization succeeds")
            .expect("active request is finalized");
        assert_eq!(terminal.outcome, NativeDemandOutcome::Cancelled);
        assert_eq!(terminal.reason, "frontend-abandonment");
        assert_eq!(terminal.lifecycle_request_id.as_deref(), Some(internal_id.as_str()));
        assert!(session
            .finalize_abandoned_demand(&payload)
            .expect("duplicate finalization succeeds")
            .is_none());
        assert!(matches!(
            session.lifecycle_registry.lock().unwrap().request_state(&internal_id),
            Ok(LifecycleState::Terminal(RequestTerminalDisposition::Cancelled))
        ));
    }

    #[test]
    fn recency_invalidation_returns_a_terminal_for_the_pending_exact_demand() {
        let session = mock_session();
        let demand = mock_demand("invalidate-me", 12);
        session.submit(demand.clone()).expect("demand accepted");

        let terminal = session
            .invalidate(13)
            .expect("obsolete exact demand is terminalized");
        assert_eq!(terminal.request_id, demand.request_id);
        assert_eq!(terminal.outcome, NativeDemandOutcome::Cancelled);
        assert_eq!(terminal.reason, "recency-invalidation");
        assert_eq!(terminal.stage, "recency-fence");
        assert!(session.invalidate(3).is_none());
    }

    #[test]
    fn terminal_outcome_and_scrub_direction_are_source_typed() {
        let demand = mock_demand("typed-terminal", 3);
        let terminal = NativeRenderSession::terminal(
            &demand,
            None,
            "superseded",
            "latest-value-mailbox",
            NativeDemandOutcome::Superseded,
        );

        assert_eq!(terminal.outcome, NativeDemandOutcome::Superseded);
        assert_eq!(terminal.scrub_direction, Some(NativeScrubDirection::Forward));
        assert_eq!(terminal.workload, WorkloadMode::Scrub);
    }

    #[test]
    fn repeated_external_ids_produce_distinct_internal_request_ids() {
        let session = mock_session();
        let demand1 = mock_demand("playback", 1);
        let demand2 = mock_demand("playback", 2);
        
        session.submit(demand1).expect("first submit");
        let first_id = session.pending.lock().unwrap().internal_request_id.clone().expect("first id allocated");
        
        session.submit(demand2).expect("second submit");
        let second_id = session.pending.lock().unwrap().internal_request_id.clone().expect("second id allocated");
        
        assert_ne!(first_id, second_id, "Repeated external ID must produce distinct internal IDs");
    }

    #[test]
    fn continuous_playback_demands_do_not_create_explicit_request_lifecycles() {
        let mut playback = mock_demand("playback", 1);
        playback.mode = Some("playback".to_string());
        playback.is_scrubbing = false;
        assert!(!tracks_explicit_request(&playback));

        playback.is_scrubbing = true;
        assert!(tracks_explicit_request(&playback));

        playback.mode = Some("seek".to_string());
        playback.is_scrubbing = false;
        assert!(tracks_explicit_request(&playback));
    }

    #[test]
    fn superseded_request_records_successor_relationship() {
        let session = mock_session();
        let demand1 = mock_demand("request-1", 1);
        let demand2 = mock_demand("request-2", 2);
        
        session.submit(demand1).expect("first submit");
        let first_id = session.pending.lock().unwrap().internal_request_id.clone().expect("first id");
        
        session.submit(demand2).expect("second submit supersedes first");
        let second_id = session.pending.lock().unwrap().internal_request_id.clone().expect("second id");
        
        let registry = session.lifecycle_registry.lock().unwrap();
        let first_state = registry.request_state(&first_id).expect("first request exists");
        assert!(matches!(
            first_state,
            LifecycleState::Terminal(RequestTerminalDisposition::Superseded { by_request_id })
            if by_request_id == &second_id
        ), "First request should be superseded by second");
    }

    #[test]
    fn generation_mismatch_coalesces_request() {
        let session = mock_session();
        session.generation.store(10, Ordering::Release);
        
        let stale_demand = mock_demand("stale", 5);
        session.submit(stale_demand).expect("submit stale");
        
        // The generation check in submit rejects it immediately
        assert!(session.pending.lock().unwrap().value.is_none(), "Stale demand rejected by generation check");
    }

    #[test]
    fn forward_scrub_target_replaces_pending_without_advancing_cancellation_epoch() {
        let session = mock_session();
        session.generation.store(10, Ordering::Release);

        let mut demand = mock_demand("forward-target", 11);
        demand.cancellation_epoch = Some(10);
        session.submit(demand).expect("forward target accepted");

        let pending = session.pending.lock().unwrap();
        assert_eq!(pending.value.as_ref().and_then(|value| value.generation), Some(11));
        let request = session
            .materialize_request(pending.value.as_ref())
            .expect("demand materializes");
        assert_eq!(request.generation, Some(10));
        // The visible target must travel independently of cancellation.
        assert_eq!(request.target_generation, Some(11));
        assert_eq!(request.is_scrubbing, Some(true));
        assert_eq!(session.generation.load(Ordering::Acquire), 10);
        assert!(!session.demand_requires_recency_barrier(10));
    }

    #[test]
    fn superseding_a_forward_target_reports_the_target_identity() {
        let session = mock_session();
        session.generation.store(10, Ordering::Release);

        let mut first = mock_demand("forward-11", 11);
        first.cancellation_epoch = Some(10);
        assert!(session.submit(first).expect("first submit").is_none());

        let mut replacement = mock_demand("forward-12", 12);
        replacement.cancellation_epoch = Some(10);
        let terminal = session
            .submit(replacement)
            .expect("replacement submit")
            .expect("superseded terminal");

        assert_eq!(terminal.request_id, "forward-11");
        assert_eq!(terminal.generation, Some(11));
        assert_eq!(terminal.cancellation_epoch, 10);
        assert_eq!(terminal.disposition, "superseded");
    }

    #[test]
    fn newer_demand_requires_recency_barrier_before_acceptance() {
        let session = mock_session();
        session.generation.store(12, Ordering::Release);

        assert!(session.demand_requires_recency_barrier(13));
        assert!(!session.demand_requires_recency_barrier(12));
        assert!(!session.demand_requires_recency_barrier(11));
    }

    #[test]
    fn pause_cancels_pending_request() {
        let session = mock_session();
        let demand = mock_demand("pause-test", 1);
        
        session.submit(demand).expect("submit demand");
        let request_id = session.pending.lock().unwrap().internal_request_id.clone().expect("request allocated");
        
        session.pause_continuous_playback();
        
        let registry = session.lifecycle_registry.lock().unwrap();
        let state = registry.request_state(&request_id).expect("request exists");
        assert!(matches!(
            state,
            LifecycleState::Terminal(RequestTerminalDisposition::Cancelled)
        ), "Paused request should be cancelled");
    }

    #[test]
    fn invalidate_cancels_obsolete_pending_request() {
        let session = mock_session();
        let demand = mock_demand("invalidate-test", 5);
        
        session.submit(demand).expect("submit demand");
        let request_id = session.pending.lock().unwrap().internal_request_id.clone().expect("request allocated");
        
        session.invalidate(10);
        
        let registry = session.lifecycle_registry.lock().unwrap();
        let state = registry.request_state(&request_id).expect("request exists");
        assert!(matches!(
            state,
            LifecycleState::Terminal(RequestTerminalDisposition::Cancelled)
        ), "Invalidated request should be cancelled");
    }

    #[test]
    fn shutdown_abandons_unresolved_requests() {
        let session = mock_session();
        let demand = mock_demand("shutdown-test", 1);
        
        session.submit(demand).expect("submit demand");
        let request_id = session.pending.lock().unwrap().internal_request_id.clone().expect("request allocated");
        
        // Take the demand to simulate it being processed but not yet resolved
        let _ = session.pending.lock().unwrap().take();
        
        session.stop(None);
        
        let registry = session.lifecycle_registry.lock().unwrap();
        let state = registry.request_state(&request_id).expect("request exists");
        // The request is active when taken, and stop() should abandon all active requests
        assert!(matches!(
            state,
            LifecycleState::Terminal(RequestTerminalDisposition::Abandoned { reason: AbandonReason::SessionShutdown })
        ), "Shutdown should abandon unresolved requests, got {:?}", state);
    }

    #[test]
    fn request_identity_survives_async_boundary() {
        let session = mock_session();
        let demand = mock_demand("async-test", 1);
        
        session.submit(demand).expect("submit demand");
        let allocated_id = session.pending.lock().unwrap().internal_request_id.clone().expect("request allocated");
        
        // Simulate async take
        let taken = session.pending.lock().unwrap().take();
        assert!(taken.is_some(), "Demand should be takeable");
        
        let (_, taken_id) = taken.unwrap();
        assert_eq!(taken_id, Some(allocated_id), "Internal ID should survive async handoff");
    }

    #[test]
    fn request_cannot_become_presented_without_explicit_transition() {
        let session = mock_session();
        let demand = mock_demand("no-auto-present", 1);
        
        session.submit(demand).expect("submit demand");
        let request_id = session.pending.lock().unwrap().internal_request_id.clone().expect("request allocated");
        
        // Request remains active until explicitly transitioned
        let registry = session.lifecycle_registry.lock().unwrap();
        let state = registry.request_state(&request_id).expect("request exists");
        assert!(matches!(state, LifecycleState::Active), "Request should remain active until explicit transition");
    }

    #[tokio::test]
    async fn overlapping_requests_with_same_external_id_remain_independent() {
        let session = mock_session();
        let external_id = "playback-reused";

        // Submit request A with external ID "playback-reused"
        let demand_a = mock_demand(external_id, 1);
        session.submit(demand_a).expect("submit demand A");
        let internal_id_a = session.pending.lock().unwrap().internal_request_id.clone().expect("request A allocated");

        // Extract request A and simulate async processing with lifecycle context
        let (_demand_a_value, extracted_id_a) = session.pending.lock().unwrap().take().expect("take request A");
        assert_eq!(extracted_id_a, Some(internal_id_a.clone()), "Request A identity extracted");
        
        let lifecycle_ctx_a = RenderLifecycleContext::new(internal_id_a.clone());
        
        // Spawn async task to simulate decode/queue/present pipeline preserving context
        let internal_id_a_clone = internal_id_a.clone();
        let handle_a = tokio::spawn(async move {
            // Simulate async work (decode, queue operations, etc.)
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            
            // Verify context survives async boundary
            assert!(!lifecycle_ctx_a.is_empty(), "Context A should contain request ID");
            
            // Simulate successful async completion
            (internal_id_a_clone, lifecycle_ctx_a)
        });

        // Submit request B with the SAME external ID while A is still in flight
        let demand_b = mock_demand(external_id, 2);
        session.submit(demand_b).expect("submit demand B");
        let internal_id_b = session.pending.lock().unwrap().internal_request_id.clone().expect("request B allocated");

        // Extract request B and create its lifecycle context
        let (_demand_b_value, extracted_id_b) = session.pending.lock().unwrap().take().expect("take request B");
        assert_eq!(extracted_id_b, Some(internal_id_b.clone()), "Request B identity extracted");
        
        let lifecycle_ctx_b = RenderLifecycleContext::new(internal_id_b.clone());

        // Spawn async task for request B
        let internal_id_b_clone = internal_id_b.clone();
        let handle_b = tokio::spawn(async move {
            // Simulate async work
            tokio::time::sleep(std::time::Duration::from_millis(3)).await;
            
            // Verify context survives async boundary
            assert!(!lifecycle_ctx_b.is_empty(), "Context B should contain request ID");
            
            (internal_id_b_clone, lifecycle_ctx_b)
        });

        // Internal IDs must be distinct despite same external ID
        assert_ne!(internal_id_a, internal_id_b, "Internal IDs must be distinct even when external ID is reused");

        // Both requests exist independently in the registry
        let registry = session.lifecycle_registry.lock().unwrap();
        let state_a = registry.request_state(&internal_id_a).expect("request A exists");
        let state_b = registry.request_state(&internal_id_b).expect("request B exists");
        assert!(matches!(state_a, LifecycleState::Active), "Request A remains active");
        assert!(matches!(state_b, LifecycleState::Active), "Request B remains active");
        drop(registry);

        // Wait for async work to complete and verify contexts survived
        let (returned_id_a, returned_ctx_a) = handle_a.await.expect("async task A completes");
        assert_eq!(returned_id_a, internal_id_a, "Context A preserved internal ID through async boundary");
        assert!(!returned_ctx_a.is_empty(), "Context A survived async work");

        let (returned_id_b, returned_ctx_b) = handle_b.await.expect("async task B completes");
        assert_eq!(returned_id_b, internal_id_b, "Context B preserved internal ID through async boundary");
        assert!(!returned_ctx_b.is_empty(), "Context B survived async work");

        // Completing B should not affect A
        session.lifecycle_registry.lock().unwrap().finish_request(&internal_id_b, RequestTerminalDisposition::Cancelled).expect("finish B");

        let registry = session.lifecycle_registry.lock().unwrap();
        let state_a_after_b = registry.request_state(&internal_id_a).expect("request A still exists");
        let state_b_after = registry.request_state(&internal_id_b).expect("request B still exists");
        assert!(matches!(state_a_after_b, LifecycleState::Active), "Request A unaffected by B completion");
        assert!(matches!(state_b_after, LifecycleState::Terminal(_)), "Request B is terminal");
        drop(registry);

        // Completing A late should not corrupt B
        session.lifecycle_registry.lock().unwrap().finish_request(&internal_id_a, RequestTerminalDisposition::Cancelled).expect("finish A");

        let registry = session.lifecycle_registry.lock().unwrap();
        let state_a_final = registry.request_state(&internal_id_a).expect("request A exists");
        let state_b_final = registry.request_state(&internal_id_b).expect("request B still exists");
        assert!(matches!(state_a_final, LifecycleState::Terminal(_)), "Request A is terminal");
        assert!(matches!(state_b_final, LifecycleState::Terminal(_)), "Request B remains terminal");
    }
}
