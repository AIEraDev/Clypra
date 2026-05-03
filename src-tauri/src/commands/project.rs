use crate::models::Project;
use tauri::Manager;
use std::fs;
use std::path::PathBuf;

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
    
    let project: Project = serde_json::from_str(&project_data)
        .map_err(|e| format!("Invalid project JSON: {}", e))?;
    
    let file_path = projects_dir.join(format!("{}.json", project.id));
    
    fs::write(&file_path, &project_data)
        .map_err(|e| format!("Failed to save project: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to load project: {}", e))
}

#[tauri::command]
pub fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let projects_dir = get_projects_dir(&app)?;
    
    let mut projects: Vec<(u64, String)> = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            if let Ok(path) = entry.path().canonicalize() {
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(metadata) = fs::metadata(&path) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(modified) = metadata.modified() {
                                if let Ok(duration) = modified.elapsed() {
                                    let timestamp = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as u64 - duration.as_millis() as u64;
                                    projects.push((timestamp, content));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    projects.sort_by(|a, b| b.0.cmp(&a.0));
    
    Ok(projects.into_iter().take(6).map(|(_, content)| content).collect())
}

#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let projects_dir = get_projects_dir(&app)?;
    let file_path = projects_dir.join(format!("{}.json", project_id));
    
    if !file_path.exists() {
        return Err(format!("Project file not found: {}", project_id));
    }
    
    fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete project: {}", e))?;
    
    Ok(())
}
