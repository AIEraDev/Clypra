use std::path::PathBuf;
use std::time::Duration;

use super::queue::request_thumbnail;
use super::types::{DensityLevel, ExtractionError, Priority};

/// Extract a single frame, returning a typed ExtractionError on failure.
///
/// This is a thin wrapper around `request_thumbnail` that maps the
/// string-based errors into the structured `ExtractionError` variants used
/// by `extract_with_retry`.
pub async fn extract_frame(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    request_thumbnail(
        video_path,
        time,
        density,
        Priority::Critical,
        width,
        height,
        1.0, // default DPR; callers needing 2x should use request_thumbnail directly
    )
    .await
    .map_err(|e| {
        let lower = e.to_lowercase();
        if lower.contains("no such file")
            || lower.contains("permission denied")
            || lower.contains("spawn")
            || lower.contains("os error")
        {
            ExtractionError::ProcessSpawn(e)
        } else if lower.contains("codec")
            || lower.contains("decoder")
            || lower.contains("invalid data")
            || lower.contains("moov atom")
        {
            ExtractionError::CodecError(e)
        } else if lower.contains("timeout") || lower.contains("timed out") {
            ExtractionError::Timeout
        } else if lower.contains("cache") {
            ExtractionError::CacheError(e)
        } else {
            ExtractionError::Other(e)
        }
    })
}

/// Extract a frame with automatic retry and exponential backoff.
///
/// Retry policy (Property 15 — Validates: Requirements 16.1, 16.4):
/// - `ProcessSpawn` errors: retry up to 3 times with delays of 100 ms, 400 ms,
///   1600 ms (base-4 exponential backoff).
/// - `CodecError`: no retry — return immediately and let the caller use the
///   fallback chain.
/// - `Timeout`: retry once with the next lower density level; if already at
///   the lowest density, return the error.
/// - All other errors: return immediately without retry.
pub async fn extract_with_retry(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    let mut attempts = 0;
    let max_attempts = 3;
    let mut backoff_ms: u64 = 100;

    loop {
        attempts += 1;

        match extract_frame(video_path, time, density, width, height).await {
            Ok(path) => return Ok(path),
            Err(e) => match e {
                ExtractionError::CodecError(_) => {
                    eprintln!("[Extract] Codec error (no retry): {}", e);
                    return Err(e);
                }
                ExtractionError::Timeout => {
                    if let Some(lower) = density.lower() {
                        eprintln!(
                            "[Extract] Timeout at density {:?}, retrying with lower density {:?}",
                            density, lower
                        );
                        return Box::pin(extract_with_retry(
                            video_path, time, lower, width, height,
                        ))
                        .await;
                    }
                    eprintln!("[Extract] Timeout at lowest density, giving up");
                    return Err(e);
                }
                ExtractionError::ProcessSpawn(_) => {
                    if attempts >= max_attempts {
                        eprintln!(
                            "[Extract] Max retries ({}) exceeded for process spawn error: {}",
                            max_attempts, e
                        );
                        return Err(e);
                    }

                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    eprintln!(
                        "[Extract] Retry {} after {}ms (process spawn error)",
                        attempts, backoff_ms
                    );
                    backoff_ms *= 4;
                }
                _ => {
                    eprintln!("[Extract] Non-retriable error: {}", e);
                    return Err(e);
                }
            },
        }
    }
}
