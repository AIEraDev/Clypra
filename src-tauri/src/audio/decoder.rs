//! Streaming audio decoder leveraging ffmpeg-next for high-performance,
//! format-agnostic audio decoding with container parity.

use super::mixer::{AudioClipConfig, DecodedAudioClip, TICKS_PER_SECOND};
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;

pub const MAX_AUDIO_CLIP_BYTES: usize = 256 * 1024 * 1024; // 256 MiB safety budget

/// Bounded concurrency pool for audio decoding (prevents thread exhaustion on 20+ track timelines).
static AUDIO_DECODE_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| {
    let permits = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4)
        .clamp(2, 8);
    Arc::new(Semaphore::new(permits))
});

/// Decode a timeline audio clip into memory for real-time mixing.
/// Converts any source container and codec into standard interleaved `f32` PCM.
pub async fn decode_audio_clip(
    path: &Path,
    config: AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    if target_sample_rate == 0 || target_channels == 0 {
        return Err("Target audio sample rate or channel count is invalid".to_string());
    }

    let _permit = AUDIO_DECODE_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire decode permit: {e}"))?;

    let path_buf = path.to_path_buf();
    let config_clone = config.clone();

    // Run blocking FFmpeg decode on bounded blocking threadpool
    tokio::task::spawn_blocking(move || {
        decode_audio_clip_sync(&path_buf, config_clone, target_sample_rate, target_channels)
    })
    .await
    .map_err(|e| format!("Audio decode task panicked: {e}"))?
}

fn decode_audio_clip_sync(
    path: &Path,
    config: AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    // Attempt FFmpeg in-process decode first
    match decode_with_ffmpeg_next(path, &config, target_sample_rate, target_channels) {
        Ok(clip) => Ok(clip),
        Err(err) => {
            log::warn!(
                "[audio::decoder] ffmpeg-next decode failed for {:?}: {}. Falling back to CLI decoder.",
                path,
                err
            );
            decode_with_ffmpeg_cli(path, &config, target_sample_rate, target_channels)
        }
    }
}

/// In-process decoding via ffmpeg-next.
fn decode_with_ffmpeg_next(
    path: &Path,
    config: &AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    let mut ictx = ffmpeg::format::input(&path)
        .map_err(|e| format!("Failed to open audio input: {e}"))?;

    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .ok_or_else(|| "No audio stream found in media file".to_string())?;

    let stream_index = stream.index();
    let time_base = stream.time_base();

    let context_decoder = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| format!("Failed to create codec context: {e}"))?;
    let mut decoder = context_decoder
        .decoder()
        .audio()
        .map_err(|e| format!("Failed to initialize audio decoder: {e}"))?;

    let input_channel_layout = if decoder.channel_layout().is_empty() {
        ffmpeg::channel_layout::ChannelLayout::default(decoder.channels() as i32)
    } else {
        decoder.channel_layout()
    };

    let target_channel_layout = if target_channels == 1 {
        ffmpeg::channel_layout::ChannelLayout::MONO
    } else {
        ffmpeg::channel_layout::ChannelLayout::STEREO
    };

    let mut resampler = ffmpeg::software::resampling::Context::get(
        decoder.format(),
        input_channel_layout,
        decoder.rate(),
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Packed),
        target_channel_layout,
        target_sample_rate,
    )
    .map_err(|e| format!("Failed to create audio resampler: {e}"))?;

    // Seek if needed
    if config.source_start_ticks > 0 {
        let seek_seconds = config.source_start_ticks as f64 / TICKS_PER_SECOND as f64;
        let seek_ts = (seek_seconds / f64::from(time_base)).round() as i64;
        let _ = ictx.seek(seek_ts, ..seek_ts);
        decoder.flush();
    }

    let mut all_samples = Vec::new();
    let mut decoded_frame = ffmpeg::frame::Audio::empty();
    let mut resampled_frame = ffmpeg::frame::Audio::empty();

    let target_duration_samples = if config.duration_ticks > 0 {
        Some((config.duration_ticks as f64 * target_sample_rate as f64 / TICKS_PER_SECOND as f64) as usize * usize::from(target_channels))
    } else {
        None
    };

    for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }

        if decoder.send_packet(&packet).is_ok() {
            while decoder.receive_frame(&mut decoded_frame).is_ok() {
                if resampler.run(&decoded_frame, &mut resampled_frame).is_ok() {
                    append_valid_samples(
                        &resampled_frame,
                        target_channels,
                        &mut all_samples,
                    )?;
                }
            }
        }

        if let Some(target_len) = target_duration_samples {
            if all_samples.len() >= target_len {
                all_samples.truncate(target_len);
                break;
            }
        }
    }

    // Flush decoder
    if decoder.send_eof().is_ok() {
        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            if resampler.run(&decoded_frame, &mut resampled_frame).is_ok() {
                append_valid_samples(
                    &resampled_frame,
                    target_channels,
                    &mut all_samples,
                )?;
            }
        }
    }

    if all_samples.is_empty() {
        return Err("Audio stream decoded to 0 samples".to_string());
    }

    let actual_duration_ticks = (all_samples.len() as i64 / i64::from(target_channels))
        .saturating_mul(TICKS_PER_SECOND)
        / i64::from(target_sample_rate);

    let mut final_config = config.clone();
    if final_config.duration_ticks <= 0 || final_config.duration_ticks > actual_duration_ticks {
        final_config.duration_ticks = actual_duration_ticks;
    }

    Ok(DecodedAudioClip {
        config: final_config,
        sample_rate: target_sample_rate,
        channels: target_channels,
        samples: all_samples.into(),
    })
}

