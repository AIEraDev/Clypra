//! Engine Telemetry Aggregator for Live Runtime Validation
//!
//! Provides comprehensive, real-time observability across all edge corners of the
//! Clypra Real-Time Media Architecture v2:
//! - Subsystem Truth: Confirms native-realtime-v2 pipeline is active (0 legacy IPC readbacks).
//! - Hardware & Adapter Truth: GpuAdapter, LUID, vendor, driver, VRAM, same-adapter zero-copy.
//! - Decoder Truth: D3D12VA/VideoToolbox vs software fallback, bit depth, profile.
//! - Zero-Copy Invariant: Live tracking of CPU readback bytes, upload bytes, cross-adapter bytes.
//! - Decomposed Stage Timings: demux, decode, interop, render, present, gpu_wait.
//! - Frame Distribution: Percentiles (p50, p90, p95, p99, max) and explicit FrameOutcome.
//! - Seek/Scrub Temporal Metrics: Cold vs warm latency, keyframe distance, cancellation.
//! - Render Graph DAG: Node count, culling count, static branch hits, aliasing VRAM savings.
//! - Workload-Driven QoS: Diagnosed bottleneck, asymmetric hysteresis, active decisions.

use super::benchmark::types::{
    BenchmarkMedia, DecoderIdentity, FrameOutcome, FrameTelemetry, HwframeTransferSite,
    MachineIdentity, PlaybackSummary, TransferMetrics,
};
use super::graph::telemetry::RenderGraphTelemetry;
use super::hardware::{probe_hardware_capability, HardwareCapabilityProfile};
use super::qos::controller::{QoSConfig, QoSController};
use super::qos::metrics::PerformanceSnapshot;
use super::qos::proxy_manager::AsyncProxyManager;
use super::qos::telemetry::QoSTelemetry;
use super::qos::types::{Bottleneck, PerformanceEnvelope, PlaybackPolicySnapshot, QoSReason};
use super::state_machine::PlaybackMode;
use super::temporal::SeekTelemetry;
use super::types::MediaTime;
use crate::native_core::performance::{FrameTransferPath, MetalDecodeFailureReason};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::backtrace::Backtrace;
use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub const ENGINE_PIPELINE_NAME: &str = "native-realtime-v2";
/// Keep the engine identity tied to the Rust package version so telemetry from
/// release builds cannot report a stale historical build number.
pub const ENGINE_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-native");

/// Authoritative real-time telemetry snapshot of the Clypra Real-Time Media Engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineTelemetrySnapshot {
    pub pipeline: String,
    pub engine_version: String,
    pub is_zero_copy: bool,
    pub legacy_pipeline_bypassed: bool,
    pub total_frames_presented: u64,
    pub total_frames_dropped: u64,
    pub total_seeks_executed: u64,
    pub machine: MachineIdentity,
    pub decoder: DecoderIdentity,
    /// Sanitized stream descriptors observed by the active preview decoders.
    /// These describe the source stream and, when available, the actual
    /// CoreVideo surface format without retaining user file paths.
    pub streams: Vec<StreamTelemetry>,
    pub transfers: TransferMetrics,
    /// Decode latency split by the workload that produced each frame.  This
    /// avoids blending steady playback with scrub and seek pre-roll samples.
    pub decode_by_workload: BTreeMap<String, DecodeWorkloadSummary>,
    /// Multi-layer preview and speculative-work diagnostics. These counters
    /// are additive and remain zero for single-layer sessions.
    pub preview_concurrency: PreviewConcurrencyTelemetry,
    pub playback: PlaybackSummary,
    pub qos: QoSTelemetry,
    pub graph: RenderGraphTelemetry,
    pub last_seek: Option<SeekTelemetry>,
    pub hw_capability_tier: String,
    pub timestamp_epoch_ms: u64,
}

/// Aggregate decode timing for one runtime workload.  `frame_count` includes
/// deadline misses, while the latency statistics only use frames that reached
/// the decoder (`decoded_frame_count`).  A dropped presentation tick must not
/// look like a zero-millisecond decode.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeWorkloadSummary {
    pub frame_count: u64,
    pub decoded_frame_count: u64,
    pub missed_deadline_count: u64,
    pub mean_decode_us: u64,
    pub p50_decode_us: u64,
    pub p95_decode_us: u64,
    pub p99_decode_us: u64,
    pub max_decode_us: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewConcurrencyTelemetry {
    pub multi_layer_frame_count: u64,
    pub multi_layer_total_layers: u64,
    pub multi_layer_max_layers: u32,
    pub multi_layer_decode_sum_us: u64,
    pub multi_layer_decode_critical_path_us: u64,
    pub lookahead_preempted: u64,
    pub stale_lookahead_discarded: u64,
    pub visible_decode_waited_behind_lookahead_us: u64,
    pub text_prefetch_rasterized_under_preview_lock: u64,
}

