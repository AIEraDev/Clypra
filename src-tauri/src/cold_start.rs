//! Cold-start span recorder and launch milestone tracer.
//!
//! Collects instrumented spans across the cold-start lifecycle (C0–C4),
//! maintains bounded ring-buffer storage with per-stage aggregates,
//! tracks audio safety counters (PCM bytes, 256 MiB cap truncations, CLI fallbacks),
//! and captures process creation / OS uptime and user-visible launch milestones.

use once_cell::sync::Lazy;
use serde::Serialize;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Maximum number of individual spans retained in memory.
/// Once reached, oldest spans are discarded and `dropped_spans` is incremented,
/// while `aggregates` retain complete summary statistics across all spans.
pub const RING_BUFFER_CAPACITY: usize = 512;

/// Maximum number of distinct stage keys tracked in `aggregates`.
/// Any distinct stage names beyond this limit fold into `"other"`,
/// ensuring bounded memory consumption.
pub const MAX_DISTINCT_STAGES: usize = 64;

/// Process start instant. Force-initialized via [`force_process_start`].
pub static PROCESS_START: Lazy<Instant> = Lazy::new(Instant::now);

// ── Audio Cold-Path Safety Counters ──────────────────────────────────────────
static AUDIO_PCM_BYTES: AtomicU64 = AtomicU64::new(0);
static AUDIO_CAP_TRUNCATIONS: AtomicU64 = AtomicU64::new(0);
static AUDIO_CLI_FALLBACKS: AtomicU64 = AtomicU64::new(0);

// ── Launch Milestones (One-time atomics) ──────────────────────────────────────
static FIRST_SOUND_AT_US: AtomicU64 = AtomicU64::new(0);
static FIRST_SOUND_LATENCY_US: AtomicU64 = AtomicU64::new(0);
static FIRST_SOUND_LATENCY_SET: AtomicBool = AtomicBool::new(false);
static WINDOW_CREATED_AT_US: AtomicU64 = AtomicU64::new(0);
static WINDOW_SHOWN_AT_US: AtomicU64 = AtomicU64::new(0);
static DOM_CONTENT_LOADED_MS: AtomicU64 = AtomicU64::new(0);
static APP_MOUNTED_MS: AtomicU64 = AtomicU64::new(0);
static SHELL_PAINTED_MS: AtomicU64 = AtomicU64::new(0);
static INTERACTIVE_AT_US: AtomicU64 = AtomicU64::new(0);
static FIRST_FRAME_AT_US: AtomicU64 = AtomicU64::new(0);
static FIRST_FRAME_PAINTED_MS: AtomicU64 = AtomicU64::new(0);
static SMOOTH_PLAYBACK_AT_US: AtomicU64 = AtomicU64::new(0);
static SMOOTH_PLAYBACK_TARGET_FPS: AtomicU32 = AtomicU32::new(0);

// ── Interactive wait tracking ────────────────────────────────────────────────
static GPU_AWAITED_AT_US: AtomicU64 = AtomicU64::new(0);

// ── Clip Ordinal (Never leak file paths into telemetry) ───────────────────────
static CLIP_ORDINAL: AtomicU64 = AtomicU64::new(0);

/// Quantize file size into log2 MiB buckets (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024...)
/// to prevent byte counts from functioning as quasi-identifiers while providing
/// precise cost-model bucketing for clips of any size.
pub fn bucket_file_size_log2_mb(bytes: u64) -> u64 {
    if bytes == 0 {
        return 0;
    }
    const ONE_MIB: u64 = 1024 * 1024;
    let mib = (bytes.saturating_add(ONE_MIB - 1)) / ONE_MIB;
    if mib <= 1 {
        1
    } else {
        mib.next_power_of_two()
    }
}

/// One timestamped span in the cold-start lifecycle.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdSpan {
    /// Short human-readable stage identifier, e.g. `"c0_gpu_init"`.
    pub stage: Cow<'static, str>,
    /// Microseconds elapsed from [`PROCESS_START`] to when this span started.
    pub started_at_us: u64,
    /// Wall-clock work duration of this span in microseconds.
    pub work_us: u64,
    /// Duration an interactive or UI thread was blocked awaiting this span.
    pub waited_by_interactive_us: u64,
    /// `true` if the result came from a persistent cache (skipping real work).
    pub cached: bool,
    /// `true` if the operation completed successfully; `false` on error/early return.
    pub ok: bool,
    /// Subsystem purpose: `"preview"`, `"filmstrip"`, `"waveform"`, `"export"`, or `"probe"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<Cow<'static, str>>,
    /// Monotonic ordinal clip index within the session (1, 2, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip_index: Option<u64>,
    /// Container format name (e.g. `"mov,mp4,m4a,3gp,3g2,mj2"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_format: Option<String>,
    /// Media file size quantized to log2 MiB buckets (1, 2, 4, 8, 16, 32, 64, 128...)
    /// to avoid functioning as a quasi-identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bucket_mb: Option<u64>,
    /// Media location class (`"fixed"`, `"removable"`, `"network"`, or `"unknown"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_location: Option<&'static str>,
}

