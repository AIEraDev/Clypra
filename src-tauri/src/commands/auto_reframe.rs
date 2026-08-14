// src-tauri/src/commands/auto_reframe.rs
// Smart Auto-Reframe (16:9 -> 9:16 Subject Tracking) Engine

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectDetection {
    pub timestamp: f64,
    /// Normalized center X [0.0..1.0]
    pub center_x: f64,
    /// Normalized center Y [0.0..1.0]
    pub center_y: f64,
    /// Normalized width [0.0..1.0]
    pub width: f64,
    /// Normalized height [0.0..1.0]
    pub height: f64,
    /// Detection confidence [0.0..1.0]
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReframeKeyframe {
    pub timestamp: f64,
    /// Normalized canvas X offset [-1.0..1.0]
    pub pan_x: f64,
    /// Normalized canvas Y offset [-1.0..1.0]
    pub pan_y: f64,
    /// Scale factor to fill 9:16 portrait canvas
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoReframeResult {
    pub target_aspect: String,
    pub keyframes: Vec<ReframeKeyframe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoReframeOptions {
    /// Smoothing window duration in seconds (e.g. 1.0s)
    pub smoothing_window: f64,
    /// Maximum allowed pan speed (delta per second) to prevent jerky camera motion
    pub max_pan_speed: f64,
    /// Source aspect ratio (e.g. 16.0 / 9.0)
    pub source_aspect: f64,
    /// Target aspect ratio (e.g. 9.0 / 16.0)
    pub target_aspect: f64,
}

impl Default for AutoReframeOptions {
    fn default() -> Self {
        Self {
            smoothing_window: 0.8,
            max_pan_speed: 0.8,
            source_aspect: 16.0 / 9.0,
            target_aspect: 9.0 / 16.0,
        }
    }
}

/// Generates smooth pan keyframes from subject detections to frame 16:9 content into 9:16
pub fn compute_auto_reframe_trajectory(
    detections: &[SubjectDetection],
    duration: f64,
    options: &AutoReframeOptions,
) -> AutoReframeResult {
    if detections.is_empty() || duration <= 0.0 {
        return AutoReframeResult {
            target_aspect: "9:16".into(),
            keyframes: vec![
                ReframeKeyframe {
                    timestamp: 0.0,
                    pan_x: 0.0,
                    pan_y: 0.0,
                    scale: options.source_aspect / options.target_aspect,
                },
                ReframeKeyframe {
                    timestamp: duration,
                    pan_x: 0.0,
                    pan_y: 0.0,
                    scale: options.source_aspect / options.target_aspect,
                },
            ],
        };
    }

    let scale = options.source_aspect / options.target_aspect; // e.g. (16/9) / (9/16) = 3.16 or fit height

    // Sample timeline at 10fps for smooth keyframe curve
    let sample_interval = 0.1;
    let mut sampled_points: Vec<(f64, f64)> = Vec::new();

    let mut t = 0.0;
    while t <= duration + 1e-4 {
        // Find closest detection or interpolate
        let center_x = if let Some(d) = detections.iter().min_by(|a, b| {
            (a.timestamp - t).abs().partial_cmp(&(b.timestamp - t).abs()).unwrap()
        }) {
            d.center_x
        } else {
            0.5
        };

        // Convert center_x [0..1] to pan_x offset [-1..1]
        // 0.5 center -> pan_x = 0.0
        let raw_pan_x = (0.5 - center_x) * 2.0;
        sampled_points.push((t, raw_pan_x));

        t += sample_interval;
    }

    // Temporal Gaussian / moving average smoothing
    let window_half = ((options.smoothing_window / sample_interval) / 2.0).round() as usize;
    let mut smoothed_keyframes: Vec<ReframeKeyframe> = Vec::new();

    for (i, &(time, _)) in sampled_points.iter().enumerate() {
        let start_idx = i.saturating_sub(window_half);
        let end_idx = (i + window_half + 1).min(sampled_points.len());

        let mut sum_val = 0.0;
        let mut count = 0.0;

        for j in start_idx..end_idx {
            sum_val += sampled_points[j].1;
            count += 1.0;
        }

        let avg_pan_x = if count > 0.0 { sum_val / count } else { 0.0 };
        // Clamp pan_x within safe boundaries [-1.0, 1.0]
        let clamped_pan_x = avg_pan_x.clamp(-1.0, 1.0);

        smoothed_keyframes.push(ReframeKeyframe {
            timestamp: time,
            pan_x: clamped_pan_x,
            pan_y: 0.0,
            scale,
        });
    }

    AutoReframeResult {
        target_aspect: "9:16".into(),
        keyframes: smoothed_keyframes,
    }
}

#[tauri::command]
pub async fn calculate_auto_reframe(
    detections: Vec<SubjectDetection>,
    duration: f64,
    options: Option<AutoReframeOptions>,
) -> Result<AutoReframeResult, String> {
    let opts = options.unwrap_or_default();
    Ok(compute_auto_reframe_trajectory(&detections, duration, &opts))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_detections_fallback() {
        let result = compute_auto_reframe_trajectory(&[], 5.0, &AutoReframeOptions::default());
        assert_eq!(result.keyframes.len(), 2);
        assert_eq!(result.keyframes[0].pan_x, 0.0);
    }

    #[test]
    fn test_subject_tracking_smoothing() {
        let detections = vec![
            SubjectDetection { timestamp: 0.0, center_x: 0.2, center_y: 0.5, width: 0.2, height: 0.4, confidence: 0.9 },
            SubjectDetection { timestamp: 1.0, center_x: 0.8, center_y: 0.5, width: 0.2, height: 0.4, confidence: 0.9 },
            SubjectDetection { timestamp: 2.0, center_x: 0.5, center_y: 0.5, width: 0.2, height: 0.4, confidence: 0.9 },
        ];

        let result = compute_auto_reframe_trajectory(&detections, 2.0, &AutoReframeOptions::default());
        assert!(!result.keyframes.is_empty());
        // Verify pan_x is bounded
        for k in &result.keyframes {
            assert!(k.pan_x >= -1.0 && k.pan_x <= 1.0);
            assert!(k.scale > 1.0);
        }
    }
}
