use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone)]
pub enum ExtractionError {
    ProcessSpawn(String),
    CodecError(String),
    Timeout,
    CacheError(String),
    Other(String),
}

impl fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExtractionError::ProcessSpawn(msg) => write!(f, "Process spawn error: {}", msg),
            ExtractionError::CodecError(msg) => write!(f, "Codec error: {}", msg),
            ExtractionError::Timeout => write!(f, "Extraction timed out"),
            ExtractionError::CacheError(msg) => write!(f, "Cache error: {}", msg),
            ExtractionError::Other(msg) => write!(f, "Extraction error: {}", msg),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailTile {
    pub time: f64,
    pub path: String,
    pub density: DensityLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub atlas_coords: Option<AtlasCoords>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasCoords {
    pub col: u32,
    pub row: u32,
    pub thumb_width: u32,
    pub thumb_height: u32,
}

impl ThumbnailTile {
    pub fn from_path(time: f64, path: String, density: DensityLevel) -> Self {
        Self {
            time,
            path,
            density,
            atlas_coords: None,
            actual_width: None,
            actual_height: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_atlas(
        time: f64,
        atlas_path: String,
        density: DensityLevel,
        col: u32,
        row: u32,
        thumb_width: u32,
        thumb_height: u32,
        actual_width: u32,
        actual_height: u32,
    ) -> Self {
        Self {
            time,
            path: atlas_path,
            density,
            atlas_coords: Some(AtlasCoords {
                col,
                row,
                thumb_width,
                thumb_height,
            }),
            actual_width: Some(actual_width),
            actual_height: Some(actual_height),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResolutionTier {
    Tier1x,
    Tier2x,
}

impl ResolutionTier {
    pub fn from_dpr(dpr: f64) -> Self {
        if dpr >= 1.5 {
            ResolutionTier::Tier2x
        } else {
            ResolutionTier::Tier1x
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        match self {
            ResolutionTier::Tier1x => (160, 90),
            ResolutionTier::Tier2x => (320, 180),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ResolutionTier::Tier1x => "1x",
            ResolutionTier::Tier2x => "2x",
        }
    }

    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "1x" => Ok(ResolutionTier::Tier1x),
            "2x" => Ok(ResolutionTier::Tier2x),
            _ => Err(format!("Invalid resolution tier: {}", label)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CacheKey {
    pub video_id: String,
    pub timestamp_ms: u64,
    pub density: DensityLevel,
    pub resolution_tier: ResolutionTier,
}

impl std::fmt::Display for CacheKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{}:{}:{}",
            self.video_id,
            self.timestamp_ms,
            self.density.label(),
            self.resolution_tier.label()
        )
    }
}

impl CacheKey {
    pub fn new(video_path: &str, time: f64, density: DensityLevel, dpr: f64) -> Self {
        let video_id = format!("{:x}", md5::compute(video_path));
        let timestamp_ms = (time * 1000.0).round() as u64;
        let resolution_tier = ResolutionTier::from_dpr(dpr);

        Self {
            video_id,
            timestamp_ms,
            density,
            resolution_tier,
        }
    }

    pub fn from_string(s: &str) -> Result<Self, String> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 4 {
            return Err(format!(
                "Invalid cache key format: expected 4 parts, got {}",
                parts.len()
            ));
        }

        Ok(Self {
            video_id: parts[0].to_string(),
            timestamp_ms: parts[1]
                .parse()
                .map_err(|_| format!("Invalid timestamp: {}", parts[1]))?,
            density: DensityLevel::from_label(parts[2])?,
            resolution_tier: ResolutionTier::from_label(parts[3])?,
        })
    }
}

// CRITICAL: Must match src/types/index.ts DensityLevel enum
// Serialized as lowercase strings via #[serde(rename_all = "lowercase")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DensityLevel {
    Low = 0,
    Medium = 1,
    High = 2,
    Ultra = 3,
}

impl DensityLevel {
    pub fn time_interval(&self) -> f64 {
        match self {
            DensityLevel::Low => 5.0,
            DensityLevel::Medium => 1.0,
            DensityLevel::High => 0.2,
            DensityLevel::Ultra => 0.02,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            DensityLevel::Low => "low",
            DensityLevel::Medium => "medium",
            DensityLevel::High => "high",
            DensityLevel::Ultra => "ultra",
        }
    }

    /// Parse density level from label string
    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "low" => Ok(DensityLevel::Low),
            "medium" => Ok(DensityLevel::Medium),
            "high" => Ok(DensityLevel::High),
            "ultra" => Ok(DensityLevel::Ultra),
            _ => Err(format!("Invalid density level: {}", label)),
        }
    }

    pub fn from_zoom(px_per_sec: f64) -> Self {
        let time_per_thumb = 80.0 / px_per_sec;

        if time_per_thumb > 3.0 {
            DensityLevel::Low
        } else if time_per_thumb > 0.5 {
            DensityLevel::Medium
        } else if time_per_thumb > 0.05 {
            DensityLevel::High
        } else {
            DensityLevel::Ultra
        }
    }

    pub fn higher(&self) -> Option<Self> {
        match self {
            DensityLevel::Low => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Ultra),
            DensityLevel::Ultra => None,
        }
    }

    pub fn lower(&self) -> Option<Self> {
        match self {
            DensityLevel::Ultra => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::Low),
            DensityLevel::Low => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Critical = 0,
    High = 1,
    Normal = 2,
}