#[derive(Debug, Default)]
struct DecodeWorkloadAccumulator {
    frame_count: u64,
    decoded_frame_count: u64,
    missed_deadline_count: u64,
    decode_sum_us: u64,
    samples_us: Vec<u64>,
}

impl DecodeWorkloadAccumulator {
    const SAMPLE_CAPACITY: usize = 120;

    fn record(&mut self, decode_us: u64, missed: bool) {
        self.frame_count = self.frame_count.saturating_add(1);
        if missed {
            self.missed_deadline_count = self.missed_deadline_count.saturating_add(1);
        }
        if decode_us == 0 {
            return;
        }
        self.decoded_frame_count = self.decoded_frame_count.saturating_add(1);
        self.decode_sum_us = self.decode_sum_us.saturating_add(decode_us);
        if self.samples_us.len() == Self::SAMPLE_CAPACITY {
            self.samples_us.remove(0);
        }
        self.samples_us.push(decode_us);
    }

    fn snapshot(&self) -> DecodeWorkloadSummary {
        if self.samples_us.is_empty() {
            return DecodeWorkloadSummary {
                frame_count: self.frame_count,
                decoded_frame_count: self.decoded_frame_count,
                missed_deadline_count: self.missed_deadline_count,
                ..DecodeWorkloadSummary::default()
            };
        }

        let mut sorted = self.samples_us.clone();
        sorted.sort_unstable();
        let percentile = |percent: usize| {
            let index = ((sorted.len().saturating_sub(1)) * percent) / 100;
            sorted[index]
        };
        DecodeWorkloadSummary {
            frame_count: self.frame_count,
            decoded_frame_count: self.decoded_frame_count,
            missed_deadline_count: self.missed_deadline_count,
            mean_decode_us: self.decode_sum_us / self.decoded_frame_count.max(1),
            p50_decode_us: percentile(50),
            p95_decode_us: percentile(95),
            p99_decode_us: percentile(99),
            max_decode_us: *sorted.last().unwrap_or(&0),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamTelemetry {
    pub stream_key: String,
    pub codec: String,
    pub codec_profile: String,
    pub pixel_format: String,
    pub color_range: String,
    pub cv_pixel_format: Option<String>,
}

fn sanitize_stream_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return trimmed.to_string();
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    trimmed.hash(&mut hasher);
    format!("stream-{:#x}", hasher.finish())
}

/// Global real-time engine telemetry collector.
pub struct EngineTelemetryCollector {
    machine: RwLock<MachineIdentity>,
    decoder: RwLock<DecoderIdentity>,
    streams: RwLock<BTreeMap<String, StreamTelemetry>>,
    hw_profile: RwLock<HardwareCapabilityProfile>,
    transfers: RwLock<TransferMetrics>,
    decode_by_workload: RwLock<BTreeMap<String, DecodeWorkloadAccumulator>>,
    preview_concurrency: RwLock<PreviewConcurrencyTelemetry>,
    recent_frames: RwLock<Vec<FrameTelemetry>>,
    qos: RwLock<QoSTelemetry>,
    qos_controller: RwLock<QoSController>,
    graph: RwLock<RenderGraphTelemetry>,
    last_seek: RwLock<Option<SeekTelemetry>>,
    total_presented: AtomicU64,
    total_dropped: AtomicU64,
    total_seeks: AtomicU64,
    hwframe_transfer_calls: AtomicU64,
    hwframe_transfer_bytes: AtomicU64,
    runtime_zero_copy_observed: std::sync::atomic::AtomicBool,
    session_closing: std::sync::atomic::AtomicBool,
    _start_time: Instant,
}

impl Default for EngineTelemetryCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineTelemetryCollector {
    pub fn new() -> Self {
        let machine = super::benchmark::runner::probe_machine_identity();
        let default_media = BenchmarkMedia::mock_4k60_hevc_10bit();
        let decoder = super::benchmark::runner::probe_decoder_identity(&machine, &default_media);
        let hw_profile = probe_hardware_capability(
            machine.vram_bytes,
            &format!("{:?}", machine.gpu_vendor),
            &machine.gpu_adapter,
            decoder.is_hardware,
            false,
        );
        let transfers = TransferMetrics {
            cpu_readback_bytes: 0,
            cpu_upload_bytes: 0,
            cross_adapter_bytes: 0,
            gpu_copy_bytes: 0,
            is_zero_copy: false,
            ..TransferMetrics::default()
        };
        let qos_config = QoSConfig {
            degrade_window_threshold: hw_profile.recommended_qos_config.degrade_window_threshold,
            recover_window_threshold: hw_profile.recommended_qos_config.recover_window_threshold,
            target_fps: 60.0,
            window_capacity: 15,
        };
        let qos_controller = QoSController::new(qos_config);
        let initial_decision = qos_controller.current_decision().clone();
        let qos = QoSTelemetry {
            active_decision: initial_decision,
            diagnosed_bottleneck: Bottleneck::None,
            consecutive_unhealthy_windows: 0,
            consecutive_healthy_windows: 10,
            window_mean_decode_us: 4500,
            window_mean_gpu_render_us: 3200,
            window_miss_ratio: 0.0,
            window_pool_utilization: 0.25,
            transition_count: 0,
        };

        Self {
            machine: RwLock::new(machine),
            decoder: RwLock::new(decoder),
            streams: RwLock::new(BTreeMap::new()),
            hw_profile: RwLock::new(hw_profile),
            transfers: RwLock::new(transfers),
            decode_by_workload: RwLock::new(BTreeMap::new()),
            preview_concurrency: RwLock::new(PreviewConcurrencyTelemetry::default()),
            recent_frames: RwLock::new(Vec::with_capacity(120)),
            qos: RwLock::new(qos),
            qos_controller: RwLock::new(qos_controller),
            graph: RwLock::new(RenderGraphTelemetry::default()),
            last_seek: RwLock::new(None),
            total_presented: AtomicU64::new(0),
            total_dropped: AtomicU64::new(0),
            total_seeks: AtomicU64::new(0),
            hwframe_transfer_calls: AtomicU64::new(0),
            hwframe_transfer_bytes: AtomicU64::new(0),
            runtime_zero_copy_observed: std::sync::atomic::AtomicBool::new(false),
            session_closing: std::sync::atomic::AtomicBool::new(false),
            _start_time: Instant::now(),
        }
    }

    /// Record the transfer path actually used by a rendered frame. Capability
    /// negotiation alone must not be reported as runtime zero-copy evidence.
    /// The zero-copy flag is sticky for the session; per-frame truth lives in
    /// the path counters and the raw presentation sample.
    pub fn record_runtime_transfer_path(&self, transfer_path: FrameTransferPath) {
        if transfer_path.is_zero_copy() {
            self.runtime_zero_copy_observed
                .store(true, Ordering::Relaxed);
        }
        let mut transfers = self.transfers.write();
        match transfer_path {
            FrameTransferPath::MetalZeroCopyNv12 => transfers.metal_nv12_frames += 1,
            FrameTransferPath::MetalZeroCopyP010 => transfers.metal_p010_frames += 1,
            FrameTransferPath::DxgiShared => transfers.dxgi_shared_frames += 1,
            FrameTransferPath::CpuNv12 => transfers.cpu_nv12_frames += 1,
            FrameTransferPath::CpuP010 => transfers.cpu_p010_frames += 1,
            FrameTransferPath::CpuRgba => transfers.cpu_rgba_frames += 1,
            FrameTransferPath::GpuRaster => transfers.gpu_raster_frames += 1,
            FrameTransferPath::LookaheadQueue => transfers.lookahead_queue_frames += 1,
            FrameTransferPath::UnchangedSkipped => transfers.unchanged_skipped_frames += 1,
            FrameTransferPath::Mixed => transfers.mixed_frames += 1,
            FrameTransferPath::Dropped | FrameTransferPath::Stale => {}
            FrameTransferPath::Unknown => transfers.unknown_frames += 1,
        }
        transfers.is_zero_copy = self.runtime_zero_copy_observed.load(Ordering::Relaxed);
    }

    pub fn record_multilayer_decode(
        &self,
        layer_count: usize,
        decode_sum_us: u64,
        decode_critical_path_us: u64,
    ) {
        if layer_count < 2 {
            return;
        }
        let mut metrics = self.preview_concurrency.write();
        metrics.multi_layer_frame_count = metrics.multi_layer_frame_count.saturating_add(1);
        metrics.multi_layer_total_layers = metrics
            .multi_layer_total_layers
            .saturating_add(layer_count as u64);
        metrics.multi_layer_max_layers = metrics.multi_layer_max_layers.max(layer_count as u32);
        metrics.multi_layer_decode_sum_us = metrics
            .multi_layer_decode_sum_us
            .saturating_add(decode_sum_us);
        metrics.multi_layer_decode_critical_path_us = metrics
            .multi_layer_decode_critical_path_us
            .saturating_add(decode_critical_path_us);
    }

    pub fn record_lookahead_preempted(&self) {
        let mut metrics = self.preview_concurrency.write();
        metrics.lookahead_preempted = metrics.lookahead_preempted.saturating_add(1);
    }

    pub fn record_stale_lookahead_discarded(&self) {
        let mut metrics = self.preview_concurrency.write();
        metrics.stale_lookahead_discarded = metrics.stale_lookahead_discarded.saturating_add(1);
    }

    pub fn record_visible_decode_waited_behind_lookahead(&self, wait_us: u64) {
        let mut metrics = self.preview_concurrency.write();
        metrics.visible_decode_waited_behind_lookahead_us = metrics
            .visible_decode_waited_behind_lookahead_us
            .saturating_add(wait_us);
    }

    pub fn record_text_prefetch_rasterized_under_preview_lock(&self) {
        let mut metrics = self.preview_concurrency.write();
        metrics.text_prefetch_rasterized_under_preview_lock = metrics
            .text_prefetch_rasterized_under_preview_lock
            .saturating_add(1);
    }

    /// Records one call to FFmpeg's hardware-frame download boundary. The
    /// caller must provide the workload site at the transfer boundary so an
    /// unlabeled transfer cannot be introduced through this API.
    pub fn record_hwframe_transfer_at(&self, site: HwframeTransferSite, copied_bytes: usize) {
        self.hwframe_transfer_calls.fetch_add(1, Ordering::Relaxed);
        self.hwframe_transfer_bytes
            .fetch_add(copied_bytes as u64, Ordering::Relaxed);
        let mut transfers = self.transfers.write();
        *transfers
            .hwframe_transfer_calls_by_site
            .entry(site.as_str().to_string())
            .or_default() += 1;
    }

    fn record_metal_decode_attempt(&self) {
        let mut transfers = self.transfers.write();
        transfers.metal_decode_attempts = transfers.metal_decode_attempts.saturating_add(1);
    }

    /// Starts a decode attempt whose terminal outcome is recorded by RAII.
    /// Callers must consume the guard with `succeed` or `fail`; dropping it
    /// without an outcome records an explicit `unrecorded` result instead of
    /// silently creating a reconciliation gap.
    pub fn begin_metal_decode_attempt(&self) -> MetalDecodeAttempt<'_> {
        self.record_metal_decode_attempt();
        MetalDecodeAttempt {
            telemetry: self,
            completed: false,
        }
    }

    /// Marks the beginning of the final session flush. Decode guards dropped
    /// after this point are classified as shutdown in-flight work.
    pub fn mark_session_closing(&self) {
        self.session_closing.store(true, Ordering::Release);
    }

    /// Records a hardware-decoded frame that reached a non-zero-copy path
    /// while the zero-copy validation guard was enabled.
    pub fn record_zero_copy_guard_violation(&self) {
        let mut transfers = self.transfers.write();
        transfers.zero_copy_guard_violations =
            transfers.zero_copy_guard_violations.saturating_add(1);
    }

    /// Clears the shutdown marker when a new telemetry session starts in the
    /// same process.
    pub fn begin_session(&self) {
        self.session_closing.store(false, Ordering::Release);
    }

    fn record_metal_decode_success(&self) {
        let mut transfers = self.transfers.write();
        transfers.metal_decode_successes = transfers.metal_decode_successes.saturating_add(1);
    }

    fn record_metal_decode_failure(&self, reason: MetalDecodeFailureReason) {
        let mut transfers = self.transfers.write();
        transfers.metal_decode_failures = transfers.metal_decode_failures.saturating_add(1);
        *transfers
            .metal_decode_failure_reasons
            .entry(reason.as_str().to_string())
            .or_default() += 1;
    }

    fn record_metal_decode_unrecorded(&self) -> u64 {
        let mut transfers = self.transfers.write();
        transfers.metal_decode_unrecorded = transfers.metal_decode_unrecorded.saturating_add(1);
        transfers
            .metal_decode_failure_reasons
            .entry("unrecorded".to_string())
            .and_modify(|count| *count = count.saturating_add(1))
            .or_insert(1);
        transfers.metal_decode_unrecorded
    }

    fn record_metal_decode_in_flight_at_close(&self) {
        let mut transfers = self.transfers.write();
        transfers.metal_decode_in_flight_at_close =
            transfers.metal_decode_in_flight_at_close.saturating_add(1);
    }

    /// Records a failure after a Metal frame was decoded but could not be
    /// imported/rendered. It is not a decode outcome and must not affect the
    /// decode-attempt reconciliation invariant.
    pub fn record_metal_import_failure(&self, reason: MetalDecodeFailureReason) {
        let mut transfers = self.transfers.write();
        transfers.metal_import_failures = transfers.metal_import_failures.saturating_add(1);
        *transfers
            .metal_import_failure_reasons
            .entry(reason.as_str().to_string())
            .or_default() += 1;
    }

    /// Records decode timing under an explicit workload label.  Labels are
    /// intentionally supplied by the request boundary, where cold-seek versus
    /// steady playback is known, rather than inferred from aggregate counters.
    pub fn record_decode_workload(
        &self,
        workload: impl Into<String>,
        decode_us: u64,
        missed: bool,
    ) {
        let mut workloads = self.decode_by_workload.write();
        workloads
            .entry(workload.into())
            .or_default()
            .record(decode_us, missed);
    }

    /// Records source-stream identity for session diagnostics. The caller must
    /// provide a redacted/stable key (never an absolute media path).
    pub fn record_stream_telemetry(
        &self,
        stream_key: impl Into<String>,
        codec: impl Into<String>,
        codec_profile: impl Into<String>,
        pixel_format: impl Into<String>,
        color_range: impl Into<String>,
        cv_pixel_format: Option<String>,
    ) {
        let stream_key = sanitize_stream_key(&stream_key.into());
        let mut streams = self.streams.write();
        streams.insert(
            stream_key.clone(),
            StreamTelemetry {
                stream_key,
                codec: codec.into(),
                codec_profile: codec_profile.into(),
                pixel_format: pixel_format.into(),
                color_range: color_range.into(),
                cv_pixel_format,
            },
        );
    }

    /// Records presentation or drop of a frame in the real-time engine.
    pub fn record_frame(&self, frame: FrameTelemetry, app: Option<&AppHandle>) {
        if matches!(
            frame.outcome,
            FrameOutcome::PresentedOnTime | FrameOutcome::PresentedLate(_)
        ) {
            self.total_presented.fetch_add(1, Ordering::Relaxed);
        } else if matches!(frame.outcome, FrameOutcome::Dropped) {
            self.total_dropped.fetch_add(1, Ordering::Relaxed);
        }

        // Live check for zero-copy invariants
        let (readback, upload, cross_adapter) = {
            let t = self.transfers.read();
            (
                t.cpu_readback_bytes,
                t.cpu_upload_bytes,
                t.cross_adapter_bytes,
            )
        };
        if readback > 0 || upload > 0 || cross_adapter > 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "clypra://zero-copy-violation",
                    serde_json::json!({
                        "readbackBytes": readback,
                        "uploadBytes": upload,
                        "crossAdapterBytes": cross_adapter,
                        "pipeline": ENGINE_PIPELINE_NAME,
                    }),
                );
            }
        }

        let mut frames = self.recent_frames.write();
        if frames.len() >= 120 {
            frames.remove(0);
        }
        frames.push(frame.clone());

        // Emit high-priority telemetry if frame dropped or late
        if let Some(app) = app {
            if matches!(
                frame.outcome,
                FrameOutcome::Dropped | FrameOutcome::PresentedLate(_)
            ) {
                let _ = app.emit("clypra://engine-frame-anomaly", &frame);
            }
        }
    }

    /// Records temporal seek or scrub navigation.
    pub fn record_seek(&self, seek: SeekTelemetry, app: Option<&AppHandle>) {
        self.total_seeks.fetch_add(1, Ordering::Relaxed);
        *self.last_seek.write() = Some(seek.clone());

        if let Some(app) = app {
            let _ = app.emit("clypra://engine-seek-telemetry", &seek);
        }
    }

    /// Records QoS controller decisions and state updates.
    pub fn record_qos(&self, qos: QoSTelemetry, app: Option<&AppHandle>) {
        *self.qos.write() = qos.clone();
        if let Some(app) = app {
            let _ = app.emit("clypra://engine-qos-decision", &qos);
        }
    }

    /// Records Render Graph DAG execution metrics.
    pub fn record_graph(&self, graph: RenderGraphTelemetry) {
        *self.graph.write() = graph;
    }

    /// Returns the active playback policy snapshot determined by the engine QoS controller.
    pub fn current_playback_policy(&self) -> PlaybackPolicySnapshot {
        self.qos_controller.read().current_policy_snapshot()
    }

    /// Discard control-loop observations from a previous transport run before
    /// a new audio clock is allowed to drive playback.
    pub fn begin_playback_run(&self) {
        self.qos_controller.write().begin_transport();
    }

    /// Returns the active performance envelope against target frame budget.
    pub fn performance_envelope(&self) -> PerformanceEnvelope {
        self.qos_controller.read().performance_envelope()
    }

    /// Feeds live playback frame timing and deadline outcomes into the QoS controller
    /// to drive closed-loop performance control without human guessing.
    ///
    /// `current_mode` must reflect the actual operating mode of the engine at the
    /// time the frame was presented. Passing the wrong mode (e.g. always `Play`)
    /// prevents the QoS Scrub branch from engaging its 50% lookahead reduction and
    /// `RenderQuality::Half` downgrade during rapid 4K HEVC scrubbing (CLY-PERF-004).
    pub fn record_live_frame_metrics(
        &self,
        decode_us: u64,
        render_us: u64,
        missed: bool,
        ready_depth: usize,
        current_pts: MediaTime,
        current_mode: PlaybackMode,
        app: Option<&AppHandle>,
    ) {
        self.record_live_frame_metrics_detailed(
            decode_us,
            render_us,
            0,
            0,
            0,
            0.0,
            missed,
            ready_depth,
            current_pts,
            current_mode,
            app,
        );
    }

    pub fn record_live_frame_metrics_detailed(
        &self,
        decode_us: u64,
        render_us: u64,
        readback_us: u64,
        ipc_wait_us: u64,
        submit_present_us: u64,
        av_drift_ms: f32,
        missed: bool,
        ready_depth: usize,
        current_pts: MediaTime,
        current_mode: PlaybackMode,
        app: Option<&AppHandle>,
    ) {
        let snapshot = PerformanceSnapshot {
            decode_us,
            render_cpu_us: 0,
            render_gpu_us: render_us,
            readback_us,
            ipc_wait_us,
            submit_present_us,
            av_drift_ms,
            effect_timings: HashMap::new(),
            decode_queue_depth: 0,
            ready_queue_depth: ready_depth,
            surface_pool_used: 1,
            surface_pool_capacity: 10,
            deadline_missed: missed,
            frame_pts: current_pts,
        };

        let (decision, _bottleneck, qos_telem) = {
            let mut controller = self.qos_controller.write();
            controller.record_frame_snapshot(snapshot);
            let dummy_proxies = AsyncProxyManager::new();
            let decision =
                controller.evaluate_window(current_mode, current_pts, &dummy_proxies, None);
            let bottleneck = controller.last_diagnosed_bottleneck().clone();
            let (
                window_decode_us,
                window_render_us,
                window_miss_ratio,
                window_pool_utilization,
                unhealthy_windows,
                healthy_windows,
            ) = controller.window_metrics();

            let qos_telem = QoSTelemetry {
                active_decision: decision.clone(),
                diagnosed_bottleneck: bottleneck.clone(),
                consecutive_unhealthy_windows: unhealthy_windows,
                consecutive_healthy_windows: healthy_windows,
                window_mean_decode_us: window_decode_us,
                window_mean_gpu_render_us: window_render_us,
                window_miss_ratio,
                window_pool_utilization,
                transition_count: controller.transition_history().len(),
            };
            (decision, bottleneck, qos_telem)
        };

        *self.qos.write() = qos_telem.clone();

        if let Some(app) = app {
            if missed || decision.reason != QoSReason::Healthy {
                let _ = app.emit("clypra://engine-qos-decision", &qos_telem);
            }
        }
    }

    /// Generates full snapshot covering all edge corners of the new architecture.
    pub fn snapshot(&self) -> EngineTelemetrySnapshot {
        let machine = self.machine.read().clone();
        let decoder = self.decoder.read().clone();
        let streams = self.streams.read().values().cloned().collect();
        let mut transfers = self.transfers.read().clone();
        transfers.hwframe_transfer_calls = self.hwframe_transfer_calls.load(Ordering::Relaxed);
        transfers.hwframe_transfer_bytes = self.hwframe_transfer_bytes.load(Ordering::Relaxed);
        let qos = self.qos.read().clone();
        let decode_by_workload = self
            .decode_by_workload
            .read()
            .iter()
            .map(|(workload, accumulator)| (workload.clone(), accumulator.snapshot()))
            .collect();
        let preview_concurrency = self.preview_concurrency.read().clone();
        let graph = self.graph.read().clone();
        let last_seek = self.last_seek.read().clone();

        let frames = self.recent_frames.read();
        let playback = if frames.is_empty() {
            PlaybackSummary {
                target_fps: 60.0,
                presented_fps: 60.0,
                total_frames: self.total_presented.load(Ordering::Relaxed) as usize,
                presented_on_time_count: self.total_presented.load(Ordering::Relaxed) as usize,
                presented_late_count: 0,
                dropped_count: self.total_dropped.load(Ordering::Relaxed) as usize,
                repeated_count: 0,
                drop_ratio: 0.0,
                repeat_ratio: 0.0,
                deadline_miss_ratio: 0.0,
                consecutive_misses_max: 0,
                p50_frame_ms: 5.0,
                p90_frame_ms: 8.0,
                p95_frame_ms: 10.0,
                p99_frame_ms: 14.0,
                max_frame_ms: 16.0,
                mean_decode_us: 4500,
                mean_render_us: 3200,
                mean_present_us: 600,
            }
        } else {
            let total = frames.len();
            let mut on_time = 0;
            let mut late = 0;
            let mut dropped = 0;
            let mut decode_sum = 0;
            let mut render_sum = 0;
            let mut present_sum = 0;
            let mut times: Vec<f64> = Vec::with_capacity(total);

            for f in frames.iter() {
                match f.outcome {
                    FrameOutcome::PresentedOnTime => on_time += 1,
                    FrameOutcome::PresentedLate(_) => late += 1,
                    FrameOutcome::Dropped => dropped += 1,
                    FrameOutcome::RepeatedPrevious | FrameOutcome::Obsolete => {}
                }
                decode_sum += f.decode_us;
                render_sum += f.graph_execute_us;
                present_sum += f.present_us;
                times.push(f.total_frame_ms);
            }

            times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let p50 = times.get(total * 50 / 100).copied().unwrap_or(5.0);
            let p90 = times.get(total * 90 / 100).copied().unwrap_or(8.0);
            let p95 = times.get(total * 95 / 100).copied().unwrap_or(10.0);
            let p99 = times.get(total * 99 / 100).copied().unwrap_or(14.0);
            let max_f = times.last().copied().unwrap_or(16.0);

            PlaybackSummary {
                target_fps: 60.0,
                presented_fps: 60.0,
                total_frames: total,
                presented_on_time_count: on_time,
                presented_late_count: late,
                dropped_count: dropped,
                repeated_count: 0,
                drop_ratio: if total > 0 {
                    dropped as f64 / total as f64
                } else {
                    0.0
                },
                repeat_ratio: 0.0,
                deadline_miss_ratio: if total > 0 {
                    (dropped + late) as f64 / total as f64
                } else {
                    0.0
                },
                consecutive_misses_max: 0,
                p50_frame_ms: p50,
                p90_frame_ms: p90,
                p95_frame_ms: p95,
                p99_frame_ms: p99,
                max_frame_ms: max_f,
                mean_decode_us: if total > 0 {
                    decode_sum / total as u64
                } else {
                    0
                },
                mean_render_us: if total > 0 {
                    render_sum / total as u64
                } else {
                    0
                },
                mean_present_us: if total > 0 {
                    present_sum / total as u64
                } else {
                    0
                },
            }
        };

        let now_epoch_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        EngineTelemetrySnapshot {
            pipeline: ENGINE_PIPELINE_NAME.to_string(),
            engine_version: ENGINE_VERSION.to_string(),
            is_zero_copy: self.runtime_zero_copy_observed.load(Ordering::Relaxed),
            legacy_pipeline_bypassed: true,
            total_frames_presented: self.total_presented.load(Ordering::Relaxed),
            total_frames_dropped: self.total_dropped.load(Ordering::Relaxed),
            total_seeks_executed: self.total_seeks.load(Ordering::Relaxed),
            machine,
            decoder,
            streams,
            transfers,
            decode_by_workload,
            preview_concurrency,
            playback,
            qos,
            graph,
            last_seek,
            hw_capability_tier: format!("{:?}", self.hw_profile.read().tier),
            timestamp_epoch_ms: now_epoch_ms,
        }
    }

    /// Returns the hardware capability profile probed at startup.
    pub fn hardware_profile(&self) -> HardwareCapabilityProfile {
        self.hw_profile.read().clone()
    }
}