/// Safely extract ONLY the valid audio samples from a resampled FFmpeg frame.
/// Invariant: `resampled_frame.data(0)` has linesize allocation padding; we must ONLY
/// read `samples * channels` samples to prevent reading uninitialized memory/garbage floats!
#[inline]
fn append_valid_samples(
    resampled_frame: &ffmpeg::frame::Audio,
    target_channels: u16,
    all_samples: &mut Vec<f32>,
) -> Result<(), String> {
    let valid_samples_per_channel = resampled_frame.samples();
    if valid_samples_per_channel == 0 {
        return Ok(());
    }
    let total_valid_samples = valid_samples_per_channel.saturating_mul(usize::from(target_channels));
    let total_valid_bytes = total_valid_samples.saturating_mul(std::mem::size_of::<f32>());

    let raw_plane_data = resampled_frame.data(0);
    let bounded_bytes = if raw_plane_data.len() >= total_valid_bytes {
        &raw_plane_data[..total_valid_bytes]
    } else {
        raw_plane_data
    };

    let (sample_chunks, _) = bounded_bytes.as_chunks::<4>();
    for chunk in sample_chunks {
        let raw = f32::from_le_bytes(*chunk);
        // Nan/Inf & extreme outlier safety clamping
        let clean = if raw.is_finite() {
            raw.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        all_samples.push(clean);
        if all_samples.len() * 4 > MAX_AUDIO_CLIP_BYTES {
            return Err(format!(
                "Decoded audio exceeds maximum {} MiB limit",
                MAX_AUDIO_CLIP_BYTES / 1024 / 1024
            ));
        }
    }
    Ok(())
}

/// Fallback decoder spawning FFmpeg CLI process if needed.
fn decode_with_ffmpeg_cli(
    path: &Path,
    config: &AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    use std::process::{Command, Stdio};

    let mut command = Command::new("ffmpeg");
    command
        .env("PATH", crate::commands::export::augmented_path())
        .arg("-v")
        .arg("error")
        .arg("-nostdin")
        .arg("-threads")
        .arg("1");

    if config.source_start_ticks > 0 {
        let sec = config.source_start_ticks as f64 / TICKS_PER_SECOND as f64;
        command.arg("-ss").arg(format!("{:.6}", sec));
    }

    command
        .arg("-i")
        .arg(path)
        .arg("-vn")
        .arg("-ac")
        .arg(target_channels.to_string())
        .arg("-ar")
        .arg(target_sample_rate.to_string());

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

    let output = command
        .output()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

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

    let actual_duration_ticks = (samples.len() as i64 / i64::from(target_channels))
        .saturating_mul(TICKS_PER_SECOND)
        / i64::from(target_sample_rate);

    let mut final_config = config.clone();
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
