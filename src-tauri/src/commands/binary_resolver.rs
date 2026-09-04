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
    all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64")),
    all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
    all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
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
            extras.push(format!("{}\\scoop\\apps\\ffmpeg\\current\\bin", user_profile));
        }
        if let Ok(program_data) = std::env::var("ProgramData") {
            extras.push(format!("{}\\chocolatey\\bin", program_data));
        }
        extras.push("C:\\ffmpeg\\bin".to_string());
        extras.push("C:\\Program Files\\ffmpeg\\bin".to_string());

        let extra_str = extras.join(";");
        if current.is_empty() {
            extra_str
        } else {
            format!("{};{}", current, extra_str)
        }
    }

    #[cfg(target_os = "macos")]
    {
        let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
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

/// Locate an executable binary on the system using multi-tier fallback.
pub fn resolve_binary_path(base_name: &str) -> Option<PathBuf> {
    let names = candidate_binary_names(base_name);

    // Tier 1: Relative to current executable
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
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    // Tier 2: Relative to current working directory
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
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // Tier 3: Search within the augmented PATH
    let path_var = augmented_path();
    let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
    for dir_str in path_var.split(sep) {
        let dir = Path::new(dir_str.trim());
        if !dir.is_dir() {
            continue;
        }
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

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
        let triple_name = format!("{}-{}.exe", base_name.trim_end_matches(".exe"), TARGET_TRIPLE);

        names.push(exe_name.clone());
        names.push(triple_name);
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
pub fn create_async_command(base_name: &str) -> Command {
    let path_env = augmented_path();
    if let Some(resolved) = resolve_binary_path(base_name) {
        let mut cmd = Command::new(resolved);
        cmd.env("PATH", path_env);
        cmd
    } else {
        let mut cmd = Command::new(base_name);
        cmd.env("PATH", path_env);
        cmd
    }
}

/// Create a standard synchronous `std::process::Command` targeting the resolved binary or fallback name.
pub fn create_std_command(base_name: &str) -> std::process::Command {
    let path_env = augmented_path();
    if let Some(resolved) = resolve_binary_path(base_name) {
        let mut cmd = std::process::Command::new(resolved);
        cmd.env("PATH", path_env);
        cmd
    } else {
        let mut cmd = std::process::Command::new(base_name);
        cmd.env("PATH", path_env);
        cmd
    }
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
}
