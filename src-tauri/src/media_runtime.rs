//! Clypra-managed, short-lived FFmpeg media runtime.
//!
//! The editor never relies on a user-managed PATH in shipped builds. Tauri
//! packages `ffmpeg` and `ffprobe` as target-specific sidecars and this module
//! provides a small, inspectable contract for their availability.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRuntimeStatus {
    pub available: bool,
    pub bundled: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub diagnostic: Option<String>,
}

pub struct MediaRuntime;

impl MediaRuntime {
    pub fn ffmpeg_path() -> Option<PathBuf> {
        crate::commands::binary_resolver::resolve_binary_path("ffmpeg")
    }

    pub fn ffprobe_path() -> Option<PathBuf> {
        crate::commands::binary_resolver::resolve_binary_path("ffprobe")
    }

    /// True when the resolved path points to a Clypra-managed sidecar rather
    /// than an arbitrary system install.
    ///
    /// Two naming conventions are accepted:
    ///
    /// 1. **Triple-qualified** (`ffmpeg-aarch64-apple-darwin`) — used inside a
    ///    packaged `.app` / `.exe` bundle where Tauri places the sidecar as a
    ///    sibling of the main executable under `Contents/MacOS/` (macOS) or
    ///    next to the `.exe` (Windows/Linux). This is the canonical production
    ///    layout.
    ///
    /// 2. **Plain name** (`ffmpeg` / `ffmpeg.exe`) **adjacent to the Clypra
    ///    executable** — Tauri copies the target-qualified sidecar from
    ///    `src-tauri/bin/` into `target/debug/` and `target/release/` under the
    ///    plain name during both `cargo tauri dev` and `cargo tauri build`.
    ///    Matching only the triple-qualified name caused `bundled: false` to be
    ///    reported for every dev and release run, which in turn allowed the
    ///    subprocess FFmpeg path to fall through to the system install.
    ///
    /// The plain-name match is intentionally gated on the path being **sibling
    /// to the current executable** so that a user-installed `/usr/local/bin/ffmpeg`
    /// is never mistaken for the bundled sidecar.
    pub fn is_bundled_path(path: &Path, binary: &str) -> bool {
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => return false,
        };

        // Accept the triple-qualified name (production .app bundle layout).
        let triple_name = if cfg!(target_os = "windows") {
            format!(
                "{}-{}.exe",
                binary,
                crate::commands::binary_resolver::TARGET_TRIPLE
            )
        } else {
            format!(
                "{}-{}",
                binary,
                crate::commands::binary_resolver::TARGET_TRIPLE
            )
        };
        if file_name == triple_name.as_str() {
            return true;
        }

