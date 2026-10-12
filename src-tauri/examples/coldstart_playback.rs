use std::env;
use std::time::Duration;
use tauri_app_lib::native_audio::{NativeAudioClock, NativePcmClip, TICKS_PER_SECOND};

fn main() {
    let args: Vec<String> = env::args().collect();
    let duration_secs: f64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(2.0);

    let mut clock = NativeAudioClock::new();

    let start_result = clock.start();
    if let Err(e) = start_result {
        eprintln!("Failed to start native audio clock: {}", e);
        std::process::exit(1);
    }

    let started_status = clock.status();
    let sample_rate = started_status.sample_rate.unwrap_or(44_100) as usize;
    let channels = started_status.channels.unwrap_or(2) as usize;

    // 880 Hz sine wave tone at 0.9 amplitude (loud, clear signal)
    let total_samples = (sample_rate as f64 * duration_secs) as usize * channels;
    let mut samples = Vec::with_capacity(total_samples);
    for i in 0..(total_samples / channels) {
        let t = i as f32 / sample_rate as f32;
        let sample = (2.0 * std::f32::consts::PI * 880.0 * t).sin() * 0.9;
        for _ in 0..channels {
            samples.push(sample);
        }
    }

    let clip = NativePcmClip {
        id: "cold-start-oracle-tone".to_string(),
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

    if let Err(e) = clock.install_clip(clip) {
        eprintln!("Failed to install clip: {}", e);
        std::process::exit(1);
    }

    // Play tone on hardware
    clock.resume();

    // Sleep for the specified duration while hardware outputs audio
    std::thread::sleep(Duration::from_secs_f64(duration_secs));

    let final_status = clock.status();
    clock.pause();
    clock.stop();

    let json_output = serde_json::json!({
        "host": final_status.host,
        "deviceName": final_status.device_name,
        "sampleRate": final_status.sample_rate,
        "channels": final_status.channels,
        "callbacks": final_status.callback_count,
        "renderedFrames": final_status.rendered_frames,
        "nonSilentFrames": final_status.non_silent_frames,
        "audioPositionTicks": final_status.audio_position_ticks,
    });

    println!("{}", json_output);
}
