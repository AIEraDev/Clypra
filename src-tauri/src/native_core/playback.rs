use super::{FrameTime, NativeCoreError, PlaybackPlan};

pub const MAX_AV_DRIFT_TICKS_AT_1MHZ: i64 = 16_000;
pub const VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ: i64 = 60_000;
pub const MIN_AUDIO_BUFFER_TICKS_AT_1MHZ: i64 = 100_000;
pub const MAX_VIDEO_LOOKAHEAD_TICKS_AT_1MHZ: i64 = 200_000;

/// Resolve the frame covering the current audio-clock interval.
///
/// The native playback session will use the device sample clock as its source
/// of truth. This helper keeps the frame-index mapping integer based at the
/// contract boundary and is also used by deterministic playback tests.
pub fn frame_for_audio_position(
    audio_position: FrameTime,
    plan: &PlaybackPlan,
) -> Result<u64, NativeCoreError> {
    if plan.contract_version == 0 || plan.frame_rate == 0 {
        return Err(NativeCoreError::InvalidContract(
            "PlaybackPlan requires a valid contract version and frame rate".to_string(),
        ));
    }
    if audio_position.timescale == 0 {
        return Err(NativeCoreError::InvalidContract(
            "Playback position timescale must be non-zero".to_string(),
        ));
    }

    let seconds = audio_position.ticks.max(0) as u128;
    let numerator = seconds.saturating_mul(plan.frame_rate as u128);
    let frame = numerator / audio_position.timescale as u128;
    Ok(frame.min(plan.duration_frames.saturating_sub(1) as u128) as u64)
}

pub fn is_video_late(
    audio_position: FrameTime,
    frame_time: FrameTime,
) -> Result<bool, NativeCoreError> {
    if audio_position.timescale == 0 || frame_time.timescale == 0 {
        return Err(NativeCoreError::InvalidContract(
            "Playback frame timescales must be non-zero".to_string(),
        ));
    }
    let audio_us = audio_position.ticks as i128 * 1_000_000 / audio_position.timescale as i128;
    let frame_us = frame_time.ticks as i128 * 1_000_000 / frame_time.timescale as i128;
    Ok(audio_us - frame_us > VIDEO_DROP_THRESHOLD_TICKS_AT_1MHZ as i128)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NATIVE_CORE_CONTRACT_VERSION;

    fn plan() -> PlaybackPlan {
        PlaybackPlan {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            project_revision: "project:1".to_string(),
            frame_rate: 30,
            duration_frames: 300,
            audio_track_count: 1,
        }
    }

    #[test]
    fn maps_audio_position_to_integer_frame() {
        let position = FrameTime::new(0, 500_000, 1_000_000).unwrap();
        assert_eq!(frame_for_audio_position(position, &plan()).unwrap(), 15);
    }

    #[test]
    fn clamps_frame_at_timeline_end() {
        let position = FrameTime::new(0, 100_000_000, 1_000_000).unwrap();
        assert_eq!(frame_for_audio_position(position, &plan()).unwrap(), 299);
    }

    #[test]
    fn marks_late_video_for_drop() {
        let audio = FrameTime::new(0, 100_000, 1_000_000).unwrap();
        let frame = FrameTime::new(0, 30_000, 1_000_000).unwrap();
        assert!(is_video_late(audio, frame).unwrap());
    }
}
