use tauri_app_lib::native_audio::TICKS_PER_SECOND;

#[test]
fn test_ten_minute_audio_clock_zero_drift_at_44100hz() {
    let sample_rate: u32 = 44_100;
    let target_duration_secs: f64 = 600.0; // 10 minutes
    let target_ticks: i64 = (target_duration_secs * TICKS_PER_SECOND as f64) as i64; // 600,000,000 us

    // Simulate 10 minutes of audio callbacks with typical buffer size 512
    let frames_per_callback: u32 = 512;
    let total_frames: u64 = (target_duration_secs * sample_rate as f64).round() as u64; // 26,460,000 frames

    let mut accumulated_ticks: i64 = 0;
    let mut tick_remainder: i64 = 0;
    let mut rendered_frames: u64 = 0;

    let speed_milli: u32 = 1_000; // 1.0x speed
    let denominator = i64::from(sample_rate).saturating_mul(1_000);

    while rendered_frames < total_frames {
        let frames = frames_per_callback.min((total_frames - rendered_frames) as u32);
        rendered_frames += frames as u64;

        let total_numerator = (frames as i64)
            .saturating_mul(TICKS_PER_SECOND)
            .saturating_mul(i64::from(speed_milli))
            + tick_remainder;
        let elapsed_ticks = total_numerator / denominator;
        tick_remainder = total_numerator % denominator;
        accumulated_ticks += elapsed_ticks;
    }

    let drift_us = (accumulated_ticks - target_ticks).abs();
    println!("--- 10-Minute Audio Clock Drift (44.1 kHz) ---");
    println!("Target Ticks:      {} µs (600.000s)", target_ticks);
    println!("Accumulated Ticks: {} µs", accumulated_ticks);
    println!("Total Drift:       {} µs ({:.6} ms)", drift_us, drift_us as f64 / 1000.0);

    // Invariant: Drift across 10 minutes must be strictly <= 1 microsecond
    assert!(
        drift_us <= 1,
        "Audio clock drifted by {} µs over 10 minutes (must be <= 1 µs)",
        drift_us
    );
}

#[test]
fn test_ten_minute_audio_clock_zero_drift_at_48000hz() {
    let sample_rate: u32 = 48_000;
    let target_duration_secs: f64 = 600.0;
    let target_ticks: i64 = (target_duration_secs * TICKS_PER_SECOND as f64) as i64;

    let frames_per_callback: u32 = 256;
    let total_frames: u64 = (target_duration_secs * sample_rate as f64).round() as u64;

    let mut accumulated_ticks: i64 = 0;
    let mut tick_remainder: i64 = 0;
    let mut rendered_frames: u64 = 0;

    let speed_milli: u32 = 1_000;
    let denominator = i64::from(sample_rate).saturating_mul(1_000);

    while rendered_frames < total_frames {
        let frames = frames_per_callback.min((total_frames - rendered_frames) as u32);
        rendered_frames += frames as u64;

        let total_numerator = (frames as i64)
            .saturating_mul(TICKS_PER_SECOND)
            .saturating_mul(i64::from(speed_milli))
            + tick_remainder;
        let elapsed_ticks = total_numerator / denominator;
        tick_remainder = total_numerator % denominator;
        accumulated_ticks += elapsed_ticks;
    }

    let drift_us = (accumulated_ticks - target_ticks).abs();
    println!("--- 10-Minute Audio Clock Drift (48.0 kHz) ---");
    println!("Target Ticks:      {} µs (600.000s)", target_ticks);
    println!("Accumulated Ticks: {} µs", accumulated_ticks);
    println!("Total Drift:       {} µs ({:.6} ms)", drift_us, drift_us as f64 / 1000.0);

    assert!(drift_us <= 1, "Audio clock drifted by {} µs at 48kHz", drift_us);
}

#[test]
fn test_ten_minute_video_vs_audio_frame_alignment() {
    // 10 minutes @ 30 fps = exactly 18,000 frames
    let total_video_frames: u32 = 18_000;
    let video_fps: f64 = 30.0;
    let sample_rate: u32 = 44_100;

    // Compare video frame time against audio position ticks at every 30th frame (every 1 second)
    for frame_idx in (0..=total_video_frames).step_by(30) {
        let video_time_secs = frame_idx as f64 / video_fps;
        let video_time_ticks = (video_time_secs * TICKS_PER_SECOND as f64).round() as i64;

        // Exact audio samples elapsed for this duration
        let audio_samples = (video_time_secs * sample_rate as f64).round() as u64;
        let audio_ticks = (audio_samples as i128 * TICKS_PER_SECOND as i128 / sample_rate as i128) as i64;

        let diff_us = (video_time_ticks - audio_ticks).abs();
        // At second intervals, time code math must agree within 1 tick (1 microsecond)
        assert!(
            diff_us <= 1,
            "Video frame {} and audio samples {} drifted by {} µs at time {:.3}s",
            frame_idx,
            audio_samples,
            diff_us,
            video_time_secs
        );
    }
}
