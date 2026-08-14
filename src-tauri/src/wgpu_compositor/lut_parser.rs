// src-tauri/src/wgpu_compositor/lut_parser.rs

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ParsedLut3D {
    pub title: String,
    pub size: u32,
    pub domain_min: [f32; 3],
    pub domain_max: [f32; 3],
    /// Packed RGBA8 pixel data: (size * size * size * 4) bytes
    pub rgba8_data: Vec<u8>,
}

impl ParsedLut3D {
    /// Generates a neutral/identity 3D LUT (passes colors through unchanged)
    pub fn create_identity(size: u32) -> Self {
        let count = (size * size * size) as usize;
        let mut rgba8_data = Vec::with_capacity(count * 4);
        let divisor = if size > 1 { (size - 1) as f32 } else { 1.0 };

        for b in 0..size {
            for g in 0..size {
                for r in 0..size {
                    let rf = (r as f32) / divisor;
                    let gf = (g as f32) / divisor;
                    let bf = (b as f32) / divisor;

                    rgba8_data.push((rf * 255.0).round() as u8);
                    rgba8_data.push((gf * 255.0).round() as u8);
                    rgba8_data.push((bf * 255.0).round() as u8);
                    rgba8_data.push(255u8); // Solid Alpha
                }
            }
        }

        Self {
            title: "Identity".into(),
            size,
            domain_min: [0.0, 0.0, 0.0],
            domain_max: [1.0, 1.0, 1.0],
            rgba8_data,
        }
    }

    /// Parses an Adobe .cube formatted string
    pub fn parse_cube_str(content: &str) -> Result<Self, String> {
        let mut title = String::from("Custom LUT");
        let mut lut_size: Option<u32> = None;
        let mut domain_min = [0.0f32, 0.0, 0.0];
        let mut domain_max = [1.0f32, 1.0, 1.0];
        let mut raw_samples: Vec<[f32; 3]> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();

            // Skip comments and empty lines
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }

