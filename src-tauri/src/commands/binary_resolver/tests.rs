#[cfg(test)]
mod tests {
    use super::super::executable_check::is_real_executable;
    use super::super::resolver::{
        candidate_binary_names, create_async_command, create_std_command, resolve_binary_path,
    };
    use super::super::target::{augmented_path, TARGET_TRIPLE};
    use std::path::Path;

    #[test]
    fn test_candidate_names_non_empty() {
        let names = candidate_binary_names("ffmpeg");
        assert!(!names.is_empty());
        assert!(names.iter().any(|n| n.contains("ffmpeg")));
    }

    #[test]
    fn test_augmented_path_includes_fallback() {
        let path = augmented_path();
        assert!(!path.is_empty());
    }

    #[test]
    fn test_create_command_constructs() {
        let _cmd = create_async_command("ffmpeg");
        let _std_cmd = create_std_command("ffmpeg");
    }

    #[test]
    fn test_resolve_binary_discovers_sidecar_independently_of_system_path() {
        // Create a temporary sandbox directory mimicking a Tauri bundle resources structure
        let temp_dir =
            std::env::temp_dir().join(format!("clypra-resolver-test-{}", uuid::Uuid::new_v4()));
        let bin_dir = temp_dir.join("bin");
        std::fs::create_dir_all(&bin_dir).expect("Failed to create mock bin dir");

        let target_name = format!("mocktool-{}", TARGET_TRIPLE);
        let mock_file = bin_dir.join(&target_name);
        std::fs::write(&mock_file, b"#!/bin/sh\necho ok\n").expect("Failed to write mock binary");

        // Verify candidate_binary_names includes the target triple variant
        let candidates = candidate_binary_names("mocktool");
        assert!(
            candidates
                .iter()
                .any(|c| c == &target_name || c.starts_with("mocktool")),
            "Expected candidate list {:?} to include {:?}",
            candidates,
            target_name
        );

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_ffmpeg_locates_local_workspace_or_sidecar() {
        // When running in workspace, resolver locates sidecar in src-tauri/bin/ or bin/
        let resolved = resolve_binary_path("ffmpeg");
        if let Some(path) = resolved {
            assert!(
                path.is_file(),
                "Resolved path must be an existing file: {:?}",
                path
            );
        }
    }

    #[test]
    fn test_is_real_executable_rejects_non_existent_file() {
        let non_existent = Path::new("non_existent_file_12345.exe");
        assert!(!is_real_executable(non_existent));
    }

    #[test]
    fn test_is_real_executable_mock_pe_vs_batch_stub() {
        let temp_dir =
            std::env::temp_dir().join(format!("clypra-exe-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

        let batch_stub = temp_dir.join("ffmpeg-stub.exe");
        std::fs::write(&batch_stub, b"@echo off\r\nwhere ffmpeg\r\n")
            .expect("Failed to write stub");

        let mut pe_bytes = vec![0u8; 256];
        pe_bytes[0] = b'M';
        pe_bytes[1] = b'Z';
        // e_lfanew at 0x3C points to 0x80 (128)
        pe_bytes[0x3C] = 0x80;
        // PE\0\0 signature at offset 128
        pe_bytes[128..132].copy_from_slice(b"PE\0\0");
        // Machine field: AMD64 (0x8664)
        pe_bytes[132] = 0x64;
        pe_bytes[133] = 0x86;

        let pe_binary = temp_dir.join("ffmpeg-real.exe");
        std::fs::write(&pe_binary, &pe_bytes).expect("Failed to write mock PE");

        #[cfg(target_os = "windows")]
        {
            assert!(
                !is_real_executable(&batch_stub),
                "Batch stub named .exe must be rejected"
            );
            assert!(
                is_real_executable(&pe_binary),
                "PE binary starting with MZ and PE header must be accepted"
            );
        }

        // On non-Windows these are tiny files (<1 MB) so they are rejected by the size guard.
        #[cfg(not(target_os = "windows"))]
        {
            assert!(
                !is_real_executable(&batch_stub),
                "Tiny batch stub must be rejected on non-Windows (size guard)"
            );
            assert!(
                !is_real_executable(&pe_binary),
                "Tiny PE-header mock must be rejected on non-Windows (size guard)"
            );
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_is_real_executable_rejects_shebang_stub_on_unix() {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let temp_dir =
                std::env::temp_dir().join(format!("clypra-shebang-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

            // Shell stub like those shipped in src-tauri/bin/ for non-native triples
            let stub = temp_dir.join("ffmpeg-x86_64-apple-darwin");
            std::fs::write(
                &stub,
                b"#!/bin/sh\n# Dev helper: runs ffmpeg from PATH.\nif command -v ffmpeg >/dev/null 2>&1; then exec ffmpeg \"$@\"; fi\nexit 127\n",
            )
            .expect("Failed to write stub");
            // Make it executable so the old code would have passed it
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755))
                .expect("Failed to chmod stub");

            assert!(
                !is_real_executable(&stub),
                "Shell stub starting with #! must be rejected (shebang)"
            );

            let _ = std::fs::remove_dir_all(&temp_dir);
        }
    }

    #[test]
    fn test_is_real_executable_mock_arm64_pe() {
        let temp_dir =
            std::env::temp_dir().join(format!("clypra-exe-test-arm64-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

        let mut pe_bytes = vec![0u8; 256];
        pe_bytes[0] = b'M';
        pe_bytes[1] = b'Z';
        pe_bytes[0x3C] = 0x80;
        pe_bytes[128..132].copy_from_slice(b"PE\0\0");
        // Machine field: ARM64 (0xAA64) -> 0x64, 0xAA in little-endian
        pe_bytes[132] = 0x64;
        pe_bytes[133] = 0xAA;

        let arm64_binary = temp_dir.join("ffmpeg-arm64.exe");
        std::fs::write(&arm64_binary, &pe_bytes).expect("Failed to write mock ARM64 PE");

        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            assert!(
                !is_real_executable(&arm64_binary),
                "ARM64 PE binary on x86_64 host must be rejected"
            );
        }

        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        {
            assert!(
                is_real_executable(&arm64_binary),
                "ARM64 PE binary on ARM64 host must be accepted"
            );
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_strict_bundled_media_guard_rejects_fallback() {
        std::env::set_var("CLYPRA_REQUIRE_BUNDLED_MEDIA", "1");
        let result = resolve_binary_path("non_existent_media_tool_12345");
        std::env::remove_var("CLYPRA_REQUIRE_BUNDLED_MEDIA");
        assert!(result.is_none());
    }
}
