use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip, TICKS_PER_SECOND};
use ffmpeg::util::mathematics::Rescale;
use ffmpeg_next as ffmpeg;
use std::path::Path;

/// Return true when a decode is materially truncated relative to its requested
/// duration. Small codec priming differences (100 ms) are tolerated at the
/// start; this guard detects truncated containers where ffmpeg fails to
/// emit at its tail. Keep only a small, codec-boundary allowance; anything
/// beyond it is recovered through the independent FFmpeg CLI decoder before
/// the graph is installed.
pub fn is_materially_truncated(clip: &DecodedAudioClip, requested: &AudioClipConfig) -> bool {
    if requested.duration_ticks <= 0 {
        return false;
    }
    // AAC/MP3 priming and resampler packet boundaries are measured in
    // milliseconds, not percent of the full source duration. 100 ms is
    // deliberately generous while preventing audible end-of-clip gaps.
    const TOLERANCE_TICKS: i64 = 100_000;
    let tolerance_ticks = requested.duration_ticks.min(TOLERANCE_TICKS);
    decoded_duration_ticks(clip) < requested.duration_ticks.saturating_sub(tolerance_ticks)
}

pub fn decoded_duration_ticks(clip: &DecodedAudioClip) -> i64 {
    (clip.samples.len() as i64 / i64::from(clip.channels.max(1))).saturating_mul(TICKS_PER_SECOND)
        / i64::from(clip.sample_rate.max(1))
}

/// Return true when a short decode is explained by the source ending before
/// the requested timeline range. This keeps normal end-of-file clips on the
/// in-process path while preserving recovery for genuine early truncation.
pub fn is_expected_source_end(
    path: &Path,
    clip: &DecodedAudioClip,
    requested: &AudioClipConfig,
) -> bool {
    let Some(source_duration_ticks) = source_duration_ticks(path) else {
        return false;
    };

    is_expected_source_end_for_duration(
        decoded_duration_ticks(clip),
        requested,
        source_duration_ticks,
    )
}

pub fn is_expected_source_end_for_duration(
    decoded_ticks: i64,
    requested: &AudioClipConfig,
    source_duration_ticks: i64,
) -> bool {
    let source_start_ticks = requested.source_start_ticks.max(0);
    let available_ticks = source_duration_ticks.saturating_sub(source_start_ticks);
    let expected_ticks = requested.duration_ticks.max(0).min(available_ticks);
    if expected_ticks <= 0 {
        return false;
    }

    const TOLERANCE_TICKS: i64 = 100_000;
    let tolerance_ticks = expected_ticks.min(TOLERANCE_TICKS);
    decoded_ticks >= expected_ticks.saturating_sub(tolerance_ticks)
}

/// Probe the container duration in FFmpeg's global microsecond time base.
/// Format duration is preferred because it remains available for MP3 streams
/// whose individual stream duration metadata is incomplete.
pub fn source_duration_ticks(path: &Path) -> Option<i64> {
    let ictx = ffmpeg::format::input(path).ok()?;
    let duration = ictx.duration();
    if duration > 0 {
        return Some(duration);
    }

    let stream = ictx.streams().best(ffmpeg::media::Type::Audio)?;
    let stream_duration = stream.duration();
    if stream_duration <= 0 {
        return None;
    }

    Some(stream_duration.rescale(stream.time_base(), (1, 1_000_000)))
}
