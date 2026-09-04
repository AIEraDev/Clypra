use bytemuck::cast_slice;
use std::path::PathBuf;
use std::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[tokio::test]
async fn test_live_whisper_on_device_transcription() {
    let model_path = PathBuf::from(
        "/Users/AIEraDev/Library/Application Support/com.clypra.editor/models/whisper/ggml-tiny.bin",
    );
    assert!(
        model_path.exists(),
        "ggml-tiny.bin must exist at {:?}",
        model_path
    );

    // Verify model validation passes
    assert!(
        tauri_app_lib::commands::whisper::is_valid_whisper_model_file(&model_path),
        "is_valid_whisper_model_file must approve real downloaded model"
    );

    let audio_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("temp/c9e67a7bf27636b001604b349b66942c.mp3");
    assert!(
        audio_path.exists(),
        "Sample audio must exist at {:?}",
        audio_path
    );

    // 1. Extract 16kHz Mono f32 PCM via FFmpeg
    let output = Command::new("ffmpeg")
        .args([
            "-i",
            audio_path.to_str().unwrap(),
            "-vn",
            "-acodec",
            "pcm_f32le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "f32le",
            "-t",
            "15", // Transcribe first 15 seconds for deterministic, fast test
            "-",
        ])
        .output()
        .expect("FFmpeg audio extraction failed");

    assert!(
        !output.stdout.is_empty(),
        "Audio extraction produced empty output"
    );
    let audio_data: &[f32] = cast_slice(&output.stdout);
    let sample_count = audio_data.len();
    assert!(sample_count > 0, "No f32 audio samples extracted");
    println!(
        "Extracted {} samples ({:.2}s of audio)",
        sample_count,
        sample_count as f64 / 16000.0
    );

    // 2. Initialize WhisperContext
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap(),
        WhisperContextParameters::default(),
    )
    .expect("Failed to initialize WhisperContext with ggml-tiny.bin");

    let mut state = ctx
        .create_state()
        .expect("Failed to create Whisper state");

    // 3. Configure inference
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_token_timestamps(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // 4. Run inference
    let start_time = std::time::Instant::now();
    state
        .full(params, audio_data)
        .expect("Whisper inference failed");
    let elapsed = start_time.elapsed();
    println!("Whisper inference completed in {:.2?}", elapsed);

    // 5. Inspect segments & timestamps
    let n_segments = state.full_n_segments();
    println!("Detected {} segments", n_segments);
    assert!(
        n_segments > 0,
        "Whisper inference must produce at least one segment"
    );

    let mut total_transcription = String::new();
    for i in 0..n_segments {
        let seg = state.get_segment(i).expect("Segment missing");
        let text = seg.to_str_lossy().unwrap_or_default().trim().to_string();
        let start_cs = seg.start_timestamp();
        let end_cs = seg.end_timestamp();
        let start_ticks = tauri_app_lib::commands::captions::whisper_centiseconds_to_ticks(start_cs);
        let end_ticks = tauri_app_lib::commands::captions::whisper_centiseconds_to_ticks(end_cs);

        println!(
            "  Segment {}: [{}cs - {}cs] ({} - {} ticks): '{}'",
            i, start_cs, end_cs, start_ticks, end_ticks, text
        );

        assert!(end_ticks >= start_ticks, "End ticks must be >= start ticks");
        total_transcription.push_str(&text);
        total_transcription.push(' ');
    }

    println!("\nFull transcription: {}", total_transcription.trim());
    assert!(
        !total_transcription.trim().is_empty(),
        "Transcription must not be empty"
    );
}
