#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecoderSeekAction {
    /// Cold start, discontinuity, loop wrap, large backward jump, or large forward jump beyond window.
    Seek,
    /// Forward progress within sequential decode window.
    DecodeForward,
    /// Target is within small backward/forward jitter tolerance; reuse ready frame without seeking or decoding.
    ReuseCurrent,
}

/// Pure decision function determining whether to seek, decode forward, or reuse current position.
pub fn decide_decoder_action(
    is_playback: bool,
    current_pts: i64,
    target_pts: i64,
    pts_tolerance: i64,
    forward_window: i64,
    backward_jitter_threshold: i64,
    generation_changed: bool,
) -> DecoderSeekAction {
    if generation_changed || current_pts < 0 {
        return DecoderSeekAction::Seek;
    }

    let delta = target_pts - current_pts;

    // Forward decision is identical for both modes: small delta → reuse,
    // within window → decode forward, beyond window → seek to keyframe.
    let decide_forward = |delta: i64| -> DecoderSeekAction {
        if delta <= pts_tolerance {
            DecoderSeekAction::ReuseCurrent
        } else if delta <= forward_window {
            DecoderSeekAction::DecodeForward
        } else {
            DecoderSeekAction::Seek
        }
    };

    if delta >= 0 {
        return decide_forward(delta);
    }

    // delta < 0: target is behind current position.
    if !is_playback {
        // Paused seek / scrub: exact frame correctness matters; only allow
        // reuse within pts_tolerance (sub-frame rounding).
        if delta.abs() <= pts_tolerance {
            DecoderSeekAction::ReuseCurrent
        } else {
            DecoderSeekAction::Seek
        }
    } else {
        // Continuous playback: small backward drift is normal clock jitter.
        // `backward_jitter_threshold` is capped at 1 frame duration so the
        // served frame is never more than ~1 frame ahead of target_pts.
        if delta.abs() <= backward_jitter_threshold {
            DecoderSeekAction::ReuseCurrent
        } else {
            // Real backward jump (loop wrap, clip boundary, timeline drag).
            DecoderSeekAction::Seek
        }
    }
}

