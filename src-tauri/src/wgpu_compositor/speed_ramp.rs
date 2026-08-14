// src-tauri/src/wgpu_compositor/speed_ramp.rs
// Parametric Speed Ramping and Continuous Variable Framerate Motion Smoothing

use super::bezier::CubicBezier;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedKeyframe {
    /// Timeline time in seconds
    pub time: f64,
    /// Playback speed multiplier (e.g. 0.25 for 4x slowmo, 1.0 for normal, 4.0 for fast)
    pub speed: f64,
    /// Cubic Bézier easing control points to next keyframe
    pub curve: Option<CubicBezier>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedRampProfile {
    pub keyframes: Vec<SpeedKeyframe>,
}

impl SpeedRampProfile {
    pub fn new(keyframes: Vec<SpeedKeyframe>) -> Self {
        let mut sorted = keyframes;
        sorted.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());
        Self { keyframes: sorted }
    }

    /// Evaluates instantaneous speed at a given timeline position
    pub fn get_speed_at(&self, timeline_time: f64) -> f64 {
        if self.keyframes.is_empty() {
            return 1.0;
        }
        if self.keyframes.len() == 1 || timeline_time <= self.keyframes[0].time {
            return self.keyframes[0].speed.max(0.01);
        }
        if timeline_time >= self.keyframes.last().unwrap().time {
            return self.keyframes.last().unwrap().speed.max(0.01);
        }

        for i in 0..self.keyframes.len() - 1 {
            let k_start = &self.keyframes[i];
            let k_end = &self.keyframes[i + 1];

            if timeline_time >= k_start.time && timeline_time <= k_end.time {
                let curve = k_start.curve.unwrap_or(CubicBezier::LINEAR);
                let duration = k_end.time - k_start.time;
                if duration <= 1e-6 {
                    return k_start.speed;
                }
                let progress = (timeline_time - k_start.time) / duration;
                let eased = curve.evaluate(progress);
                let speed = k_start.speed + (k_end.speed - k_start.speed) * eased;
                return speed.max(0.01);
            }
        }

        1.0
    }

    /// Numerically integrates speed curve to map timeline_time to source_media_time
    /// source_time(t) = \int_0^t v(\tau) d\tau
    pub fn timeline_to_source_time(&self, timeline_time: f64, initial_trim_in: f64) -> f64 {
        if timeline_time <= 0.0 {
            return initial_trim_in;
        }

        // Numerical Simpson's / Trapezoidal rule integration with adaptive step
        let steps = ((timeline_time * 60.0).ceil() as usize).clamp(10, 500);
        let dt = timeline_time / steps as f64;
        let mut accumulated_source_time = 0.0;

        let mut prev_speed = self.get_speed_at(0.0);
        for i in 1..=steps {
            let cur_t = i as f64 * dt;
            let cur_speed = self.get_speed_at(cur_t);
            accumulated_source_time += (prev_speed + cur_speed) * 0.5 * dt;
            prev_speed = cur_speed;
        }

        initial_trim_in + accumulated_source_time
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_speed_mapping() {
        let profile = SpeedRampProfile::new(vec![
            SpeedKeyframe { time: 0.0, speed: 2.0, curve: None },
            SpeedKeyframe { time: 10.0, speed: 2.0, curve: None },
        ]);

        assert_eq!(profile.get_speed_at(5.0), 2.0);
        let source_time = profile.timeline_to_source_time(5.0, 0.0);
        assert!((source_time - 10.0).abs() < 0.05); // 5s at 2x speed = 10s source elapsed
    }

    #[test]
    fn test_speed_ramp_transition() {
        let profile = SpeedRampProfile::new(vec![
            SpeedKeyframe { time: 0.0, speed: 1.0, curve: Some(CubicBezier::EASE_IN_OUT) },
            SpeedKeyframe { time: 2.0, speed: 4.0, curve: None },
        ]);

        let mid_speed = profile.get_speed_at(1.0);
        assert!(mid_speed > 1.0 && mid_speed < 4.0);

        let source_time = profile.timeline_to_source_time(2.0, 0.0);
        assert!(source_time > 2.0 && source_time < 8.0);
    }
}
