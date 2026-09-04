use serde::{Deserialize, Serialize};
use std::backtrace::Backtrace;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;

static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Structured native crash report envelope written to disk upon panic.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeCrashReport {
    pub id: String,
    pub timestamp_iso: String,
    pub timestamp_epoch_ms: u64,
    pub panic_message: String,
    pub panic_location: String,
    pub thread_name: String,
    pub backtrace: String,
    pub os: String,
    pub arch: String,
    pub reported: bool,
}

/// Resolve the crash reports directory inside the app data directory.
pub fn get_crash_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("crash_reports")
}

/// Install the global panic hook to capture native crashes and write them to disk.
pub fn install_panic_hook(app_data_dir: PathBuf) {
    let crash_dir = get_crash_dir(&app_data_dir);
    if let Err(e) = fs::create_dir_all(&crash_dir) {
        eprintln!("[crash_handler] Failed to create crash directory: {e}");
    }
    let _ = CRASH_DIR.set(crash_dir);

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let timestamp_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let timestamp_iso = chrono_lite_iso(timestamp_epoch_ms);

        let panic_message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic payload".to_string()
        };

        let panic_location = if let Some(loc) = panic_info.location() {
            format!("{}:{}:{}", loc.file(), loc.line(), loc.column())
        } else {
            "unknown location".to_string()
        };

        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("unnamed").to_string();
        let backtrace = format!("{:#?}", Backtrace::capture());

        let report = NativeCrashReport {
            id: Uuid::new_v4().to_string(),
            timestamp_iso,
            timestamp_epoch_ms,
            panic_message,
            panic_location,
            thread_name,
            backtrace,
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            reported: false,
        };

        // Write report directly to disk synchronously before the process terminates
        if let Some(dir) = CRASH_DIR.get() {
            let file_name = format!("crash-{}-{}.json", timestamp_epoch_ms, report.id);
            let target_path = dir.join(file_name);
            if let Ok(json) = serde_json::to_string_pretty(&report) {
                let _ = fs::write(target_path, json);
            }
        }

        // Forward to previous hook so stderr / debug output still functions
        default_hook(panic_info);
    }));
}

/// Fallback simple ISO-8601 formatter without heavy external chrono dependencies.
fn chrono_lite_iso(epoch_ms: u64) -> String {
    let secs = epoch_ms / 1000;
    let millis = epoch_ms % 1000;
    format!("timestamp_ms_{secs}.{millis:03}")
}

/// Retrieve all unreported crash reports from disk.
pub fn read_unreported_crashes(app_data_dir: &Path) -> Vec<NativeCrashReport> {
    let crash_dir = get_crash_dir(app_data_dir);
    if !crash_dir.exists() {
        return Vec::new();
    }

    let mut reports = Vec::new();
    if let Ok(entries) = fs::read_dir(crash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(report) = serde_json::from_str::<NativeCrashReport>(&content) {
                        if !report.reported {
                            reports.push(report);
                        }
                    }
                }
            }
        }
    }

    reports.sort_by_key(|r| r.timestamp_epoch_ms);
    reports
}

/// Mark a crash report as reported on disk so it is not resent.
pub fn mark_crash_as_reported(app_data_dir: &Path, crash_id: &str) -> Result<(), String> {
    let crash_dir = get_crash_dir(app_data_dir);
    if !crash_dir.exists() {
        return Ok(());
    }

    if let Ok(entries) = fs::read_dir(&crash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(mut report) = serde_json::from_str::<NativeCrashReport>(&content) {
                        if report.id == crash_id {
                            report.reported = true;
                            if let Ok(updated) = serde_json::to_string_pretty(&report) {
                                let _ = fs::write(&path, updated);
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Delete crash report files older than `max_age_days`.
pub fn purge_old_crashes(app_data_dir: &Path, max_age_days: u32) -> Result<usize, String> {
    let crash_dir = get_crash_dir(app_data_dir);
    if !crash_dir.exists() {
        return Ok(0);
    }

    let now_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let max_age_ms = (max_age_days as u64) * 24 * 60 * 60 * 1000;
    let mut deleted_count = 0;

    if let Ok(entries) = fs::read_dir(&crash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(report) = serde_json::from_str::<NativeCrashReport>(&content) {
                        if now_epoch_ms.saturating_sub(report.timestamp_epoch_ms) > max_age_ms {
                            if fs::remove_file(&path).is_ok() {
                                deleted_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(deleted_count)
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_unreported_crashes(app: tauri::AppHandle) -> Result<Vec<NativeCrashReport>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(read_unreported_crashes(&app_data_dir))
}

#[tauri::command]
pub fn mark_crash_reported(app: tauri::AppHandle, crash_id: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    mark_crash_as_reported(&app_data_dir, &crash_id)
}

#[tauri::command]
pub fn purge_crash_reports(
    app: tauri::AppHandle,
    max_age_days: Option<u32>,
) -> Result<usize, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    purge_old_crashes(&app_data_dir, max_age_days.unwrap_or(14))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crash_report_serialization_roundtrip() {
        let report = NativeCrashReport {
            id: "test-crash-id-123".to_string(),
            timestamp_iso: "2026-08-30T00:00:00Z".to_string(),
            timestamp_epoch_ms: 1788048000000,
            panic_message: "assertion failed: sample_rate > 0".to_string(),
            panic_location: "src/audio/mixer.rs:42:5".to_string(),
            thread_name: "audio-render-worker".to_string(),
            backtrace: "stack backtrace:\n   0: std::panicking::begin_panic\n".to_string(),
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
            reported: false,
        };

        let json = serde_json::to_string_pretty(&report).expect("must serialize");
        let deserialized: NativeCrashReport =
            serde_json::from_str(&json).expect("must deserialize");

        assert_eq!(report, deserialized);
        assert!(!deserialized.reported);
    }

    #[test]
    fn test_crash_report_lifecycle_in_temp_dir() {
        let temp_dir = std::env::temp_dir().join(format!("clypra_crash_test_{}", Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let report = NativeCrashReport {
            id: "test-uuid".to_string(),
            timestamp_iso: "2026-08-30T00:00:00Z".to_string(),
            timestamp_epoch_ms: 1000,
            panic_message: "Test panic".to_string(),
            panic_location: "main.rs:1:1".to_string(),
            thread_name: "main".to_string(),
            backtrace: "none".to_string(),
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
            reported: false,
        };

        let crash_dir = get_crash_dir(&temp_dir);
        let _ = fs::create_dir_all(&crash_dir);
        let file_path = crash_dir.join("crash-1000-test-uuid.json");
        fs::write(&file_path, serde_json::to_string(&report).unwrap()).unwrap();

        // Check read
        let unread = read_unreported_crashes(&temp_dir);
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].id, "test-uuid");

        // Mark reported
        mark_crash_as_reported(&temp_dir, "test-uuid").unwrap();
        let unread_after = read_unreported_crashes(&temp_dir);
        assert_eq!(unread_after.len(), 0);

        // Purge old crashes
        let deleted = purge_old_crashes(&temp_dir, 0).unwrap();
        assert_eq!(deleted, 1);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
