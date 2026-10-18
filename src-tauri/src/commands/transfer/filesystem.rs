
/// Opens a specific file with the system default application (e.g. Preview for images, player for videos).
#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    let path = crate::commands::media::normalize_file_path(&path);
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = crate::process_util::hidden_command("open").arg(&path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = crate::process_util::hidden_command("cmd")
            .args(["/C", "start", "", &path])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = crate::process_util::hidden_command("xdg-open").arg(&path).spawn();
    }
    Ok(())
}

/// Reveals a file in the system file manager (Finder on macOS, File Explorer on Windows).
#[tauri::command]
pub async fn show_item_in_folder(path: String) -> Result<(), String> {
    let path = crate::commands::media::normalize_file_path(&path);
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = crate::process_util::hidden_command("open")
            .args(["-R", &path])
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = crate::process_util::hidden_command("explorer")
            .arg(format!("/select,\"{}\"", path))
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = p.parent() {
            let _ = crate::process_util::hidden_command("xdg-open").arg(parent).spawn();
        }
    }
    Ok(())
}