/// Cumulative aggregate for a specific cold-start stage across the entire session.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageAggregate {
    pub count: u64,
    pub total_work_us: u64,
    pub max_work_us: u64,
    pub total_waited_us: u64,
    pub max_waited_us: u64,
    pub ok_count: u64,
    pub err_count: u64,
}

impl StageAggregate {
    fn record(&mut self, work_us: u64, waited_us: u64, ok: bool) {
        self.count = self.count.saturating_add(1);
        self.total_work_us = self.total_work_us.saturating_add(work_us);
        self.max_work_us = self.max_work_us.max(work_us);
        self.total_waited_us = self.total_waited_us.saturating_add(waited_us);
        self.max_waited_us = self.max_waited_us.max(waited_us);
        if ok {
            self.ok_count = self.ok_count.saturating_add(1);
        } else {
            self.err_count = self.err_count.saturating_add(1);
        }
    }
}

/// Known audio cold-path counters.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioColdMetrics {
    pub pcm_bytes: u64,
    pub cap_truncations: u64,
    pub cli_fallbacks: u64,
}

/// User-visible launch and playback readiness milestones.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchMilestones {
    /// Pre-main time in ms (from OS process creation to main() entry).
    pub pre_main_ms: Option<u64>,
    pub window_created_at_us: Option<u64>,
    pub window_shown_at_us: Option<u64>,
    pub dom_content_loaded_ms: Option<u64>,
    pub app_mounted_ms: Option<u64>,
    pub shell_painted_ms: Option<u64>,
    /// Microseconds elapsed from [`PROCESS_START`] to when the audio callback first rendered non-silent samples.
    pub first_sound_at_us: Option<u64>,
    /// Device output latency in microseconds measured when the first sound was rendered.
    /// The estimated wall-clock time sound was heard is `first_sound_at_us + first_sound_latency_us`.
    pub first_sound_latency_us: Option<u64>,
    pub interactive_at_us: Option<u64>,
    /// First native video frame presented to the native surface.
    pub first_frame_at_us: Option<u64>,
    /// First frame painted on the frontend canvas (in requestAnimationFrame), in ms from process start.
    /// Ensures milestones fire even on software adapters where native surface is disabled.
    pub first_frame_painted_ms: Option<u64>,
    /// First moment unique painted FPS stays at target for 1.0 continuous second.
    pub smooth_playback_at_us: Option<u64>,
    /// Target FPS used during the smooth playback measurement window.
    pub smooth_playback_target_fps: Option<u32>,
}

/// Cold-start report section embedded in the session performance telemetry.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdStartReport {
    /// Unix wall-clock milliseconds at process start.
    pub process_epoch_ms: u64,
    /// OS-measured duration from process creation to main() in ms.
    pub pre_main_ms: Option<u64>,
    /// System uptime at process start (seconds).
    /// Note: On Windows, Fast Startup preserves the kernel session across shutdown/boot,
    /// so a high uptime does not guarantee a warm OS file cache. Treat uptime as a hint,
    /// and rely on explicit cache clearing (e.g. RAMMap / purge) for cold testing.
    pub system_uptime_secs: Option<u64>,
    /// User-visible milestones.
    pub milestones: LaunchMilestones,
    /// Known audio cold-path risks.
    pub audio_metrics: AudioColdMetrics,
    /// Aggregates per stage.
    pub aggregates: HashMap<String, StageAggregate>,
    /// Spans discarded when ring buffer exceeded capacity.
    pub dropped_spans: u64,
    /// Retained spans (most recent, up to 512).
    pub spans: Vec<ColdSpan>,
}

struct ColdReportState {
    process_epoch_ms: u64,
    pre_main_ms: Option<u64>,
    system_uptime_secs: Option<u64>,
    ring: VecDeque<ColdSpan>,
    aggregates: HashMap<String, StageAggregate>,
    dropped_spans: u64,
}

