#[derive(Debug, Clone, Copy)]
pub struct DisplayGeometry {
    pub encoded_width: u32,
    pub encoded_height: u32,
    pub display_width: u32,
    pub display_height: u32,
    pub sar_num: i32,
    pub sar_den: i32,
    pub rotation: u32,
}

/// Maximum safe display dimension to prevent OOM allocations on corrupted video metadata
pub const MAX_DISPLAY_DIMENSION: u32 = 8192;

impl DisplayGeometry {
    pub fn from_encoded(width: u32, height: u32, sar: (i32, i32), rotation: u32) -> Self {
        if width == 0 || height == 0 {
            return Self {
                encoded_width: width,
                encoded_height: height,
                display_width: 0,
                display_height: 0,
                sar_num: sar.0,
                sar_den: sar.1,
                rotation,
            };
        }

        let (display_w, display_h) = if sar.0 > 0 && sar.1 > 0 && sar.0 != sar.1 {
            let ratio = (sar.0 as f64) / (sar.1 as f64);
            // Cap extreme SAR ratios between 1:4 and 4:1 to prevent allocation blowups
            let clamped_ratio = ratio.clamp(0.25, 4.0);
            let w = ((width as f64) * clamped_ratio).round() as u32;
            (
                w.clamp(1, MAX_DISPLAY_DIMENSION),
                height.clamp(1, MAX_DISPLAY_DIMENSION),
            )
        } else {
            (
                width.clamp(1, MAX_DISPLAY_DIMENSION),
                height.clamp(1, MAX_DISPLAY_DIMENSION),
            )
        };

        let (final_w, final_h) = if rotation == 90 || rotation == 270 {
            (display_h, display_w)
        } else {
            (display_w, display_h)
        };

        Self {
            encoded_width: width,
            encoded_height: height,
            display_width: final_w,
            display_height: final_h,
            sar_num: sar.0,
            sar_den: sar.1,
            rotation,
        }
    }
}

