//! Cross-Platform Golden-Pixel Test & Metric Evaluation Harness.
//!
//! Provides deterministic image quality assessment (SSIM, PSNR, L_inf, L_1)
//! and false-color difference heatmap generation for cross-GPU parity testing
//! across Metal, Vulkan, and DirectX 12.

use serde::{Deserialize, Serialize};

/// Image fidelity metrics comparing rendered output against a golden baseline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GoldenMetrics {
    /// Maximum absolute color subpixel difference across all channels ($L_\infty$).
    pub max_delta: u8,
    /// Mean absolute color subpixel difference across all channels ($L_1$).
    pub mean_delta: f32,
    /// Mean Squared Error (MSE).
    pub mse: f64,
    /// Peak Signal-to-Noise Ratio (PSNR) in decibels (dB).
    pub psnr: f64,
    /// Structural Similarity Index Measure (SSIM) in range [0.0, 1.0].
    pub ssim: f64,
}

/// Computes pixel-exact and perceptual similarity metrics between two RGBA8 frame buffers.
pub fn compute_image_metrics(
    actual: &[u8],
    expected: &[u8],
    width: u32,
    height: u32,
) -> Result<GoldenMetrics, String> {
    let expected_len = (width * height * 4) as usize;
    if actual.len() != expected_len || expected.len() != expected_len {
        return Err(format!(
            "Buffer size mismatch: actual={}, expected={}, required={}",
            actual.len(),
            expected.len(),
            expected_len
        ));
    }

    let mut max_delta = 0u8;
    let mut total_abs_delta = 0u64;
    let mut total_sq_delta = 0.0f64;

    let subpixel_count = (width * height * 4) as f64;

    for i in 0..actual.len() {
        let a = actual[i];
        let e = expected[i];
        let diff = (a as i16 - e as i16).unsigned_abs() as u8;
        if diff > max_delta {
            max_delta = diff;
        }
        total_abs_delta += diff as u64;
        total_sq_delta += (diff as f64) * (diff as f64);
    }

    let mean_delta = (total_abs_delta as f32) / (subpixel_count as f32);
    let mse = total_sq_delta / subpixel_count;

    let psnr = if mse < 1e-10 {
        100.0 // Mathematically identical -> infinite PSNR clamped to 100 dB
    } else {
        10.0 * (255.0 * 255.0 / mse).log10()
    };

    // Calculate simplified 8x8 block Structural Similarity Index (SSIM)
    let ssim = compute_ssim_rgba(actual, expected, width as usize, height as usize);

    Ok(GoldenMetrics {
        max_delta,
        mean_delta,
        mse,
        psnr,
        ssim,
    })
}

/// Generates an amplified false-color heatmap RGBA8 buffer of visual differences.
/// Matching pixels appear dark gray; differences glow in vibrant red/yellow.
pub fn generate_diff_heatmap(
    actual: &[u8],
    expected: &[u8],
    _width: u32,
    _height: u32,
    amplification: u8,
) -> Vec<u8> {
    let amp = amplification.max(1) as u16;
    let mut diff_rgba = Vec::with_capacity(actual.len());

    for chunk_idx in 0..(actual.len() / 4) {
        let offset = chunk_idx * 4;
        let mut max_sub_diff = 0u8;
        for c in 0..3 {
            let d = (actual[offset + c] as i16 - expected[offset + c] as i16).unsigned_abs() as u8;
            max_sub_diff = max_sub_diff.max(d);
        }

        if max_sub_diff == 0 {
            // Background reference (dark charcoal)
            diff_rgba.extend_from_slice(&[20, 20, 25, 255]);
        } else {
            // Heatmap gradient: yellow to red
            let amplified = ((max_sub_diff as u16) * amp).min(255) as u8;
            diff_rgba.extend_from_slice(&[255, 255 - amplified, 0, 255]);
        }
    }

    diff_rgba
}

