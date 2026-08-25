//! Streaming audio decoder leveraging ffmpeg-next for high-performance,
//! format-agnostic audio decoding with container parity.

use super::mixer::{AudioClipConfig, DecodedAudioClip, TICKS_PER_SECOND};
use ffmpeg::util::mathematics::{rescale, Rescale};
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
        Ok(clip) if !is_materially_truncated(&clip, &config) => Ok(clip),
        Ok(clip) => {
            // A successful decode with far fewer samples than the requested
            // timeline range is not a usable result. Installing it lets the
            // mixer report an "active" clip that has no PCM after its short
            // buffer ends—the exact failure observed with the 31.8s MP3 that
            // decoded to 0.8s. Use the established FFmpeg CLI decoder as an
            // explicit decoder-backend recovery, not as a playback fallback.
            eprintln!(
                "[native-audio] in-process decoder returned a truncated clip for {:?}: requested={}us decoded={}us; retrying with FFmpeg CLI",
                path,
                config.duration_ticks,
                decoded_duration_ticks(&clip),
            );
            decode_with_ffmpeg_cli(path, &config, target_sample_rate, target_channels)
        }
        Err(err) => {
            eprintln!(
                "[native-audio] in-process decoder failed for {:?}: {}. Retrying with FFmpeg CLI.",
                path, err
            );
            decode_with_ffmpeg_cli(path, &config, target_sample_rate, target_channels)
        }
    }
}

/// The in-process decoder must produce nearly all of a requested clip range.
/// A small tolerance covers encoder delay, packet boundaries, and a clip that
/// genuinely reaches the end of its source. Anything larger is a decode
/// failure, not silence that the mixer should be asked to conceal.
fn is_materially_truncated(clip: &DecodedAudioClip, requested: &AudioClipConfig) -> bool {
    if requested.duration_ticks <= 0 {
        return false;
    }
    let tolerance_ticks = (requested.duration_ticks / 50).max(250_000);
    decoded_duration_ticks(clip) < requested.duration_ticks.saturating_sub(tolerance_ticks)
}

fn decoded_duration_ticks(clip: &DecodedAudioClip) -> i64 {
    (clip.samples.len() as i64 / i64::from(clip.channels.max(1))).saturating_mul(TICKS_PER_SECOND)
        / i64::from(clip.sample_rate.max(1))
}

