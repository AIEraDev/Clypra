use image::{ImageBuffer, Rgba};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GoldenDiff {
    pub differing_pixels: usize,
    pub total_pixels: usize,
    pub max_channel_error: u8,
    pub mean_channel_error: f64,
}

impl GoldenDiff {
    pub fn is_within_tolerance(&self, tolerance: u8) -> bool {
        self.max_channel_error <= tolerance
    }
}

#[allow(clippy::manual_slice_size_calculation)]
pub fn compare_rgba8(actual: &[u8], expected: &[u8], tolerance: u8) -> Result<GoldenDiff, String> {
    if actual.len() != expected.len() {
        return Err(format!(
            "RGBA frame length mismatch: actual={} expected={}",
            actual.len(),
            expected.len()
        ));
    }
    if !actual.len().is_multiple_of(4) {
        return Err(format!(
            "RGBA frame length is not pixel-aligned: {} bytes",
            actual.len()
        ));
    }

    let total_pixels = actual.len() / 4;
    let mut differing_pixels = 0;
    let mut max_channel_error = 0;
    let mut total_channel_error = 0u64;

    for (actual_pixel, expected_pixel) in actual.chunks_exact(4).zip(expected.chunks_exact(4)) {
        let mut pixel_differs = false;
        for (actual_channel, expected_channel) in actual_pixel.iter().zip(expected_pixel) {
            let error = actual_channel.abs_diff(*expected_channel);
            max_channel_error = max_channel_error.max(error);
            total_channel_error += u64::from(error);
            pixel_differs |= error > tolerance;
        }
        if pixel_differs {
            differing_pixels += 1;
        }
    }

    Ok(GoldenDiff {
        differing_pixels,
        total_pixels,
        max_channel_error,
        mean_channel_error: if total_pixels == 0 {
            0.0
        } else {
            total_channel_error as f64 / (total_pixels * 4) as f64
        },
    })
}

pub fn write_rgba8_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let expected_len = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Golden PNG dimensions overflow".to_string())? as usize;
    if rgba.len() != expected_len {
        return Err(format!(
            "Golden PNG frame length mismatch: actual={} expected={}",
            rgba.len(),
            expected_len
        ));
    }

    let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "Unable to construct golden PNG image".to_string())?;
    image.save(path).map_err(|error| error.to_string())
}

pub fn read_rgba8_png(path: &Path) -> Result<(u32, u32, Vec<u8>), String> {
    let image = image::open(path)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = image.dimensions();
    Ok((width, height, image.into_raw()))
}

#[cfg(test)]
mod tests {
    use super::{compare_rgba8, read_rgba8_png, write_rgba8_png, GoldenDiff};

    #[test]
    fn identical_frames_have_zero_diff() {
        let diff = compare_rgba8(&[0, 10, 20, 255], &[0, 10, 20, 255], 0).unwrap();
        assert_eq!(
            diff,
            GoldenDiff {
                differing_pixels: 0,
                total_pixels: 1,
                max_channel_error: 0,
                mean_channel_error: 0.0,
            }
        );
        assert!(diff.is_within_tolerance(0));
    }

    #[test]
    fn tolerance_is_applied_per_channel_and_reports_statistics() {
        let diff = compare_rgba8(&[10, 20, 30, 255], &[12, 20, 35, 255], 2).unwrap();
        assert_eq!(diff.differing_pixels, 1);
        assert_eq!(diff.max_channel_error, 5);
        assert!(!diff.is_within_tolerance(2));
        assert!(diff.is_within_tolerance(5));
    }

    #[test]
    fn malformed_frames_are_rejected() {
        assert!(compare_rgba8(&[0, 0, 0], &[0, 0, 0], 0).is_err());
        assert!(compare_rgba8(&[0, 0, 0, 255], &[], 0).is_err());
    }

    #[test]
    fn png_capture_round_trips_rgba_pixels() {
        let path = std::env::temp_dir().join(format!(
            "clypra_preview_golden_{}_{}.png",
            std::process::id(),
            "roundtrip"
        ));
        let pixels = [10, 20, 30, 255, 200, 210, 220, 255];

        write_rgba8_png(&path, 2, 1, &pixels).expect("golden PNG should write");
        let (width, height, decoded) = read_rgba8_png(&path).expect("golden PNG should read");
        let _ = std::fs::remove_file(&path);

        assert_eq!((width, height), (2, 1));
        assert_eq!(decoded, pixels);
    }
}
