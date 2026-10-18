use std::path::PathBuf;
use crate::commands::export::augmented_path;

#[tauri::command]
pub async fn transcribe_audio_local(
    audio_path: String,
    model_size: Option<String>,
    language: Option<String>,
    language_hints: Option<Vec<String>>,
) -> Result<String, String> {
    let model = model_size.unwrap_or_else(|| "tiny".to_string());
    let lang_param = language.unwrap_or_else(|| "auto".to_string());

    log::debug!(
        "🦀 [transcribe_audio_local] Transcribing: {} (model: {}, lang: {})",
        audio_path,
        model,
        lang_param
    );

    // Get app data directory for models
    let app_data_dir: String = std::env::var("TAURI_APP_DATA_DIR")
        .or_else(|_| -> Result<String, String> {
            // Fallback: construct it manually
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "Could not determine home directory".to_string())?;

            #[cfg(target_os = "macos")]
            let path = format!("{}/Library/Application Support/com.clypra.editor", home);

            #[cfg(target_os = "windows")]
            let path = format!("{}\\AppData\\Roaming\\com.clypra.editor", home);

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let path = format!("{}/.local/share/com.clypra.editor", home);

            Ok(path)
        })
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = PathBuf::from(&app_data_dir)
        .join("models")
        .join("whisper")
        .to_string_lossy()
        .to_string();
    log::debug!(
        "🦀 [transcribe_audio_local] Models directory: {}",
        models_dir
    );

    // Verify Python script exists
    let mut script_path = PathBuf::from("src/features/text-effects/transcribe.py");
    if !script_path.exists() {
        script_path = PathBuf::from("../src/features/text-effects/transcribe.py");
    }
    if !script_path.exists() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let mut dir = exe_dir.to_path_buf();
                for _ in 0..5 {
                    let test_path = dir.join("src/features/text-effects/transcribe.py");
                    if test_path.exists() {
                        script_path = test_path;
                        break;
                    }
                    if let Some(parent) = dir.parent() {
                        dir = parent.to_path_buf();
                    } else {
                        break;
                    }
                }
            }
        }
    }
    if !script_path.exists() {
        let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for _ in 0..4 {
            let test_path = dir.join("src/features/text-effects/transcribe.py");
            if test_path.exists() {
                script_path = test_path;
                break;
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }

    if !script_path.exists() {
        return Err(format!(
            "Transcription script not found. Expected at: {:?}",
            script_path
        ));
    }

    let script_path_str = script_path
        .to_str()
        .ok_or("Failed to convert script path to string")?
        .to_string();
    log::debug!(
        "🦀 [transcribe_audio_local] Resolved script path: {}",
        script_path_str
    );

    // Build language hint prompt if hints are provided
    let prompt = if let Some(hints) = language_hints {
        if !hints.is_empty() {
            let lang_names: Vec<String> = hints
                .iter()
                .map(|code| {
                    match code.as_str() {
                        "en" => "English",
                        "es" => "Spanish",
                        "fr" => "French",
                        "de" => "German",
                        "it" => "Italian",
                        "pt" => "Portuguese",
                        "ru" => "Russian",
                        "ja" => "Japanese",
                        "ko" => "Korean",
                        "zh" => "Chinese",
                        "ar" => "Arabic",
                        "hi" => "Hindi",
                        _ => code.as_str(),
                    }
                    .to_string()
                })
                .collect();
            Some(format!(
                "This audio may contain speech in {}. Transcribe accordingly.",
                lang_names.join(", ")
            ))
        } else {
            None
        }
    } else {
        None
    };

    if let Some(ref p) = prompt {
        log::debug!(
            "🦀 [transcribe_audio_local] Using language hint prompt: {}",
            p
        );
    }

    // Build command arguments with model, language, model directory, and optional prompt
    let mut args = vec![
        "run".to_string(),
        script_path_str.clone(),
        audio_path.clone(),
        format!("--model={}", model),
        format!("--model-dir={}", models_dir),
    ];

    // Add language argument if not auto
    if lang_param != "auto" {
        args.push(format!("--language={}", lang_param));
    }

    // Add prompt if generated from hints
    if let Some(p) = prompt {
        args.push(format!("--prompt={}", p));
    }

    log::debug!(
        "🦀 [transcribe_audio_local] Executing command: uv {}",
        args.join(" ")
    );

    // Call uv command to run our python script asynchronously
    let output = crate::process_util::hidden_tokio_command("uv")
        .env("PATH", augmented_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute uv transcription: {}", e))?;

    log::debug!(
        "🦀 [transcribe_audio_local] Command completed with status: {}",
        output.status
    );

    // Only delete the audio file if it is confirmed to be an internal temp file (in clypra-audio or system temp)
    let is_temp_audio = audio_path.contains("clypra-audio")
        || audio_path.starts_with(&std::env::temp_dir().to_string_lossy().to_string());
    if is_temp_audio {
        if let Err(e) = tokio::fs::remove_file(&audio_path).await {
            log::debug!(
                "⚠️ [transcribe_audio_local] Failed to clean up temporary audio file: {}",
                e
            );
        }
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::debug!("🦀 [transcribe_audio_local] Transcription failed!");
        log::debug!("  stdout: {}", stdout);
        log::debug!("  stderr: {}", stderr);
        return Err(format!("Whisper transcription failed: {}", stderr));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    log::debug!(
        "🦀 [transcribe_audio_local] Transcription successful, output length: {} bytes",
        stdout_str.len()
    );
    Ok(stdout_str.trim().to_string())
}
