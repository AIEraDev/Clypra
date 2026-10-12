use std::time::Duration;
use tauri_app_lib::native_audio::{NativeAudioClock, NativePcmClip, TICKS_PER_SECOND};

#[test]
fn test_m1_cold_start_playback_stream_and_non_silent_callbacks() {
    let mut clock = NativeAudioClock::new();

    // 1. Initial state: stopped
    let initial_status = clock.status();
    assert!(!initial_status.running);
    assert!(!initial_status.playing);
    assert_eq!(initial_status.callback_count, 0);
    assert_eq!(initial_status.rendered_frames, 0);
    assert_eq!(initial_status.non_silent_frames, 0);

    // 2. Start hardware audio stream
    let start_result = clock.start();
    if let Err(ref e) = start_result {
        eprintln!(
            "⚠️ Skipping hardware audio playback audit: no native audio output device available on this host: {:?}",
            e
        );
        return;
    }

    let started_status = clock.status();
    assert!(started_status.available, "Audio stream should be available");
    assert!(started_status.running, "Audio stream should be running");

    let sample_rate = started_status.sample_rate.unwrap_or(48_000) as usize;
    let channels = started_status.channels.unwrap_or(2) as usize;

    // 3. Generate a 2.0-second 880 Hz sine wave tone
    let duration_secs = 2.0;
    let total_samples = (sample_rate as f64 * duration_secs) as usize * channels;
    let mut samples = Vec::with_capacity(total_samples);
    for i in 0..(total_samples / channels) {
        let t = i as f32 / sample_rate as f32;
        let sample = (2.0 * std::f32::consts::PI * 880.0 * t).sin() * 0.8;
        for _ in 0..channels {
            samples.push(sample);
        }
    }

    let clip = NativePcmClip {
        id: "cold-start-test-tone".to_string(),
        sample_rate: sample_rate as u32,
        channels: channels as u16,
        samples: samples.into(),
        timeline_start_ticks: 0,
        duration_ticks: (duration_secs * TICKS_PER_SECOND as f64) as i64,
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
    };

    assert!(clock.install_clip(clip).is_ok());

    // 4. Resume playback on hardware
    clock.resume();

    // Sleep to allow CoreAudio callbacks to physically execute on the audio thread
    std::thread::sleep(Duration::from_millis(500));

    let playing_status = clock.status();
    println!("--- M1 Cold-Start Live Playback Telemetry ---");
    println!("Host: {:?}", playing_status.host);
    println!("Device: {:?}", playing_status.device_name);
    println!("Sample Rate: {:?}", playing_status.sample_rate);
    println!("Channels: {:?}", playing_status.channels);
    println!("Callbacks: {}", playing_status.callback_count);
    println!("Rendered Frames: {}", playing_status.rendered_frames);
    println!("Non-Silent Frames: {}", playing_status.non_silent_frames);
    println!("Audio Position Ticks: {}", playing_status.audio_position_ticks);

    // Hardware verification assertions:
    assert!(
        playing_status.callback_count > 0,
        "CoreAudio hardware callback must have fired"
    );
    assert!(
        playing_status.rendered_frames > 0,
        "Audio engine must have rendered PCM frames to hardware"
    );
    assert!(
        playing_status.non_silent_frames > 0,
        "Hardware output must be non-silent"
    );
    assert!(
        playing_status.audio_position_ticks > 0,
        "Hardware position ticks must advance"
    );

    // Clean pause and stop
    clock.pause();
    clock.stop();
}
