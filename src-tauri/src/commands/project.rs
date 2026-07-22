use crate::models::Project;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use unicode_segmentation::UnicodeSegmentation;

fn get_projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let projects_dir = app_data.join("projects");
    fs::create_dir_all(&projects_dir)
        .map_err(|e| format!("Failed to create projects dir: {}", e))?;

    Ok(projects_dir)
}

#[tauri::command]
pub fn save_project(app: tauri::AppHandle, project_data: String) -> Result<(), String> {
    let projects_dir = get_projects_dir(&app)?;

    let project: Project =
        serde_json::from_str(&project_data).map_err(|e| format!("Invalid project JSON: {}", e))?;

    let file_path = projects_dir.join(format!("{}.json", project.id));

    println!(
        "[save_project] Saving project {} with {} tracks, {} clips, {} media_assets",
        project.id,
        project.tracks.len(),
        project.clips.len(),
        project.media_assets.len()
    );

    // Implement atomic write to prevent data corruption
    // Write to temp file first, then atomically rename to target path
    // This ensures project file is never left in a corrupt state if write fails
    let temp_path = projects_dir.join(format!("{}.tmp", project.id));

    // Write to temporary file
    fs::write(&temp_path, &project_data)
        .map_err(|e| format!("Failed to write temporary project file: {}", e))?;

    // Atomically rename temp file to final path
    // On POSIX and Windows, rename is atomic - either succeeds completely or fails with no side effects
    fs::rename(&temp_path, &file_path).map_err(|e| {
        // Clean up temp file on failure
        let _ = fs::remove_file(&temp_path);
        format!("Failed to finalize project save: {}", e)
    })?;

    Ok(())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to load project: {}", e))
}

#[tauri::command]
pub fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let projects_dir = get_projects_dir(&app)?;

    let mut projects: Vec<(u64, String)> = Vec::new();

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            if let Ok(path) = entry.path().canonicalize() {
                if path.extension().is_some_and(|ext| ext == "json") {
                    if let Ok(metadata) = fs::metadata(&path) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(modified) = metadata.modified() {
                                if let Ok(duration) = modified.elapsed() {
                                    let timestamp = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64
                                        - duration.as_millis() as u64;
                                    projects.push((timestamp, content));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    projects.sort_by_key(|b| std::cmp::Reverse(b.0));

    Ok(projects.into_iter().map(|(_, content)| content).collect())
}

const MAX_PROJECT_NAME_LENGTH: usize = 64;

// CRITICAL: Must stay in sync with src/types/index.ts MAX_PROJECT_NAME_LENGTH
#[tauri::command]
pub fn rename_project(
    app: tauri::AppHandle,
    project_id: String,
    new_name: String,
) -> Result<(), String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if trimmed.graphemes(true).count() > MAX_PROJECT_NAME_LENGTH {
        return Err(format!(
            "Project name exceeds {} characters",
            MAX_PROJECT_NAME_LENGTH
        ));
    }
    let projects_dir = get_projects_dir(&app)?;
    let file_path = projects_dir.join(format!("{}.json", project_id));

    if !file_path.exists() {
        return Err(format!("Project file not found: {}", project_id));
    }

    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid project JSON: {}", e))?;

    project["name"] = serde_json::Value::String(trimmed.to_string());

    let updated = serde_json::to_string(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    fs::write(&file_path, updated).map_err(|e| format!("Failed to save project: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let projects_dir = get_projects_dir(&app)?;
    let file_path = projects_dir.join(format!("{}.json", project_id));

    if !file_path.exists() {
        return Err(format!("Project file not found: {}", project_id));
    }

    fs::remove_file(&file_path).map_err(|e| format!("Failed to delete project: {}", e))?;

    Ok(())
}