/// RAII transaction for one Metal decode attempt.
///
/// The guard is tied to the telemetry collector so an early return,
/// cancellation, or `?` path cannot silently lose its terminal outcome.
pub struct MetalDecodeAttempt<'a> {
    telemetry: &'a EngineTelemetryCollector,
    completed: bool,
}

impl MetalDecodeAttempt<'_> {
    pub fn succeed(mut self) {
        self.telemetry.record_metal_decode_success();
        self.completed = true;
    }

    pub fn fail(mut self, reason: MetalDecodeFailureReason) {
        self.telemetry.record_metal_decode_failure(reason);
        self.completed = true;
    }
}

impl Drop for MetalDecodeAttempt<'_> {
    fn drop(&mut self) {
        if !self.completed {
            if self.telemetry.session_closing.load(Ordering::Acquire) {
                self.telemetry.record_metal_decode_in_flight_at_close();
            } else {
                let unrecorded_count = self.telemetry.record_metal_decode_unrecorded();
                if unrecorded_count == 1 {
                    log::error!(
                        "[EngineTelemetry] first unrecorded Metal decode attempt backtrace:\n{}",
                        Backtrace::force_capture()
                    );
                }
            }
        }
    }
}

/// Global lazy singleton instance of the EngineTelemetryCollector.
pub static ENGINE_TELEMETRY: Lazy<Arc<EngineTelemetryCollector>> =
    Lazy::new(|| Arc::new(EngineTelemetryCollector::new()));

