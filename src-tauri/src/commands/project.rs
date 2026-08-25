use crate::models::Project;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveVerification {
    pub primary_readback: bool,
    pub backup_rotated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveResult {
    pub project_id: String,
    pub bytes_written: u64,
    pub modified_at: u64,
    pub verified: bool,
    pub verification: ProjectSaveVerification,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectEntry {
    pub kind: String,
    pub id: String,
    pub name: Option<String>,
    pub path: String,
    pub backup_path: String,
    pub backup_available: bool,
    pub modified_at: Option<u64>,
    pub project: Option<Project>,
    pub error: Option<String>,
}

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

fn flush_file(path: &Path, payload: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Failed to open temporary project file: {}", e))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("Failed to write temporary project file: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to flush temporary project file: {}", e))
}

fn backup_current_primary(primary: &Path, backup: &Path) -> Result<bool, String> {
    if !primary.exists() {
        return Ok(false);
    }
    let current = fs::read_to_string(primary)
        .map_err(|e| format!("Failed to read current project before backup: {}", e))?;
    let _: Project = serde_json::from_str(&current).map_err(|e| {
        format!(
            "Current project is not valid and cannot be backed up: {}",
            e
        )
    })?;
    let backup_tmp = backup.with_extension("bak.tmp");
    flush_file(&backup_tmp, &current)?;
    #[cfg(windows)]
    if backup.exists() {
        fs::remove_file(backup)
            .map_err(|e| format!("Failed to rotate previous project backup: {}", e))?;
    }
    fs::rename(&backup_tmp, backup)
        .map_err(|e| format!("Failed to rotate verified project backup: {}", e))?;
    Ok(true)
}

fn restore_backup(primary: &Path, backup: &Path) -> Result<(), String> {
    if !backup.exists() {
        return Ok(());
    }
    fs::copy(backup, primary).map_err(|e| {
        format!(
            "Save failed and previous project could not be restored: {}",
            e
        )
    })?;
    Ok(())
}

/// Replace a project file without deleting the last known-good generation.
/// POSIX rename replaces the destination atomically. Windows stages the
/// destination first and uses the verified backup as its rollback point.
fn replace_primary(temp: &Path, primary: &Path, backup: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        if primary.exists() {
            // The verified current primary has already been copied to backup;
            // Windows rename cannot replace an existing destination.
            let _ = fs::remove_file(backup);
            fs::rename(primary, backup)
                .map_err(|e| format!("Failed to stage current project for replacement: {}", e))?;
        }
        if let Err(error) = fs::rename(temp, primary) {
            let _ = restore_backup(primary, backup);
            return Err(format!("Failed to finalize project save: {}", error));
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        fs::rename(temp, primary).map_err(|e| {
            let _ = restore_backup(primary, backup);
            format!("Failed to finalize project save: {}", e)
        })
    }
}

fn modified_timestamp(project: &Project, path: &Path) -> u64 {
    if project.modified_at > 0 {
        return project.modified_at;
    }
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        })
}

#[tauri::command]
pub fn save_project(
    app: tauri::AppHandle,
    project_data: String,
) -> Result<ProjectSaveResult, String> {
    let projects_dir = get_projects_dir(&app)?;
    let project: Project =
        serde_json::from_str(&project_data).map_err(|e| format!("Invalid project JSON: {}", e))?;
    let safe_id = super::security::validate_project_id(&project.id)?;
    let primary = projects_dir.join(format!("{}.json", safe_id));
    let backup = projects_dir.join(format!("{}.json.bak", safe_id));
    let temp = projects_dir.join(format!("{}.json.tmp", safe_id));

    flush_file(&temp, &project_data)?;
    let staged = fs::read_to_string(&temp)
        .map_err(|e| format!("Failed to read back temporary project file: {}", e))?;
    let _: Project = serde_json::from_str(&staged)
        .map_err(|e| format!("Temporary project validation failed: {}", e))?;
    if staged != project_data {
        let _ = fs::remove_file(&temp);
        return Err("Temporary project verification failed: payload differs after write".into());
    }

    let backup_rotated = backup_current_primary(&primary, &backup)?;
    if let Err(error) = replace_primary(&temp, &primary, &backup) {
        let _ = fs::remove_file(&temp);
        let _ = restore_backup(&primary, &backup);
        return Err(error);
    }

    let final_data = match fs::read_to_string(&primary) {
        Ok(data) => data,
        Err(error) => {
            let _ = restore_backup(&primary, &backup);
            return Err(format!(
                "Failed to verify finalized project file: {}",
                error
            ));
        }
    };
    if let Err(error) = serde_json::from_str::<Project>(&final_data) {
        let _ = restore_backup(&primary, &backup);
        return Err(format!("Final project validation failed: {}", error));
    }
    if final_data != project_data {
        let _ = restore_backup(&primary, &backup);
        return Err("Project verification failed: finalized file differs from payload".into());
    }

    let bytes_written = fs::metadata(&primary)
        .map_err(|e| format!("Failed to read finalized project metadata: {}", e))?
        .len();
    Ok(ProjectSaveResult {
        project_id: safe_id,
        bytes_written,
        modified_at: modified_timestamp(&project, &primary),
        verified: true,
        verification: ProjectSaveVerification {
            primary_readback: true,
            backup_rotated,
        },
    })
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    let safe_path = super::security::sanitize_and_validate_path(&path)?;
    fs::read_to_string(&safe_path).map_err(|e| format!("Failed to load project: {}", e))
}

