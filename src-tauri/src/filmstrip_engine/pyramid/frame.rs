use super::tiers::SpatialTier;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

pub struct RawRgbaFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub decoded_at: Instant,
    pub byte_size: u64,
}

impl RawRgbaFrame {
    pub fn new(data: Vec<u8>, width: u32, height: u32) -> Self {
        let byte_size = data.len() as u64;
        Self {
            data,
            width,
            height,
            decoded_at: Instant::now(),
            byte_size,
        }
    }
}

pub struct TierRgbaFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub tier: SpatialTier,
    pub produced_at: Instant,
    pub last_accessed: std::sync::Mutex<Instant>,
    pub byte_size: u64,
    /// Stability score numerator components (reentry penalty stored separately)
    pub access_count: AtomicU64,
}

impl TierRgbaFrame {
    pub fn new(data: Vec<u8>, width: u32, height: u32, tier: SpatialTier) -> Self {
        let byte_size = data.len() as u64;
        Self {
            data,
            width,
            height,
            tier,
            produced_at: Instant::now(),
            last_accessed: std::sync::Mutex::new(Instant::now()),
            byte_size,
            access_count: AtomicU64::new(1),
        }
    }

    pub fn touch(&self) {
        self.access_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut t) = self.last_accessed.lock() {
            *t = Instant::now();
        }
    }

    pub fn seconds_since_access(&self) -> u64 {
        self.last_accessed
            .lock()
            .map(|t| t.elapsed().as_secs())
            .unwrap_or(0)
    }
}

/// Canonical backend→frontend transfer object (R6).
/// Sent via Tauri channel to the frontend RasterSurface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderArtifact {
    pub frame_id: String,
    pub content_hash: String,
    pub spatial_tier: SpatialTier,
    /// Raw RGBA bytes (transport layer encodes to WebP or SAB on the frontend)
    pub rgba_data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub timestamp_ms: u64,
    pub source: ArtifactSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactSource {
    BackendFrameCache,
    BackendTierCache,
    FreshDecode,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractionProgressEvent {
    pub clip_id: String,
    pub spatial_tier: SpatialTier,
    pub progress: f32, // 0.0–1.0
    pub frames_done: u32,
    pub frames_total: u32,
    pub cancelled: bool,
}
