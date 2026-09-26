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

    /// True only when both executables use Tauri's target-qualified sidecar
    /// names. A PATH fallback remains useful for local development, but must
    /// never be mistaken for a packaged Clypra media engine.
    pub fn is_bundled_path(path: &Path, binary: &str) -> bool {
        let expected = if cfg!(target_os = "windows") {
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
        path.file_name().and_then(|name| name.to_str()) == Some(expected.as_str())
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

        let output = tokio::process::Command::new(&ffmpeg_path)
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
    fn only_target_qualified_names_are_marked_as_bundled() {
        let expected = if cfg!(target_os = "windows") {
            format!(
                "ffmpeg-{}.exe",
                crate::commands::binary_resolver::TARGET_TRIPLE
            )
        } else {
            format!("ffmpeg-{}", crate::commands::binary_resolver::TARGET_TRIPLE)
        };
        assert!(MediaRuntime::is_bundled_path(
            Path::new(&expected),
            "ffmpeg"
        ));
        assert!(!MediaRuntime::is_bundled_path(
            Path::new("ffmpeg"),
            "ffmpeg"
        ));
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
