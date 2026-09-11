//! Session-scoped performance log writer.
//!
//! Each editor session gets one NDJSON file under:
//!   `<app_data_dir>/perf_logs/session-<epoch_ms>-<uuid>.ndjson`
//!
//! The frontend batches rollup snapshots and appends them here instead of
//! streaming hundreds of small API requests per session.  When the session
//! closes the completed file is uploaded as a single payload, keeping the
//! remote row count at one row per session rather than one per rollup window.
//!
//! Design notes:
//! - All disk I/O is guarded by a `tokio::sync::Mutex` so concurrent
//!   `append_perf_log_entries` calls stay serialised without blocking the
//!   Tauri command thread pool.
//! - The writer is intentionally append-only.  Every entry is a full JSON
//!   object on its own line (NDJSON), so a crash mid-write never corrupts
//!   previously written entries.
//! - Session state lives in a `DashMap<String, PerfLogSession>` keyed by the
//!   session ID supplied by the frontend, mirroring the pattern used by the
//!   native frame cache.

use dashmap::DashMap;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

// ── Constants ──────────────────────────────────────────────────────────────

const PERF_LOG_DIR: &str = "perf_logs";
const DEFAULT_MAX_AGE_DAYS: u32 = 7;

// ── Types ──────────────────────────────────────────────────────────────────

/// One line in an NDJSON perf-log file.
///
/// The `payload` field carries whatever JSON the frontend passes through —
/// a `TelemetryEvent` rollup, a `SyncMetricsSnapshot`, a `NativeDiagnostic`,
/// or a playback-trace event — without forcing the Rust layer to know about
/// every variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfLogEntry {
    /// Discriminator so log consumers can route each line correctly.
    pub kind: String,
    /// Matches the Tauri session ID from `telemetryCollector`.
    pub session_id: String,
    /// Unix epoch in milliseconds, set by the frontend at collection time.
    pub timestamp_epoch_ms: u64,
    /// Raw JSON payload — the caller is responsible for its schema.
    pub payload: serde_json::Value,
}

/// Metadata returned to the frontend for the active session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfLogSessionInfo {
    pub session_id: String,
    pub file_path: String,
    pub opened_at_epoch_ms: u64,
}

/// Metadata for a completed log file visible to `list_perf_log_files`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfLogFileInfo {
    pub file_name: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at_epoch_ms: u64,
}

// ── Internal session state ─────────────────────────────────────────────────

struct PerfLogSession {
    file_path: PathBuf,
    file: Arc<AsyncMutex<File>>,
    opened_at_epoch_ms: u64,
}

// ── Global session registry ────────────────────────────────────────────────

static SESSIONS: Lazy<DashMap<String, PerfLogSession>> = Lazy::new(DashMap::new);

// ── Helpers ────────────────────────────────────────────────────────────────

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn get_perf_log_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PERF_LOG_DIR)
}

// ── Tauri Commands ─────────────────────────────────────────────────────────

/// Opens (or re-opens) a perf-log file for `session_id`.
/// Safe to call multiple times — returns the existing session if already open.
#[tauri::command]
pub async fn open_perf_log_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<PerfLogSessionInfo, String> {
    // Re-use existing session when the frontend hot-reloads.
    if let Some(session) = SESSIONS.get(&session_id) {
        return Ok(PerfLogSessionInfo {
            session_id: session_id.clone(),
            file_path: session.file_path.to_string_lossy().to_string(),
            opened_at_epoch_ms: session.opened_at_epoch_ms,
        });
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let log_dir = get_perf_log_dir(&app_data_dir);
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create perf_logs dir: {e}"))?;

    let epoch = now_epoch_ms();
    // Use a short UUID suffix to avoid collisions when the app is restarted
    // within the same millisecond (unlikely but defensive).
    let file_name = format!(
        "session-{}-{}.ndjson",
        epoch,
        Uuid::new_v4().to_string().split('-').next().unwrap_or("xxxx")
    );
    let file_path = log_dir.join(&file_name);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| format!("Failed to open perf log file '{file_name}': {e}"))?;

    SESSIONS.insert(
        session_id.clone(),
        PerfLogSession {
            file_path: file_path.clone(),
            file: Arc::new(AsyncMutex::new(file)),
            opened_at_epoch_ms: epoch,
        },
    );

    Ok(PerfLogSessionInfo {
        session_id,
        file_path: file_path.to_string_lossy().to_string(),
        opened_at_epoch_ms: epoch,
    })
}

