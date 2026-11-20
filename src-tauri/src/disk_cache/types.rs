use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Dedicated cache namespaces for Clypra's multi-tier storage engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheNamespace {
    /// Filmstrip multi-resolution atlases and pyramid LOD tiles
    Thumbnails,
    /// Extracted and normalized audio streams (WAV, AAC, FLAC)
    AudioStems,
    /// Transcoded video preview proxies (H.264 / AAC)
    PreviewProxies,
    /// AI rotoscoping neural masks and segmentations (.clymatte)
    RotoscopeMattes,
    /// Downloaded remote assets (LUTs, filters, stickers, templates)
    RemoteAssets,
    /// Ephemeral scratch renders, active exports in-flight
    Temp,
}

impl CacheNamespace {
    /// Subdirectory name under `<AppCache>/clypra_cache/`
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Thumbnails => "thumbnails",
            Self::AudioStems => "audio",
            Self::PreviewProxies => "proxies",
            Self::RotoscopeMattes => "mattes",
            Self::RemoteAssets => "assets",
            Self::Temp => "temp",
        }
    }

    /// Priority weight for LRU eviction (higher weight = pruned earlier on disk pressure).
    /// Proxies and scratch files are cheapest to regenerate; user assets are preserved.
    pub fn eviction_weight(&self) -> f64 {
        match self {
            Self::PreviewProxies => 1.0,
            Self::Temp => 1.0,
            Self::Thumbnails => 0.8,
            Self::AudioStems => 0.6,
            Self::RotoscopeMattes => 0.4,
            Self::RemoteAssets => 0.2,
        }
    }

    /// All available namespaces.
    pub fn all() -> &'static [CacheNamespace] {
        &[
            Self::Thumbnails,
            Self::AudioStems,
            Self::PreviewProxies,
            Self::RotoscopeMattes,
            Self::RemoteAssets,
            Self::Temp,
        ]
    }
}

/// Metadata record for a single on-disk cache artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskCacheEntry {
    pub path: PathBuf,
    pub namespace: CacheNamespace,
    pub size_bytes: u64,
    pub last_accessed_secs: u64,
    pub created_secs: u64,
}

/// Comprehensive telemetry snapshot across all disk cache namespaces.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedCacheStats {
    pub total_bytes: u64,
    pub limit_bytes: u64,
    pub namespace_bytes: HashMap<String, u64>,
    pub namespace_counts: HashMap<String, usize>,
    pub hit_count: u64,
    pub miss_count: u64,
    pub hit_rate_pct: f64,
    pub eviction_count: u64,
    pub root_dir: String,
}

/// Parameters for targeted or bulk cache purge operations.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PurgeFilter {
    pub namespaces: Option<Vec<CacheNamespace>>,
    pub older_than_secs: Option<u64>,
}

/// Summary report after executing a cache purge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurgeResult {
    pub purged_files: usize,
    pub purged_bytes: u64,
    pub remaining_bytes: u64,
}

/// Diagnostics report after verifying disk cache integrity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityReport {
    pub scanned_files: usize,
    pub quarantined_files: usize,
    pub quarantined_bytes: u64,
    pub errors: Vec<String>,
}
