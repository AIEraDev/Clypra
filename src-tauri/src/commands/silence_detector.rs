// src-tauri/src/commands/silence_detector.rs
// On-device audio silence detection and AI jump-cut engine

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceRange {
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeepRange {
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpCutPlan {
    pub total_duration: f64,
    pub removed_duration: f64,
    pub silence_ranges: Vec<SilenceRange>,
    pub keep_ranges: Vec<KeepRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilenceDetectionOptions {
    /// Silence dB threshold (e.g. -35.0 dBFS). Samples below this are considered silent.
    pub threshold_db: f64,
    /// Minimum silence duration in seconds to trigger a cut (e.g. 0.35s).
    pub min_silence_duration: f64,
    /// Safety padding before speech in seconds (e.g. 0.05s).
    pub pre_roll: f64,
    /// Safety padding after speech in seconds (e.g. 0.05s).
    pub post_roll: f64,
}

impl Default for SilenceDetectionOptions {
    fn default() -> Self {
        Self {
            threshold_db: -35.0,
            min_silence_duration: 0.35,
            pre_roll: 0.05,
            post_roll: 0.05,
        }
    }
}

/// Computes the Root Mean Square (RMS) of PCM audio samples
pub fn compute_rms(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt()
}

/// Converts linear RMS amplitude [0.0..1.0] to Decibels Full Scale (dBFS)
pub fn rms_to_db(rms: f64) -> f64 {
    if rms <= 1e-7 {
        -140.0
    } else {
        20.0 * rms.log10()
    }
}

/// Detects silence and generates keep/cut ranges from PCM audio samples
pub fn analyze_audio_silence(
    samples: &[f32],
    sample_rate: u32,
    options: &SilenceDetectionOptions,
) -> JumpCutPlan {
    if samples.is_empty() || sample_rate == 0 {
        return JumpCutPlan {
            total_duration: 0.0,
            removed_duration: 0.0,
            silence_ranges: Vec::new(),
            keep_ranges: Vec::new(),
        };
    }

    let total_duration = samples.len() as f64 / sample_rate as f64;
    // Analysis window: 25ms
    let window_size = (sample_rate as f64 * 0.025).round() as usize;
    let hop_size = window_size / 2;

    if window_size == 0 || samples.len() < window_size {
        return JumpCutPlan {
            total_duration,
            removed_duration: 0.0,
            silence_ranges: Vec::new(),
            keep_ranges: vec![KeepRange {
                start_time: 0.0,
                end_time: total_duration,
                duration: total_duration,
            }],
        };
    }

    // Step 1: Compute windowed dB energy levels
    let mut frame_times: Vec<f64> = Vec::new();
    let mut is_silent_frames: Vec<bool> = Vec::new();

    let mut start = 0;
    while start + window_size <= samples.len() {
        let frame = &samples[start..start + window_size];
        let rms = compute_rms(frame);
        let db = rms_to_db(rms);

        let time = start as f64 / sample_rate as f64;
        frame_times.push(time);
        is_silent_frames.push(db < options.threshold_db);

        start += hop_size;
    }

    // Step 2: Group contiguous silent frames
    let mut raw_silence_ranges: Vec<(f64, f64)> = Vec::new();
    let mut in_silence = false;
    let mut silence_start = 0.0;

    for (i, &is_silent) in is_silent_frames.iter().enumerate() {
        let time = frame_times[i];
        if is_silent && !in_silence {
            in_silence = true;
            silence_start = time;
        } else if !is_silent && in_silence {
            in_silence = false;
            let duration = time - silence_start;
            if duration >= options.min_silence_duration {
                raw_silence_ranges.push((silence_start, time));
            }
        }
    }

    if in_silence {
        let duration = total_duration - silence_start;
        if duration >= options.min_silence_duration {
            raw_silence_ranges.push((silence_start, total_duration));
        }
    }

    // Step 3: Apply pre-roll and post-roll margins
    let mut final_silence_ranges: Vec<SilenceRange> = Vec::new();
    for (s_start, s_end) in raw_silence_ranges {
        let adjusted_start = (s_start + options.post_roll).min(s_end);
        let adjusted_end = (s_end - options.pre_roll).max(adjusted_start);
        let duration = adjusted_end - adjusted_start;

        if duration >= 0.05 {
            final_silence_ranges.push(SilenceRange {
                start_time: adjusted_start,
                end_time: adjusted_end,
                duration,
            });
        }
    }

    // Step 4: Build speech keep ranges
    let mut keep_ranges: Vec<KeepRange> = Vec::new();
    let mut cur_time = 0.0;

    for s in &final_silence_ranges {
        if s.start_time > cur_time {
            let dur = s.start_time - cur_time;
            keep_ranges.push(KeepRange {
                start_time: cur_time,
                end_time: s.start_time,
                duration: dur,
            });
        }
        cur_time = s.end_time;
    }

    if cur_time < total_duration {
        keep_ranges.push(KeepRange {
            start_time: cur_time,
            end_time: total_duration,
            duration: total_duration - cur_time,
        });
    }

    let removed_duration: f64 = final_silence_ranges.iter().map(|s| s.duration).sum();

    JumpCutPlan {
        total_duration,
        removed_duration,
        silence_ranges: final_silence_ranges,
        keep_ranges,
    }
}

#[tauri::command]
pub async fn detect_silence_ranges(
    samples: Vec<f32>,
    sample_rate: u32,
    options: Option<SilenceDetectionOptions>,
) -> Result<JumpCutPlan, String> {
    let opts = options.unwrap_or_default();
    Ok(analyze_audio_silence(&samples, sample_rate, &opts))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rms_and_db_calculations() {
        let zeros = vec![0.0; 100];
        assert_eq!(compute_rms(&zeros), 0.0);
        assert!(rms_to_db(0.0) <= -100.0);

        let ones = vec![1.0; 100];
        assert!((compute_rms(&ones) - 1.0).abs() < 1e-6);
        assert!((rms_to_db(1.0) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_synthetic_speech_and_silence_detection() {
        let sample_rate = 44100;
        // 1 second speech (sine wave) + 1 second silence + 1 second speech
        let mut samples = Vec::new();

        // 1s tone
        for i in 0..sample_rate {
            let t = i as f32 / sample_rate as f32;
            samples.push((t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.8);
        }
        // 1s silence
        samples.extend(vec![0.0f32; sample_rate as usize]);
        // 1s tone
        for i in 0..sample_rate {
            let t = i as f32 / sample_rate as f32;
            samples.push((t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.8);
        }

        let options = SilenceDetectionOptions {
            threshold_db: -30.0,
            min_silence_duration: 0.3,
            pre_roll: 0.05,
            post_roll: 0.05,
        };

        let plan = analyze_audio_silence(&samples, sample_rate, &options);
        assert_eq!(plan.silence_ranges.len(), 1);
        assert!((plan.silence_ranges[0].start_time - 1.05).abs() < 0.1);
        assert!((plan.silence_ranges[0].end_time - 1.95).abs() < 0.1);
        assert_eq!(plan.keep_ranges.len(), 2);
    }
}