static COLD_REPORT: Lazy<Mutex<ColdReportState>> = Lazy::new(|| {
    let now_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let creation_epoch_ms = get_process_creation_epoch_ms();
    let pre_main_ms = creation_epoch_ms
        .and_then(|c_ms| now_epoch_ms.checked_sub(c_ms))
        .filter(|&ms| ms < 300_000); // Sanity filter: < 5 minutes

    let uptime = get_system_uptime_secs();

    Mutex::new(ColdReportState {
        process_epoch_ms: now_epoch_ms,
        pre_main_ms,
        system_uptime_secs: uptime,
        ring: VecDeque::with_capacity(RING_BUFFER_CAPACITY),
        aggregates: HashMap::new(),
        dropped_spans: 0,
    })
});

/// Force-initialize [`PROCESS_START`]. Call as early as possible in `main()`.
pub fn force_process_start() {
    Lazy::force(&PROCESS_START);
    Lazy::force(&COLD_REPORT);
}

// ── SpanGuard: RAII auto-recording on drop ────────────────────────────────────

/// Interactive wait measurement mode for a span.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitedMode {
    /// Work was non-blocking or background; waited time is 0 unless measured.
    None,
    /// Exact measured wait duration in microseconds.
    Measured(u64),
    /// Interactive thread was synchronously blocked for the entire work duration.
    EqualsWork,
}

/// RAII span guard that records on drop.
///
/// Guaranteed to record a span with exact duration and `ok: false` if an operation
/// fails, returns early with `?`, or panics. Call [`finish_ok`] upon successful completion.
pub struct SpanGuard {
    stage: Cow<'static, str>,
    started: Instant,
    waited: WaitedMode,
    cached: bool,
    ok: bool,
    purpose: Option<Cow<'static, str>>,
    clip_index: Option<u64>,
    container_format: Option<String>,
    file_size_bucket_mb: Option<u64>,
    media_location: Option<&'static str>,
    completed: bool,
}

impl SpanGuard {
    pub fn start(stage: impl Into<Cow<'static, str>>) -> Self {
        Self {
            stage: stage.into(),
            started: Instant::now(),
            waited: WaitedMode::None,
            cached: false,
            ok: false, // Default is false: early return via `?` or panic drops with ok: false!
            purpose: None,
            clip_index: None,
            container_format: None,
            file_size_bucket_mb: None,
            media_location: None,
            completed: false,
        }
    }

    /// Set the functional purpose of this span (e.g. `"preview"`, `"filmstrip"`, `"waveform"`, `"export"`, `"probe"`).
    pub fn set_purpose(&mut self, purpose: impl Into<Cow<'static, str>>) -> &mut Self {
        self.purpose = Some(purpose.into());
        self
    }

    /// Mark the interactive wait time (e.g. if the UI blocked for this operation).
    pub fn set_waited(&mut self, waited_us: u64) -> &mut Self {
        self.waited = WaitedMode::Measured(waited_us);
        self
    }

    /// Convenience: mark that this span was executed synchronously on the interactive path
    /// (waited time equals work time).
    pub fn set_interactive_blocking(&mut self) -> &mut Self {
        self.waited = WaitedMode::EqualsWork;
        self
    }

    pub fn set_cached(&mut self, cached: bool) -> &mut Self {
        self.cached = cached;
        self
    }

    pub fn set_ok(&mut self, ok: bool) -> &mut Self {
        self.ok = ok;
        self
    }

    pub fn set_clip_info(
        &mut self,
        clip_index: u64,
        container_format: Option<String>,
        file_size_bytes: Option<u64>,
        media_location: Option<&'static str>,
    ) -> &mut Self {
        self.clip_index = Some(clip_index);
        self.container_format = container_format;
        self.file_size_bucket_mb = file_size_bytes.map(bucket_file_size_log2_mb);
        self.media_location = media_location;
        self
    }

    /// Complete the guard successfully.
    pub fn finish_ok(mut self) {
        self.ok = true;
        self.finish();
    }

    /// Explicitly complete the guard with current `ok` state.
    pub fn complete(mut self) {
        self.finish();
    }

