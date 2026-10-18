use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;

/// Maximum number of individual spans retained in memory.
/// Once reached, oldest spans are discarded and `dropped_spans` is incremented,
/// while `aggregates` retain complete summary statistics across all spans.
pub const RING_BUFFER_CAPACITY: usize = 512;

/// Maximum number of distinct stage keys tracked in `aggregates`.
/// Any distinct stage names beyond this limit fold into `"other"`,
/// ensuring bounded memory consumption.
pub const MAX_DISTINCT_STAGES: usize = 64;

pub const CURRENT_REPORT_VERSION: u32 = 3;

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
    /// Duration this background task overlapped with the critical path before interactive or first frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlapped_with_critical_path_us: Option<u64>,
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
    pub fn record(&mut self, work_us: u64, waited_us: u64, ok: bool) {
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
    #[serde(default)]
    pub fallback_reasons: Vec<String>,
}

/// User-visible launch and playback readiness milestones.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchMilestones {
    /// Pre-main time in ms (from OS process creation to main() entry).
    pub pre_main_ms: Option<u64>,
    pub window_created_at_us: Option<u64>,
    pub window_shown_at_us: Option<u64>,
    pub tauri_ready_at_us: Option<u64>,
    /// Webview navigation start in ms from process start (performance.timeOrigin).
    pub navigation_start_ms: Option<u64>,
    pub dom_content_loaded_ms: Option<u64>,
    pub app_mounted_ms: Option<u64>,
    pub shell_painted_ms: Option<u64>,
    /// Microseconds elapsed from [`PROCESS_START`] to when the audio callback first rendered non-silent samples.
    pub first_sound_at_us: Option<u64>,
    /// Device output latency in microseconds measured when the first sound was rendered.
    /// The estimated wall-clock time sound was heard is `first_sound_at_us + first_sound_latency_us`.
    pub first_sound_latency_us: Option<u64>,
    pub interactive_at_us: Option<u64>,
    /// When project open was requested in S2, in microseconds from process start.
    pub project_open_requested_at_us: Option<u64>,
    /// First native video frame presented to the native surface.
    pub first_frame_at_us: Option<u64>,
    /// First frame painted on the frontend canvas (in requestAnimationFrame), in ms from process start.
    /// Ensures milestones fire even on software adapters where native surface is disabled.
    pub first_frame_painted_ms: Option<u64>,
    /// Time from project open request to first frame painted in ms (human-independent S2 duration).
    pub first_frame_painted_from_open_ms: Option<u64>,
    /// First moment unique painted FPS stays at target for 1.0 continuous second.
    pub smooth_playback_at_us: Option<u64>,
    /// Target FPS used during the smooth playback measurement window.
    pub smooth_playback_target_fps: Option<u32>,
    /// Document visibility state ("visible", "hidden") recorded during launch milestones.
    pub document_visibility_state: Option<String>,
    /// Whether the document has focus (`document.hasFocus()`).
    pub document_has_focus: Option<bool>,
    /// Whether the native window has input focus (`window.is_focused()`).
    pub window_is_focused: Option<bool>,
    /// Whether the native window is visible (`window.is_visible()`).
    pub window_is_visible: Option<bool>,
    /// Quiescence wait time in ms before interactive milestone was confirmed.
    pub quiescence_wait_ms: Option<u64>,
    /// True if App Nap was explicitly disabled for the benchmark run.
    pub app_nap_disabled: Option<bool>,
    /// True if the run met all valid measurement criteria (focused and visible).
    pub valid: bool,
    /// Reason string if the run was flagged invalid (e.g. "window not focused").
    pub invalid_reason: Option<String>,
}

/// Specification of cold-start milestone definitions. Frozen per report version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDefinitions {
    pub pre_main: &'static str,
    pub navigation_start: &'static str,
    pub dom_content_loaded: &'static str,
    pub app_mounted: &'static str,
    pub shell_painted: &'static str,
    pub interactive: &'static str,
    pub first_frame_from_open: &'static str,
    pub smooth_playback: &'static str,
}

