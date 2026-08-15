// src-tauri/src/wgpu_compositor/bezier.rs
// High-precision Parametric Cubic-Bézier Curve Engine

use serde::{Deserialize, Serialize};

/// Cubic Bézier curve defined by control points (x1, y1) and (x2, y2)
/// Start point is fixed at (0, 0) and end point at (1, 1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CubicBezier {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

impl CubicBezier {
    pub const LINEAR: Self = Self { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 };
    pub const EASE: Self = Self { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
    pub const EASE_IN: Self = Self { x1: 0.42, y1: 0.0, x2: 1.0, y2: 1.0 };
    pub const EASE_OUT: Self = Self { x1: 0.0, y1: 0.0, x2: 0.58, y2: 1.0 };
    pub const EASE_IN_OUT: Self = Self { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 };
    pub const EASE_IN_CUBIC: Self = Self { x1: 0.32, y1: 0.0, x2: 0.67, y2: 0.0 };
    pub const EASE_OUT_CUBIC: Self = Self { x1: 0.33, y1: 1.0, x2: 0.68, y2: 1.0 };

    pub fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        Self {
            x1: x1.clamp(0.0, 1.0),
            y1,
            x2: x2.clamp(0.0, 1.0),
            y2,
        }
    }

    /// Evaluates Bézier polynomial component at parameter t in [0.0, 1.0]
    #[inline]
    fn sample_curve(p1: f64, p2: f64, t: f64) -> f64 {
        // B(t) = 3(1-t)^2 * t * P1 + 3(1-t) * t^2 * P2 + t^3
        let inv_t = 1.0 - t;
        3.0 * inv_t * inv_t * t * p1 + 3.0 * inv_t * t * t * p2 + t * t * t
    }

    /// First derivative of Bézier polynomial with respect to parameter t
    #[inline]
    fn sample_curve_derivative(p1: f64, p2: f64, t: f64) -> f64 {
        let inv_t = 1.0 - t;
        3.0 * inv_t * inv_t * p1 + 6.0 * inv_t * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
    }

    /// Solves parameter t such that sample_curve(x1, x2, t) = x using Newton-Raphson with binary bisection fallback
    pub fn solve_t_for_x(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        if x >= 1.0 {
            return 1.0;
        }

        // Fast Newton-Raphson iteration
        let mut t = x;
        for _ in 0..8 {
            let current_x = Self::sample_curve(self.x1, self.x2, t) - x;
            if current_x.abs() < 1e-6 {
                return t;
            }
            let d_x = Self::sample_curve_derivative(self.x1, self.x2, t);
            if d_x.abs() < 1e-6 {
                break;
            }
            t -= current_x / d_x;
        }

        // Fallback to Binary Bisection
        let mut t_min = 0.0;
        let mut t_max = 1.0;
        t = x;

        while t_min < t_max {
            let current_x = Self::sample_curve(self.x1, self.x2, t);
            if (current_x - x).abs() < 1e-6 {
                return t;
            }
            if x > current_x {
                t_min = t;
            } else {
                t_max = t;
            }
            t = (t_max + t_min) * 0.5;
        }

        t
    }

    /// Evaluates curve output y for a normalized input progress x in [0.0, 1.0]
    pub fn evaluate(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        if x >= 1.0 {
            return 1.0;
        }
        let t = self.solve_t_for_x(x);
        Self::sample_curve(self.y1, self.y2, t)
    }
}

/// Evaluates smooth interpolated value between two keyframes using parametric Bézier easing
pub fn interpolate_keyframe(
    val_start: f64,
    val_end: f64,
    time_start: f64,
    time_end: f64,
    current_time: f64,
    curve: &CubicBezier,
) -> f64 {
    if time_end <= time_start || current_time <= time_start {
        return val_start;
    }
    if current_time >= time_end {
        return val_end;
    }

    let progress = (current_time - time_start) / (time_end - time_start);
    let eased = curve.evaluate(progress);
    val_start + (val_end - val_start) * eased
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_bezier() {
        let b = CubicBezier::LINEAR;
        assert_eq!(b.evaluate(0.0), 0.0);
        assert!((b.evaluate(0.5) - 0.5).abs() < 1e-5);
        assert_eq!(b.evaluate(1.0), 1.0);
    }

    #[test]
    fn test_ease_in_out_symmetry() {
        let b = CubicBezier::EASE_IN_OUT;
        assert_eq!(b.evaluate(0.0), 0.0);
        assert!((b.evaluate(0.5) - 0.5).abs() < 1e-4);
        assert_eq!(b.evaluate(1.0), 1.0);
    }

    #[test]
    fn test_parametric_interpolation() {
        let curve = CubicBezier::EASE;
        let val = interpolate_keyframe(100.0, 200.0, 0.0, 1.0, 0.5, &curve);
        assert!(val > 100.0 && val < 200.0);
    }
}