/// Appends a batch of performance entries to the session's NDJSON log file.
/// Each entry is serialised as a single line — safe against partial writes.
#[tauri::command]
pub async fn append_perf_log_entries(
    session_id: String,
    entries: Vec<PerfLogEntry>,
) -> Result<usize, String> {
    if entries.is_empty() {
        return Ok(0);
    }

    let session = SESSIONS
        .get(&session_id)
        .ok_or_else(|| format!("No open perf-log session for id '{session_id}'"))?;

    // Build the full NDJSON block before acquiring the lock to minimise hold time.
    let mut block = String::with_capacity(entries.len() * 256);
    for entry in &entries {
        let line = serde_json::to_string(entry)
            .map_err(|e| format!("Failed to serialise PerfLogEntry: {e}"))?;
        block.push_str(&line);
        block.push('\n');
    }

    let count = entries.len();
    let mut file = session.file.lock().await;
    file.write_all(block.as_bytes())
        .map_err(|e| format!("Failed to write perf log entries: {e}"))?;
    // Flush to the OS page cache; fsync is intentionally skipped to avoid
    // stalling the audio/render thread that triggered this command.
    file.flush()
        .map_err(|e| format!("Failed to flush perf log: {e}"))?;

    Ok(count)
}

/// Closes the session's log file and removes it from the active registry.
/// Returns the path of the completed file so the frontend can trigger upload.
#[tauri::command]
pub async fn close_perf_log_session(session_id: String) -> Result<String, String> {
    let (_, session) = SESSIONS
        .remove(&session_id)
        .ok_or_else(|| format!("No open perf-log session for id '{session_id}'"))?;

    // Drop the Arc<Mutex<File>> — the file is flushed and closed automatically
    // when the last strong reference is released.
    let path = session.file_path.to_string_lossy().to_string();
    // Explicitly flush before the drop.
    {
        let mut file = session.file.lock().await;
        let _ = file.flush();
    }
    drop(session.file);

    Ok(path)
}

/// Uploads a completed NDJSON session log file as a single POST request.
///
/// The file is read entirely into memory, parsed into a JSON array (one
/// element per NDJSON line), and sent as `application/json`.  This replaces
/// the previous pattern of hundreds of individual telemetry batches, keeping
/// the remote DB at one row per session.
#[tauri::command]
pub async fn upload_perf_log_session(
    file_path: String,
    api_base_url: String,
    api_key: String,
) -> Result<(), String> {
    // Read and parse the NDJSON file.
    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read perf log '{file_path}': {e}"))?;

    let entries: Vec<serde_json::Value> = raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line)
                .unwrap_or(serde_json::Value::Null)
        })
        .filter(|v| !v.is_null())
        .collect();

    if entries.is_empty() {
        // Nothing to upload — not an error.
        return Ok(());
    }

    let url = format!("{}/performance/telemetry/ingest/session", api_base_url.trim_end_matches('/'));

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "entryCount": entries.len(),
        "entries": entries,
    });

    let mut request = client.post(&url).json(&body);

    if !api_key.is_empty() {
        request = request
            .header("X-API-Key", &api_key)
            .header("X-Clypra-Client", "clypra-desktop-v1");
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Upload rejected — HTTP {status}: {body}"));
    }

    // Mark as uploaded by renaming extension so next launch doesn't re-upload it.
    let uploaded_path = format!("{file_path}.uploaded");
    let _ = fs::rename(&file_path, &uploaded_path);

    Ok(())
}

