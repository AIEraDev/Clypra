//! Streaming audio decoder leveraging ffmpeg-next for high-performance,
//! format-agnostic audio decoding with container parity.

pub mod cli_backend;
pub mod constants;
pub mod ffmpeg_backend;
pub mod validation;

#[cfg(test)]
mod tests;

pub use constants::MAX_AUDIO_CLIP_BYTES;

use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip};
use cli_backend::decode_with_ffmpeg_cli;
use ffmpeg_backend::decode_with_ffmpeg_next;
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;
use validation::{decoded_duration_ticks, is_expected_source_end, is_materially_truncated};

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
    // ffmpeg-next's format metadata APIs (including duration probing) require
    // process initialization. The thumbnail decoder initializes its own path,
    // but audio can be the first native media service used in a session.
    // Initialize here so source-end classification does not incorrectly fall
    // through to the CLI recovery path for every late MP3 segment.
    let _ = ffmpeg::init();

    // Attempt FFmpeg in-process decode first
    match decode_with_ffmpeg_next(path, &config, target_sample_rate, target_channels) {
        Ok((clip, _reached_source_end)) if !is_materially_truncated(&clip, &config) => {
            crate::cold_start::add_audio_pcm_bytes((clip.samples.len() * 4) as u64);
            Ok(clip)
        }
        Ok((clip, _reached_source_end)) => {
            let req_ms = (config.duration_ticks.max(0) / 1000) as u64;
            let got_ms = (decoded_duration_ticks(&clip).max(0) / 1000) as u64;
            let shortfall_ms = req_ms.saturating_sub(got_ms);

            // If the source genuinely ended before the requested range, this is valid EOF,
            // not an in-process decode truncation!
            if is_expected_source_end(path, &clip, &config) {
                crate::cold_start::add_audio_pcm_bytes((clip.samples.len() * 4) as u64);
                return Ok(clip);
            }

            let reason = format!(
                "truncated by {} ms (requested {} ms, decoded {} ms)",
                shortfall_ms, req_ms, got_ms
            );
            crate::cold_start::record_audio_cli_fallback(&reason);

            match decode_with_ffmpeg_cli(path, &config, target_sample_rate, target_channels) {
                Ok(recovered) => {
                    crate::cold_start::add_audio_pcm_bytes((recovered.samples.len() * 4) as u64);
                    Ok(recovered)
                }
                Err(error) => Err(error),
            }
        }
        Err(err) => {
            // If there is simply no audio stream in the media container, do not attempt CLI decode.
            if err.contains("No audio stream found") {
                return Ok(DecodedAudioClip {
                    config,
                    sample_rate: target_sample_rate,
                    channels: target_channels,
                    samples: Vec::new().into(),
                });
            }

            // Severe failure in in-process decode (corrupt container, unsupported codec profile)
            // Attempt CLI recovery
            crate::cold_start::record_audio_cli_fallback(&err);
            match decode_with_ffmpeg_cli(path, &config, target_sample_rate, target_channels) {
                Ok(recovered) => {
                    crate::cold_start::add_audio_pcm_bytes((recovered.samples.len() * 4) as u64);
                    Ok(recovered)
                }
                Err(cli_err) => Err(format!(
                    "Audio decode failed (in-process: {err}, cli: {cli_err})"
                )),
            }
        }
    }
}
