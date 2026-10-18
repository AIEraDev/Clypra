use super::types::ExportConfig;

/// Build an augmented PATH string that includes common Homebrew/system binary
/// locations. Tauri apps on macOS launch with a stripped environment, so
/// `ffmpeg` and `ffprobe` (typically in /opt/homebrew/bin or /usr/local/bin)
/// may not be found with the default PATH.
pub fn augmented_path() -> String {
    crate::commands::binary_resolver::augmented_path()
}

/// Atomically commit an exported file by renaming, with fallback to copy+delete
/// when crossing physical filesystems or volumes (EXDEV).
pub(crate) async fn atomic_or_copy_commit(
    src: &std::path::Path,
    dst: &std::path::Path,
) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create destination directory: {}", e))?;
        }
    }

    match tokio::fs::rename(src, dst).await {
        Ok(()) => Ok(()),
        Err(err) => {
            let is_cross_device = err.kind() == std::io::ErrorKind::CrossesDevices
                || err.raw_os_error() == Some(18) // EXDEV on Unix
                || err.raw_os_error() == Some(17); // EXDEV on Windows

            if is_cross_device {
                tokio::fs::copy(src, dst)
                    .await
                    .map_err(|e| format!("Failed to copy file across filesystems: {}", e))?;
                let _ = tokio::fs::remove_file(src).await;
                Ok(())
            } else {
                Err(format!("Failed to commit file: {}", err))
            }
        }
    }
}

/// Validate compositor export configuration parameters.
pub(crate) fn validate_compositor_export_config(config: &ExportConfig) -> Result<(), String> {
    if config.width == 0 || config.height == 0 {
        return Err(format!(
            "Invalid export dimensions: {}x{}",
            config.width, config.height
        ));
    }
    if config.width > 7680 || config.height > 4320 {
        return Err(format!(
            "Export dimensions too large: {}x{} (max 7680x4320)",
            config.width, config.height
        ));
    }
    if !config.frame_rate.is_finite() || config.frame_rate <= 0.0 || config.frame_rate > 240.0 {
        return Err(format!("Invalid frame rate: {}", config.frame_rate));
    }
    if config.total_frames == 0 {
        return Err("total_frames must be greater than 0".to_string());
    }
    if config.output_path.trim().is_empty() {
        return Err("output_path cannot be empty".to_string());
    }
    if let Some(clips) = &config.audio_clips {
        for clip in clips {
            if !clip.duration.is_finite() || clip.duration <= 0.0 {
                return Err(format!("Invalid audio clip duration: {}", clip.duration));
            }
            if !clip.trim_in.is_finite() || clip.trim_in < 0.0 {
                return Err(format!("Invalid audio clip trim_in: {}", clip.trim_in));
            }
            if !clip.start_time.is_finite() || clip.start_time < 0.0 {
                return Err(format!(
                    "Invalid audio clip start_time: {}",
                    clip.start_time
                ));
            }
            if !clip.volume.is_finite() || clip.volume < 0.0 {
                return Err(format!("Invalid audio clip volume: {}", clip.volume));
            }
            if let Some(pan) = clip.pan {
                if !pan.is_finite() || !(-1.0..=1.0).contains(&pan) {
                    return Err(format!("Invalid audio clip pan: {}", pan));
                }
            }
        }
    }
    Ok(())
}

fn calculate_export_bitrate(width: u32, height: u32, codec: &str) -> u64 {
    let pixels = u64::from(width) * u64::from(height);
    let base = if codec == "h265" || codec == "hevc" {
        35_000_000u64
    } else {
        50_000_000u64
    };
    ((base * pixels) / (3840 * 2160)).max(4_000_000)
}

