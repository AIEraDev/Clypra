pub mod crash_handler;
pub mod perf_log;

pub use crash_handler::NativeCrashReport;
pub use perf_log::{
    append_perf_log_entries, close_perf_log_session, delete_pending_perf_logs, list_perf_log_files,
    mark_perf_log_uploaded, open_perf_log_session, purge_perf_logs, read_perf_log_file,
    upload_pending_perf_logs, upload_perf_log_session,
};

use serde::Serialize;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const EVENT_NAME: &str = "clypra://native-diagnostic";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDiagnostic {
    pub level: &'static str,
    pub source: &'static str,
    pub code: &'static str,
    pub message: String,
    pub timestamp_epoch_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn app_handle() -> Option<&'static AppHandle> {
    APP_HANDLE.get()
}

pub fn initialize(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        crash_handler::install_panic_hook(app_data_dir);
    }
}

pub fn report(
    level: &'static str,
    source: &'static str,
    code: &'static str,
    message: impl Into<String>,
) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };

    let timestamp_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let diagnostic = NativeDiagnostic {
        level,
        source,
        code,
        message: message.into(),
        timestamp_epoch_ms,
        incident_kind: None,
        stream_key: None,
        request_id: None,
    };

    // Error delivery is event-driven and non-blocking from the caller's
    // perspective. Never write diagnostics to stderr from a render/audio path.
    let _ = app.emit(EVENT_NAME, diagnostic);
}

/// Emits a structured decoder incident without putting raw media paths or
/// codec-context addresses into the session log. The optional identifiers are
/// already sanitized by the decoder boundary and let offline analysis join a
/// codec error to the stream/request that was active when it occurred.
pub fn report_decode_incident(
    kind: &'static str,
    message: impl Into<String>,
    stream_key: Option<String>,
    request_id: Option<String>,
) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };

    let timestamp_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let diagnostic = NativeDiagnostic {
        level: "error",
        source: "ffmpeg-decoder",
        code: "decode-reference-error",
        message: message.into(),
        timestamp_epoch_ms,
        incident_kind: Some(kind),
        stream_key,
        request_id,
    };

    let _ = app.emit(EVENT_NAME, diagnostic);
}

pub fn error(source: &'static str, code: &'static str, message: impl Into<String>) {
    report("error", source, code, message);
}

pub fn warning(source: &'static str, code: &'static str, message: impl Into<String>) {
    report("warning", source, code, message);
}

pub use warning as warn;

pub fn info(source: &'static str, code: &'static str, message: impl Into<String>) {
    report("info", source, code, message);
}
