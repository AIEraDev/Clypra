use serde::{Deserialize, Serialize};

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
    // Use ffmpeg to decode audio to raw PCM samples (mono, 16kHz for efficiency)
    let mut cmd = crate::commands::binary_resolver::create_std_command("ffmpeg");
    if let Some(start) = start_time.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-ss").arg(format!("{:.3}", start));
    }
    cmd.arg("-i").arg(&path);
    if let Some(len) = duration.filter(|v| v.is_finite() && *v > 0.0) {
        cmd.arg("-t").arg(format!("{:.3}", len));
    }
    let output = cmd
        .args([
            "-f", "f32le", // 32-bit float PCM
            "-ac", "1", // Mono (mix to single channel)
            "-ar", "16000", // 16kHz sample rate (sufficient for visualization)
            "-",     // Output to stdout
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio decoding failed: {}", stderr));
    }

    // Zero-copy cast bytes to f32 samples using bytemuck
    let samples: &[f32] = bytemuck::cast_slice(&output.stdout);

    if samples.is_empty() {
        return Err("No audio samples extracted".to_string());
    }

    // Compute peak and RMS for each bucket in parallel
    let buckets = compute_waveform_buckets(samples, num_buckets);
    Ok(buckets)
}

/// Compute peak and RMS amplitudes for each pixel bucket using parallel chunk processing.
/// Professional audio analysis: peak captures transients, RMS captures energy.
fn compute_waveform_buckets(samples: &[f32], num_buckets: usize) -> Vec<WaveformBucket> {
    use rayon::prelude::*;

    if samples.is_empty() || num_buckets == 0 {
        return vec![
            WaveformBucket {
                peak: 0.0,
                rms: 0.0
            };
            num_buckets
        ];
    }

    let total_samples = samples.len();

    (0..num_buckets)
        .into_par_iter()
        .map(|i| {
            let start = (i * total_samples) / num_buckets;
            let end = (((i + 1) * total_samples) / num_buckets).min(total_samples);
            let bucket = if start < end {
                &samples[start..end]
            } else {
                &[]
            };

            let mut peak = 0.0f32;
            let mut sum_squares = 0.0f32;
            for &s in bucket {
                let abs_s = s.abs();
                if abs_s > peak {
                    peak = abs_s;
                }
                sum_squares += s * s;
            }
            let rms = if !bucket.is_empty() {
                (sum_squares / bucket.len() as f32).sqrt()
            } else {
                0.0
            };

            WaveformBucket { peak, rms }
        })
        .collect()
}
