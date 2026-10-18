use std::sync::{Arc, OnceLock};
use serde::Serialize;
use tauri::Manager;
use crate::native_core::{
    ModeStats, NativeFrameService, NativeFrameServiceStats, NativeGpuRuntimeStatus, PreviewMode,
};
use super::push_runtime::{NativePlaybackPushRuntime, NativePlaybackPushStatus};

/// Returns `true` when `CLYPRA_SKIP_PLAYBACK_CACHE_INSERT=1` (or `true`) is
/// set in the environment. Evaluated once at first call; subsequent calls are
/// free reads of a boolean.
///
/// **Default: `false`** — the old behavior is preserved unless you opt in.
/// Set this to isolate whether the `cache.insert` cost is responsible for the
/// ~34 ms median unaccounted time in playback mode.
pub(crate) fn skip_playback_cache_insert_enabled() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("CLYPRA_SKIP_PLAYBACK_CACHE_INSERT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}


/// A user-initiated, copyable snapshot of the native preview environment and
/// telemetry. This endpoint is read-only: it never enables automatic field
/// telemetry and it never adds samples to the performance windows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePreviewPerformanceReport {
    pub report_version: u32,
    pub captured_at_ms: u64,
    pub application_version: String,
    /// Rust's active Cargo profile. Performance percentiles from debug builds
    /// must never be compared with release qualification baselines.
    pub build_profile: String,
    pub operating_system: String,
    pub architecture: String,
    /// The git commit SHA that produced this binary. `None` when built outside
    /// of git (e.g. a release tarball without `.git`).
    pub git_commit: Option<String>,
    /// `true` when the working tree had uncommitted changes at build time.
    pub git_dirty: Option<bool>,
    pub gpu: Option<NativeGpuRuntimeStatus>,
    pub audio: Option<crate::native_audio::NativeAudioStatus>,
    pub preview: Option<NativeFrameServiceStats>,
    pub session: crate::wgpu_compositor::SessionSnapshot,
    /// Per-interaction p95 diagnosis. This is an evidence summary, not an
    /// automated policy change: it tells the maintainer which phase to pursue.
    pub stage_diagnoses: Vec<NativePreviewStageDiagnosis>,
    pub push_bridge: Option<NativePlaybackPushStatus>,
    /// Whether the `CLYPRA_SKIP_PLAYBACK_CACHE_INSERT` experiment was active
    /// during this session. When `true`, playback-mode frames were NOT inserted
    /// into the NativeFrameService cache. Records the A/B state so unaccounted
    /// p50 comparisons can be attributed correctly.
    pub playback_cache_insert_skipped: bool,
    pub cold_start: crate::cold_start::ColdStartReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePreviewStageDiagnosis {
    pub mode: PreviewMode,
    pub sample_count: usize,
    pub dominant_stage: String,
    pub dominant_p95_us: u64,
    /// `prioritize-decode` triggers the Phase 0 decode decision gate. Other
    /// values intentionally preserve uncertainty instead of crediting a
    /// throughput gain to the wrong pipeline stage.
    pub recommended_next_step: String,
}

/// Runtime-discovered candidates for the Phase 2 bridge transport gate. This
/// intentionally describes capability only: selection is made by the measured
/// p95/FPS gate, never by operating system, adapter vendor, or wgpu backend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePushTransportCapabilities {
    pub channel: bool,
    pub custom_protocol_long_poll: bool,
    pub webview2_shared_buffer: bool,
    pub webview_runtime: Option<String>,
}

#[tauri::command]
pub fn get_native_push_transport_capabilities(
    #[cfg_attr(not(target_os = "windows"), allow(unused_variables))] app: tauri::AppHandle,
) -> NativePushTransportCapabilities {
    #[cfg(target_os = "windows")]
    {
        use std::sync::{Arc, Mutex};
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment12, ICoreWebView2_17,
        };
        use windows_core::Interface;

        let shared_buffer = Arc::new(Mutex::new(false));
        let runtime_version = Arc::new(Mutex::new(None));
        if let Some(window) = app.get_webview_window("main") {
            let shared_buffer_out = Arc::clone(&shared_buffer);
            let runtime_version_out = Arc::clone(&runtime_version);
            let _ = window.with_webview(move |webview| unsafe {
                let environment = webview.environment();
                let controller = webview.controller();
                let webview_core = controller.CoreWebView2();
                let supported = environment.cast::<ICoreWebView2Environment12>().is_ok()
                    && webview_core
                        .as_ref()
                        .map(|core| core.cast::<ICoreWebView2_17>().is_ok())
                        .unwrap_or(false);
                if let Ok(mut value) = shared_buffer_out.lock() {
                    *value = supported;
                }

                // BrowserVersionString now requires an output parameter
                let mut version_string = windows_core::PWSTR::null();
                if environment
                    .BrowserVersionString(&mut version_string)
                    .is_ok()
                {
                    if let Ok(mut value) = runtime_version_out.lock() {
                        let version = version_string.to_string().unwrap_or_default();
                        *value = Some(version);
                        // Free the allocated string memory
                        if !version_string.is_null() {
                            windows_core::imp::CoTaskMemFree(version_string.0 as *const _);
                        }
                    }
                }
            });
        }
        NativePushTransportCapabilities {
            channel: true,
            custom_protocol_long_poll: true,
            webview2_shared_buffer: shared_buffer.lock().map(|value| *value).unwrap_or(false),
            webview_runtime: runtime_version.lock().ok().and_then(|value| value.clone()),
        }
    }

    #[cfg(not(target_os = "windows"))]
    NativePushTransportCapabilities {
        channel: true,
        custom_protocol_long_poll: true,
        webview2_shared_buffer: false,
        webview_runtime: None,
    }
}

