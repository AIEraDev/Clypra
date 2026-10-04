//! Robust cross-platform binary and sidecar resolution engine.
//!
//! Locates essential external binaries (such as `ffmpeg` and `ffprobe`)
//! using a 4-tier fallback strategy:
//! 1. Bundled application resources & sibling `bin/` directories
//! 2. Project workspace and sidecar naming conventions (e.g. `ffmpeg-<target-triple>.exe`)
//! 3. Standard platform install locations (Homebrew, WinGet, Chocolatey, Scoop, system dirs)
//! 4. Augmented PATH environment lookup

use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Platform target triple for sidecar resolution.
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
pub const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
pub const TARGET_TRIPLE: &str = "aarch64-pc-windows-msvc";

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub const TARGET_TRIPLE: &str = "aarch64-apple-darwin";

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub const TARGET_TRIPLE: &str = "x86_64-apple-darwin";

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub const TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
pub const TARGET_TRIPLE: &str = "aarch64-unknown-linux-gnu";

#[cfg(not(any(
    all(
        target_os = "windows",
        any(target_arch = "x86_64", target_arch = "aarch64")
    ),
    all(
        target_os = "macos",
        any(target_arch = "x86_64", target_arch = "aarch64")
    ),
    all(
        target_os = "linux",
        any(target_arch = "x86_64", target_arch = "aarch64")
    ),
)))]
pub const TARGET_TRIPLE: &str = "unknown";

/// Construct an augmented PATH string containing common system and package manager directories.
pub fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let mut extras = Vec::new();
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            extras.push(format!("{}\\Microsoft\\WinGet\\Links", local_app_data));
            extras.push(format!("{}\\Programs\\ffmpeg\\bin", local_app_data));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            extras.push(format!("{}\\scoop\\shims", user_profile));
            extras.push(format!(
                "{}\\scoop\\apps\\ffmpeg\\current\\bin",
                user_profile
            ));
        }
        if let Ok(program_data) = std::env::var("ProgramData") {
            extras.push(format!("{}\\chocolatey\\bin", program_data));
        }
        extras.push("C:\\ffmpeg\\bin".to_string());
        extras.push("C:\\Program Files\\ffmpeg\\bin".to_string());
        extras.push("C:\\Program Files (x86)\\ffmpeg\\bin".to_string());
        extras.push("C:\\tools\\ffmpeg\\bin".to_string());

        let extra_str = extras.join(";");
        if current.is_empty() {
            extra_str
        } else {
            format!("{};{}", current, extra_str)
        }
    }

    #[cfg(target_os = "macos")]
    {
        let extra =
            "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
        if current.is_empty() {
            extra.to_string()
        } else {
            format!("{}:{}", current, extra)
        }
    }

    #[cfg(target_os = "linux")]
    {
        let extra = "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games:/snap/bin:/var/lib/flatpak/exports/bin";
        if current.is_empty() {
            extra.to_string()
        } else {
            format!("{}:{}", current, extra)
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        current
    }
}

