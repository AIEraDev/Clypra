use bytemuck::cast_slice;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tauri::Manager;
use tokio::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::commands::whisper::resolve_model_file_path;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WordTimestamp {
    pub word: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub id: usize,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
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
            "Whisper model '{}' not found. Please download it from Settings → Captions.",
            model_key
        )
    })?;

    let model_path_str = model_path
        .to_str()
        .ok_or_else(|| "Failed to convert model path to string".to_string())?
        .to_string();

    eprintln!(
        "🦀 [generate_auto_captions] Using model at: {}",
        model_path_str
    );

    // 2. Extract 16kHz Mono f32 PCM via FFmpeg stdout — no intermediate file
    let child = Command::new("ffmpeg")
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

            // Timestamps are in centiseconds — multiply by 10 to get ms
            let start_ms = seg.start_timestamp() as u64 * 10;
            let end_ms = seg.end_timestamp() as u64 * 10;

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
                words.push(WordTimestamp {
                    word,
                    start_ms: token_data.t0 as u64 * 10,
                    end_ms: token_data.t1 as u64 * 10,
                });
            }

            segments.push(SubtitleSegment {
                id: i as usize,
                text,
                start_ms,
                end_ms,
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
