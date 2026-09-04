//! Real-Time Video Analysis Scopes Engine.
//!
//! Provides high-performance, frame-accurate statistical analysis for:
//! 1. **Histogram:** 256-bin frequency distribution for Luma, R, G, B channels.
//! 2. **Waveform:** Horizontal scanline intensity profile across 256 columns (0--100 IRE).
//! 3. **RGB Parade:** Side-by-side Red, Green, and Blue column intensity profiles.
//! 4. **Vectorscope:** Polar Cb/Cr chroma saturation & hue distribution with skin-tone reference line.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeType {
    Histogram,
    Waveform,
    RgbParade,
    Vectorscope,
    All,
}

/// 256-bin channel histogram statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistogramData {
    pub luma: Vec<u32>,
    pub red: Vec<u32>,
    pub green: Vec<u32>,
    pub blue: Vec<u32>,
    pub max_bin_count: u32,
}

/// $256 \times 256$ 2D density grid for Waveform or Vectorscope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeGridData {
    pub width: u32,
    pub height: u32,
    /// 8-bit density values [0..255] where 255 = highest point concentration.
    pub data: Vec<u8>,
}

/// Side-by-side RGB Parade data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbParadeData {
    pub width: u32,
    pub height: u32,
    pub red: Vec<u8>,
    pub green: Vec<u8>,
    pub blue: Vec<u8>,
}

/// Complete video scope telemetry payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoScopePayload {
    pub histogram: Option<HistogramData>,
    pub waveform: Option<ScopeGridData>,
    pub rgb_parade: Option<RgbParadeData>,
    pub vectorscope: Option<ScopeGridData>,
}

