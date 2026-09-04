//! Monotone Cubic Hermite Spline Color Curves Engine.
//!
//! Provides deterministic, overshoot-free spline interpolation for Master,
//! Red, Green, and Blue color response curves, generating a 256-sample
//! 1D RGBA lookup table for hardware GPU evaluation.

use serde::{Deserialize, Serialize};

/// A single control point on a curve in normalized [0.0, 1.0] coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CurvePoint {
    pub x: f32,
    pub y: f32,
}

impl CurvePoint {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

/// Curve points container for Master, Red, Green, and Blue channels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurvesData {
    #[serde(default = "default_linear_curve")]
    pub master: Vec<CurvePoint>,
    #[serde(default = "default_linear_curve")]
    pub red: Vec<CurvePoint>,
    #[serde(default = "default_linear_curve")]
    pub green: Vec<CurvePoint>,
    #[serde(default = "default_linear_curve")]
    pub blue: Vec<CurvePoint>,
}

fn default_linear_curve() -> Vec<CurvePoint> {
    vec![CurvePoint::new(0.0, 0.0), CurvePoint::new(1.0, 1.0)]
}

impl Default for CurvesData {
    fn default() -> Self {
        Self {
            master: default_linear_curve(),
            red: default_linear_curve(),
            green: default_linear_curve(),
            blue: default_linear_curve(),
        }
    }
}

/// Evaluates a monotone cubic Hermite spline at normalized input `x` in [0.0, 1.0].
///
/// Implements the Fritsch-Carlson algorithm to ensure monotonicity and
/// eliminate ringing/overshoot artifacts commonly produced by standard natural cubics.
pub fn evaluate_monotone_spline(points: &[CurvePoint], x: f32) -> f32 {
    if points.is_empty() {
        return x.clamp(0.0, 1.0);
    }
    if points.len() == 1 {
        return points[0].y.clamp(0.0, 1.0);
    }

    // Sort and deduplicate by X coordinate
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
    sorted.dedup_by(|a, b| (a.x - b.x).abs() < 1e-5);

    if sorted.len() == 1 {
        return sorted[0].y.clamp(0.0, 1.0);
    }

    let n = sorted.len();

    // Clamp input to endpoints
    if x <= sorted[0].x {
        return sorted[0].y.clamp(0.0, 1.0);
    }
    if x >= sorted[n - 1].x {
        return sorted[n - 1].y.clamp(0.0, 1.0);
    }

    // Compute interval secants (slopes)
    let mut deltas = Vec::with_capacity(n - 1);
    let mut h = Vec::with_capacity(n - 1);
    for k in 0..(n - 1) {
        let dx = (sorted[k + 1].x - sorted[k].x).max(1e-6);
        let dy = sorted[k + 1].y - sorted[k].y;
        h.push(dx);
        deltas.push(dy / dx);
    }

    // Compute initial tangents
    let mut m = Vec::with_capacity(n);
    m.push(deltas[0]);
    for k in 1..(n - 1) {
        if deltas[k - 1] * deltas[k] <= 0.0 {
            m.push(0.0);
        } else {
            m.push((deltas[k - 1] + deltas[k]) * 0.5);
        }
    }
    m.push(deltas[n - 2]);

    // Fritsch-Carlson monotonicity correction
    for k in 0..(n - 1) {
        if deltas[k].abs() < 1e-7 {
            m[k] = 0.0;
            m[k + 1] = 0.0;
            continue;
        }
        let alpha = m[k] / deltas[k];
        let beta = m[k + 1] / deltas[k];
        let sum_sq = alpha * alpha + beta * beta;
        if sum_sq > 9.0 {
            let tau = 3.0 / sum_sq.sqrt();
            m[k] = tau * alpha * deltas[k];
            m[k + 1] = tau * beta * deltas[k];
        }
    }

    // Find active interval
    let mut k = 0;
    while k < n - 2 && sorted[k + 1].x < x {
        k += 1;
    }

    let h_k = h[k];
    let t = (x - sorted[k].x) / h_k;
    let t2 = t * t;
    let t3 = t2 * t;

    // Hermite basis functions
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;

    let y = h00 * sorted[k].y + h10 * h_k * m[k] + h01 * sorted[k + 1].y + h11 * h_k * m[k + 1];
    y.clamp(0.0, 1.0)
}

/// 256-sample RGBA curve lookup table representing 1D mapping for [R, G, B, Master].
#[derive(Debug, Clone)]
pub struct CurveLutTable {
    /// 256 entries * 4 channels (RGBA) in [0..255] byte format.
    pub table_bytes: [u8; 256 * 4],
    /// 256 entries * 4 channels (RGBA) in [0.0..1.0] normalized float format.
    pub table_floats: [[f32; 4]; 256],
    pub is_identity: bool,
}

