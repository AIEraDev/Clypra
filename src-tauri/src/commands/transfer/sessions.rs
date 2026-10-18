use crate::transfer::{SessionState, TransferSession};
use tauri::AppHandle;

use super::helpers::{get_service, local_ip};

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

    if let Some((_, tx)) = service.consent_senders.remove(&session_id) {
        let _ = tx.send(false);
    }

    if let Some(mut s) = service.sessions.get_mut(&session_id) {
        s.state = SessionState::Cancelled;
    }

    Ok(())
}

/// Returns all known transfer sessions.
#[tauri::command]
pub async fn get_transfer_sessions(app: AppHandle) -> Result<Vec<TransferSession>, String> {
    let service = get_service(&app)?;
    Ok(service.sessions.iter().map(|e| e.value().clone()).collect())
}

/// Returns `"http://{localIp}:{port}"` — useful for manual display and copy.
#[tauri::command]
pub async fn get_transfer_server_url(app: AppHandle) -> Result<String, String> {
    let service = get_service(&app)?;
    let ip = local_ip();
    let port = service.get_bound_port();
    Ok(format!("http://{}:{}", ip, port))
}