pub fn get_milestone_definitions() -> MilestoneDefinitions {
    MilestoneDefinitions {
        pre_main: "OS process creation to native main() entry",
        navigation_start: "Native process start to WebKit browsing context creation (performance.timeOrigin - processEpochMs)",
        dom_content_loaded: "Native process start to DOMContentLoaded event end",
        app_mounted: "Native process start to React App root mount",
        shell_painted: "Native process start to double requestAnimationFrame after mount",
        interactive: "Native process start to responsive main-thread event loop (3 consecutive MessageChannel ping round-trips < 5ms)",
        first_frame_from_open: "Project open request to first frame presented to native surface or canvas paint",
        smooth_playback: "Native process start to first moment unique painted FPS stays at target for 1.0s",
    }
}

impl Default for MilestoneDefinitions {
    fn default() -> Self {
        get_milestone_definitions()
    }
}

/// Cold-start report section embedded in the session performance telemetry.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdStartReport {
    /// Schema version for cold-start report structure and milestone definitions.
    pub report_version: u32,
    /// Frozen specifications for all user-visible milestones.
    pub milestone_defs: MilestoneDefinitions,
    /// Unix wall-clock milliseconds at process start.
    pub process_epoch_ms: u64,
    /// OS-measured duration from process creation to main() in ms.
    pub pre_main_ms: Option<u64>,
    /// System uptime at process start (seconds).
    /// Note: On Windows, Fast Startup preserves the kernel session across shutdown/boot,
    /// so a high uptime does not guarantee a warm OS file cache. Treat uptime as a hint,
    /// and rely on explicit cache clearing (e.g. RAMMap / purge) for cold testing.
    pub system_uptime_secs: Option<u64>,
    /// Cargo profile of the running native binary: "debug" or "release".
    pub build_profile: &'static str,
    /// Git commit SHA of the binary at compile time.
    pub git_commit: Option<&'static str>,
    /// True if the binary was built from a dirty git working tree.
    pub git_dirty: bool,
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

/// Automated benchmark execution parameters.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchRunConfig {
    pub enabled: bool,
    pub project_path: Option<String>,
    pub report_output_path: Option<String>,
    pub seek_target_secs: Option<f64>,
    pub play_duration_secs: Option<f64>,
    pub auto_exit: bool,
}

/// Inspect environment and CLI arguments for benchmark run settings.
pub fn get_bench_run_config() -> BenchRunConfig {
    let mut config = BenchRunConfig::default();

    // Check environment variables first
    if let Ok(bench_run_env) = std::env::var("CLYPRA_BENCH_RUN") {
        if !bench_run_env.is_empty() {
            config.enabled = true;
            if bench_run_env.ends_with(".json") && std::path::Path::new(&bench_run_env).is_file() {
                if let Ok(content) = std::fs::read_to_string(&bench_run_env) {
                    if let Ok(parsed) = serde_json::from_str::<BenchRunConfig>(&content) {
                        return parsed;
                    }
                }
            }
        }
    }
    if let Ok(proj) = std::env::var("CLYPRA_BENCH_PROJECT") {
        if !proj.is_empty() {
            config.enabled = true;
            config.project_path = Some(proj);
        }
    }
    if let Ok(rep) = std::env::var("CLYPRA_BENCH_REPORT") {
        if !rep.is_empty() {
            config.enabled = true;
            config.report_output_path = Some(rep);
        }
    }
    if let Ok(exit) = std::env::var("CLYPRA_BENCH_AUTO_EXIT") {
        if exit == "1" || exit.eq_ignore_ascii_case("true") {
            config.enabled = true;
            config.auto_exit = true;
        }
    }

    // Check CLI arguments
    let args: Vec<String> = std::env::args().collect();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--bench-run" {
            config.enabled = true;
            if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                let path = &args[i + 1];
                if path.ends_with(".json") && std::path::Path::new(path).is_file() {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if let Ok(parsed) = serde_json::from_str::<BenchRunConfig>(&content) {
                            return parsed;
                        }
                    }
                }
                i += 1;
            }
        } else if arg == "--bench-project" && i + 1 < args.len() {
            config.enabled = true;
            config.project_path = Some(args[i + 1].clone());
            i += 1;
        } else if arg == "--bench-report" && i + 1 < args.len() {
            config.enabled = true;
            config.report_output_path = Some(args[i + 1].clone());
            i += 1;
        } else if arg == "--bench-auto-exit" {
            config.enabled = true;
            config.auto_exit = true;
        }
        i += 1;
    }

    config
}

/// Returns true only if benchmark mode was explicitly activated via CLI argument or env var.
pub fn is_bench_mode_active() -> bool {
    get_bench_run_config().enabled
}