pub(crate) fn diagnose_mode_stats(mode: &ModeStats) -> Option<NativePreviewStageDiagnosis> {
    let stages = [
        ("packet_decode", mode.packet_decode.p95, "prioritize-decode"),
        (
            "hardware_frame_download",
            mode.hardware_frame_download.p95,
            "investigate-hardware-download",
        ),
        (
            "decoder_mutex_wait",
            mode.decoder_mutex_wait.p95,
            "prioritize-decode",
        ),
        ("demux_wait", mode.demux_wait.p95, "prioritize-decode"),
        (
            "scale_colorspace",
            mode.scale_colorspace.p95,
            "investigate-render-upload",
        ),
        (
            "conversion_upload",
            mode.conversion_upload.p95,
            "investigate-render-upload",
        ),
        ("compose", mode.compose.p95, "investigate-render-upload"),
        (
            "gpu_queue_wait",
            mode.gpu_queue_wait.p95,
            "investigate-render-upload",
        ),
        ("readback", mode.readback.p95, "investigate-bridge"),
        ("map_wait", mode.map_wait.p95, "investigate-readback"),
        ("ipc_wait", mode.ipc_wait.p95, "investigate-bridge"),
        ("present", mode.present.p95, "investigate-bridge"),
        (
            "scheduler_wait",
            mode.scheduler_wait.p95,
            "investigate-queue",
        ),
        (
            "lookahead_wait",
            mode.lookahead_wait.p95,
            "investigate-queue",
        ),
        (
            "queue_residency",
            mode.queue_residency.p95,
            "investigate-queue",
        ),
        (
            "surface_acquire",
            mode.surface_acquire.p95,
            "investigate-queue",
        ),
        (
            "submit_present",
            mode.submit_present.p95,
            "investigate-queue",
        ),
        (
            "cold_start_init",
            mode.cold_start_init.p95,
            "warm-up-or-cache",
        ),
        (
            "unaccounted",
            mode.unaccounted.p95,
            "investigate-unaccounted",
        ),
    ];
    let (dominant_stage, dominant_p95_us, recommendation) = stages
        .into_iter()
        .filter_map(|(stage, p95, recommendation)| p95.map(|value| (stage, value, recommendation)))
        .max_by_key(|(_, value, _)| *value)?;
    let sample_count = [
        mode.decode.sample_count,
        mode.packet_decode.sample_count,
        mode.unaccounted.sample_count,
        mode.hardware_frame_download.sample_count,
        mode.decoder_mutex_wait.sample_count,
        mode.demux_wait.sample_count,
        mode.conversion_upload.sample_count,
        mode.compose.sample_count,
        mode.map_wait.sample_count,
        mode.readback.sample_count,
        mode.ipc_wait.sample_count,
        mode.present.sample_count,
    ]
    .into_iter()
    .max()
    .unwrap_or(0);

    Some(NativePreviewStageDiagnosis {
        mode: mode.mode,
        sample_count,
        dominant_stage: dominant_stage.to_string(),
        dominant_p95_us,
        recommended_next_step: if sample_count < 30 {
            "collect-more-samples".to_string()
        } else {
            recommendation.to_string()
        },
    })
}


/// Return a single JSON-ready snapshot suitable for a user to copy into a
/// benchmark issue. It deliberately contains only local runtime metadata and
/// aggregate performance counters; source paths, project contents, and media
/// names are not included.
#[tauri::command]
pub async fn get_native_preview_performance_report(
    app: tauri::AppHandle,
) -> Result<NativePreviewPerformanceReport, String> {
    use crate::wgpu_compositor::SessionTelemetryCollector;

    let gpu = app
        .try_state::<Arc<std::sync::Mutex<NativeGpuRuntimeStatus>>>()
        .and_then(|state| state.lock().ok().map(|status| status.clone()));

    let audio = app
        .try_state::<Arc<std::sync::Mutex<crate::native_audio::NativeAudioClock>>>()
        .and_then(|clock| clock.lock().ok().map(|c| c.status()));

    let preview = if let Some(service) = app.try_state::<tokio::sync::Mutex<NativeFrameService>>() {
        Some(service.lock().await.stats())
    } else {
        None
    };
    let stage_diagnoses = preview
        .as_ref()
        .map(|stats| {
            stats
                .mode_stats
                .iter()
                .filter_map(diagnose_mode_stats)
                .collect()
        })
        .unwrap_or_default();

    let session = app
        .try_state::<Arc<SessionTelemetryCollector>>()
        .map(|state| state.snapshot())
        .unwrap_or_else(|| SessionTelemetryCollector::new().snapshot());

    Ok(NativePreviewPerformanceReport {
        report_version: 2,
        captured_at_ms: crate::native_core::performance::now_ms(),
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
        operating_system: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        git_commit: option_env!("CLYPRA_GIT_COMMIT").map(String::from),
        git_dirty: option_env!("CLYPRA_GIT_DIRTY").map(|s| s == "true"),
        gpu,
        audio,
        preview,
        session,
        stage_diagnoses,
        push_bridge: app
            .try_state::<Arc<NativePlaybackPushRuntime>>()
            .map(|state| state.status()),
        playback_cache_insert_skipped: skip_playback_cache_insert_enabled(),
        cold_start: crate::cold_start::get_report(),
    })
}

