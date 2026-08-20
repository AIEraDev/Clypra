//! Deterministic RGBA8 comparison used by local labs and CI.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenDiff {
    pub width: u32,
    pub height: u32,
    pub differing_pixels: u64,
    pub total_pixels: u64,
    pub max_channel_error: u8,
    pub mean_channel_error: f64,
}

impl GoldenDiff {
    pub fn is_within_tolerance(self, tolerance: u8) -> bool {
        self.max_channel_error <= tolerance
    }
}

pub fn compare_rgba8(
    actual: &[u8],
    expected: &[u8],
    width: u32,
    height: u32,
) -> Result<GoldenDiff, String> {
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "RGBA8 image dimensions overflowed".to_string())?;

    if actual.len() != expected_len || expected.len() != expected_len {
        return Err(format!(
            "RGBA8 buffer length mismatch: expected {expected_len}, actual {}, reference {}",
            actual.len(),
            expected.len()
        ));
    }

    let mut differing_pixels = 0_u64;
    let mut max_channel_error = 0_u8;
    let mut total_error = 0_u64;

    for (actual_pixel, expected_pixel) in actual.chunks_exact(4).zip(expected.chunks_exact(4)) {
        let mut pixel_differs = false;
        for (&actual_channel, &expected_channel) in actual_pixel.iter().zip(expected_pixel) {
            let error = actual_channel.abs_diff(expected_channel);
            pixel_differs |= error != 0;
            max_channel_error = max_channel_error.max(error);
            total_error += u64::from(error);
        }
        if pixel_differs {
            differing_pixels += 1;
        }
    }

    let total_pixels = u64::from(width) * u64::from(height);
    let mean_channel_error = if total_pixels == 0 {
        0.0
    } else {
        total_error as f64 / (total_pixels as f64 * 4.0)
    };

    Ok(GoldenDiff {
        width,
        height,
        differing_pixels,
        total_pixels,
        max_channel_error,
        mean_channel_error,
    })
}

#[cfg(test)]
mod tests {
    use super::compare_rgba8;

    #[test]
    fn compares_exact_rgba8_frames() {
        let frame = [10, 20, 30, 255, 1, 2, 3, 4];
        let diff = compare_rgba8(&frame, &frame, 2, 1).expect("valid frame");
        assert_eq!(diff.differing_pixels, 0);
        assert_eq!(diff.max_channel_error, 0);
        assert!(diff.is_within_tolerance(0));
    }

    #[test]
    fn reports_pixel_and_channel_error() {
        let actual = [10, 20, 30, 255];
        let expected = [12, 20, 27, 255];
        let diff = compare_rgba8(&actual, &expected, 1, 1).expect("valid frame");
        assert_eq!(diff.differing_pixels, 1);
        assert_eq!(diff.max_channel_error, 3);
        assert!((diff.mean_channel_error - 1.25).abs() < f64::EPSILON);
        assert!(diff.is_within_tolerance(3));
        assert!(!diff.is_within_tolerance(2));
    }
}