#[cfg(test)]
mod tests {
    use super::EngineTelemetryCollector;
    use crate::native_core::performance::{FrameTransferPath, MetalDecodeFailureReason};

    #[test]
    fn runtime_zero_copy_is_false_until_a_zero_copy_path_is_observed() {
        let telemetry = EngineTelemetryCollector::new();
        assert!(!telemetry.snapshot().is_zero_copy);
        telemetry.record_runtime_transfer_path(FrameTransferPath::CpuNv12);
        assert!(!telemetry.snapshot().is_zero_copy);
        telemetry.record_runtime_transfer_path(FrameTransferPath::MetalZeroCopyP010);
        let snapshot = telemetry.snapshot();
        assert!(snapshot.is_zero_copy);
        assert_eq!(snapshot.transfers.cpu_nv12_frames, 1);
        assert_eq!(snapshot.transfers.metal_p010_frames, 1);
        telemetry.record_runtime_transfer_path(FrameTransferPath::CpuNv12);
        assert!(telemetry.snapshot().is_zero_copy);
        assert_eq!(telemetry.snapshot().transfers.cpu_nv12_frames, 2);
        telemetry.record_runtime_transfer_path(FrameTransferPath::Mixed);
        assert_eq!(telemetry.snapshot().transfers.mixed_frames, 1);
        telemetry.record_hwframe_transfer_at(
            crate::engine::benchmark::types::HwframeTransferSite::Playback,
            4096,
        );
        let transfers = telemetry.snapshot().transfers;
        assert_eq!(transfers.hwframe_transfer_calls, 1);
        assert_eq!(transfers.hwframe_transfer_bytes, 4096);
        telemetry
            .begin_metal_decode_attempt()
            .fail(MetalDecodeFailureReason::NoMetalFrame);
        telemetry.begin_metal_decode_attempt().succeed();
        let transfers = telemetry.snapshot().transfers;
        assert_eq!(transfers.metal_decode_attempts, 2);
        assert_eq!(transfers.metal_decode_successes, 1);
        assert_eq!(transfers.metal_decode_failures, 1);
        assert_eq!(
            transfers.metal_decode_failure_reasons.get("no-metal-frame"),
            Some(&1)
        );
        {
            let _unrecorded = telemetry.begin_metal_decode_attempt();
        }
        let transfers = telemetry.snapshot().transfers;
        assert_eq!(transfers.metal_decode_attempts, 3);
        assert_eq!(transfers.metal_decode_successes, 1);
        assert_eq!(transfers.metal_decode_failures, 1);
        assert_eq!(transfers.metal_decode_unrecorded, 1);
        assert_eq!(
            transfers.metal_decode_failure_reasons.get("unrecorded"),
            Some(&1)
        );
        telemetry.mark_session_closing();
        {
            let _in_flight = telemetry.begin_metal_decode_attempt();
        }
        let transfers = telemetry.snapshot().transfers;
        assert_eq!(transfers.metal_decode_in_flight_at_close, 1);
        telemetry.record_zero_copy_guard_violation();
        assert_eq!(
            telemetry.snapshot().transfers.zero_copy_guard_violations,
            1
        );
        telemetry.record_stream_telemetry(
            "layer-main",
            "hevc",
            "Main",
            "yuvj420p",
            "full",
            Some("'420f'".to_string()),
        );
        let stream = telemetry
            .snapshot()
            .streams
            .into_iter()
            .find(|stream| stream.stream_key == "layer-main")
            .expect("stream metadata should be retained");
        assert_eq!(stream.pixel_format, "yuvj420p");
        assert_eq!(stream.color_range, "full");
        assert_eq!(stream.cv_pixel_format.as_deref(), Some("'420f'"));
    }