    fn finish(&mut self) {
        if self.completed {
            return;
        }
        self.completed = true;

        let started_at_us = self
            .started
            .duration_since(*PROCESS_START)
            .as_micros()
            .min(u64::MAX as u128) as u64;
        let work_us = self.started.elapsed().as_micros().min(u64::MAX as u128) as u64;

        let waited_by_interactive_us = match self.waited {
            WaitedMode::None => 0,
            WaitedMode::Measured(us) => us,
            WaitedMode::EqualsWork => work_us,
        };

        record_span_internal(ColdSpan {
            stage: self.stage.clone(),
            started_at_us,
            work_us,
            waited_by_interactive_us,
            cached: self.cached,
            ok: self.ok,
            purpose: self.purpose.clone(),
            clip_index: self.clip_index,
            container_format: self.container_format.clone(),
            file_size_bucket_mb: self.file_size_bucket_mb,
            media_location: self.media_location,
        });
    }
}

impl Drop for SpanGuard {
    fn drop(&mut self) {
        self.finish();
    }
}

/// Convenience helper to record a span directly when not using a guard.
pub fn record_span(stage: &str, started: Instant, waited_by_interactive_us: u64, cached: bool) {
    record_span_with_purpose(stage, started, waited_by_interactive_us, cached, None);
}

/// Convenience helper to record a span with an explicit subsystem purpose.
pub fn record_span_with_purpose(
    stage: &str,
    started: Instant,
    waited_by_interactive_us: u64,
    cached: bool,
    purpose: Option<&'static str>,
) {
    let started_at_us = started
        .duration_since(*PROCESS_START)
        .as_micros()
        .min(u64::MAX as u128) as u64;
    let work_us = started.elapsed().as_micros().min(u64::MAX as u128) as u64;

    record_span_internal(ColdSpan {
        stage: Cow::Owned(stage.to_string()),
        started_at_us,
        work_us,
        waited_by_interactive_us,
        cached,
        ok: true,
        purpose: purpose.map(Cow::Borrowed),
        clip_index: None,
        container_format: None,
        file_size_bucket_mb: None,
        media_location: None,
    });
}

fn record_span_internal(span: ColdSpan) {
    if let Ok(mut state) = COLD_REPORT.lock() {
        let contains_stage = state.aggregates.contains_key(span.stage.as_ref());
        let contains_other = state.aggregates.contains_key("other");
        let stage_key = if contains_stage {
            span.stage.to_string()
        } else {
            let max_allowed = if contains_other {
                MAX_DISTINCT_STAGES
            } else {
                MAX_DISTINCT_STAGES.saturating_sub(1)
            };
            if state.aggregates.len() < max_allowed {
                span.stage.to_string()
            } else {
                "other".to_string()
            }
        };

        state.aggregates.entry(stage_key).or_default().record(
            span.work_us,
            span.waited_by_interactive_us,
            span.ok,
        );

        if state.ring.len() >= RING_BUFFER_CAPACITY {
            state.ring.pop_front();
            state.dropped_spans = state.dropped_spans.saturating_add(1);
        }
        state.ring.push_back(span);
    }
}

// ── Milestone Recording ───────────────────────────────────────────────────────

pub fn record_window_created() {
    if WINDOW_CREATED_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ =
            WINDOW_CREATED_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_window_shown() {
    if WINDOW_SHOWN_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ =
            WINDOW_SHOWN_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_first_sound(latency_us: u64) {
    if FIRST_SOUND_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        if FIRST_SOUND_AT_US
            .compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            FIRST_SOUND_LATENCY_US.store(latency_us, Ordering::Relaxed);
            FIRST_SOUND_LATENCY_SET.store(true, Ordering::Release);
        }
    }
}