            match parts[0] {
                "TITLE" => {
                    title = trimmed.trim_start_matches("TITLE").trim().trim_matches('"').to_string();
                }
                "LUT_3D_SIZE" => {
                    if parts.len() < 2 {
                        return Err("Malformed LUT_3D_SIZE line".into());
                    }
                    lut_size = Some(parts[1].parse::<u32>().map_err(|e| e.to_string())?);
                }
                "LUT_1D_SIZE" => {
                    return Err("1D LUTs are not supported in 3D pipeline".into());
                }
                "DOMAIN_MIN" => {
                    if parts.len() >= 4 {
                        domain_min = [
                            parts[1].parse().unwrap_or(0.0),
                            parts[2].parse().unwrap_or(0.0),
                            parts[3].parse().unwrap_or(0.0),
                        ];
                    }
                }
                "DOMAIN_MAX" => {
                    if parts.len() >= 4 {
                        domain_max = [
                            parts[1].parse().unwrap_or(1.0),
                            parts[2].parse().unwrap_or(1.0),
                            parts[3].parse().unwrap_or(1.0),
                        ];
                    }
                }
                _ => {
                    // Data line: R G B floating-point values
                    if parts.len() == 3 {
                        if let (Ok(r), Ok(g), Ok(b)) = (
                            parts[0].parse::<f32>(),
                            parts[1].parse::<f32>(),
                            parts[2].parse::<f32>(),
                        ) {
                            raw_samples.push([r, g, b]);
                        }
                    }
                }
            }
        }

        let size = lut_size.ok_or_else(|| "Missing LUT_3D_SIZE header in .cube file".to_string())?;
        let expected_count = (size * size * size) as usize;

        if raw_samples.len() != expected_count {
            return Err(format!(
                "LUT data length mismatch: expected {} points ({}x{}x{}), got {}",
                expected_count, size, size, size, raw_samples.len()
            ));
        }

        // Convert normalized floats to RGBA8 texture bytes
        let mut rgba8_data = Vec::with_capacity(expected_count * 4);
        let range_r = (domain_max[0] - domain_min[0]).max(1e-6);
        let range_g = (domain_max[1] - domain_min[1]).max(1e-6);
        let range_b = (domain_max[2] - domain_min[2]).max(1e-6);

        for [r, g, b] in raw_samples {
            let norm_r = ((r - domain_min[0]) / range_r).clamp(0.0, 1.0);
            let norm_g = ((g - domain_min[1]) / range_g).clamp(0.0, 1.0);
            let norm_b = ((b - domain_min[2]) / range_b).clamp(0.0, 1.0);

            rgba8_data.push((norm_r * 255.0).round() as u8);
            rgba8_data.push((norm_g * 255.0).round() as u8);
            rgba8_data.push((norm_b * 255.0).round() as u8);
            rgba8_data.push(255u8); // Solid Alpha
        }

        Ok(Self {
            title,
            size,
            domain_min,
            domain_max,
            rgba8_data,
        })
    }

    /// Parses an Adobe .cube file from disk
    pub fn parse_cube_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let file = File::open(path.as_ref()).map_err(|e| format!("Failed to open LUT file: {e}"))?;
        let reader = BufReader::new(file);

        let mut title = String::from("Custom LUT");
        let mut lut_size: Option<u32> = None;
        let mut domain_min = [0.0f32, 0.0, 0.0];
        let mut domain_max = [1.0f32, 1.0, 1.0];
        let mut raw_samples: Vec<[f32; 3]> = Vec::new();

        for line_res in reader.lines() {
            let line = line_res.map_err(|e| e.to_string())?;
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }

            match parts[0] {
                "TITLE" => {
                    title = trimmed.trim_start_matches("TITLE").trim().trim_matches('"').to_string();
                }
                "LUT_3D_SIZE" => {
                    if parts.len() < 2 {
                        return Err("Malformed LUT_3D_SIZE line".into());
                    }
                    lut_size = Some(parts[1].parse::<u32>().map_err(|e| e.to_string())?);
                }
                "LUT_1D_SIZE" => {
                    return Err("1D LUTs are not supported in 3D pipeline".into());
                }
                "DOMAIN_MIN" => {
                    if parts.len() >= 4 {
                        domain_min = [
                            parts[1].parse().unwrap_or(0.0),
                            parts[2].parse().unwrap_or(0.0),
                            parts[3].parse().unwrap_or(0.0),
                        ];
                    }
                }
                "DOMAIN_MAX" => {
                    if parts.len() >= 4 {
                        domain_max = [
                            parts[1].parse().unwrap_or(1.0),
                            parts[2].parse().unwrap_or(1.0),
                            parts[3].parse().unwrap_or(1.0),
                        ];
                    }
                }
                _ => {
                    if parts.len() == 3 {
                        if let (Ok(r), Ok(g), Ok(b)) = (
                            parts[0].parse::<f32>(),
                            parts[1].parse::<f32>(),
                            parts[2].parse::<f32>(),
                        ) {
                            raw_samples.push([r, g, b]);
                        }
                    }
                }
            }
        }

        let size = lut_size.ok_or_else(|| "Missing LUT_3D_SIZE header in .cube file".to_string())?;
        let expected_count = (size * size * size) as usize;

        if raw_samples.len() != expected_count {
            return Err(format!(
                "LUT data length mismatch: expected {} points ({}x{}x{}), got {}",
                expected_count, size, size, size, raw_samples.len()
            ));
        }

        let mut rgba8_data = Vec::with_capacity(expected_count * 4);
        let range_r = (domain_max[0] - domain_min[0]).max(1e-6);
        let range_g = (domain_max[1] - domain_min[1]).max(1e-6);
        let range_b = (domain_max[2] - domain_min[2]).max(1e-6);

        for [r, g, b] in raw_samples {
            let norm_r = ((r - domain_min[0]) / range_r).clamp(0.0, 1.0);
            let norm_g = ((g - domain_min[1]) / range_g).clamp(0.0, 1.0);
            let norm_b = ((b - domain_min[2]) / range_b).clamp(0.0, 1.0);

            rgba8_data.push((norm_r * 255.0).round() as u8);
            rgba8_data.push((norm_g * 255.0).round() as u8);
            rgba8_data.push((norm_b * 255.0).round() as u8);
            rgba8_data.push(255u8);
        }

        Ok(Self {
            title,
            size,
            domain_min,
            domain_max,
            rgba8_data,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_lut_generation() {
        let lut = ParsedLut3D::create_identity(2);
        assert_eq!(lut.size, 2);
        assert_eq!(lut.rgba8_data.len(), 2 * 2 * 2 * 4);
        // (0,0,0) -> [0, 0, 0, 255]
        assert_eq!(&lut.rgba8_data[0..4], &[0, 0, 0, 255]);
        // (1,1,1) -> [255, 255, 255, 255]
        let last_idx = lut.rgba8_data.len() - 4;
        assert_eq!(&lut.rgba8_data[last_idx..], &[255, 255, 255, 255]);
    }

    #[test]
    fn test_cube_str_parser() {
        let cube_content = r#"
# Test Cube LUT
TITLE "Warm Golden"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
"#;
        let parsed = ParsedLut3D::parse_cube_str(cube_content).expect("Failed to parse cube string");
        assert_eq!(parsed.title, "Warm Golden");
        assert_eq!(parsed.size, 2);
        assert_eq!(parsed.rgba8_data.len(), 32);
    }
}
