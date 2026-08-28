use bytemuck::cast_slice;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tauri::Manager;
use tokio::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::commands::whisper::resolve_model_file_path;

/// 1MHz microsecond ticks per second, matching `native_audio::TICKS_PER_SECOND`
/// and `native_core::contracts::DEFAULT_TIME_SCALE`.
pub const TICKS_PER_SECOND: i64 = 1_000_000;

/// Whisper timestamps are reported in centiseconds (10 ms units).
/// 1 centisecond = 10 ms = 10,000 microseconds (ticks at 1MHz).
#[inline]
pub fn whisper_centiseconds_to_ticks(centiseconds: i64) -> i64 {
    centiseconds.saturating_mul(10_000)
}

/// Convert audio sample index at 16,000 Hz to 1MHz microsecond ticks.
/// samples * 1,000,000 / 16,000 = (samples * 125) / 2
#[inline]
pub fn audio_16k_samples_to_ticks(samples: u64) -> i64 {
    let ticks = (samples as u128).saturating_mul(125) / 2;
    ticks.min(i64::MAX as u128) as i64
}

/// Convert 1MHz microsecond ticks back to 16,000 Hz sample count.
/// (ticks * 2) / 125
#[inline]
pub fn ticks_to_audio_16k_samples(ticks: i64) -> u64 {
    if ticks <= 0 {
        return 0;
    }
    ((ticks as u128).saturating_mul(2) / 125) as u64
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordTimestamp {
    pub word: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub start_ticks: i64,
    pub end_ticks: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub id: usize,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub start_ticks: i64,
    pub end_ticks: i64,
    pub words: Vec<WordTimestamp>,
}

#[tauri::command]
pub async fn generate_auto_captions(
    app: tauri::AppHandle,
    video_path: String,
    model_size: Option<String>,
    language: Option<String>,
) -> Result<Vec<SubtitleSegment>, String> {
    eprintln!(
        "🦀 [generate_auto_captions] Starting captioning for: {} model: {:?} language: {:?}",
        video_path, model_size, language
    );

    // 1. Resolve model path from app data dir
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let model_key = model_size.unwrap_or_else(|| "tiny".to_string());
    let model_path = resolve_model_file_path(&app_data_dir, &model_key).ok_or_else(|| {
        format!(
            "Whisper model '{}' not found or invalid. Please download it from Settings → Captions.",
            model_key
        )
    })?;

    let model_path_str = model_path
        .to_str()
        .ok_or_else(|| "Failed to convert model path to string".to_string())?
        .to_string();

    eprintln!(
        "🦀 [generate_auto_captions] Using verified model at: {}",
        model_path_str
    );

    // 2. Extract 16kHz Mono f32 PCM via FFmpeg stdout with augmented PATH
    let child = Command::new("ffmpeg")
        .env("PATH", crate::commands::export::augmented_path())
        .args([
            "-i",
            &video_path,
            "-vn", // No video
            "-acodec",
            "pcm_f32le", // 32-bit float LE
            "-ar",
            "16000", // 16 kHz
            "-ac",
            "1", // Mono
            "-f",
            "f32le", // Raw output format
            "-",     // Pipe to stdout
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("FFmpeg audio extraction failed: {}", e))?;

    if output.stdout.is_empty() {
        return Err("Audio extraction produced no data from video source.".into());
    }

    // 3. Zero-copy cast to f32 slice via bytemuck
    let audio_data: &[f32] = cast_slice(&output.stdout);
    eprintln!(
        "🦀 [generate_auto_captions] {} samples extracted ({:.2}s)",
        audio_data.len(),
        audio_data.len() as f64 / 16000.0
    );

    // 4. Initialize WhisperContext & State on a blocking thread
    // (whisper inference is CPU-bound, move off the async runtime)
    let audio_vec = audio_data.to_vec(); // move ownership into spawn_blocking
    let lang_clone = language.clone();

    let segments = tokio::task::spawn_blocking(move || -> Result<Vec<SubtitleSegment>, String> {
        let ctx =
            WhisperContext::new_with_params(&model_path_str, WhisperContextParameters::default())
                .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

        // 5. Configure inference for token-level timestamps
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_token_timestamps(true);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        if let Some(ref lang) = lang_clone {
            if lang != "auto" && !lang.is_empty() {
                params.set_language(Some(lang.as_str()));
            } else {
                params.set_language(None);
            }
        } else {
            params.set_language(None);
        }

        // 6. Run full inference pipeline
        state
            .full(params, &audio_vec)
            .map_err(|e| format!("Whisper inference failed: {}", e))?;

        let n_segments = state.full_n_segments();
        let mut segments = Vec::with_capacity(n_segments as usize);

        // 7. Extract segments and token-level word timestamps (whisper-rs 0.16 API)
        for i in 0..n_segments {
            let seg = match state.get_segment(i) {
                Some(s) => s,
                None => continue,
            };

            let text = seg.to_str_lossy().unwrap_or_default().trim().to_string();

            // Whisper timestamps are in centiseconds (10 ms units)
            let start_cs = seg.start_timestamp();
            let end_cs = seg.end_timestamp();
            let start_ms = start_cs as u64 * 10;
            let end_ms = end_cs as u64 * 10;
            let start_ticks = whisper_centiseconds_to_ticks(start_cs);
            let end_ticks = whisper_centiseconds_to_ticks(end_cs);

            let n_tokens = seg.n_tokens();
            let mut words = Vec::with_capacity(n_tokens as usize);

            for t in 0..n_tokens {
                let token = match seg.get_token(t) {
                    Some(tok) => tok,
                    None => continue,
                };

                let word = token.to_str_lossy().unwrap_or_default().trim().to_string();

                if word.is_empty() {
                    continue;
                }

                let token_data = token.token_data();
                let word_start_cs = token_data.t0;
                let word_end_cs = token_data.t1;
                words.push(WordTimestamp {
                    word,
                    start_ms: word_start_cs as u64 * 10,
                    end_ms: word_end_cs as u64 * 10,
                    start_ticks: whisper_centiseconds_to_ticks(word_start_cs),
                    end_ticks: whisper_centiseconds_to_ticks(word_end_cs),
                });
            }

            segments.push(SubtitleSegment {
                id: i as usize,
                text,
                start_ms,
                end_ms,
                start_ticks,
                end_ticks,
                words,
            });
        }

        eprintln!(
            "🦀 [generate_auto_captions] Generated {} segments",
            segments.len()
        );

        Ok(segments)
    })
    .await
    .map_err(|e| format!("Whisper inference thread panicked: {}", e))??;

    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tick_unit_agreement_with_native_audio() {
        // Assert that TICKS_PER_SECOND in captions matches native_audio::TICKS_PER_SECOND
        // and native_core::contracts::DEFAULT_TIME_SCALE exactly (1MHz).
        assert_eq!(TICKS_PER_SECOND, crate::native_audio::TICKS_PER_SECOND);
        assert_eq!(TICKS_PER_SECOND as u32, crate::native_core::contracts::DEFAULT_TIME_SCALE);
        assert_eq!(TICKS_PER_SECOND, 1_000_000);

        // 1 second (100 centiseconds in Whisper) must equal 1,000,000 ticks directly
        let ticks_from_whisper_1s = whisper_centiseconds_to_ticks(100);
        assert_eq!(ticks_from_whisper_1s, 1_000_000);
        assert_eq!(ticks_from_whisper_1s, crate::native_audio::TICKS_PER_SECOND);

        // 1 second of 16kHz audio (16,000 samples) must equal 1,000,000 ticks directly
        let ticks_from_16k_samples = audio_16k_samples_to_ticks(16_000);
        assert_eq!(ticks_from_16k_samples, 1_000_000);
        assert_eq!(ticks_from_16k_samples, crate::native_audio::TICKS_PER_SECOND);
    }

    #[test]
    fn test_whisper_sample_and_centisecond_to_ticks_conversion() {
        // 10ms window (1 Whisper centisecond): 160 samples at 16kHz
        assert_eq!(whisper_centiseconds_to_ticks(1), 10_000);
        assert_eq!(audio_16k_samples_to_ticks(160), 10_000);
        assert_eq!(ticks_to_audio_16k_samples(10_000), 160);

        // 500ms (50 Whisper centiseconds): 8,000 samples at 16kHz
        assert_eq!(whisper_centiseconds_to_ticks(50), 500_000);
        assert_eq!(audio_16k_samples_to_ticks(8_000), 500_000);
        assert_eq!(ticks_to_audio_16k_samples(500_000), 8_000);

        // Arbitrary timestamp: 3.25 seconds = 325 centiseconds = 52,000 samples
        assert_eq!(whisper_centiseconds_to_ticks(325), 3_250_000);
        assert_eq!(audio_16k_samples_to_ticks(52_000), 3_250_000);
        assert_eq!(ticks_to_audio_16k_samples(3_250_000), 52_000);

        // Long audio: 2 hours (7,200 seconds = 720,000 centiseconds = 115,200,000 samples)
        let two_hours_ticks = whisper_centiseconds_to_ticks(720_000);
        assert_eq!(two_hours_ticks, 7_200_000_000);
        assert_eq!(audio_16k_samples_to_ticks(115_200_000), 7_200_000_000);
        assert_eq!(ticks_to_audio_16k_samples(7_200_000_000), 115_200_000);
    }
}