/// Analyze raw RGBA8 image buffer and compute requested video scope metrics.
pub fn compute_video_scopes(
    rgba_bytes: &[u8],
    width: u32,
    height: u32,
    scope_type: ScopeType,
) -> Result<VideoScopePayload, String> {
    let expected_len = (width * height * 4) as usize;
    if rgba_bytes.len() < expected_len {
        return Err(format!(
            "Buffer underflow: expected {} bytes for {}x{}, got {}",
            expected_len,
            width,
            height,
            rgba_bytes.len()
        ));
    }

    let mut payload = VideoScopePayload {
        histogram: None,
        waveform: None,
        rgb_parade: None,
        vectorscope: None,
    };

    let compute_all = scope_type == ScopeType::All;

    // 1. Histogram
    if compute_all || scope_type == ScopeType::Histogram {
        let mut luma = [0u32; 256];
        let mut red = [0u32; 256];
        let mut green = [0u32; 256];
        let mut blue = [0u32; 256];

        for pixel in rgba_bytes.as_chunks::<4>().0 {
            let r = pixel[0] as usize;
            let g = pixel[1] as usize;
            let b = pixel[2] as usize;
            // ITU-R BT.709 standard luma coefficients
            let y = ((r as f32 * 0.2126) + (g as f32 * 0.7152) + (b as f32 * 0.0722))
                .round()
                .clamp(0.0, 255.0) as usize;

            red[r] += 1;
            green[g] += 1;
            blue[b] += 1;
            luma[y] += 1;
        }

        let mut max_count = 0u32;
        for i in 0..256 {
            max_count = max_count
                .max(luma[i])
                .max(red[i])
                .max(green[i])
                .max(blue[i]);
        }

        payload.histogram = Some(HistogramData {
            luma: luma.to_vec(),
            red: red.to_vec(),
            green: green.to_vec(),
            blue: blue.to_vec(),
            max_bin_count: max_count.max(1),
        });
    }

    // 2. Waveform (256 columns x 256 IRE vertical bins)
    if compute_all || scope_type == ScopeType::Waveform {
        const GRID_W: usize = 256;
        const GRID_H: usize = 256;
        let mut counts = vec![0u32; GRID_W * GRID_H];

        for y in 0..height {
            for x in 0..width {
                let offset = ((y * width + x) * 4) as usize;
                let r = rgba_bytes[offset] as f32;
                let g = rgba_bytes[offset + 1] as f32;
                let b = rgba_bytes[offset + 2] as f32;
                let luma_val = ((r * 0.2126) + (g * 0.7152) + (b * 0.0722)).clamp(0.0, 255.0);

                let col = ((x as f32 / width as f32) * (GRID_W as f32 - 1.0)).round() as usize;
                // IRE 0 is bottom (row 0 in display, row 255 in image grid)
                let row = (GRID_H - 1).saturating_sub(luma_val.round() as usize);

                let idx = row * GRID_W + col;
                if idx < counts.len() {
                    counts[idx] += 1;
                }
            }
        }

        // Normalize density to [0..255] with log scaling for high dynamic contrast
        let max_density = counts.iter().copied().max().unwrap_or(1).max(1) as f32;
        let mut data = Vec::with_capacity(GRID_W * GRID_H);
        for count in counts {
            if count == 0 {
                data.push(0);
            } else {
                let norm = ((count as f32).ln() / max_density.ln()).clamp(0.0, 1.0);
                data.push((norm * 255.0) as u8);
            }
        }

        payload.waveform = Some(ScopeGridData {
            width: GRID_W as u32,
            height: GRID_H as u32,
            data,
        });
    }

    // 3. RGB Parade (3 x 128 cols x 256 bins)
    if compute_all || scope_type == ScopeType::RgbParade {
        const PARADE_W: usize = 128;
        const PARADE_H: usize = 256;
        let mut r_counts = vec![0u32; PARADE_W * PARADE_H];
        let mut g_counts = vec![0u32; PARADE_W * PARADE_H];
        let mut b_counts = vec![0u32; PARADE_W * PARADE_H];

        for y in 0..height {
            for x in 0..width {
                let offset = ((y * width + x) * 4) as usize;
                let r = rgba_bytes[offset];
                let g = rgba_bytes[offset + 1];
                let b = rgba_bytes[offset + 2];

                let col = ((x as f32 / width as f32) * (PARADE_W as f32 - 1.0)).round() as usize;
                let r_row = (PARADE_H - 1).saturating_sub(r as usize);
                let g_row = (PARADE_H - 1).saturating_sub(g as usize);
                let b_row = (PARADE_H - 1).saturating_sub(b as usize);

                r_counts[r_row * PARADE_W + col] += 1;
                g_counts[g_row * PARADE_W + col] += 1;
                b_counts[b_row * PARADE_W + col] += 1;
            }
        }

        let normalize_parade = |counts: Vec<u32>| -> Vec<u8> {
            let max_val = counts.iter().copied().max().unwrap_or(1).max(1) as f32;
            counts
                .into_iter()
                .map(|c| {
                    if c == 0 {
                        0
                    } else {
                        (((c as f32).ln() / max_val.ln()).clamp(0.0, 1.0) * 255.0) as u8
                    }
                })
                .collect()
        };

        payload.rgb_parade = Some(RgbParadeData {
            width: PARADE_W as u32,
            height: PARADE_H as u32,
            red: normalize_parade(r_counts),
            green: normalize_parade(g_counts),
            blue: normalize_parade(b_counts),
        });
    }

    // 4. Vectorscope (256 x 256 polar chroma grid)
    if compute_all || scope_type == ScopeType::Vectorscope {
        const VEC_DIM: usize = 256;
        let mut counts = vec![0u32; VEC_DIM * VEC_DIM];
        let center = (VEC_DIM as f32) * 0.5;

        for pixel in rgba_bytes.as_chunks::<4>().0 {
            let r = pixel[0] as f32 / 255.0;
            let g = pixel[1] as f32 / 255.0;
            let b = pixel[2] as f32 / 255.0;

            // BT.709 Cb/Cr chroma coordinates: range [-0.5, 0.5]
            let cb = -0.114572 * r - 0.385428 * g + 0.5 * b;
            let cr = 0.5 * r - 0.454153 * g - 0.045847 * b;

            // Scale to grid with center at (128, 128)
            let gx = (center + cb * 2.0 * (center - 4.0))
                .round()
                .clamp(0.0, (VEC_DIM - 1) as f32) as usize;
            let gy = (center - cr * 2.0 * (center - 4.0))
                .round()
                .clamp(0.0, (VEC_DIM - 1) as f32) as usize;

            let idx = gy * VEC_DIM + gx;
            if idx < counts.len() {
                counts[idx] += 1;
            }
        }

        let max_val = counts.iter().copied().max().unwrap_or(1).max(1) as f32;
        let data: Vec<u8> = counts
            .into_iter()
            .map(|c| {
                if c == 0 {
                    0
                } else {
                    (((c as f32).ln() / max_val.ln()).clamp(0.0, 1.0) * 255.0) as u8
                }
            })
            .collect();

        payload.vectorscope = Some(ScopeGridData {
            width: VEC_DIM as u32,
            height: VEC_DIM as u32,
            data,
        });
    }

    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_histogram_solid_color() {
        let width = 10;
        let height = 10;
        // 100 pixels of pure Red [255, 0, 0, 255]
        let mut pixels = Vec::with_capacity(400);
        for _ in 0..100 {
            pixels.extend_from_slice(&[255, 0, 0, 255]);
        }

        let scopes = compute_video_scopes(&pixels, width, height, ScopeType::Histogram).unwrap();
        let hist = scopes.histogram.unwrap();

        assert_eq!(hist.red[255], 100);
        assert_eq!(hist.red[0], 0);
        assert_eq!(hist.green[0], 100);
        assert_eq!(hist.blue[0], 100);
        assert_eq!(hist.max_bin_count, 100);
    }

    #[test]
    fn test_waveform_and_vectorscope_dimensions() {
        let width = 64;
        let height = 64;
        let mut pixels = Vec::with_capacity(64 * 64 * 4);
        for i in 0..(64 * 64) {
            let val = (i % 256) as u8;
            pixels.extend_from_slice(&[val, val, val, 255]);
        }

        let scopes = compute_video_scopes(&pixels, width, height, ScopeType::All).unwrap();
        let wf = scopes.waveform.unwrap();
        assert_eq!(wf.width, 256);
        assert_eq!(wf.height, 256);
        assert_eq!(wf.data.len(), 256 * 256);

        let vec = scopes.vectorscope.unwrap();
        assert_eq!(vec.width, 256);
        assert_eq!(vec.height, 256);
        assert_eq!(vec.data.len(), 256 * 256);
    }
}
