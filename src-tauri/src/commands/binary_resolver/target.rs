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
