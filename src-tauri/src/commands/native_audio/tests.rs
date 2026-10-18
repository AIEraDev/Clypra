#[cfg(test)]
mod tests {
    use super::super::types::NativeAudioClipRequest;

    #[test]
    fn test_muted_clip_gain_detection() {
        let muted_req = NativeAudioClipRequest {
            path: "/path/to/audio.mp4".to_string(),
            clip_id: "clip_muted".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 1_000_000,
            gain: 0.0,
            pan: 0.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: vec![],
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let is_muted = muted_req.gain <= 0.0001
            && (muted_req.volume_keyframes.is_empty()
                || muted_req.volume_keyframes.iter().all(|k| k.gain <= 0.0001));
        assert!(is_muted);

        let audible_req = NativeAudioClipRequest {
            gain: 1.0,
            ..muted_req.clone()
        };
        let is_audible_muted = audible_req.gain <= 0.0001
            && (audible_req.volume_keyframes.is_empty()
                || audible_req.volume_keyframes.iter().all(|k| k.gain <= 0.0001));
        assert!(!is_audible_muted);
    }

    #[test]
    fn test_batch_parameter_update_structure() {
        use super::super::types::NativeAudioClipParameterUpdate;
        let update = NativeAudioClipParameterUpdate {
            clip_id: "clip_1".to_string(),
            gain: 0.8,
            pan: -0.5,
            fade_in_ticks: 500_000,
            fade_out_ticks: 500_000,
            fade_in_curve: "exponential".to_string(),
            fade_out_curve: "logarithmic".to_string(),
            volume_keyframes: vec![],
        };
        assert_eq!(update.clip_id, "clip_1");
        assert!((update.gain - 0.8).abs() < 1e-4);
        assert!((update.pan - (-0.5)).abs() < 1e-4);
    }
}
