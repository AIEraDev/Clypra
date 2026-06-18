use crate::thumbnail_engine::decoder::get_decoder;
use crate::models::{VideoMetadata, MediaMetadata};
use base64::Engine;
use image::ImageEncoder;
use std::fs;
use serde::{Serialize, Deserialize};

/// Unified media metadata extraction for images, videos, and audio.
/// Professional NLE approach: single probe pipeline for all media types.
#[tauri::command]
pub async fn get_media_metadata(path: String) -> Result<MediaMetadata, String> {
    eprintln!("🦀 [get_media_metadata] Probing: {}", path);
    
    // Determine media type from extension
    let extension = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    match extension.as_str() {
        // Image formats - use image crate for native decoding
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "tif" => {
            get_image_metadata(&path).await
        }
        // Video/audio formats - use FFmpeg decoder
        _ => get_video_metadata_internal(&path).await,
    }
}

/// Extract metadata from image files using the image crate.
/// Handles: dimensions, alpha channel, EXIF orientation.
async fn get_image_metadata(path: &str) -> Result<MediaMetadata, String> {
    use image::GenericImageView;
    
    eprintln!("🦀 [get_image_metadata] Loading image: {}", path);
    
    // Load image to extract metadata
    let img = image::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?;
    
    let (width, height) = img.dimensions();
    
    // Check for alpha channel
    let has_alpha = matches!(
        img.color(),
        image::ColorType::La8 | image::ColorType::La16 |
        image::ColorType::Rgba8 | image::ColorType::Rgba16 |
        image::ColorType::Rgba32F
    );
    
    // Get file size
    let size = fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0);
    
    eprintln!("🦀 [get_image_metadata] Dimensions: {}×{}, Alpha: {}", width, height, has_alpha);
    
    Ok(MediaMetadata {
        duration: 0.0,
        width,
        height,
        fps: 0.0,
        size,
        rotation: None,
        has_alpha: Some(has_alpha),
    })
}

/// Extract metadata from video/audio files using FFmpeg decoder.
/// Handles: dimensions, duration, fps, rotation, SAR.
async fn get_video_metadata_internal(path: &str) -> Result<MediaMetadata, String> {
    match get_decoder(path).await {
        Ok(decoder) => {
            let guard = decoder.lock().await;
            
            // ✅ Use display_dimensions() which handles SAR + rotation
            let (width, height) = guard.display_dimensions();
            
            let duration = guard.duration;
            let fps = guard.fps();
            let rotation = guard.rotation();
            
            drop(guard);
            
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

            eprintln!("🦀 [get_video_metadata_internal] Display dimensions: {}×{}, Rotation: {}°", width, height, rotation);

            Ok(MediaMetadata {
                duration,
                width,
                height,
                fps,
                size,
                rotation: if rotation != 0 { Some(rotation) } else { None },
                has_alpha: None,
            })
        }
        Err(e) if e.contains("No video stream") => {
            // Audio-only file
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let duration = get_audio_duration(path).await.unwrap_or(0.0);
            
            Ok(MediaMetadata {
                duration,
                width: 0,
                height: 0,
                fps: 0.0,
                size,
                rotation: None,
                has_alpha: None,
            })
        }
        Err(e) => Err(e),
    }
}

/// Legacy command for backward compatibility.
/// New code should use get_media_metadata instead.
/// 
/// DEPRECATED: Use get_media_metadata for unified media type handling
#[deprecated(note = "Use get_media_metadata instead")]
#[tauri::command]
pub async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    eprintln!("⚠️  DEPRECATED: get_video_metadata called, use get_media_metadata instead");
    get_video_metadata_internal(&path).await
}

async fn get_audio_duration(path: &str) -> Result<f64, String> {
    use std::process::Command;
    
    eprintln!("[get_audio_duration] Attempting to get duration for: {}", path);
    
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|e| {
            eprintln!("[get_audio_duration] Failed to run ffprobe: {}", e);
            format!("Failed to run ffprobe: {}", e)
        })?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[get_audio_duration] ffprobe failed: {}", stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }
    
    let duration_str = String::from_utf8_lossy(&output.stdout);
    eprintln!("[get_audio_duration] ffprobe output: {}", duration_str);
    
    let duration = duration_str.trim().parse::<f64>()
        .map_err(|e| {
            eprintln!("[get_audio_duration] Failed to parse duration '{}': {}", duration_str, e);
            format!("Failed to parse duration: {}", e)
        })?;
    
    eprintln!("[get_audio_duration] Successfully parsed duration: {}s", duration);
    Ok(duration)
}

