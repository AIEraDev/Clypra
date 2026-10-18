use tauri::AppHandle;

use super::helpers::{get_default_transfer_dir, get_service};

/// Returns the current active directory where incoming files are saved.
#[tauri::command]
pub async fn get_transfer_save_directory(app: AppHandle) -> Result<String, String> {
    let service = get_service(&app)?;
    let dir = service.get_inbox_dir();
    if dir.as_os_str().is_empty() {
        let def = get_default_transfer_dir(&app);
        let _ = std::fs::create_dir_all(&def);
        service.set_inbox_dir(def.clone());
        Ok(def.to_string_lossy().to_string())
    } else {
        Ok(dir.to_string_lossy().to_string())
    }
}

/// Sets the directory where incoming files should be saved.
#[tauri::command]
pub async fn set_transfer_save_directory(app: AppHandle, path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| format!("Cannot create folder {:?}: {e}", p))?;
    let service = get_service(&app)?;
    service.set_inbox_dir(p.clone());
    Ok(p.to_string_lossy().to_string())
}

/// Opens the transfer save directory in the system file manager (Finder / Explorer).
#[tauri::command]
pub async fn open_transfer_save_directory(app: AppHandle) -> Result<(), String> {
    let service = get_service(&app)?;
    let dir = service.get_inbox_dir();
    let target_dir = if dir.as_os_str().is_empty() {
        get_default_transfer_dir(&app)
    } else {
        dir
    };
    let _ = std::fs::create_dir_all(&target_dir);

    #[cfg(target_os = "macos")]
    {
        let _ = crate::process_util::hidden_command("open").arg(&target_dir).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = crate::process_util::hidden_command("explorer")
            .arg(&target_dir)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = crate::process_util::hidden_command("xdg-open")
            .arg(&target_dir)
            .spawn();
    }
    Ok(())
}
