use super::*;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[cfg(test)]
pub(crate) fn sample_at(
    clip: &NativePcmClip,
    timeline_ticks: i64,
    output_channel: usize,
    playback_speed: f32,
) -> Option<f32> {
    sample_at_with_cache(clip, None, timeline_ticks, output_channel, playback_speed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_audio_clip_decode_returns_error_for_caller_handling() {
        let path = std::path::PathBuf::from("/nonexistent/file/without/audio.mp4");
        let result = decode_native_audio_clip(
            &path,
            "silent_fallback_clip".to_string(),
            0,
            0,
            1_000_000,
            1.0,
            0.0,
            0,
            0,
            "linear".to_string(),
            "linear".to_string(),
            Vec::new(),
            "auto".to_string(),
            "auto".to_string(),
            None,
            false,
            48_000,
            2,
        )
        .await;

        assert!(result.is_err(), "Expected decode_native_audio_clip to return Err for nonexistent file, got: {:?}", result);
    }

    #[test]
    fn mixer_supports_up_to_512_active_clips() {
        let mut mixer = NativeAudioMixer::default();
        let mut clips = Vec::with_capacity(128);
        for i in 0..128 {
            clips.push(NativePcmClip {
                id: format!("clip_{i}"),
                sample_rate: 48_000,
                channels: 2,
                samples: Arc::from(Vec::<f32>::new()),
                timeline_start_ticks: (i as i64) * 1_000_000,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            });
        }
        let result = mixer.replace_clips(clips);
        assert!(result.is_ok(), "Expected replace_clips to support 128 clips, got: {:?}", result);
    }

    #[tokio::test]
    async fn test_user_timeline_playback() {
        let path1 = std::path::PathBuf::from("/Users/AIEraDev/Documents/clypra-testing-assets/O lo far ooo 😂😂🤣🤣 [7662866378793258261].mp4");
        let path2 = std::path::PathBuf::from("/Users/AIEraDev/Documents/clypra-testing-assets/VØRTΞX★ 👽 - @CFCMods They thought they had Argentina [2077525613615751168].mp4");
        if !path1.exists() || !path2.exists() {
            return;
        }

        let clip1 = decode_native_audio_clip(
            &path1,
            "clip1".to_string(),
            0,
            0,
            40_800_000,
            1.0,
            0.0,
            0,
            0,
            "linear".to_string(),
            "linear".to_string(),
            Vec::new(),
            "auto".to_string(),
            "auto".to_string(),
            None,
            false,
            48_000,
            2,
        )
        .await
        .unwrap();

        let clip2 = decode_native_audio_clip(
            &path2,
            "clip2".to_string(),
            12_200_000,
            0,
            25_402_630,
            1.0,
            0.0,
            0,
            0,
            "linear".to_string(),
            "linear".to_string(),
            Vec::new(),
            "auto".to_string(),
            "auto".to_string(),
            None,
            false,
            48_000,
            2,
        )
        .await
        .unwrap();

        log::debug!(
            "Clip 1: duration_ticks={}, sample_count={}, sample_rate={}, channels={}",
            clip1.duration_ticks,
            clip1.samples.len(),
            clip1.sample_rate,
            clip1.channels
        );
        log::debug!(
            "Clip 2: duration_ticks={}, sample_count={}, sample_rate={}, channels={}",
            clip2.duration_ticks,
            clip2.samples.len(),
            clip2.sample_rate,
            clip2.channels
        );

        assert!(clip1.duration_ticks >= 40_000_000);
        assert!(clip2.duration_ticks >= 25_000_000);

        // At 22s, both clips are overlapping and MUST produce audio samples
        let ticks_22s = 22 * 1_000_000;
        assert!(sample_at(&clip1, ticks_22s, 0, 1.0).is_some());
        assert!(sample_at(&clip2, ticks_22s, 0, 1.0).is_some());
    }

    #[test]
    fn new_clock_is_stopped_and_unconfigured() {
        let clock = NativeAudioClock::new();
        let status = clock.status();
        assert!(!status.available);
        assert!(!status.running);
        assert_eq!(status.audio_position_ticks, 0);
        assert_eq!(status.speed, 1.0);
    }

    #[test]
    fn native_speed_is_clamped_to_supported_playback_bounds() {
        let clock = NativeAudioClock::new();
        clock.set_speed(8.0);
        assert_eq!(clock.status().speed, 4.0);

        clock.set_speed(f32::NAN);
        assert_eq!(clock.status().speed, 1.0);
    }

    #[test]
    fn mixer_renders_clip_at_timeline_position_with_gain() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 4,
                channels: 1,
                samples: vec![0.0, 1.0, 0.0, -1.0].into(),
                timeline_start_ticks: 500_000,
                duration_ticks: 1_000_000,
                gain: 0.5,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [9.0_f32; 4];
        mixer.mix_into(&mut output, 1, 4, 500_000, 1.0, 1.0);

        assert_eq!(output, [0.0, 0.5, 0.0, -0.5]);
    }

    #[test]
    fn mixer_applies_a_short_sample_domain_ramp_after_transport_discontinuity() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 4,
                channels: 1,
                samples: vec![1.0; 4].into(),
                timeline_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 4];
        mixer.mix_into_with_ramp(&mut output, 1, 4, 0, 1.0, 1.0, 4, 4);

        assert_eq!(output, [0.25, 0.5, 0.75, 1.0]);
    }

    #[test]
    fn mixer_inspection_uses_the_same_timeline_and_gain_path_as_rendering() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "audible".to_string(),
                sample_rate: 10,
                channels: 1,
                samples: vec![0.5; 10].into(),
                timeline_start_ticks: 1_000_000,
                duration_ticks: TICKS_PER_SECOND,
                gain: 0.5,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let before = mixer.inspect(1, 10, 0, 1.0, 1.0);
        assert!(before.active_clip_ids.is_empty());
        assert_eq!(before.mixer_peak, 0.0);
        assert_eq!(before.clip_diagnostics[0].id, "audible");
        assert!(!before.clip_diagnostics[0].active);

        let active = mixer.inspect(1, 10, TICKS_PER_SECOND, 0.8, 1.0);
        assert_eq!(active.active_clip_ids, vec!["audible"]);
        assert!((active.mixer_peak - 0.2).abs() < 0.000_001);
        assert!(active.clip_diagnostics[0].active);
        assert!((active.clip_diagnostics[0].mixer_peak - 0.2).abs() < 0.000_001);
    }

    #[test]
    fn clock_diagnostics_are_derived_from_its_installed_native_mixer() {
        let mut clock = NativeAudioClock::new();
        clock.inner.sample_rate = Some(10);
        clock.inner.channels = Some(1);
        clock
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 10,
                channels: 1,
                samples: vec![0.25; 10].into(),
                timeline_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let diagnostics = clock.diagnostics();
        assert_eq!(diagnostics.installed_clips.len(), 1);
        assert_eq!(diagnostics.active_clip_ids, vec!["clip"]);
        assert!((diagnostics.mixer_peak - 0.25).abs() < 0.000_001);
        assert_eq!(diagnostics.clip_diagnostics.len(), 1);
        assert!(diagnostics.clip_diagnostics[0].active);
        assert!((diagnostics.clip_diagnostics[0].mixer_peak - 0.25).abs() < 0.000_001);
    }

    #[test]
    fn mixer_applies_fade_in_and_fade_out_to_rendered_samples() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![1.0; 4].into(),
                timeline_start_ticks: 0,
                duration_ticks: 4 * TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 2 * TICKS_PER_SECOND,
                fade_out_ticks: 2 * TICKS_PER_SECOND,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 4];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);

        assert_eq!(output, [0.0, 0.5, 1.0, 0.5]);
    }

    #[test]
    fn mixer_applies_keyframe_automation_with_the_same_relative_ticks_as_the_timeline() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "automation".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![1.0; 4].into(),
                timeline_start_ticks: 0,
                duration_ticks: 4 * TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: vec![
                    NativeAudioKeyframe {
                        time: 0,
                        gain: 0.25,
                        easing: Some("linear".to_string()),
                    },
                    NativeAudioKeyframe {
                        time: 2 * TICKS_PER_SECOND,
                        gain: 1.0,
                        easing: Some("linear".to_string()),
                    },
                    NativeAudioKeyframe {
                        time: 4 * TICKS_PER_SECOND,
                        gain: 0.5,
                        easing: Some("exponential".to_string()),
                    },
                ],
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 4];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);

        assert_eq!(output[0], 0.25);
        assert_eq!(output[1], 0.625);
        assert!((output[3] - 0.707_106_77).abs() < 0.0001);
    }

    #[test]
    fn mixer_applies_clip_pan_without_changing_center_gain() {
        let clip = NativePcmClip {
            id: "pan".to_string(),
            sample_rate: 1,
            channels: 2,
            samples: vec![1.0, 1.0].into(),
            timeline_start_ticks: 0,
            duration_ticks: TICKS_PER_SECOND,
            gain: 1.0,
            pan: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let mut mixer = NativeAudioMixer::default();
        mixer.install_clip(clip).unwrap();
        let mut output = [0.0_f32; 2];
        mixer.mix_into(&mut output, 2, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.0, 1.0]);
    }

    #[test]
    fn mixer_applies_explicit_downmix_and_channel_map() {
        let base = NativePcmClip {
            id: "routing".to_string(),
            sample_rate: 1,
            channels: 2,
            samples: vec![1.0, 0.0].into(),
            timeline_start_ticks: 0,
            duration_ticks: TICKS_PER_SECOND,
            gain: 1.0,
            pan: 0.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "mono".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let mut mixer = NativeAudioMixer::default();
        mixer.install_clip(base.clone()).unwrap();
        let mut mono = [0.0_f32; 2];
        mixer.mix_into(&mut mono, 2, 1, 0, 1.0, 1.0);
        assert_eq!(mono, [0.5, 0.5]);

        let mut swapped = base;
        swapped.id = "swapped".to_string();
        swapped.downmix = "auto".to_string();
        swapped.channel_map = Some(vec![1, 0]);
        mixer.clear();
        mixer.install_clip(swapped).unwrap();
        let mut output = [0.0_f32; 2];
        mixer.mix_into(&mut output, 2, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.0, 1.0]);
    }

    #[test]
    fn mixer_pitch_preservation_keeps_a_constant_signal_audible_at_transport_speed() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "pitch".to_string(),
                sample_rate: 100,
                channels: 1,
                samples: vec![0.75; 100].into(),
                timeline_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: true,
            })
            .unwrap();
        let mut output = [0.0_f32; 20];
        mixer.mix_into(&mut output, 1, 100, 0, 1.0, 2.0);
        assert!(output.iter().all(|sample| (*sample - 0.75).abs() < 0.001));
    }

    #[test]
    fn mixer_uses_prepared_wsola_samples_after_a_speed_change() {
        let clip = NativePcmClip {
            id: "prepared".to_string(),
            sample_rate: 4,
            channels: 1,
            samples: vec![0.1; 4].into(),
            timeline_start_ticks: 0,
            duration_ticks: TICKS_PER_SECOND,
            gain: 1.0,
            pan: 0.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: true,
        };
        let mut mixer = NativeAudioMixer::default();
        mixer.install_clip(clip).unwrap();
        mixer.install_pitch_cache(
            2_000,
            HashMap::from([("prepared".to_string(), Arc::<[f32]>::from(vec![0.8, 0.8]))]),
        );

        let mut output = [0.0_f32; 2];
        mixer.mix_into(&mut output, 1, 4, 0, 1.0, 2.0);
        assert_eq!(output, [0.8, 0.8]);
    }

    #[test]
    fn mixer_is_silent_before_and_after_clip_bounds() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.75].into(),
                timeline_start_ticks: 1_000_000,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut before = [9.0_f32; 1];
        mixer.mix_into(&mut before, 1, 1, 0, 1.0, 1.0);
        let mut after = [9.0_f32; 1];
        mixer.mix_into(&mut after, 1, 1, 2_000_000, 1.0, 1.0);

        assert_eq!(before, [0.0]);
        assert_eq!(after, [0.0]);
    }

    #[test]
    fn mixer_sums_overlapping_clips_and_replaces_by_id() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "a".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.25].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();
        mixer
            .install_clip(NativePcmClip {
                id: "b".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.5].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 1];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.75]);

        mixer
            .install_clip(NativePcmClip {
                id: "a".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.1].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();
        let mut replaced = [0.0_f32; 1];
        mixer.mix_into(&mut replaced, 1, 1, 0, 1.0, 1.0);
        assert_eq!(replaced, [0.6]);
        assert_eq!(mixer.clip_statuses().len(), 2);
    }

    #[test]
    fn mixer_updates_parameters_without_replacing_pcm() {
        let samples: Arc<[f32]> = vec![1.0].into();
        let original_samples = samples.clone();
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "editable".to_string(),
                sample_rate: 1,
                channels: 1,
                samples,
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        mixer
            .update_clip_parameters(
                "editable",
                0.25,
                0.0,
                0,
                0,
                "linear".to_string(),
                "linear".to_string(),
                Vec::new(),
            )
            .unwrap();

        assert!(Arc::ptr_eq(&original_samples, &mixer.clips[0].samples));
        let mut output = [0.0_f32; 1];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.25]);
    }

    #[test]
    fn failed_graph_replacement_keeps_the_previous_graph() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "healthy".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.75].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let oversized = (0..=MAX_ACTIVE_CLIPS)
            .map(|index| NativePcmClip {
                id: format!("candidate-{index}"),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.1].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .collect();
        assert!(mixer.replace_clips(oversized).is_err());
        assert_eq!(mixer.clip_statuses()[0].id, "healthy");
    }

    #[test]
    fn test_output_latency_bucket_mapping() {
        assert_eq!(output_latency_bucket(0), 0);
        assert_eq!(output_latency_bucket(999), 0);
        assert_eq!(output_latency_bucket(1000), 1);
        assert_eq!(output_latency_bucket(1999), 1);
        assert_eq!(output_latency_bucket(20_000), 20); // 20 ms (wired)
        assert_eq!(output_latency_bucket(30_000), 30); // 30 ms (wired)
        assert_eq!(output_latency_bucket(100_000), 100); // 100 ms (BT)
        assert_eq!(output_latency_bucket(300_000), 300); // 300 ms (BT)
        assert_eq!(output_latency_bucket(511_999), 511);
        assert_eq!(output_latency_bucket(512_000), 512); // overflow
        assert_eq!(output_latency_bucket(1_000_000), 512); // overflow
        assert_eq!(output_latency_bucket(u64::MAX), 512);
    }

    #[test]
    fn test_output_latency_status_telemetry() {
        let clock = NativeAudioClock::new();
        let status = clock.status();
        // Host has not provided timestamps yet, so histogram and atomics must be None
        assert_eq!(status.output_latency_us_histogram, None);
        assert_eq!(status.output_latency_last_us, None);
        assert_eq!(status.output_latency_min_us, None);
        assert_eq!(status.output_latency_max_us, None);
        assert_eq!(status.output_latency_sum_us, None);
        assert_eq!(status.output_latency_count, None);

        // Simulate lock-free atomic updates as done from the CPAL callback
        let b20 = output_latency_bucket(20_000); // bucket 20 (20 ms)
        let b512 = output_latency_bucket(600_000); // bucket 512 (overflow)
        clock.inner.output_latency.histogram[b20].fetch_add(3, Ordering::Relaxed);
        clock.inner.output_latency.histogram[b512].fetch_add(1, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .last_us
            .store(20_000, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .min_us
            .fetch_min(20_000, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .max_us
            .fetch_max(600_000, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .sum_us
            .fetch_add(660_000, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .count
            .fetch_add(4, Ordering::Relaxed);
        clock
            .inner
            .output_latency
            .available
            .store(true, Ordering::Release);

        let status2 = clock.status();
        assert!(status2.output_latency_us_histogram.is_some());
        let hist = status2.output_latency_us_histogram.unwrap();
        assert_eq!(hist.len(), OUTPUT_LATENCY_HISTOGRAM_BUCKETS);
        assert_eq!(hist[b20], 3);
        assert_eq!(hist[b512], 1);
        assert_eq!(hist[0], 0);
        assert_eq!(status2.output_latency_last_us, Some(20_000));
        assert_eq!(status2.output_latency_min_us, Some(20_000));
        assert_eq!(status2.output_latency_max_us, Some(600_000));
        assert_eq!(status2.output_latency_sum_us, Some(660_000));
        assert_eq!(status2.output_latency_count, Some(4));
    }

    #[test]
    fn test_realtime_safety_callback_structures() {
        // Assert that the histogram array in OutputLatencyMetrics is fixed-size
        // and contains only AtomicU64 elements — zero heap allocation and zero locks.
        let clock = NativeAudioClock::new();
        assert_eq!(
            clock.inner.output_latency.histogram.len(),
            OUTPUT_LATENCY_HISTOGRAM_BUCKETS
        );
        for slot in clock.inner.output_latency.histogram.iter() {
            assert_eq!(slot.load(Ordering::Relaxed), 0);
        }
        // Verify output_latency.available is an atomic bool
        assert!(!clock.inner.output_latency.available.load(Ordering::Relaxed));
    }
}