#[tauri::command]
pub async fn extract_poster_frame(path: String, time: f64) -> Result<String, String> {
    use image::codecs::png::PngEncoder;
    
    eprintln!("[extract_poster_frame] Extracting frame at {}s from {}", time, path);
    
    let decoder = get_decoder(&path).await?;
    
    let rgba_bytes = {
        let mut guard = decoder.lock().await;
        guard.decode_frame(time, 160, 90)?
    };
    
    let mut png_data = Vec::new();
    let encoder = PngEncoder::new(&mut png_data);
    encoder.write_image(&rgba_bytes, 160, 90, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("PNG encoding failed: {}", e))?;
    
    let encoded = base64::engine::general_purpose::STANDARD.encode(&png_data);
    Ok(format!("data:image/png;base64,{}", encoded))
}

#[tauri::command]
pub async fn extract_audio_artwork(path: String) -> Result<Option<String>, String> {
    use std::process::Command;
    
    eprintln!("[extract_audio_artwork] Extracting artwork from: {}", path);
    
    let output = Command::new("ffmpeg")
        .args([
            "-i", &path,
            "-an", // No audio
            "-vcodec", "copy",
            "-f", "image2pipe",
            "-vframes", "1",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    
    if !output.status.success() || output.stdout.is_empty() {
        eprintln!("[extract_audio_artwork] No artwork found");
        return Ok(None);
    }
    
    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    let mime_type = "image/jpeg"; // Most audio artwork is JPEG
    
    eprintln!("[extract_audio_artwork] Extracted artwork ({} bytes)", output.stdout.len());
    Ok(Some(format!("data:{};base64,{}", mime_type, encoded)))
}

#[tauri::command]
pub async fn extract_audio_track(path: String) -> Result<String, String> {
    use std::process::Command;
    use std::fs;

    eprintln!("🦀 [extract_audio_track] Extracting audio from: {}", path);

    // Use system temp directory to avoid triggering file watchers in dev mode
    let temp_dir = std::env::temp_dir();
    
    // Create a clypra-specific subdirectory
    let clypra_temp = temp_dir.join("clypra-audio");
    if !clypra_temp.exists() {
        fs::create_dir_all(&clypra_temp).map_err(|e| format!("Failed to create temp directory: {}", e))?;
    }

    // Generate a unique filename using MD5 of path
    let hash = format!("{:x}", md5::compute(path.as_bytes()));
    let output_filename = format!("{}.mp3", hash);
    let output_path = clypra_temp.join(output_filename);
    let output_path_str = output_path.to_str().ok_or("Failed to convert output path to string")?.to_string();

    // Call ffmpeg command to extract audio: ffmpeg -i <path> -vn -acodec libmp3lame -ac 1 -ar 16000 -y <output_path>
    let output = Command::new("ffmpeg")
        .args([
            "-i", &path,
            "-vn",
            "-acodec", "libmp3lame",
            "-ac", "1",
            "-ar", "16000",
            "-y",
            &output_path_str,
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg for audio extraction: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio extraction failed: {}", stderr));
    }

    // Get the absolute path of the output file
    let abs_path = fs::canonicalize(output_path)
        .map_err(|e| format!("Failed to resolve absolute path of extracted audio: {}", e))?;
    
    let abs_path_str = abs_path.to_str().ok_or("Failed to convert absolute path to string")?.to_string();
    eprintln!("🦀 [extract_audio_track] Extracted audio saved to: {}", abs_path_str);

    Ok(abs_path_str)
}

#[tauri::command]
pub async fn transcribe_audio_local(
    audio_path: String,
    model_size: Option<String>,
    language: Option<String>,
    language_hints: Option<Vec<String>>,
) -> Result<String, String> {
    use std::process::Command;
    use std::fs;
    use std::path::PathBuf;

    let model = model_size.unwrap_or_else(|| "tiny".to_string());
    let lang_param = language.unwrap_or_else(|| "auto".to_string());

    eprintln!("🦀 [transcribe_audio_local] Transcribing: {} (model: {}, lang: {})", audio_path, model, lang_param);

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
        }).map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    let models_dir = format!("{}/models/whisper", app_data_dir);
    eprintln!("🦀 [transcribe_audio_local] Models directory: {}", models_dir);

    // Verify Python script exists
    let mut script_path = PathBuf::from("src/features/text-effects/transcribe.py");
    if !script_path.exists() {
        script_path = PathBuf::from("../src/features/text-effects/transcribe.py");
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
        return Err(format!("Transcription script not found. Expected at: {:?}", script_path));
    }

    let script_path_str = script_path.to_str().ok_or("Failed to convert script path to string")?.to_string();
    eprintln!("🦀 [transcribe_audio_local] Resolved script path: {}", script_path_str);

    // Build language hint prompt if hints are provided
    let prompt = if let Some(hints) = language_hints {
        if !hints.is_empty() {
            let lang_names: Vec<String> = hints.iter().map(|code| {
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
                }.to_string()
            }).collect();
            Some(format!("This audio may contain speech in {}. Transcribe accordingly.", lang_names.join(", ")))
        } else {
            None
        }
    } else {
        None
    };

    if let Some(ref p) = prompt {
        eprintln!("🦀 [transcribe_audio_local] Using language hint prompt: {}", p);
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

    eprintln!("🦀 [transcribe_audio_local] Executing command: uv {}", args.join(" "));

    // Call uv command to run our python script
    let output = Command::new("uv")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute uv transcription: {}", e))?;

    eprintln!("🦀 [transcribe_audio_local] Command completed with status: {}", output.status);

    eprintln!("🦀 [transcribe_audio_local] Command completed with status: {}", output.status);

    // Delete the temporary audio file since transcription is completed (to prevent disk bloat)
    if let Err(e) = fs::remove_file(&audio_path) {
        eprintln!("⚠️ [transcribe_audio_local] Failed to clean up temporary audio file: {}", e);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        eprintln!("🦀 [transcribe_audio_local] Transcription failed!");
        eprintln!("  stdout: {}", stdout);
        eprintln!("  stderr: {}", stderr);
        return Err(format!("Whisper transcription failed: {}", stderr));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    eprintln!("🦀 [transcribe_audio_local] Transcription successful, output length: {} bytes", stdout_str.len());
    Ok(stdout_str.trim().to_string())
}

/// Waveform bucket containing both peak and RMS amplitude data.
/// Professional NLE approach: peak shows transients, RMS shows perceived loudness.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WaveformBucket {
    /// Peak amplitude (absolute max sample in bucket) - range [0.0, 1.0]
    pub peak: f32,
    /// RMS amplitude (root mean square energy) - range [0.0, 1.0]
    pub rms: f32,
}

/// Extract professional waveform data from audio file.
/// Computes both peak and RMS values for each pixel bucket.
/// Used for timeline waveform rendering with proper dynamic range visualization.
#[tauri::command]
pub async fn extract_waveform_data(
    path: String,
    num_buckets: usize,
    start_time: Option<f64>,
    duration: Option<f64>,
) -> Result<Vec<WaveformBucket>, String> {
    use std::process::Command;
    
    eprintln!("🦀 [extract_waveform_data] Extracting {} buckets from: {}", num_buckets, path);
    
    // Use ffmpeg to decode audio to raw PCM samples (mono, 16kHz for efficiency)
    let mut cmd = Command::new("ffmpeg");
    if let Some(start) = start_time.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-ss").arg(format!("{:.3}", start));
    }
    cmd.arg("-i").arg(&path);
    if let Some(len) = duration.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-t").arg(format!("{:.3}", len));
    }
    let output = cmd
        .args([
            "-f", "f32le",      // 32-bit float PCM
            "-ac", "1",         // Mono (mix to single channel)
            "-ar", "16000",     // 16kHz sample rate (sufficient for visualization)
            "-",                // Output to stdout
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio decoding failed: {}", stderr));
    }
    
    // Convert bytes to f32 samples
    let samples: Vec<f32> = output.stdout
        .chunks_exact(4)
        .map(|chunk| {
            let bytes = [chunk[0], chunk[1], chunk[2], chunk[3]];
            f32::from_le_bytes(bytes)
        })
        .collect();
    
    if samples.is_empty() {
        return Err("No audio samples extracted".to_string());
    }
    
    eprintln!("🦀 [extract_waveform_data] Decoded {} samples", samples.len());
    
    // Compute peak and RMS for each bucket
    let buckets = compute_waveform_buckets(&samples, num_buckets);
    
    eprintln!("🦀 [extract_waveform_data] Computed {} buckets", buckets.len());
    Ok(buckets)
}

/// Compute peak and RMS amplitudes for each pixel bucket.
/// Professional audio analysis: peak captures transients, RMS captures energy.
fn compute_waveform_buckets(samples: &[f32], num_buckets: usize) -> Vec<WaveformBucket> {
    let samples_per_bucket = samples.len() / num_buckets;
    
    if samples_per_bucket == 0 {
        // Edge case: fewer samples than buckets - create minimal buckets
        return vec![WaveformBucket { peak: 0.0, rms: 0.0 }; num_buckets];
    }
    
    (0..num_buckets)
        .map(|i| {
            let start = i * samples_per_bucket;
            let end = ((i + 1) * samples_per_bucket).min(samples.len());
            let bucket = &samples[start..end];
            
            // Peak: absolute maximum sample in bucket
            let peak = bucket.iter()
                .map(|s| s.abs())
                .fold(0.0f32, f32::max);
            
            // RMS: root mean square (perceived loudness/energy)
            let sum_squares: f32 = bucket.iter()
                .map(|s| s * s)
                .sum();
            let rms = (sum_squares / bucket.len() as f32).sqrt();
            
            WaveformBucket { peak, rms }
        })
        .collect()
}