pub fn mark_gpu_awaited() {
    if GPU_AWAITED_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = GPU_AWAITED_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn get_gpu_awaited_at_us() -> u64 {
    GPU_AWAITED_AT_US.load(Ordering::Relaxed)
}

pub fn record_first_frame() {
    if FIRST_FRAME_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = FIRST_FRAME_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_first_frame_painted(ms: u64) {
    if FIRST_FRAME_PAINTED_MS.load(Ordering::Relaxed) == 0 {
        let _ = FIRST_FRAME_PAINTED_MS.compare_exchange(0, ms, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_interactive() {
    if INTERACTIVE_AT_US.load(Ordering::Relaxed) == 0 {
        let elapsed = PROCESS_START.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let _ = INTERACTIVE_AT_US.compare_exchange(0, elapsed, Ordering::AcqRel, Ordering::Relaxed);
    }
}

pub fn record_smooth_playback(us: u64, target_fps: Option<u32>) {
    if SMOOTH_PLAYBACK_AT_US.load(Ordering::Relaxed) == 0
        && SMOOTH_PLAYBACK_AT_US
            .compare_exchange(0, us, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
    {
        if let Some(fps) = target_fps {
            SMOOTH_PLAYBACK_TARGET_FPS.store(fps, Ordering::Relaxed);
        }
    }
}

pub fn record_frontend_launch_milestones(
    dom_content_loaded_wall_ms: Option<u64>,
    app_mounted_wall_ms: Option<u64>,
    shell_painted_wall_ms: Option<u64>,
    interactive_wall_ms: Option<u64>,
    first_frame_painted_wall_ms: Option<u64>,
    smooth_playback_wall_ms: Option<u64>,
    smooth_playback_target_fps: Option<u32>,
) {
    let epoch_ms = COLD_REPORT.lock().map(|s| s.process_epoch_ms).unwrap_or(0);

    let to_elapsed_ms = |wall_ms: u64| -> u64 {
        if wall_ms >= epoch_ms && epoch_ms > 0 {
            wall_ms.saturating_sub(epoch_ms)
        } else {
            wall_ms
        }
    };

    if let Some(wall_ms) = dom_content_loaded_wall_ms {
        DOM_CONTENT_LOADED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = app_mounted_wall_ms {
        APP_MOUNTED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = shell_painted_wall_ms {
        SHELL_PAINTED_MS.store(to_elapsed_ms(wall_ms), Ordering::Relaxed);
    }
    if let Some(wall_ms) = interactive_wall_ms {
        let elapsed_us = to_elapsed_ms(wall_ms).saturating_mul(1000);
        if INTERACTIVE_AT_US.load(Ordering::Relaxed) == 0 {
            let _ = INTERACTIVE_AT_US.compare_exchange(
                0,
                elapsed_us,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
    if let Some(wall_ms) = first_frame_painted_wall_ms {
        record_first_frame_painted(to_elapsed_ms(wall_ms));
    }
    if let Some(wall_ms) = smooth_playback_wall_ms {
        let elapsed_us = to_elapsed_ms(wall_ms).saturating_mul(1000);
        record_smooth_playback(elapsed_us, smooth_playback_target_fps);
    }
}

pub fn next_clip_index() -> u64 {
    CLIP_ORDINAL.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn add_audio_pcm_bytes(bytes: u64) {
    AUDIO_PCM_BYTES.fetch_add(bytes, Ordering::Relaxed);
}

pub fn record_audio_cap_truncation() {
    AUDIO_CAP_TRUNCATIONS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_audio_cli_fallback() {
    AUDIO_CLI_FALLBACKS.fetch_add(1, Ordering::Relaxed);
}

/// Retrieve a clone of the current cold-start report.
pub fn get_report() -> ColdStartReport {
    let state = match COLD_REPORT.lock() {
        Ok(s) => s,
        Err(_) => return ColdStartReport::default(),
    };

    let milestones = LaunchMilestones {
        pre_main_ms: state.pre_main_ms,
        window_created_at_us: load_opt_u64(&WINDOW_CREATED_AT_US),
        window_shown_at_us: load_opt_u64(&WINDOW_SHOWN_AT_US),
        dom_content_loaded_ms: load_opt_u64(&DOM_CONTENT_LOADED_MS),
        app_mounted_ms: load_opt_u64(&APP_MOUNTED_MS),
        shell_painted_ms: load_opt_u64(&SHELL_PAINTED_MS),
        first_sound_at_us: load_opt_u64(&FIRST_SOUND_AT_US),
        first_sound_latency_us: if FIRST_SOUND_LATENCY_SET.load(Ordering::Acquire) {
            Some(FIRST_SOUND_LATENCY_US.load(Ordering::Relaxed))
        } else {
            None
        },
        interactive_at_us: load_opt_u64(&INTERACTIVE_AT_US),
        first_frame_at_us: load_opt_u64(&FIRST_FRAME_AT_US),
        first_frame_painted_ms: load_opt_u64(&FIRST_FRAME_PAINTED_MS),
        smooth_playback_at_us: load_opt_u64(&SMOOTH_PLAYBACK_AT_US),
        smooth_playback_target_fps: {
            let fps = SMOOTH_PLAYBACK_TARGET_FPS.load(Ordering::Relaxed);
            if fps == 0 {
                None
            } else {
                Some(fps)
            }
        },
    };

    let audio_metrics = AudioColdMetrics {
        pcm_bytes: AUDIO_PCM_BYTES.load(Ordering::Relaxed),
        cap_truncations: AUDIO_CAP_TRUNCATIONS.load(Ordering::Relaxed),
        cli_fallbacks: AUDIO_CLI_FALLBACKS.load(Ordering::Relaxed),
    };

    ColdStartReport {
        process_epoch_ms: state.process_epoch_ms,
        pre_main_ms: state.pre_main_ms,
        system_uptime_secs: state.system_uptime_secs,
        milestones,
        audio_metrics,
        aggregates: state.aggregates.clone(),
        dropped_spans: state.dropped_spans,
        spans: state.ring.iter().cloned().collect(),
    }
}

fn load_opt_u64(val: &AtomicU64) -> Option<u64> {
    let v = val.load(Ordering::Relaxed);
    if v == 0 {
        None
    } else {
        Some(v)
    }
}

// ── Platform Utilities: Process Creation, Uptime, Media Location ─────────────

#[cfg(target_os = "macos")]
fn get_process_creation_epoch_ms() -> Option<u64> {
    unsafe {
        let mut proc_info: libc::proc_bsdinfo = std::mem::zeroed();
        let pid = std::process::id() as i32;
        let st = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut proc_info as *mut _ as *mut libc::c_void,
            std::mem::size_of::<libc::proc_bsdinfo>() as i32,
        );
        if st as usize == std::mem::size_of::<libc::proc_bsdinfo>() {
            let start_sec = proc_info.pbi_start_tvsec;
            let start_usec = proc_info.pbi_start_tvusec;
            Some((start_sec as u64 * 1000) + (start_usec as u64 / 1000))
        } else {
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn get_system_uptime_secs() -> Option<u64> {
    unsafe {
        let mut boottime: libc::timeval = std::mem::zeroed();
        let mut size = std::mem::size_of::<libc::timeval>();
        let mut mib = [libc::CTL_KERN, libc::KERN_BOOTTIME];
        if libc::sysctl(
            mib.as_mut_ptr(),
            2,
            &mut boottime as *mut _ as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            let mut now: libc::timeval = std::mem::zeroed();
            libc::gettimeofday(&mut now, std::ptr::null_mut());
            Some(now.tv_sec.saturating_sub(boottime.tv_sec) as u64)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn get_process_creation_epoch_ms() -> Option<u64> {
    type HANDLE = *mut std::ffi::c_void;
    type BOOL = i32;
    #[repr(C)]
    struct FILETIME {
        dwLowDateTime: u32,
        dwHighDateTime: u32,
    }
    extern "system" {
        fn GetCurrentProcess() -> HANDLE;
        fn GetProcessTimes(
            hProcess: HANDLE,
            lpCreationTime: *mut FILETIME,
            lpExitTime: *mut FILETIME,
            lpKernelTime: *mut FILETIME,
            lpUserTime: *mut FILETIME,
        ) -> BOOL;
    }
    unsafe {
        let handle = GetCurrentProcess();
        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
            let ft_intervals =
                ((creation.dwHighDateTime as u64) << 32) | (creation.dwLowDateTime as u64);
            // 116444736000000000 is 100ns intervals between 1601 and 1970 UTC
            if ft_intervals >= 116444736000000000 {
                let unix_intervals = ft_intervals - 116444736000000000;
                Some(unix_intervals / 10000)
            } else {
                None
            }
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn get_system_uptime_secs() -> Option<u64> {
    extern "system" {
        fn GetTickCount64() -> u64;
    }
    unsafe { Some(GetTickCount64() / 1000) }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn get_process_creation_epoch_ms() -> Option<u64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn get_system_uptime_secs() -> Option<u64> {
    std::fs::read_to_string("/proc/uptime").ok().and_then(|s| {
        s.split_whitespace()
            .next()
            .and_then(|v| v.parse::<f64>().ok())
            .map(|u| u as u64)
    })
}

/// Classify a filesystem path as `"fixed"`, `"removable"`, or `"network"` drive.
/// Never logs, stores, or transmits the path.
#[cfg(target_os = "windows")]
pub fn classify_media_location(path: &std::path::Path) -> &'static str {
    type UINT = u32;
    type LPCWSTR = *const u16;
    extern "system" {
        fn GetDriveTypeW(lpRootPathName: LPCWSTR) -> UINT;
    }
    let mut root = match path.components().next() {
        Some(c) => c.as_os_str().to_string_lossy().to_string(),
        None => return "unknown",
    };
    if !root.ends_with('\\') && !root.ends_with('/') {
        root.push('\\');
    }
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
    match drive_type {
        3 => "fixed",         // DRIVE_FIXED
        2 | 5 => "removable", // DRIVE_REMOVABLE | DRIVE_CDROM
        4 => "network",       // DRIVE_REMOTE
        6 => "ramdisk",       // DRIVE_RAMDISK
        _ => "unknown",
    }
}

#[cfg(not(target_os = "windows"))]
pub fn classify_media_location(path: &std::path::Path) -> &'static str {
    use std::os::unix::ffi::OsStrExt;
    let c_path = match std::ffi::CString::new(path.as_os_str().as_bytes()) {
        Ok(c) => c,
        Err(_) => return "unknown",
    };
    unsafe {
        #[cfg(target_os = "macos")]
        {
            let mut stat: libc::statfs = std::mem::zeroed();
            if libc::statfs(c_path.as_ptr(), &mut stat) == 0 {
                let flags = stat.f_flags;
                // MNT_LOCAL is 0x00001000 on macOS
                let is_local = (flags & (libc::MNT_LOCAL as u32)) != 0;
                if !is_local {
                    "network"
                } else if path.starts_with("/Volumes") {
                    "removable"
                } else {
                    "fixed"
                }
            } else {
                "unknown"
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let mut stat: libc::statfs = std::mem::zeroed();
            if libc::statfs(c_path.as_ptr(), &mut stat) == 0 {
                // Common network filesystem types on Linux:
                // NFS (0x6969), SMB/CIFS (0x517B, 0xFE534D42), AFS (0x5346414F)
                let f_type = stat.f_type as u64;
                let is_network = f_type == 0x6969
                    || f_type == 0x517B
                    || f_type == 0xFE534D42
                    || f_type == 0x5346414F;
                if is_network {
                    "network"
                } else if path.starts_with("/media")
                    || path.starts_with("/mnt")
                    || path.starts_with("/run/media")
                {
                    "removable"
                } else {
                    "fixed"
                }
            } else {
                "unknown"
            }
        }
    }
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spans_ordered_and_monotonic() {
        force_process_start();
        let guard1 = SpanGuard::start("test_monotonic_1");
        std::thread::sleep(std::time::Duration::from_millis(5));
        guard1.finish_ok();

        let guard2 = SpanGuard::start("test_monotonic_2");
        std::thread::sleep(std::time::Duration::from_millis(5));
        guard2.finish_ok();

        let report = get_report();
        let span1 = report
            .spans
            .iter()
            .find(|s| s.stage == "test_monotonic_1")
            .unwrap();
        let span2 = report
            .spans
            .iter()
            .find(|s| s.stage == "test_monotonic_2")
            .unwrap();

        assert!(span2.started_at_us >= span1.started_at_us);
        assert!(span1.work_us >= 4_000); // At least 4ms
        assert!(span2.work_us >= 4_000);
        assert!(span1.ok);
        assert!(span2.ok);
    }

    #[test]
    fn test_span_guard_early_return_records_ok_false() {
        force_process_start();
        fn failing_operation_with_question_mark() -> Result<(), &'static str> {
            let _guard = SpanGuard::start("test_guard_early_return");
            std::thread::sleep(std::time::Duration::from_millis(2));
            // Early return via `?` operator — guard dropped without finish_ok()
            Err("probe failed early")?;
            Ok(())
        }

        let res = failing_operation_with_question_mark();
        assert!(res.is_err());

        let report = get_report();
        let span = report
            .spans
            .iter()
            .rfind(|s| s.stage == "test_guard_early_return")
            .expect("Span must be recorded even on early return");

        assert!(
            !span.ok,
            "Span dropped via early return must have ok: false"
        );
        assert!(span.work_us >= 1_500);
    }

    #[test]
    fn test_span_guard_panic_records_ok_false() {
        force_process_start();
        let panic_result = std::panic::catch_unwind(|| {
            let _guard = SpanGuard::start("test_guard_panic");
            std::thread::sleep(std::time::Duration::from_millis(2));
            panic!("unexpected decoder panic");
        });
        assert!(panic_result.is_err());

        let report = get_report();
        let span = report
            .spans
            .iter()
            .rfind(|s| s.stage == "test_guard_panic")
            .expect("Span must be recorded on panic unwind");

        assert!(!span.ok, "Span dropped via panic must have ok: false");
        assert!(span.work_us >= 1_500);
    }

    #[test]
    fn test_span_guard_finish_ok_records_ok_true() {
        force_process_start();
        let mut guard = SpanGuard::start("test_guard_success");
        guard.set_waited(500);
        guard.finish_ok();

        let report = get_report();
        let span = report
            .spans
            .iter()
            .rfind(|s| s.stage == "test_guard_success")
            .unwrap();

        assert!(span.ok);
        assert_eq!(span.waited_by_interactive_us, 500);
    }

    #[test]
    fn test_ring_bound_and_aggregate_overflow() {
        force_process_start();
        let initial_report = get_report();
        let initial_dropped = initial_report.dropped_spans;

        // Push 600 spans (exceeding RING_BUFFER_CAPACITY = 512)
        for i in 0..600 {
            let mut guard = SpanGuard::start("test_overflow_stage");
            guard.set_waited(10);
            if i % 2 == 0 {
                guard.finish_ok();
            } else {
                drop(guard); // drops with ok: false
            }
        }

        let report = get_report();
        assert!(report.spans.len() <= RING_BUFFER_CAPACITY);
        assert!(report.dropped_spans >= initial_dropped + (600 - RING_BUFFER_CAPACITY) as u64);

        let agg = report.aggregates.get("test_overflow_stage").unwrap();
        assert!(agg.count >= 600);
        assert!(agg.ok_count >= 300);
        assert!(agg.err_count >= 300);
        assert!(agg.total_waited_us >= 6_000);
    }

    #[test]
    fn test_stage_keys_bounded_to_64() {
        force_process_start();
        // Push spans with 80 distinct stage names
        for i in 0..80 {
            let stage_name = format!("stage_key_unique_{i}");
            record_span(&stage_name, Instant::now(), 0, false);
        }

        let report = get_report();
        assert!(
            report.aggregates.len() <= MAX_DISTINCT_STAGES,
            "Aggregates map exceeded MAX_DISTINCT_STAGES (len={})",
            report.aggregates.len()
        );
        assert!(
            report.aggregates.contains_key("other"),
            "Excess stages must fold into 'other'"
        );
    }

    #[test]
    fn test_bucket_file_size_log2_mb() {
        assert_eq!(bucket_file_size_log2_mb(0), 0);
        assert_eq!(bucket_file_size_log2_mb(100), 1);
        assert_eq!(bucket_file_size_log2_mb(500 * 1024), 1);
        assert_eq!(bucket_file_size_log2_mb(1024 * 1024), 1);
        assert_eq!(bucket_file_size_log2_mb(1024 * 1024 + 1), 2);
        assert_eq!(bucket_file_size_log2_mb(3 * 1024 * 1024), 4);
        assert_eq!(bucket_file_size_log2_mb(5 * 1024 * 1024), 8);
        assert_eq!(bucket_file_size_log2_mb(15 * 1024 * 1024), 16);
        assert_eq!(bucket_file_size_log2_mb(60 * 1024 * 1024), 64);
        assert_eq!(bucket_file_size_log2_mb(100 * 1024 * 1024), 128);
        assert_eq!(bucket_file_size_log2_mb(1000 * 1024 * 1024), 1024);
    }

    #[test]
    fn test_classify_media_location_samples() {
        #[cfg(target_os = "windows")]
        {
            let fixed = classify_media_location(std::path::Path::new("C:\\Videos\\clip.mp4"));
            assert!(fixed == "fixed" || fixed == "unknown");
        }
        #[cfg(not(target_os = "windows"))]
        {
            let loc = classify_media_location(std::path::Path::new("/tmp/test.mp4"));
            assert!(loc == "fixed" || loc == "unknown");
        }
    }

    #[test]
    fn test_report_serialization_keys() {
        force_process_start();
        let report = get_report();
        let json = serde_json::to_string(&report).expect("ColdStartReport must serialize");
        assert!(json.contains("\"processEpochMs\":"));
        assert!(json.contains("\"milestones\":"));
        assert!(json.contains("\"audioMetrics\":"));
        assert!(json.contains("\"aggregates\":"));
        assert!(json.contains("\"droppedSpans\":"));
        assert!(json.contains("\"spans\":"));
    }

    #[test]
    fn test_first_sound_latency_preserves_zero() {
        // Record latency as 0 us (valid output when driver has no device latency offset)
        record_first_sound(0);
        let report = get_report();
        assert_eq!(
            report.milestones.first_sound_latency_us,
            Some(0),
            "A latency of 0 must be preserved as Some(0), not None"
        );
    }
}