/// Uploads any pending (un-uploaded) session files from previous runs.
/// This runs on application startup to ensure sessions terminated abruptly or
/// closed without network access are reliably ingested on the next session.
#[tauri::command]
pub async fn upload_pending_perf_logs(
    app: tauri::AppHandle,
    api_base_url: String,
    api_key: String,
) -> Result<usize, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let log_dir = get_perf_log_dir(&app_data_dir);
    if !log_dir.exists() {
        return Ok(0);
    }

    let open_paths: std::collections::HashSet<PathBuf> = SESSIONS
        .iter()
        .map(|s| s.value().file_path.clone())
        .collect();

    let mut pending: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("ndjson")
                && !open_paths.contains(&path)
            {
                pending.push(path.to_string_lossy().to_string());
            }
        }
    }

    let mut uploaded_count = 0usize;
    for file_path in pending {
        if upload_perf_log_session(file_path, api_base_url.clone(), api_key.clone()).await.is_ok() {
            uploaded_count += 1;
        }
    }

    Ok(uploaded_count)
}

/// Returns metadata for all completed perf-log files on disk.
/// Active (currently-open) sessions are included because their files already
/// contain flushed entries.
#[tauri::command]
pub fn list_perf_log_files(app: tauri::AppHandle) -> Result<Vec<PerfLogFileInfo>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let log_dir = get_perf_log_dir(&app_data_dir);
    if !log_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files: Vec<PerfLogFileInfo> = Vec::new();
    for entry in fs::read_dir(&log_dir).map_err(|e| format!("Failed to read perf_logs dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Directory entry error: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("ndjson") {
            continue;
        }
        let meta = fs::metadata(&path).unwrap_or_else(|_| {
            // Fall back to zero metadata on permission errors.
            fs::metadata(&log_dir).expect("log dir must be accessible")
        });
        let size_bytes = meta.len();
        // Best-effort creation time; fall back to parsing epoch from file name.
        let created_at_epoch_ms = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|stem| stem.strip_prefix("session-"))
            .and_then(|rest| rest.split('-').next())
            .and_then(|epoch_str| epoch_str.parse::<u64>().ok())
            .unwrap_or(0);

        files.push(PerfLogFileInfo {
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_path: path.to_string_lossy().to_string(),
            size_bytes,
            created_at_epoch_ms,
        });
    }

    files.sort_by_key(|f| f.created_at_epoch_ms);
    Ok(files)
}

/// Deletes perf-log files older than `max_age_days` (default 7).
/// Skips any session that is currently open.
#[tauri::command]
pub fn purge_perf_logs(
    app: tauri::AppHandle,
    max_age_days: Option<u32>,
) -> Result<usize, String> {
    let max_age = max_age_days.unwrap_or(DEFAULT_MAX_AGE_DAYS);
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let log_dir = get_perf_log_dir(&app_data_dir);
    if !log_dir.exists() {
        return Ok(0);
    }

    let now = now_epoch_ms();
    let max_age_ms = (max_age as u64) * 24 * 60 * 60 * 1000;

    // Build a set of file paths that belong to open sessions so we skip them.
    let open_paths: std::collections::HashSet<PathBuf> = SESSIONS
        .iter()
        .map(|s| s.value().file_path.clone())
        .collect();

    let mut deleted = 0usize;
    for entry in fs::read_dir(&log_dir).map_err(|e| format!("Failed to read perf_logs dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Directory entry error: {e}"))?;
        let path = entry.path();

        let ext = path.extension().and_then(|s| s.to_str());
        if ext != Some("ndjson") && ext != Some("uploaded") {
            continue;
        }
        if open_paths.contains(&path) {
            continue;
        }

        let created_at = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|stem| stem.strip_prefix("session-"))
            .and_then(|rest| rest.split('-').next())
            .and_then(|epoch_str| epoch_str.parse::<u64>().ok())
            .unwrap_or(0);

        if now.saturating_sub(created_at) > max_age_ms && fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}
