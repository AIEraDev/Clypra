use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip, TICKS_PER_SECOND};
use std::path::Path;
use std::process::Stdio;

/// Fallback decoder spawning FFmpeg CLI process if needed.
pub fn decode_with_ffmpeg_cli(
    path: &Path,
    config: &AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    // Use binary_resolver which verifies genuine executables (rejecting non-PE batch stubs on Windows)
    // and checks bundled ffmpeg-static/bin/, application directory, augmented system PATH, etc.
    if crate::commands::binary_resolver::resolve_binary_path("ffmpeg").is_none() {
        return Err(
            "FFmpeg executable not found on system. Please install FFmpeg or run scripts/setup-sidecars.ps1"
                .to_string(),
        );
    }

    let mut command = crate::commands::binary_resolver::create_std_command("ffmpeg");
    command
        .arg("-v")
        .arg("error")
        .arg("-nostdin")
        .arg("-threads")
        .arg("1");

    command
        .arg("-i")
        .arg(path)
        .arg("-vn")
        .arg("-ac")
        .arg(target_channels.to_string())
        .arg("-ar")
        .arg(target_sample_rate.to_string());

    // Place -ss after -i so the fallback decoder performs an accurate output
    // seek instead of retaining keyframe preroll from the source file.
    if config.source_start_ticks > 0 {
        let sec = config.source_start_ticks as f64 / TICKS_PER_SECOND as f64;
        command.arg("-ss").arg(format!("{:.6}", sec));
    }

    if config.duration_ticks > 0 {
        let sec = config.duration_ticks as f64 / TICKS_PER_SECOND as f64;
        command.arg("-t").arg(format!("{:.6}", sec));
    }

    command
        .arg("-f")
        .arg("f32le")
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let output = crate::process_util::run_command_with_timeout(
        command,
        std::time::Duration::from_secs(15),
    )
    .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !output.status.success() {
        return Err("ffmpeg audio decoding process exited with error".to_string());
    }

    let (sample_bytes, _) = output.stdout.as_chunks::<4>();
    let samples: Vec<f32> = sample_bytes
        .iter()
        .map(|chunk| {
            let val = f32::from_le_bytes(*chunk);
            if val.is_finite() {
                val.clamp(-1.0, 1.0)
            } else {
                0.0
            }
        })
        .collect();

    if samples.is_empty() {
        return Err("CLI decoder returned 0 samples".to_string());
    }

    let mut final_config = config.clone();
    let actual_duration_ticks = (samples.len() as i64 / i64::from(target_channels))
        .saturating_mul(TICKS_PER_SECOND)
        / i64::from(target_sample_rate);
    if final_config.duration_ticks <= 0 || final_config.duration_ticks > actual_duration_ticks {
        final_config.duration_ticks = actual_duration_ticks;
    }

    Ok(DecodedAudioClip {
        config: final_config,
        sample_rate: target_sample_rate,
        channels: target_channels,
        samples: samples.into(),
    })
}