#[tauri::command]
pub fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<RecentProjectEntry>, String> {
    let projects_dir = get_projects_dir(&app)?;
    let mut projects = Vec::new();

    for entry in
        fs::read_dir(&projects_dir).map_err(|e| format!("Failed to read projects: {}", e))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown")
            .to_string();
        let backup = path.with_extension("json.bak");
        let path_string = path.to_string_lossy().to_string();
        let backup_path = backup.to_string_lossy().to_string();
        let backup_available = backup.exists();

        match fs::read_to_string(&path).and_then(|content| {
            serde_json::from_str::<Project>(&content)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        }) {
            Ok(project) => projects.push(RecentProjectEntry {
                kind: "ready".into(),
                id: project.id.clone(),
                name: Some(project.name.clone()),
                modified_at: Some(project.modified_at),
                path: path_string,
                backup_path,
                backup_available,
                project: Some(project),
                error: None,
            }),
            Err(error) => projects.push(RecentProjectEntry {
                kind: "unreadable".into(),
                id,
                name: None,
                path: path_string,
                backup_path,
                backup_available,
                modified_at: None,
                project: None,
                error: Some(error.to_string()),
            }),
        }
    }

    projects.sort_by_key(|entry| std::cmp::Reverse(entry.modified_at.unwrap_or(0)));
    Ok(projects)
}

const MAX_PROJECT_NAME_LENGTH: usize = 64;

#[tauri::command]
pub fn rename_project(
    app: tauri::AppHandle,
    project_id: String,
    new_name: String,
) -> Result<(), String> {
    let safe_id = super::security::validate_project_id(&project_id)?;
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
    let primary = projects_dir.join(format!("{}.json", safe_id));
    let content =
        fs::read_to_string(&primary).map_err(|e| format!("Failed to read project: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&content).map_err(|e| format!("Invalid project JSON: {}", e))?;
    project.name = trimmed.to_string();
    project.modified_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let updated = serde_json::to_string(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    save_project(app, updated).map(|_| ())
}

#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let safe_id = super::security::validate_project_id(&project_id)?;
    let projects_dir = get_projects_dir(&app)?;
    let primary = projects_dir.join(format!("{}.json", safe_id));
    if !primary.exists() {
        return Err(format!("Project file not found: {}", safe_id));
    }
    fs::remove_file(&primary).map_err(|e| format!("Failed to delete project: {}", e))?;
    let _ = fs::remove_file(projects_dir.join(format!("{}.json.bak", safe_id)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("clypra-project-{name}-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn project_save_result_uses_camel_case_contract() {
        let result = ProjectSaveResult {
            project_id: "p".into(),
            bytes_written: 10,
            modified_at: 12,
            verified: true,
            verification: ProjectSaveVerification {
                primary_readback: true,
                backup_rotated: false,
            },
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["projectId"], "p");
        assert_eq!(value["modifiedAt"], 12);
        assert_eq!(value["verification"]["primaryReadback"], true);
    }

    #[test]
    fn backup_rotation_preserves_previous_verified_generation() {
        let dir = test_dir("backup");
        let primary = dir.join("p.json");
        let backup = dir.join("p.json.bak");
        fs::write(
            &primary,
            "{\"id\":\"p\",\"name\":\"old\",\"created_at\":1,\"modified_at\":1}",
        )
        .unwrap();
        assert!(backup_current_primary(&primary, &backup).unwrap());
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            fs::read_to_string(&primary).unwrap()
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replacement_failure_keeps_previous_primary_readable() {
        let dir = test_dir("rollback");
        let primary = dir.join("p.json");
        let backup = dir.join("p.json.bak");
        let missing_temp = dir.join("missing.tmp");
        let old = "{\"id\":\"p\",\"name\":\"old\",\"created_at\":1,\"modified_at\":1}";
        fs::write(&primary, old).unwrap();
        fs::write(&backup, old).unwrap();
        assert!(replace_primary(&missing_temp, &primary, &backup).is_err());
        assert_eq!(fs::read_to_string(&primary).unwrap(), old);
        fs::remove_dir_all(dir).unwrap();
    }
}