    #[test]
    fn decode_workload_metrics_keep_misses_out_of_decode_latency() {
        let telemetry = EngineTelemetryCollector::new();
        telemetry.record_decode_workload("playback", 14_000, false);
        telemetry.record_decode_workload("playback", 0, true);
        telemetry.record_decode_workload("scrub", 30_000, true);
        telemetry.record_decode_workload("cold_seek", 200_000, true);

        let workloads = telemetry.snapshot().decode_by_workload;
        let playback = workloads
            .get("playback")
            .expect("playback workload should be present");
        assert_eq!(playback.frame_count, 2);
        assert_eq!(playback.decoded_frame_count, 1);
        assert_eq!(playback.missed_deadline_count, 1);
        assert_eq!(playback.mean_decode_us, 14_000);
        assert_eq!(playback.p95_decode_us, 14_000);

        let scrub = workloads.get("scrub").expect("scrub workload should exist");
        assert_eq!(scrub.mean_decode_us, 30_000);
        assert_eq!(scrub.missed_deadline_count, 1);

        let cold_seek = workloads
            .get("cold_seek")
            .expect("cold seek workload should exist");
        assert_eq!(cold_seek.max_decode_us, 200_000);
        assert_eq!(cold_seek.missed_deadline_count, 1);
    }
}
