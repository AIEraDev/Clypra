use crate::sync_metrics::{SyncMetricsSnapshot, SYNC_METRICS};

/// Retrieve the current cumulative native A/V synchronization metrics.
#[tauri::command]
pub fn get_sync_metrics_snapshot() -> Result<SyncMetricsSnapshot, String> {
    Ok(SYNC_METRICS.snapshot())
}
