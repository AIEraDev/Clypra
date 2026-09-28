use super::surface::VideoSurface;
use super::types::{ColorSpace, MediaTime};
use serde::{Deserialize, Serialize};

/// Color metadata describing color primaries, transfer functions, and range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ColorMetadata {
    pub primaries: ColorSpace,
    pub is_full_range: bool,
    pub bit_depth: u8,
}

impl Default for ColorMetadata {
    fn default() -> Self {
        Self {
            primaries: ColorSpace::Rec709,
            is_full_range: false,
            bit_depth: 8,
        }
    }
}

/// A decoded video frame produced by the media engine data plane.
/// Decoupled from CPU byte representations; backed directly by a VideoSurface.
#[derive(Debug, Clone)]
pub struct VideoFrame {
    /// ID of the media asset this frame was decoded from
    pub asset_id: String,
    /// Presentation timestamp (authoritative media time)
    pub pts: MediaTime,
    /// Duration for which this frame is valid
    pub duration: MediaTime,
    /// Seek/scrub generation ID that requested this frame
    pub generation: u64,
    /// The GPU or system memory surface holding the pixel data
    pub surface: VideoSurface,
    /// Color space and range metadata
    pub color: ColorMetadata,
}

impl VideoFrame {
    pub fn new(
        asset_id: impl Into<String>,
        pts: MediaTime,
        duration: MediaTime,
        generation: u64,
        surface: VideoSurface,
        color: ColorMetadata,
    ) -> Self {
        Self {
            asset_id: asset_id.into(),
            pts,
            duration,
            generation,
            surface,
            color,
        }
    }

    #[inline]
    pub fn contains_pts(&self, target: MediaTime) -> bool {
        target >= self.pts && target < (self.pts + self.duration)
    }
}
