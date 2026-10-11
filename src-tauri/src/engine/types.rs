use serde::{Deserialize, Serialize};
use std::ops::{Add, AddAssign, Sub, SubAssign};

/// Monotonic, drift-free representation of media time in microseconds (1e-6 seconds).
/// This eliminates floating point rounding errors across long timelines.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
pub struct MediaTime(pub i64);

impl MediaTime {
    pub const ZERO: MediaTime = MediaTime(0);
    pub const SECOND: MediaTime = MediaTime(1_000_000);
    pub const MILLISECOND: MediaTime = MediaTime(1_000);

    #[inline]
    pub fn from_micros(micros: i64) -> Self {
        MediaTime(micros)
    }

    #[inline]
    pub fn from_secs_f64(secs: f64) -> Self {
        MediaTime((secs * 1_000_000.0).round() as i64)
    }

    #[inline]
    pub fn as_micros(&self) -> i64 {
        self.0
    }

    #[inline]
    pub fn as_secs_f64(&self) -> f64 {
        self.0 as f64 / 1_000_000.0
    }

    #[inline]
    pub fn as_frame_index(&self, fps: f64) -> i64 {
        if fps <= 0.0 {
            0
        } else {
            ((self.0 as f64 / 1_000_000.0) * fps).round() as i64
        }
    }

    #[inline]
    pub fn from_frame_index(frame: i64, fps: f64) -> Self {
        if fps <= 0.0 {
            MediaTime::ZERO
        } else {
            MediaTime(((frame as f64 / fps) * 1_000_000.0).round() as i64)
        }
    }
}

impl Add for MediaTime {
    type Output = MediaTime;
    #[inline]
    fn add(self, rhs: MediaTime) -> MediaTime {
        MediaTime(self.0 + rhs.0)
    }
}

impl AddAssign for MediaTime {
    #[inline]
    fn add_assign(&mut self, rhs: MediaTime) {
        self.0 += rhs.0;
    }
}

impl Sub for MediaTime {
    type Output = MediaTime;
    #[inline]
    fn sub(self, rhs: MediaTime) -> MediaTime {
        MediaTime(self.0 - rhs.0)
    }
}

impl SubAssign for MediaTime {
    #[inline]
    fn sub_assign(&mut self, rhs: MediaTime) {
        self.0 -= rhs.0;
    }
}

/// Specifications for the project canvas output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanvasSpec {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub sample_rate: u32,
}

impl Default for CanvasSpec {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 60.0,
            sample_rate: 48000,
        }
    }
}

/// Pixel formats supported by the native engine and GPU pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PixelFormat {
    /// 8-bit YUV 4:2:0 bi-planar (standard SDR hardware decode)
    Nv12,
    /// 10-bit YUV 4:2:0 bi-planar (HDR / 10-bit HEVC/AV1 hardware decode)
    P010,
    /// 8-bit RGBA unorm sRGB (compositor intermediate & display)
    Rgba8UnormSrgb,
    /// 8-bit BGRA unorm sRGB (Windows DXGI swapchain default)
    Bgra8UnormSrgb,
    /// 16-bit float RGBA (wide-gamut / HDR compositing)
    Rgba16Float,
}

/// Color spaces for color management across surfaces and rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ColorSpace {
    Rec709,
    Rec2020,
    DciP3,
    Srgb,
}

/// Video codecs recognized by hardware and software decoders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CodecType {
    H264,
    Hevc,
    Av1,
    Vp9,
    ProRes,
    Unknown,
}

/// Codec profile variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CodecProfile {
    Main,
    Main10,
    High,
    ProRes422,
    ProRes4444,
    Other,
}

/// Chroma subsampling formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChromaSubsampling {
    Yuv420,
    Yuv422,
    Yuv444,
    Rgb,
}

/// 2D geometric transformation applied to a visual layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayerTransform {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation_deg: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
}

impl Default for LayerTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        }
    }
}

/// Compositor blend modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
}

/// Visibility status of a layer at time T.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LayerVisibility {
    Visible,
    Hidden,
    Occluded,
}


#[cfg(test)]
mod tests {
    use super::MediaTime;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn frame_index_round_trips_for_integer_frame_rates(
            frame in -1_000_000i64..1_000_000i64,
            fps in 1u32..241u32,
        ) {
            let time = MediaTime::from_frame_index(frame, fps as f64);
            prop_assert_eq!(time.as_frame_index(fps as f64), frame);
        }

        #[test]
        fn microseconds_round_trip_through_seconds(
            micros in -1_000_000_000_000i64..1_000_000_000_000i64,
        ) {
            let time = MediaTime::from_micros(micros);
            let reconstructed = MediaTime::from_secs_f64(time.as_secs_f64());
            prop_assert_eq!(reconstructed, time);
        }

        #[test]
        fn adding_and_subtracting_time_preserves_the_original_value(
            left in -1_000_000_000i64..1_000_000_000i64,
            right in -1_000_000_000i64..1_000_000_000i64,
        ) {
            let a = MediaTime::from_micros(left);
            let b = MediaTime::from_micros(right);
            prop_assert_eq!((a + b) - b, a);
        }
    }

    #[test]
    fn frame_index_round_trips_at_common_fractional_rates() {
        for fps in [23.976, 24.0, 25.0, 29.97, 30.0, 50.0, 59.94, 60.0, 120.0] {
            for frame in [0, 1, 2, 23, 24, 100, 1_000, 100_000, 1_000_000] {
                let time = MediaTime::from_frame_index(frame, fps);
                assert_eq!(
                    time.as_frame_index(fps),
                    frame,
                    "frame {frame} did not round-trip at {fps} fps"
                );
            }
        }
    }

    #[test]
    fn invalid_frame_rates_map_to_zero_without_division() {
        for fps in [0.0, -1.0, f64::NEG_INFINITY] {
            assert_eq!(MediaTime::from_frame_index(42, fps), MediaTime::ZERO);
            assert_eq!(MediaTime::from_micros(1_000_000).as_frame_index(fps), 0);
        }
    }
}