        // Accept the plain name only when the file sits next to the Clypra
        // executable (i.e. in target/debug/, target/release/, or inside the
        // packaged bundle's executable directory). This prevents a system-wide
        // `ffmpeg` from being misidentified as the bundled one.
        let plain_name = if cfg!(target_os = "windows") {
            let base = binary.trim_end_matches(".exe");
            format!("{}.exe", base)
        } else {
            binary.to_string()
        };
        if file_name == plain_name.as_str() {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    if path.parent() == Some(exe_dir) {
                        return true;
                    }
                }
            }
        }

        false
    }

    pub fn parse_clean_version(stdout: &str) -> Option<String> {
        let first_line = stdout.lines().next()?;
        let trimmed = first_line.trim();

        let version_part = if let Some(after_version) = trimmed.strip_prefix("ffmpeg version ") {
            after_version
                .split_whitespace()
                .next()
                .unwrap_or(after_version)
        } else if let Some(after_ffmpeg) = trimmed.strip_prefix("ffmpeg ") {
            after_ffmpeg
                .split_whitespace()
                .next()
                .unwrap_or(after_ffmpeg)
        } else if let Some((before_copyright, _)) = trimmed.split_once("Copyright") {
            before_copyright.trim()
        } else {
            trimmed
        };

        let clean = if let Some((before_copyright, _)) = version_part.split_once("Copyright") {
            before_copyright.trim()
        } else {
            version_part.trim()
        };

        if clean.is_empty() {
            None
        } else {
            Some(clean.to_string())
        }
    }

    pub async fn status() -> MediaRuntimeStatus {
        let ffmpeg = Self::ffmpeg_path();
        let ffprobe = Self::ffprobe_path();
        let bundled = ffmpeg
            .as_deref()
            .is_some_and(|path| Self::is_bundled_path(path, "ffmpeg"))
            && ffprobe
                .as_deref()
                .is_some_and(|path| Self::is_bundled_path(path, "ffprobe"));

        let Some(ffmpeg_path) = ffmpeg else {
            return MediaRuntimeStatus {
                available: false,
                bundled: false,
                ffmpeg_path: None,
                ffprobe_path: ffprobe.map(|path| path.display().to_string()),
                ffmpeg_version: None,
                diagnostic: Some("Clypra media runtime could not locate FFmpeg".to_string()),
            };
        };

        let output = crate::process_util::hidden_tokio_command(&ffmpeg_path)
            .arg("-version")
            .output()
            .await;
        match output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                MediaRuntimeStatus {
                    available: true,
                    bundled,
                    ffmpeg_path: Some(ffmpeg_path.display().to_string()),
                    ffprobe_path: ffprobe.map(|path| path.display().to_string()),
                    ffmpeg_version: Self::parse_clean_version(&stdout),
                    diagnostic: None,
                }
            }
            Ok(output) => MediaRuntimeStatus {
                available: false,
                bundled,
                ffmpeg_path: Some(ffmpeg_path.display().to_string()),
                ffprobe_path: ffprobe.map(|path| path.display().to_string()),
                ffmpeg_version: None,
                diagnostic: Some(format!(
                    "Clypra media runtime exited with {}",
                    output.status
                )),
            },
            Err(error) => MediaRuntimeStatus {
                available: false,
                bundled,
                ffmpeg_path: Some(ffmpeg_path.display().to_string()),
                ffprobe_path: ffprobe.map(|path| path.display().to_string()),
                ffmpeg_version: None,
                diagnostic: Some(format!("Clypra media runtime could not start: {error}")),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::MediaRuntime;
    use std::path::Path;

    #[test]
    fn triple_qualified_name_is_always_bundled() {
        let triple_name = if cfg!(target_os = "windows") {
            format!(
                "ffmpeg-{}.exe",
                crate::commands::binary_resolver::TARGET_TRIPLE
            )
        } else {
            format!("ffmpeg-{}", crate::commands::binary_resolver::TARGET_TRIPLE)
        };
        assert!(
            MediaRuntime::is_bundled_path(Path::new(&triple_name), "ffmpeg"),
            "Triple-qualified sidecar name must always be recognised as bundled"
        );
    }

    #[test]
    fn plain_name_sibling_of_exe_is_bundled() {
        // Tauri copies the sidecar as the plain name (e.g. `ffmpeg`) into
        // target/debug/ and target/release/ next to the app executable.
        // Construct a path that IS a sibling of current_exe() and verify it
        // is accepted.
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let plain = if cfg!(target_os = "windows") {
                    exe_dir.join("ffmpeg.exe")
                } else {
                    exe_dir.join("ffmpeg")
                };
                assert!(
                    MediaRuntime::is_bundled_path(&plain, "ffmpeg"),
                    "Plain-named sidecar next to the executable must be recognised as bundled"
                );
            }
        }
    }

    #[test]
    fn plain_name_outside_exe_dir_is_not_bundled() {
        // A system-wide install (e.g. /usr/local/bin/ffmpeg) must NOT be
        // flagged as the bundled sidecar.
        #[cfg(not(target_os = "windows"))]
        assert!(
            !MediaRuntime::is_bundled_path(Path::new("/usr/local/bin/ffmpeg"), "ffmpeg"),
            "System PATH ffmpeg must not be reported as bundled"
        );
        #[cfg(not(target_os = "windows"))]
        assert!(
            !MediaRuntime::is_bundled_path(Path::new("/opt/homebrew/bin/ffmpeg"), "ffmpeg"),
            "Homebrew ffmpeg must not be reported as bundled"
        );
        assert!(
            !MediaRuntime::is_bundled_path(Path::new("ffmpeg"), "ffmpeg"),
            "Bare filename with no directory must not be reported as bundled"
        );
    }

    #[test]
    fn parse_clean_version_strips_copyright_banner_and_developers_statement() {
        let banner1 = "ffmpeg version 8.0 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with Apple clang...";
        assert_eq!(
            MediaRuntime::parse_clean_version(banner1).as_deref(),
            Some("8.0")
        );

        let banner2 = "ffmpeg version 7.1-clypra Copyright (c) 2000-2024 the FFmpeg developers";
        assert_eq!(
            MediaRuntime::parse_clean_version(banner2).as_deref(),
            Some("7.1-clypra")
        );

        let banner3 = "ffmpeg version n6.1.2-1ubuntu1 (c) developers";
        assert_eq!(
            MediaRuntime::parse_clean_version(banner3).as_deref(),
            Some("n6.1.2-1ubuntu1")
        );

        let banner4 = "ffmpeg 7.0 Copyright (c)";
        assert_eq!(
            MediaRuntime::parse_clean_version(banner4).as_deref(),
            Some("7.0")
        );
    }
}
