
/// Opens a specific file with the system default application (e.g. Preview for images, player for videos).
#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    let normalized = crate::commands::media::normalize_file_path(&path);
    let safe_path = crate::commands::security::sanitize_and_validate_path(&normalized)?;
    if !safe_path.exists() {
        return Err(format!("File does not exist: {}", safe_path.display()));
    }
    let path_str = safe_path.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        let _ = crate::process_util::hidden_command("open")
            .arg(path_str.as_ref())
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = crate::process_util::hidden_command("explorer")
            .arg(path_str.as_ref())
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = crate::process_util::hidden_command("xdg-open")
            .arg(path_str.as_ref())
            .spawn();
    }
    Ok(())
}

/// Reveals a file in the system file manager (Finder on macOS, File Explorer on Windows).
#[tauri::command]
pub async fn show_item_in_folder(path: String) -> Result<(), String> {
    let normalized = crate::commands::media::normalize_file_path(&path);
    let safe_path = crate::commands::security::sanitize_and_validate_path(&normalized)?;
    if !safe_path.exists() {
        return Err(format!("File does not exist: {}", safe_path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        let path_str = safe_path.to_string_lossy();
        let _ = crate::process_util::hidden_command("open")
            .args(["-R", path_str.as_ref()])
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let path_str = safe_path.to_string_lossy();
        let _ = crate::process_util::hidden_command("explorer")
            .args(["/select,", path_str.as_ref()])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = safe_path.parent() {
            let _ = crate::process_util::hidden_command("xdg-open")
                .arg(parent)
                .spawn();
        }
    }
    Ok(())
}
