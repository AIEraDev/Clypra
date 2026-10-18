use std::path::{Path, PathBuf};
use tokio::process::Command;

use super::executable_check::is_real_executable;
use super::target::{augmented_path, TARGET_TRIPLE};

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
pub fn candidate_binary_names(base_name: &str) -> Vec<String> {
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
