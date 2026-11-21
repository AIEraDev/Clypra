use std::path::Path;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

/// Atomically write a slice of bytes to disk using a temporary sibling file and rename.
/// Guarantees that readers never observe partially written, truncated, or locked files.
pub async fn atomic_write_file(dest_path: &Path, bytes: &[u8]) -> Result<u64, String> {
    let parent = dest_path.parent().ok_or_else(|| {
        format!("Destination path has no parent directory: {:?}", dest_path)
    })?;

    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| format!("Failed to create parent directory {:?}: {}", parent, e))?;

    let file_stem = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("cache_file");
    let temp_name = format!("{}.tmp.{}", file_stem, Uuid::new_v4());
    let temp_path = parent.join(temp_name);

    // Write contents to temporary file
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file {:?}: {}", temp_path, e))?;

    if let Err(e) = file.write_all(bytes).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Failed to write data to temp file: {}", e));
    }

    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Failed to flush temp file: {}", e));
    }

    if let Err(e) = file.sync_all().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Failed to sync temp file to disk: {}", e));
    }

    drop(file);

    // Atomically rename temporary file to destination path
    if let Err(e) = tokio::fs::rename(&temp_path, dest_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!(
            "Failed to rename temp file {:?} to {:?}: {}",
            temp_path, dest_path, e
        ));
    }

    Ok(bytes.len() as u64)
}

/// Verify that an existing cache file is non-empty and accessible.
/// If 0 bytes or corrupted, automatically deletes (quarantines) the file.
pub async fn validate_or_quarantine(path: &Path, min_bytes: u64) -> Result<u64, String> {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => return Err(format!("Cannot read metadata for {:?}: {}", path, e)),
    };

    let len = meta.len();
    if len < min_bytes {
        log::warn!(
            "[validate_or_quarantine] Quarantining file {:?} (size {} < min {})",
            path,
            len,
            min_bytes
        );
        let _ = tokio::fs::remove_file(path).await;
        return Err(format!(
            "File {:?} truncated (size {} < {} bytes), quarantined",
            path, len, min_bytes
        ));
    }

    Ok(len)
}

/// Safely remove a file and return the number of bytes freed.
pub async fn safe_delete_file(path: &Path) -> Result<u64, String> {
    let size = tokio::fs::metadata(path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    tokio::fs::remove_file(path)
        .await
        .map_err(|e| format!("Failed to delete {:?}: {}", path, e))?;
    Ok(size)
}
