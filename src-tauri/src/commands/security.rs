use std::path::{Component, Path, PathBuf};

/// Validates that a project ID contains only safe characters (alphanumeric, hyphens, underscores).
/// Strictly rejects path separators, relative traversal sequences (`..`), null bytes, and control characters.
pub fn validate_project_id(raw_id: &str) -> Result<String, String> {
    let trimmed = raw_id.trim();
    if trimmed.is_empty() {
        return Err("Security Violation: Project ID cannot be empty".into());
    }

    if trimmed.len() > 128 {
        return Err("Security Violation: Project ID exceeds maximum length (128)".into());
    }

    // Check for null bytes or control chars
    if trimmed.chars().any(|c| c.is_control() || c == '\0') {
        return Err("Security Violation: Project ID contains invalid control characters".into());
    }

    // Check for directory separators or parent directory references
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(
            "Security Violation: Project ID contains illegal path traversal characters".into(),
        );
    }

    // Allow alphanumeric characters, hyphens, and underscores (standard UUIDs / slug IDs)
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Security Violation: Project ID contains illegal non-alphanumeric characters".into(),
        );
    }

    Ok(trimmed.to_string())
}

/// Sanitizes and validates a given file path to protect against path traversal attacks.
/// Ensures paths do not contain null bytes, control characters, or relative escapes (`..`).
pub fn sanitize_and_validate_path(raw_path: &str) -> Result<PathBuf, String> {
    // Null byte check
    if raw_path.contains('\0') {
        return Err("Security Violation: Path contains null bytes".into());
    }

    // Control characters check (\n, \r, \t, etc.)
    if raw_path.chars().any(|c| c.is_control()) {
        return Err("Security Violation: Path contains illegal control characters".into());
    }

    // Forbidden protocol schemes check
    let lower = raw_path.to_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || lower.starts_with("vbscript:")
    {
        return Err("Security Violation: Disallowed URI protocol scheme".into());
    }

    // Path normalization check (handle both POSIX / and Windows \ separators cross-platform)
    let normalized = raw_path.replace('\\', "/");
    let path = Path::new(&normalized);
    for component in path.components() {
        if component == Component::ParentDir || component.as_os_str() == ".." {
            return Err("Security Violation: Path traversal '..' detected".into());
        }
    }

    Ok(path.to_path_buf())
}

/// Sanitizes command arguments intended for shell / process spawning (e.g., FFmpeg).
pub fn sanitize_shell_arg(arg: &str) -> Result<String, String> {
    // Prevent command injection characters
    if arg.contains(';')
        || arg.contains('|')
        || arg.contains('&')
        || arg.contains('`')
        || arg.contains('$')
        || arg.contains('<')
        || arg.contains('>')
        || arg.contains('\n')
        || arg.contains('\r')
    {
        return Err(
            "Security Violation: Argument contains potential shell injection tokens".into(),
        );
    }
    Ok(arg.to_string())
}

/// Validates audio volume level (0.0 to 10.0 max safety margin).
pub fn validate_audio_volume(volume: f64) -> Result<f64, String> {
    if volume.is_nan() || volume.is_infinite() {
        return Err("Invalid volume: NaN or Infinity".into());
    }
    if !(0.0..=10.0).contains(&volume) {
        return Err(format!("Volume out of bounds: {}", volume));
    }
    Ok(volume)
}

/// Validates spatial dimensions (width, height, fps).
pub fn validate_export_dimensions(w: u32, h: u32, fps: u32) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Err("Export dimensions cannot be zero".into());
    }
    if w > 15360 || h > 8640 {
        return Err("Export dimensions exceed 16K max safety ceiling".into());
    }
    if fps == 0 || fps > 480 {
        return Err(format!("FPS out of bounds: {}", fps));
    }
    Ok(())
}
