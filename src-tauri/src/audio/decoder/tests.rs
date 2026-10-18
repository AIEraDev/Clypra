#[cfg(test)]
mod tests {
    use super::super::ffmpeg_backend::{samples_to_skip_before_source_start, source_seek_timestamp};
    use super::super::validation::{
        decoded_duration_ticks, is_expected_source_end_for_duration, is_materially_truncated,
    };
    use super::super::decode_audio_clip_sync;
    use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip};

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
    fn sub_packet_encoder_delay_does_not_trigger_decoder_recovery() {
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
            // 9.95 seconds remains inside the 100 ms codec-boundary tolerance.
            samples: vec![0.0; 48_000 * 2 * 9 + 45_600 * 2].into(),
        };

        assert!(!is_materially_truncated(&complete, &config));
    }

    #[test]
    fn audible_tail_gap_triggers_decoder_recovery_regardless_of_clip_length() {
        let config = AudioClipConfig {
            id: "long-aac".to_string(),
            path: "fixture.mp4".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 83_114_667,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };
        let truncated = DecodedAudioClip {
            config: config.clone(),
            sample_rate: 44_100,
            channels: 2,
            // An 80-second decode formerly passed the two-percent test for
            // sufficiently long sources, leaving a reproducible silent tail.
            samples: vec![0.0; 80 * 44_100 * 2].into(),
        };

        assert!(is_materially_truncated(&truncated, &config));
    }

    #[test]
    fn short_decode_is_accepted_when_requested_range_reaches_source_end() {
        let config = AudioClipConfig {
            id: "mp3".to_string(),
            path: "fixture.mp3".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 274_200_000,
            duration_ticks: 63_500_000,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };
        let clip = DecodedAudioClip {
            config: config.clone(),
            sample_rate: 44_100,
            channels: 2,
            // Approximately the 11.66 seconds remaining in a 285.86 second
            // source after the requested source offset.
            samples: vec![0.0; 44_100 * 2 * 11 + 29_106 * 2].into(),
        };

        assert!(is_expected_source_end_for_duration(
            decoded_duration_ticks(&clip),
            &config,
            285_857_143,
        ));
    }

    #[test]
    fn short_decode_is_not_accepted_when_source_has_more_audio() {
        let config = AudioClipConfig {
            id: "mp3".to_string(),
            path: "fixture.mp3".to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 63_500_000,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };

        assert!(!is_expected_source_end_for_duration(
            11_663_673,
            &config,
            285_857_143,
        ));
    }

    #[test]
    #[ignore = "requires local /Users/Shared/clypra-fixtures/clip_1440p25_gop1s.mp4"]
    fn fixture_audio_decodes_in_process_without_cli_fallback() {
        let path = std::path::Path::new("/Users/Shared/clypra-fixtures/clip_1440p25_gop1s.mp4");
        if !path.exists() {
            eprintln!("[SKIP] Fixture not found at {:?}", path);
            return;
        }
        let config = AudioClipConfig {
            id: "fixture_60".to_string(),
            path: path.to_str().unwrap().to_string(),
            timeline_start_ticks: 0,
            source_start_ticks: 0,
            duration_ticks: 60_000_000,
            gain: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            track_id: None,
        };
        let decoded = decode_audio_clip_sync(path, config.clone(), 44_100, 2)
            .expect("in-process decode must succeed for fixture");
        assert!(decoded.samples.len() > 0, "must produce valid PCM samples");
        assert!(!is_materially_truncated(&decoded, &config));
    }
}