impl CurveLutTable {
    /// Generates a 256-entry RGBA LUT from authored CurvesData.
    pub fn from_curves_data(curves: &CurvesData) -> Self {
        let mut table_bytes = [0u8; 256 * 4];
        let mut table_floats = [[0.0f32; 4]; 256];
        let mut is_identity = true;

        for (i, entry) in table_floats.iter_mut().enumerate() {
            let x = i as f32 / 255.0;

            let r = evaluate_monotone_spline(&curves.red, x);
            let g = evaluate_monotone_spline(&curves.green, x);
            let b = evaluate_monotone_spline(&curves.blue, x);
            let m = evaluate_monotone_spline(&curves.master, x);

            if (r - x).abs() > 0.002
                || (g - x).abs() > 0.002
                || (b - x).abs() > 0.002
                || (m - x).abs() > 0.002
            {
                is_identity = false;
            }

            *entry = [r, g, b, m];

            let offset = i * 4;
            table_bytes[offset] = (r * 255.0).round().clamp(0.0, 255.0) as u8;
            table_bytes[offset + 1] = (g * 255.0).round().clamp(0.0, 255.0) as u8;
            table_bytes[offset + 2] = (b * 255.0).round().clamp(0.0, 255.0) as u8;
            table_bytes[offset + 3] = (m * 255.0).round().clamp(0.0, 255.0) as u8;
        }

        Self {
            table_bytes,
            table_floats,
            is_identity,
        }
    }

    /// Allocates or updates a GPU 2D/1D texture from this LUT table.
    pub fn create_gpu_texture(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        label: Option<&str>,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        use wgpu::util::DeviceExt;

        let texture = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: label.or(Some("Color Curves LUT Texture")),
                size: wgpu::Extent3d {
                    width: 256,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &self.table_bytes,
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_identity_curve() {
        let linear = default_linear_curve();
        assert_eq!(evaluate_monotone_spline(&linear, 0.0), 0.0);
        assert!((evaluate_monotone_spline(&linear, 0.5) - 0.5).abs() < 1e-4);
        assert_eq!(evaluate_monotone_spline(&linear, 1.0), 1.0);

        let lut = CurveLutTable::from_curves_data(&CurvesData::default());
        assert!(lut.is_identity);
        for i in 0..256 {
            assert_eq!(lut.table_bytes[i * 4], i as u8);
            assert_eq!(lut.table_bytes[i * 4 + 1], i as u8);
            assert_eq!(lut.table_bytes[i * 4 + 2], i as u8);
            assert_eq!(lut.table_bytes[i * 4 + 3], i as u8);
        }
    }

    #[test]
    fn test_s_curve_contrast_monotonicity() {
        // Classic S-curve: toe at (0.25, 0.15), shoulder at (0.75, 0.85)
        let s_curve = vec![
            CurvePoint::new(0.0, 0.0),
            CurvePoint::new(0.25, 0.15),
            CurvePoint::new(0.75, 0.85),
            CurvePoint::new(1.0, 1.0),
        ];

        let mut prev_y = -1.0f32;
        for step in 0..=100 {
            let x = step as f32 / 100.0;
            let y = evaluate_monotone_spline(&s_curve, x);
            assert!(
                y >= prev_y,
                "Monotone spline must not decrease: x={}, y={}, prev_y={}",
                x,
                y,
                prev_y
            );
            assert!(y >= 0.0 && y <= 1.0, "Output must stay clamped in [0, 1]");
            prev_y = y;
        }

        // Mid-tones at 0.5 must remain centered around 0.5 for symmetrical S-curve
        let mid = evaluate_monotone_spline(&s_curve, 0.5);
        assert!((mid - 0.5).abs() < 0.02, "S-curve mid-tone deviation: {}", mid);
    }

    #[test]
    fn test_curves_data_lut_generation() {
        let curves = CurvesData {
            master: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.7), // Lift midtones
                CurvePoint::new(1.0, 1.0),
            ],
            red: vec![
                CurvePoint::new(0.0, 0.1), // Red lift
                CurvePoint::new(1.0, 0.9), // Red highlight roll-off
            ],
            green: default_linear_curve(),
            blue: default_linear_curve(),
        };

        let lut = CurveLutTable::from_curves_data(&curves);
        assert!(!lut.is_identity);

        // Check red lift at x=0
        assert_eq!(lut.table_bytes[0], 26); // ~0.1 * 255
        // Check green at x=0
        assert_eq!(lut.table_bytes[1], 0);
        // Check master at x=128 (approx 0.5)
        assert!(lut.table_floats[128][3] > 0.65);
    }
}
