use once_cell::sync::Lazy;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::cold_start::milestones::{
    collect_audio_metrics, collect_launch_milestones, get_first_frame_painted_at_us,
};
use crate::cold_start::models::{
    bucket_file_size_log2_mb, get_milestone_definitions, ColdSpan, ColdStartReport,
    StageAggregate, WaitedMode, CURRENT_REPORT_VERSION, MAX_DISTINCT_STAGES, RING_BUFFER_CAPACITY,
};
use crate::cold_start::os::{get_process_creation_epoch_ms, get_system_uptime_secs};

/// Process start instant. Force-initialized via [`force_process_start`].
pub static PROCESS_START: Lazy<Instant> = Lazy::new(Instant::now);

pub(crate) struct ColdReportState {
    pub(crate) process_epoch_ms: u64,
    pub(crate) pre_main_ms: Option<u64>,
    pub(crate) system_uptime_secs: Option<u64>,
    pub(crate) ring: VecDeque<ColdSpan>,
    pub(crate) aggregates: HashMap<String, StageAggregate>,
    pub(crate) dropped_spans: u64,
}

pub(crate) static COLD_REPORT: Lazy<Mutex<ColdReportState>> = Lazy::new(|| {
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
    overlapped_with_critical_path_us: Option<u64>,
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
            overlapped_with_critical_path_us: None,
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

    /// Mark the background overlap with the critical path before interactive or first frame.
    pub fn set_overlapped_with_critical_path(&mut self, us: u64) -> &mut Self {
        self.overlapped_with_critical_path_us = Some(us);
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
            overlapped_with_critical_path_us: self.overlapped_with_critical_path_us,
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

/// Convenience helper to record a span with critical-path overlap metrics.
pub fn record_span_with_overlap(
    stage: &str,
    started: Instant,
    waited_by_interactive_us: u64,
    overlapped_with_critical_path_us: Option<u64>,
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
        overlapped_with_critical_path_us,
        cached,
        ok: true,
        purpose: purpose.map(Cow::Borrowed),
        clip_index: None,
        container_format: None,
        file_size_bucket_mb: None,
        media_location: None,
    });
}

/// Convenience helper to record a span with an explicit subsystem purpose.
pub fn record_span_with_purpose(
    stage: &str,
    started: Instant,
    waited_by_interactive_us: u64,
    cached: bool,
    purpose: Option<&'static str>,
) {
    record_span_with_overlap(
        stage,
        started,
        waited_by_interactive_us,
        None,
        cached,
        purpose,
    );
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

/// Record a custom span directly (e.g. from frontend performance marks or native lifecycle stages).
pub fn record_custom_span(
    stage: impl Into<Cow<'static, str>>,
    started_at_us: u64,
    work_us: u64,
    waited_us: u64,
    cached: bool,
    ok: bool,
    purpose: Option<impl Into<Cow<'static, str>>>,
) {
    record_span_internal(ColdSpan {
        stage: stage.into(),
        started_at_us,
        work_us,
        waited_by_interactive_us: waited_us,
        overlapped_with_critical_path_us: None,
        cached,
        ok,
        purpose: purpose.map(Into::into),
        clip_index: None,
        container_format: None,
        file_size_bucket_mb: None,
        media_location: None,
    });
}

/// Retrieve a clone of the current cold-start report.
pub fn get_report() -> ColdStartReport {
    let mut state = match COLD_REPORT.lock() {
        Ok(s) => s,
        Err(_) => return ColdStartReport::default(),
    };

    let first_frame_us = get_first_frame_painted_at_us();
    if first_frame_us > 0 {
        let mut audio_waited: Option<u64> = None;
        for span in state.ring.iter_mut() {
            if span.stage == "c1_audio_decode_all" {
                let span_start = span.started_at_us;
                let span_end = span_start.saturating_add(span.work_us);
                let waited = if first_frame_us > span_start {
                    first_frame_us.min(span_end).saturating_sub(span_start)
                } else {
                    0
                };
                span.waited_by_interactive_us = waited;
                audio_waited = Some(waited);
            }
        }
        if let Some(waited) = audio_waited {
            if let Some(agg) = state.aggregates.get_mut("c1_audio_decode_all") {
                agg.total_waited_us = waited;
                agg.max_waited_us = waited;
            }
        }
    }

    let milestones = collect_launch_milestones(state.pre_main_ms);
    let audio_metrics = collect_audio_metrics();

    ColdStartReport {
        report_version: CURRENT_REPORT_VERSION,
        milestone_defs: get_milestone_definitions(),
        process_epoch_ms: state.process_epoch_ms,
        pre_main_ms: state.pre_main_ms,
        system_uptime_secs: state.system_uptime_secs,
        build_profile: if cfg!(debug_assertions) { "debug" } else { "release" },
        git_commit: option_env!("CLYPRA_GIT_COMMIT"),
        git_dirty: option_env!("CLYPRA_GIT_DIRTY").map(|s| s == "true").unwrap_or(false),
        milestones,
        audio_metrics,
        aggregates: state.aggregates.clone(),
        dropped_spans: state.dropped_spans,
        spans: state.ring.iter().cloned().collect(),
    }
}
