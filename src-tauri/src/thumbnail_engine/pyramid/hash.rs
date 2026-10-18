use super::tiers::SpatialTier;
use serde::{Deserialize, Serialize};

/// Content-addressed frame identity.
/// FNV-1a hash of: videoSourceId, decodeParams, effectGraphVersion,
/// speed, trimRange, fpsNormalization.
///
/// Different from CacheKey (which uses videoId+timestamp) — two clips
/// using the same source at the same timestamp with the same params share
/// the same FrameContentHash and therefore share cached tier data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FrameContentHash(pub String);

impl FrameContentHash {
    /// Compute from the components that affect rendered pixel output.
    pub fn compute(
        video_source_id: &str,
        timestamp_ms: u64,
        effect_graph_version: u32,
        speed: f64, // quantised to 4 dp to avoid float noise
        trim_in_ms: u64,
        trim_out_ms: u64,
        fps_normalized: bool,
    ) -> Self {
        let input = format!(
            "{}:{}:{}:{:.4}:{}:{}:{}",
            video_source_id,
            timestamp_ms,
            effect_graph_version,
            speed,
            trim_in_ms,
            trim_out_ms,
            fps_normalized as u8,
        );
        let hash = fnv1a_64(input.as_bytes());
        Self(format!("{:016x}", hash))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Timestamp rounded to millisecond precision — prevents float drift.
pub fn canonical_timestamp(time_secs: f64) -> u64 {
    (time_secs * 1000.0).round() as u64
}

/// Stable cache identity for atlas-based persistent storage.
/// Key components: video_hash + tier + sampling_strategy + effect_graph_version
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AtlasCacheKey {
    pub video_hash: String,
    pub tier: SpatialTier,
    pub sampling_strategy: String, // e.g., "tile_width:80" or "density:medium"
    pub effect_graph_version: u32,
}

impl AtlasCacheKey {
    pub fn compute(
        video_path: &str,
        tier: SpatialTier,
        sampling_strategy: &str,
        effect_graph_version: u32,
    ) -> Self {
        let video_hash = format!("{:x}", md5::compute(video_path));
        Self {
            video_hash,
            tier,
            sampling_strategy: sampling_strategy.to_string(),
            effect_graph_version,
        }
    }

    pub fn as_cache_key(&self) -> String {
        format!(
            "{}_{}_{}_{}",
            self.video_hash,
            self.tier.label(),
            self.sampling_strategy,
            self.effect_graph_version
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TierCacheKey {
    pub content_hash: FrameContentHash,
    pub tier: SpatialTier,
}