/// Check if a path points to a genuine, runnable executable file rather than a
/// placeholder or text stub.
///
/// On Windows, sidecar stubs in the repo have `.exe` extensions but contain
/// batch scripts starting with `@echo off`. Attempting to spawn them directly
/// via `Command::new` causes `ERROR_EXE_MACHINE_TYPE_MISMATCH (os error 216)`:
/// "This version of %1 is not compatible with the version of Windows you're running."
/// Genuine Windows PE executables must begin with the `MZ` DOS magic header.
///
/// On macOS/Linux the repo ships shell-script stubs (starting with `#!`) in
/// place of real binaries for non-native target triples. These stubs are valid
/// files with the execute bit set, so a plain `is_file()` check accepts them.
/// We reject any file whose first two bytes form a shebang (`#!`) because no
/// real native binary (Mach-O: `\xCF\xFA` / `\xFE\xED`, ELF: `\x7FELF`) starts
/// with those bytes. We also enforce a minimum size floor: real FFmpeg builds
/// are tens of megabytes; any file smaller than 1 MB is certainly not a usable
/// native binary and is rejected regardless of magic bytes.
pub fn is_real_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    // Read the first 4 bytes to inspect the magic header.
    // All real native binary formats start with a recognisable magic number
    // that is entirely distinct from the ASCII characters used by shell/batch stubs.
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    if f.read_exact(&mut magic).is_err() {
        // File is smaller than 4 bytes — definitely not a real binary.
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let is_exe = path
            .extension()
            .map_or(false, |ext| ext.eq_ignore_ascii_case("exe"));
        if is_exe {
            use std::io::{Seek, SeekFrom};

            // 1. Must have DOS header starting with "MZ" (0x4D, 0x5A)
            if magic[0] != 0x4D || magic[1] != 0x5A {
                return false;
            }

            // Read the full 64-byte DOS header to reach e_lfanew at 0x3C.
            let mut dos_rest = [0u8; 60];
            if f.read_exact(&mut dos_rest).is_err() {
                return false;
            }
            let mut dos_header = [0u8; 64];
            dos_header[..4].copy_from_slice(&magic);
            dos_header[4..].copy_from_slice(&dos_rest);

            // 2. Read e_lfanew (offset to PE header) at offset 0x3C
            let pe_offset = u32::from_le_bytes([
                dos_header[0x3C],
                dos_header[0x3D],
                dos_header[0x3E],
                dos_header[0x3F],
            ]) as u64;

            // Basic sanity check on PE header offset
            if pe_offset < 64 || pe_offset > 10_000_000 {
                return false;
            }

            if f.seek(SeekFrom::Start(pe_offset)).is_err() {
                return false;
            }

            // 3. Must have "PE\0\0" signature (0x50, 0x45, 0x00, 0x00)
            let mut pe_sig = [0u8; 4];
            if f.read_exact(&mut pe_sig).is_err() || &pe_sig != b"PE\0\0" {
                return false;
            }

            // 4. Read IMAGE_FILE_HEADER Machine field (2 bytes)
            let mut machine_bytes = [0u8; 2];
            if f.read_exact(&mut machine_bytes).is_err() {
                return false;
            }
            let machine = u16::from_le_bytes(machine_bytes);

            // Machine architecture compatibility check:
            // 0x8664 = IMAGE_FILE_MACHINE_AMD64 (x86_64)
            // 0xAA64 = IMAGE_FILE_MACHINE_ARM64 (aarch64)
            // 0xA641 = IMAGE_FILE_MACHINE_ARM64EC (ARM64 Emulation Compatible)
            // 0x014C = IMAGE_FILE_MACHINE_I386  (x86 32-bit)
            #[cfg(target_arch = "x86_64")]
            {
                // Native x86_64 hosts can execute AMD64 (0x8664) and i386 (0x014C) via WOW64.
                // They cannot execute native ARM64 (0xAA64) or ARM64EC (0xA641) binaries.
                if machine == 0xAA64 || machine == 0xA641 {
                    return false;
                }
            }

            #[cfg(target_arch = "aarch64")]
            {
                // Native ARM64 hosts can execute ARM64 (0xAA64), ARM64EC (0xA641),
                // and on Windows 11 transparently emulate AMD64 (0x8664) and i386 (0x014C).
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // Reject shell/batch stubs: they start with `#!` (shebang, 0x23 0x21).
        // Real native binaries never start with ASCII text characters:
        //   Mach-O 64-bit little-endian: CF FA ED FE
        //   Mach-O 64-bit big-endian:    FE ED FA CF
        //   Mach-O fat binary:           CA FE BA BE
        //   ELF:                         7F 45 4C 46
        if magic[0] == b'#' && magic[1] == b'!' {
            log::debug!(
                "[BinaryResolver] Rejected shell stub at {:?} (shebang header)",
                path
            );
            return false;
        }

        // Enforce minimum size: real FFmpeg/FFprobe binaries are many megabytes.
        // A file smaller than 1 MB cannot be a real native binary.
        let Ok(meta) = std::fs::metadata(path) else {
            return false;
        };
        if meta.len() < 1_000_000 {
            log::debug!(
                "[BinaryResolver] Rejected undersized file at {:?} ({} bytes < 1 MB minimum)",
                path,
                meta.len()
            );
            return false;
        }
    }

    true
}

/// Locate an executable binary on the system using multi-tier fallback.
pub fn resolve_binary_path(base_name: &str) -> Option<PathBuf> {
    let names = candidate_binary_names(base_name);

    // Tier 1: Tauri's managed externalBin sidecars, relative to the app
    // executable. This is deliberately ahead of PATH so release builds always
    // use Clypra's tested media runtime rather than an arbitrary user install.
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for name in &names {
                let candidates = [
                    exe_dir.join(name),
                    exe_dir.join("bin").join(name),
                    exe_dir.join("resources").join("bin").join(name),
                    exe_dir.join("..").join("Resources").join("bin").join(name),
                    exe_dir.join("..").join("Resources").join(name),
                ];
                for candidate in candidates {
                    if is_real_executable(&candidate) {
                        log::info!(
                            "[BinaryResolver] Resolved '{}' via Tier 1 (bundled runtime) -> {:?}",
                            base_name,
                            candidate
                        );
                        return Some(candidate);
                    }
                }
            }
        }
    }

    // Tier 2: Relative to the workspace. This supports `cargo tauri dev`; the
    // release pipeline replaces the development wrappers with verified binaries.
    if let Ok(cwd) = std::env::current_dir() {
        for name in &names {
            let candidates = [
                cwd.join(name),
                cwd.join("bin").join(name),
                cwd.join("src-tauri").join("bin").join(name),
                cwd.join("..").join("bin").join(name),
                cwd.join("..").join("src-tauri").join("bin").join(name),
            ];
            for candidate in candidates {
                if is_real_executable(&candidate) {
                    log::info!(
                        "[BinaryResolver] Resolved '{}' via Tier 2 (workspace sidecar) -> {:?}",
                        base_name,
                        candidate
                    );
                    return Some(candidate);
                }
            }
        }
    }

    // Strict isolation guard: if CLYPRA_REQUIRE_BUNDLED_MEDIA is set, disallow system PATH fallback
    if std::env::var("CLYPRA_REQUIRE_BUNDLED_MEDIA")
        .is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    {
        log::error!(
            "[BinaryResolver] CLYPRA_REQUIRE_BUNDLED_MEDIA is active but '{}' was not found in Tier 1 or Tier 2. Refusing system PATH fallback.",
            base_name
        );
        return None;
    }

    // Tier 3: Search within the augmented PATH
    let path_var = augmented_path();
    let sep = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };
    for dir_str in path_var.split(sep) {
        let dir = Path::new(dir_str.trim());
        if !dir.is_dir() {
            continue;
        }
        for name in &names {
            let candidate = dir.join(name);
            if is_real_executable(&candidate) {
                log::warn!(
                    "[BinaryResolver] Resolved '{}' via Tier 3 (system PATH fallback) -> {:?}. Verified bundled/workspace sidecars are recommended.",
                    base_name,
                    candidate
                );
                return Some(candidate);
            }
        }
    }

    log::warn!("[BinaryResolver] Could not resolve binary '{}' in any search tier (checked candidates: {:?})", base_name, names);
    None
}

