use std::collections::HashMap;
use tauri::AppHandle;

use super::helpers::{get_default_transfer_dir, get_service};

/// Starts the transfer service if it is not already running.
#[tauri::command]
pub async fn start_transfer_service(
    app: AppHandle,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let service = get_service(&app)?;
    let inbox_dir = match custom_dir {
        Some(d) if !d.trim().is_empty() => {
            let p = std::path::PathBuf::from(d);
            let _ = std::fs::create_dir_all(&p);
            p
        }
        _ => {
            let current = service.get_inbox_dir();
            if !current.as_os_str().is_empty() {
                current
            } else {
                let def = get_default_transfer_dir(&app);
                let _ = std::fs::create_dir_all(&def);
                def
            }
        }
    };

    if service.is_running() {
        service.set_inbox_dir(inbox_dir);
        return Ok(());
    }

    service.start(app.clone(), inbox_dir).await
}

/// Stops the transfer service.
#[tauri::command]
pub async fn stop_transfer_service(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    service
        .server_running
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Updates the transfer service theme colors for the mobile web page.
#[tauri::command]
pub async fn update_transfer_theme(
    app: AppHandle,
    theme: HashMap<String, String>,
) -> Result<(), String> {
    let service = get_service(&app)?;
    service.set_theme_colors(theme);
    Ok(())
}