/// Computes Structural Similarity Index (SSIM) across RGBA channels.
fn compute_ssim_rgba(img1: &[u8], img2: &[u8], width: usize, height: usize) -> f64 {
    const C1: f64 = (0.01 * 255.0) * (0.01 * 255.0);
    const C2: f64 = (0.03 * 255.0) * (0.03 * 255.0);

    let block_size = 8;
    let mut total_ssim = 0.0;
    let mut num_blocks = 0;

    for by in (0..height).step_by(block_size) {
        for bx in (0..width).step_by(block_size) {
            let bw = (width - bx).min(block_size);
            let bh = (height - by).min(block_size);
            let n = (bw * bh) as f64;
            if n < 4.0 {
                continue;
            }

            let mut mean1 = 0.0;
            let mut mean2 = 0.0;

            for y in 0..bh {
                for x in 0..bw {
                    let idx = ((by + y) * width + (bx + x)) * 4;
                    // Luma approximation
                    let l1 = img1[idx] as f64 * 0.299
                        + img1[idx + 1] as f64 * 0.587
                        + img1[idx + 2] as f64 * 0.114;
                    let l2 = img2[idx] as f64 * 0.299
                        + img2[idx + 1] as f64 * 0.587
                        + img2[idx + 2] as f64 * 0.114;
                    mean1 += l1;
                    mean2 += l2;
                }
            }
            mean1 /= n;
            mean2 /= n;

            let mut var1 = 0.0;
            let mut var2 = 0.0;
            let mut cov = 0.0;

            for y in 0..bh {
                for x in 0..bw {
                    let idx = ((by + y) * width + (bx + x)) * 4;
                    let l1 = img1[idx] as f64 * 0.299
                        + img1[idx + 1] as f64 * 0.587
                        + img1[idx + 2] as f64 * 0.114;
                    let l2 = img2[idx] as f64 * 0.299
                        + img2[idx + 1] as f64 * 0.587
                        + img2[idx + 2] as f64 * 0.114;

                    let d1 = l1 - mean1;
                    let d2 = l2 - mean2;
                    var1 += d1 * d1;
                    var2 += d2 * d2;
                    cov += d1 * d2;
                }
            }
            var1 /= n - 1.0;
            var2 /= n - 1.0;
            cov /= n - 1.0;

            let ssim_block =
                ((2.0 * mean1 * mean2 + C1) * (2.0 * cov + C2))
                    / ((mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2));

            total_ssim += ssim_block;
            num_blocks += 1;
        }
    }

    if num_blocks == 0 {
        1.0
    } else {
        (total_ssim / num_blocks as f64).clamp(0.0, 1.0)
    }
}

/// Assert golden image parity with explicit threshold diagnostics.
pub fn assert_golden_parity(
    actual: &[u8],
    expected: &[u8],
    width: u32,
    height: u32,
    min_ssim: f64,
    max_delta: u8,
    scenario_name: &str,
) {
    let metrics = compute_image_metrics(actual, expected, width, height)
        .expect("Failed to compute golden image metrics");

    println!(
        "[{scenario_name}] Metrics: L_inf(max_delta)={}, L_1(mean_delta)={:.4}, PSNR={:.2}dB, SSIM={:.6}",
        metrics.max_delta, metrics.mean_delta, metrics.psnr, metrics.ssim
    );

    assert!(
        metrics.max_delta <= max_delta,
        "[{scenario_name}] Maximum pixel delta {} exceeded allowed threshold {}",
        metrics.max_delta,
        max_delta
    );

    assert!(
        metrics.ssim >= min_ssim,
        "[{scenario_name}] SSIM {:.6} fell below required threshold {:.6}",
        metrics.ssim,
        min_ssim
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identical_buffers_perfect_metrics() {
        let data = vec![128u8; 64 * 64 * 4];
        let metrics = compute_image_metrics(&data, &data, 64, 64).unwrap();

        assert_eq!(metrics.max_delta, 0);
        assert_eq!(metrics.mean_delta, 0.0);
        assert_eq!(metrics.psnr, 100.0);
        assert_eq!(metrics.ssim, 1.0);
    }

    #[test]
    fn test_slight_gradient_drift_metrics() {
        let mut actual = vec![128u8; 64 * 64 * 4];
        let mut expected = vec![128u8; 64 * 64 * 4];

        // Introduce a subtle 1-subpixel drift (simulating driver float rounding)
        for i in 0..actual.len() {
            if i % 2 == 0 {
                actual[i] = 129;
            }
        }

        let metrics = compute_image_metrics(&actual, &expected, 64, 64).unwrap();
        assert_eq!(metrics.max_delta, 1);
        assert_eq!(metrics.mean_delta, 0.5);
        assert!(metrics.psnr > 50.0, "PSNR must remain very high for 1-bit delta");
        assert!(metrics.ssim > 0.999, "SSIM must remain > 0.999 for 1-bit delta");
    }
}