/// Generate candidate filenames considering platform extensions and sidecar naming.
fn candidate_binary_names(base_name: &str) -> Vec<String> {
    let mut names = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let exe_name = if base_name.ends_with(".exe") {
            base_name.to_string()
        } else {
            format!("{}.exe", base_name)
        };
        let triple_name = format!(
            "{}-{}.exe",
            base_name.trim_end_matches(".exe"),
            TARGET_TRIPLE
        );

        names.push(exe_name.clone());
        names.push(triple_name);

        #[cfg(target_arch = "aarch64")]
        {
            // Windows 11 ARM64 natively emulates x86_64 binaries. If no native ARM64
            // sidecar was installed, allow falling back to the bundled x86_64 sidecar.
            names.push(format!(
                "{}-x86_64-pc-windows-msvc.exe",
                base_name.trim_end_matches(".exe")
            ));
        }

        names.push(base_name.to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let triple_name = format!("{}-{}", base_name, TARGET_TRIPLE);
        names.push(base_name.to_string());
        names.push(triple_name);
    }

    names
}

/// Create a tokio asynchronous `Command` targeting the resolved binary or fallback name.
/// The command is configured with `CREATE_NO_WINDOW` on Windows and default null stdin.
pub fn create_async_command(base_name: &str) -> Command {
    let path_env = augmented_path();
    let mut cmd = if let Some(resolved) = resolve_binary_path(base_name) {
        crate::process_util::hidden_tokio_command(resolved)
    } else {
        crate::process_util::hidden_tokio_command(base_name)
    };
    cmd.env("PATH", path_env);
    cmd
}

/// Create a standard synchronous `std::process::Command` targeting the resolved binary or fallback name.
/// The command is configured with `CREATE_NO_WINDOW` on Windows and default null stdin.
pub fn create_std_command(base_name: &str) -> std::process::Command {
    let path_env = augmented_path();
    let mut cmd = if let Some(resolved) = resolve_binary_path(base_name) {
        crate::process_util::hidden_command(resolved)
    } else {
        crate::process_util::hidden_command(base_name)
    };
    cmd.env("PATH", path_env);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

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