/// In-process decoding via ffmpeg-next.
fn decode_with_ffmpeg_next(
    path: &Path,
    config: &AudioClipConfig,
    target_sample_rate: u32,
    target_channels: u16,
) -> Result<DecodedAudioClip, String> {
    let mut ictx =
        ffmpeg::format::input(&path).map_err(|e| format!("Failed to open audio input: {e}"))?;

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

    let target_channel_layout = match target_channels {
        1 => ffmpeg::channel_layout::ChannelLayout::MONO,
        2 => ffmpeg::channel_layout::ChannelLayout::STEREO,
        count => ffmpeg::channel_layout::ChannelLayout::default(i32::from(count)),
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

    // `Input::seek` uses FFmpeg's global AV_TIME_BASE because it seeks with
    // stream index -1. Do not pass the audio stream's packet time-base here:
    // for a 48 kHz stream that would turn 55 seconds into 2.64 seconds.
    // The seek may land on a preceding keyframe, so the decode loop below also
    // trims decoded preroll against the requested source timestamp.
    let source_start_ticks = config.source_start_ticks.max(0);
    if config.source_start_ticks > 0 {
        let seek_ts = source_seek_timestamp(source_start_ticks);
        let _ = ictx.seek(seek_ts, ..seek_ts);
        decoder.flush();
    }

    let mut all_samples = Vec::new();
    let mut decoded_frame = ffmpeg::frame::Audio::empty();
    let mut resampled_frame = ffmpeg::frame::Audio::empty();
    let mut next_frame_start_ticks: Option<i64> = None;

    let target_duration_samples = if config.duration_ticks > 0 {
        Some(
            (config.duration_ticks as f64 * target_sample_rate as f64 / TICKS_PER_SECOND as f64)
                as usize
                * usize::from(target_channels),
        )
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
                    let frame_start_ticks = decoded_frame
                        .timestamp()
                        .map(|timestamp| timestamp.rescale(time_base, (1, 1_000_000)))
                        .or(next_frame_start_ticks);
                    let skip_samples = frame_start_ticks
                        .map(|frame_start| {
                            samples_to_skip_before_source_start(
                                frame_start,
                                source_start_ticks,
                                resampled_frame.samples(),
                                target_sample_rate,
                            )
                        })
                        .unwrap_or(0);
                    append_valid_samples(
                        &resampled_frame,
                        target_channels,
                        &mut all_samples,
                        skip_samples,
                    )?;
                    if let Some(frame_start) = frame_start_ticks {
                        next_frame_start_ticks = Some(frame_start.saturating_add(
                            (resampled_frame.samples() as i64).saturating_mul(TICKS_PER_SECOND)
                                / i64::from(target_sample_rate.max(1)),
                        ));
                    }
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
                let frame_start_ticks = decoded_frame
                    .timestamp()
                    .map(|timestamp| timestamp.rescale(time_base, (1, 1_000_000)))
                    .or(next_frame_start_ticks);
                let skip_samples = frame_start_ticks
                    .map(|frame_start| {
                        samples_to_skip_before_source_start(
                            frame_start,
                            source_start_ticks,
                            resampled_frame.samples(),
                            target_sample_rate,
                        )
                    })
                    .unwrap_or(0);
                append_valid_samples(
                    &resampled_frame,
                    target_channels,
                    &mut all_samples,
                    skip_samples,
                )?;
            }
        }
    }

    if all_samples.is_empty() {
        return Err("Audio stream decoded to 0 samples".to_string());
    }

    let mut final_config = config.clone();
    let actual_duration_ticks = (all_samples.len() as i64 / i64::from(target_channels))
        .saturating_mul(TICKS_PER_SECOND)
        / i64::from(target_sample_rate);
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
    skip_samples_per_channel: usize,
) -> Result<(), String> {
    let valid_samples_per_channel = resampled_frame.samples();
    if valid_samples_per_channel == 0 {
        return Ok(());
    }
    let skip_samples_per_channel = skip_samples_per_channel.min(valid_samples_per_channel);
    let samples_to_append_per_channel =
        valid_samples_per_channel.saturating_sub(skip_samples_per_channel);
    if samples_to_append_per_channel == 0 {
        return Ok(());
    }
    let total_valid_samples =
        samples_to_append_per_channel.saturating_mul(usize::from(target_channels));
    let total_valid_bytes = total_valid_samples.saturating_mul(std::mem::size_of::<f32>());

    let raw_plane_data = resampled_frame.data(0);
    let skip_bytes = skip_samples_per_channel
        .saturating_mul(usize::from(target_channels))
        .saturating_mul(std::mem::size_of::<f32>());
    let data_after_skip = raw_plane_data.get(skip_bytes..).unwrap_or_default();
    let bounded_bytes = &data_after_skip[..data_after_skip.len().min(total_valid_bytes)];

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

fn samples_to_skip_before_source_start(
    frame_start_ticks: i64,
    source_start_ticks: i64,
    frame_samples_per_channel: usize,
    target_sample_rate: u32,
) -> usize {
    if frame_start_ticks >= source_start_ticks
        || frame_samples_per_channel == 0
        || target_sample_rate == 0
    {
        return 0;
    }

    let delta_ticks = (source_start_ticks - frame_start_ticks) as i128;
    let numerator = delta_ticks.saturating_mul(i128::from(target_sample_rate));
    let samples = (numerator + i128::from(TICKS_PER_SECOND) - 1) / i128::from(TICKS_PER_SECOND);
    samples.min(frame_samples_per_channel as i128) as usize
}

fn source_seek_timestamp(source_start_ticks: i64) -> i64 {
    source_start_ticks
        .max(0)
        .rescale((1, 1_000_000), rescale::TIME_BASE)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_seek_uses_global_microsecond_time_base() {
        assert_eq!(source_seek_timestamp(55_000_000), 55_000_000);
    }

    #[test]
    fn preroll_samples_are_trimmed_to_the_requested_source_start() {
        assert_eq!(
            samples_to_skip_before_source_start(54_980_000, 55_000_000, 1_024, 48_000),
            960
        );
        assert_eq!(
            samples_to_skip_before_source_start(55_000_000, 55_000_000, 1_024, 48_000),
            0
        );
    }

    #[test]
    fn materially_short_in_process_decode_is_rejected_before_mixer_install() {
        let config = AudioClipConfig {
            id: "mp3".to_string(),
            path: "fixture.mp3".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 31_833_333,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };
        let truncated = DecodedAudioClip {
            config: config.clone(),
            sample_rate: 44_100,
            channels: 2,
            // 0.813 seconds of PCM returned for a requested 31.833 seconds.
            samples: vec![0.0; 71_712].into(),
        };

        assert!(is_materially_truncated(&truncated, &config));
    }

    #[test]
    fn normal_encoder_delay_does_not_trigger_decoder_recovery() {
        let config = AudioClipConfig {
            id: "clip".to_string(),
            path: "fixture.mp3".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 10_000_000,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };
        let complete = DecodedAudioClip {
            config: config.clone(),
            sample_rate: 48_000,
            channels: 2,
            // 9.95 seconds remains inside the two-percent tolerance.
            samples: vec![0.0; 48_000 * 2 * 9 + 45_600 * 2].into(),
        };

        assert!(!is_materially_truncated(&complete, &config));
    }
}
