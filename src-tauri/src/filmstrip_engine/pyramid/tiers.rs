use serde::{Deserialize, Serialize};

/// Four-tier spatial resolution pyramid.
/// Dims are spec-defined; widths are multiples of 4.
/// Heights target 16:9; texture alignment (mult of 4) is enforced on the
/// frontend after DPR multiplication.
///
/// CRITICAL: These dimensions MUST match src/lib/renderEngine/types.ts SPATIAL_TIER_DIMS
/// Any change here must be reflected on the frontend to prevent thumbnail blur/stretching.
///
/// ResolutionTier (Tier1x/Tier2x) is kept as a deprecated alias in
/// filmstrip_engine.rs during the transition period.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum SpatialTier {
    L0 = 0, // 160×90
    L1 = 1, // 240×135
    L2 = 2, // 320×180
    L3 = 3, // 480×270
}

impl SpatialTier {
    /// Base pixel dimensions [width, height] — spec-defined.
    pub fn dims(self) -> (u32, u32) {
        match self {
            SpatialTier::L0 => (160, 90),
            SpatialTier::L1 => (240, 135),
            SpatialTier::L2 => (320, 180),
            SpatialTier::L3 => (480, 270),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            SpatialTier::L0 => "l0",
            SpatialTier::L1 => "l1",
            SpatialTier::L2 => "l2",
            SpatialTier::L3 => "l3",
        }
    }

    pub fn from_label(s: &str) -> Result<Self, String> {
        match s {
            "l0" => Ok(SpatialTier::L0),
            "l1" => Ok(SpatialTier::L1),
            "l2" => Ok(SpatialTier::L2),
            "l3" => Ok(SpatialTier::L3),
            _ => Err(format!("Invalid SpatialTier: {}", s)),
        }
    }

    pub fn all() -> [SpatialTier; 4] {
        [
            SpatialTier::L0,
            SpatialTier::L1,
            SpatialTier::L2,
            SpatialTier::L3,
        ]
    }
}
