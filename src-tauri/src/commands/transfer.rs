use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::transfer::{DiscoveredDevice, TransferService, TransferSession};

// ── Helper ────────────────────────────────────────────────────────────────────

fn get_service(app: &AppHandle) -> Result<Arc<TransferService>, String> {
    app.try_state::<Arc<TransferService>>()
        .ok_or_else(|| "Transfer service not initialized".to_string())
        .map(|s| s.inner().clone())
}

fn local_ip() -> String {
    crate::transfer::server::local_ip()
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns `{ running, port, localIp }`.
#[tauri::command]
pub async fn get_transfer_service_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let service = get_service(&app)?;
    Ok(serde_json::json!({
        "running":  service.is_running(),
        "port":     service.get_bound_port(),
        "localIp":  local_ip(),
    }))
}

/// Returns the list of devices discovered via UDP multicast.
#[tauri::command]
pub async fn get_discovered_devices(app: AppHandle) -> Result<Vec<DiscoveredDevice>, String> {
    let service = get_service(&app)?;
    Ok(service.discovered_devices.iter().map(|e| e.value().clone()).collect())
}

/// Accepts a pending transfer session (resolves the user-consent oneshot).
#[tauri::command]
pub async fn accept_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;
    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(true);
        Ok(())
    } else {
        Err(format!("No pending consent for session {session_id}"))
    }
}

/// Rejects a pending transfer session.
#[tauri::command]
pub async fn reject_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;
    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(false);
        Ok(())
    } else {
        Err(format!("No pending consent for session {session_id}"))
    }
}

/// Marks a session as cancelled and cleans up tokens.
#[tauri::command]
pub async fn cancel_transfer_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let service = get_service(&app)?;

    // Resolve consent with rejection if still pending
    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(false);
    }

    if let Some(mut s) = service.sessions.get_mut(&session_id) {
        s.state = crate::transfer::SessionState::Cancelled;
    }

    Ok(())
}

/// Returns all known transfer sessions.
#[tauri::command]
pub async fn get_transfer_sessions(app: AppHandle) -> Result<Vec<TransferSession>, String> {
    let service = get_service(&app)?;
    Ok(service.sessions.iter().map(|e| e.value().clone()).collect())
}

/// Returns `"http://{localIp}:{port}"` — useful for QR code generation on the frontend.
#[tauri::command]
pub async fn get_transfer_server_url(app: AppHandle) -> Result<String, String> {
    let service = get_service(&app)?;
    let ip = local_ip();
    let port = service.get_bound_port();
    Ok(format!("http://{}:{}", ip, port))
}

/// Starts the transfer service if it is not already running.
#[tauri::command]
pub async fn start_transfer_service(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    if service.is_running() {
        return Ok(());
    }
    let inbox_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("transfer_inbox");
    let _ = std::fs::create_dir_all(&inbox_dir);
    service.start(app.clone(), inbox_dir).await
}

/// Signals the transfer service to stop.  Because axum does not expose a
/// graceful-shutdown handle in this simple form, we flip the flag so that
/// the UDP loops exit on their next iteration.
#[tauri::command]
pub async fn stop_transfer_service(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    service
        .server_running
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