pub(crate) fn apply_export_codec_args(
    cmd: &mut tokio::process::Command,
    config: &ExportConfig,
    encoder: &crate::commands::native_export::SelectedEncoder,
) -> Result<(), String> {
    use crate::commands::native_export::HwAccelType;

    let gop_size = (config.frame_rate * 2.0).round() as i32;
    let target_bitrate = calculate_export_bitrate(config.width, config.height, &config.codec);

    // Color space tagging across all encoders to eliminate QuickTime gamma shift
    cmd.arg("-color_range").arg("tv");
    cmd.arg("-colorspace").arg("bt709");
    cmd.arg("-color_primaries").arg("bt709");
    cmd.arg("-color_trc").arg("bt709");

    if config.codec == "vp9" || config.codec == "webm" {
        cmd.arg("-c:v").arg("libvpx-vp9");
        cmd.arg("-crf").arg(config.crf.to_string());
        cmd.arg("-b:v").arg("0");
        cmd.arg("-pix_fmt").arg("yuv420p");
        return Ok(());
    }

    if config.codec == "gif" {
        cmd.arg("-c:v").arg("gif");
        cmd.arg("-loop").arg("0");
        return Ok(());
    }

    match encoder.hw_type {
        HwAccelType::VideoToolbox => {
            if config.codec == "prores" {
                cmd.arg("-c:v").arg("prores_videotoolbox");
                cmd.arg("-allow_sw").arg("1");
                let (prores_profile, prores_pix_fmt) = match config.pixel_format.as_str() {
                    "yuva444p10le" | "yuv444p10le" => ("4444", "p410le"),
                    "yuv422p10le" => ("hq", "p210le"),
                    "yuv422p" => ("standard", "p210le"),
                    _ => ("hq", "p210le"),
                };
                cmd.arg("-profile:v").arg(prores_profile);
                cmd.arg("-pix_fmt").arg(prores_pix_fmt);
            } else if config.codec == "h265" || config.codec == "hevc" {
                cmd.arg("-c:v").arg(&encoder.codec_name);
                cmd.arg("-tag:v").arg("hvc1");
                cmd.arg("-b:v").arg(target_bitrate.to_string());
                cmd.arg("-maxrate")
                    .arg((target_bitrate * 10 / 7).to_string());
                cmd.arg("-bufsize").arg((target_bitrate * 2).to_string());
                cmd.arg("-allow_sw").arg("1");
                cmd.arg("-realtime").arg("1");
                cmd.arg("-prio_speed").arg("1");
                cmd.arg("-bf").arg("0");
                cmd.arg("-g").arg(gop_size.to_string());
                cmd.arg("-pix_fmt").arg(&config.pixel_format);
            } else {
                cmd.arg("-c:v").arg(&encoder.codec_name);
                cmd.arg("-b:v").arg(target_bitrate.to_string());
                cmd.arg("-maxrate")
                    .arg((target_bitrate * 10 / 7).to_string());
                cmd.arg("-bufsize").arg((target_bitrate * 2).to_string());
                cmd.arg("-allow_sw").arg("1");
                cmd.arg("-realtime").arg("1");
                cmd.arg("-prio_speed").arg("1");
                cmd.arg("-bf").arg("0");
                cmd.arg("-g").arg(gop_size.to_string());
                cmd.arg("-pix_fmt").arg(&config.pixel_format);
            }
        }
        HwAccelType::Nvenc => {
            cmd.arg("-c:v").arg(&encoder.codec_name);
            cmd.arg("-preset").arg("p4");
            cmd.arg("-b:v").arg(target_bitrate.to_string());
            cmd.arg("-maxrate")
                .arg((target_bitrate * 10 / 7).to_string());
            cmd.arg("-bufsize").arg((target_bitrate * 2).to_string());
            cmd.arg("-bf").arg("0");
            cmd.arg("-g").arg(gop_size.to_string());
            cmd.arg("-pix_fmt").arg(&config.pixel_format);
            if config.codec == "h265" || config.codec == "hevc" {
                cmd.arg("-tag:v").arg("hvc1");
            }
        }
        HwAccelType::Qsv | HwAccelType::Amf | HwAccelType::Vaapi => {
            cmd.arg("-c:v").arg(&encoder.codec_name);
            cmd.arg("-b:v").arg(target_bitrate.to_string());
            cmd.arg("-bf").arg("0");
            cmd.arg("-g").arg(gop_size.to_string());
            cmd.arg("-pix_fmt").arg(&config.pixel_format);
            if config.codec == "h265" || config.codec == "hevc" {
                cmd.arg("-tag:v").arg("hvc1");
            }
        }
        HwAccelType::Software => match config.codec.as_str() {
            "h264" => {
                cmd.arg("-c:v").arg("libx264");
                cmd.arg("-preset").arg(&config.preset);
                cmd.arg("-crf").arg(config.crf.to_string());
                cmd.arg("-pix_fmt").arg(&config.pixel_format);
                cmd.arg("-g").arg(gop_size.to_string());
                cmd.arg("-keyint_min").arg(gop_size.to_string());
                cmd.arg("-x264-params").arg("scenecut=0:open_gop=0");
                cmd.arg("-force_key_frames").arg("expr:eq(n,0)");
            }
            "h265" | "hevc" => {
                cmd.arg("-c:v").arg("libx265");
                cmd.arg("-tag:v").arg("hvc1");
                cmd.arg("-preset").arg(&config.preset);
                cmd.arg("-crf").arg(config.crf.to_string());
                cmd.arg("-pix_fmt").arg(&config.pixel_format);
                cmd.arg("-g").arg(gop_size.to_string());
                cmd.arg("-keyint_min").arg(gop_size.to_string());
                cmd.arg("-x265-params")
                    .arg("scenecut=0:open-gop=0:force-idr=1");
            }
            "prores" => {
                cmd.arg("-c:v").arg("prores_ks");
                let (prores_profile, prores_pix_fmt) = match config.pixel_format.as_str() {
                    "yuva444p10le" | "yuv444p10le" => ("4444", "yuva444p10le"),
                    "yuv422p10le" => ("hq", "yuv422p10le"),
                    "yuv422p" => ("standard", "yuv422p10le"),
                    _ => ("hq", "yuv422p10le"),
                };
                cmd.arg("-profile:v").arg(prores_profile);
                cmd.arg("-pix_fmt").arg(prores_pix_fmt);
            }
            _ => return Err(format!("Unsupported codec: {}", config.codec)),
        },
    }
    Ok(())
}
