pub mod crash_handler;

pub use crash_handler::NativeCrashReport;

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
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

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
    };

    // Error delivery is event-driven and non-blocking from the caller's
    // perspective. Never write diagnostics to stderr from a render/audio path.
    let _ = app.emit(EVENT_NAME, diagnostic);
}

pub fn error(source: &'static str, code: &'static str, message: impl Into<String>) {
    report("error", source, code, message);
}

pub fn warning(source: &'static str, code: &'static str, message: impl Into<String>) {
    report("warning", source, code, message);
}

pub use warning as warn;

