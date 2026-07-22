//! Thumbnail Pyramid Architecture — Phase 2 backend types
//!
//! Additive module. Existing decode_frames_streaming is untouched until
//! wired in a later step. All new types live here.
//!
//! Key structures:
//!   SpatialTier         — L0–L3 resolution levels (new, replaces ResolutionTier)
//!   FrameContentHash    — content-addressed frame identity (SHA-256 substitute via FNV-1a)
//!   TierCacheKey        — (FrameContentHash, SpatialTier)
//!   BackendFrameCache   — raw RGBA at full res, 180 MB budget
//!   BackendTierCache    — downsampled RGBA per tier, 120 MB budget
//!   RenderArtifact      — canonical backend→frontend transfer object

use dashmap::DashMap;
use once_cell::sync::Lazy;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::geometry::fit_preserving_aspect_aligned;

// ─── SpatialTier ─────────────────────────────────────────────────────────────

/// Four-tier spatial resolution pyramid.
/// Dims are spec-defined; widths are multiples of 4.
/// Heights target 16:9; texture alignment (mult of 4) is enforced on the
/// frontend after DPR multiplication.
///
/// CRITICAL: These dimensions MUST match src/lib/renderEngine/types.ts SPATIAL_TIER_DIMS
/// Any change here must be reflected on the frontend to prevent thumbnail blur/stretching.
///
/// ResolutionTier (Tier1x/Tier2x) is kept as a deprecated alias in
/// thumbnail_engine.rs during the transition period.
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

// ─── FrameContentHash ─────────────────────────────────────────────────────────

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

// ─── AtlasCacheKey ─────────────────────────────────────────────────────────────

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

// ─── TierCacheKey ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TierCacheKey {
    pub content_hash: FrameContentHash,
    pub tier: SpatialTier,
}

// ─── Raw frame (full resolution, pre-downsampling) ───────────────────────────

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

// ─── Tier frame (downsampled per SpatialTier) ────────────────────────────────

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

// ─── Stability Score (R20) ───────────────────────────────────────────────────

/// Per-entry reentry penalty, tracked outside TierRgbaFrame so it persists
/// across eviction/reload cycles for the same TierCacheKey.
#[derive(Debug)]
struct ReentryRecord {
    penalty: f64,
    last_evicted: Option<Instant>,
}

impl ReentryRecord {
    fn new() -> Self {
        Self {
            penalty: 1.0,
            last_evicted: None,
        }
    }

    /// Called when an entry is evicted. Applies ×1.5 if re-evicted within 30s.
    fn on_evict(&mut self) {
        let now = Instant::now();
        if let Some(last) = self.last_evicted {
            if now.duration_since(last) < Duration::from_secs(30) {
                self.penalty = (self.penalty * 1.5).min(4.0);
            }
        }
        // Decay existing penalty by 0.95 per 60s elapsed
        if let Some(last) = self.last_evicted {
            let elapsed_mins = now.duration_since(last).as_secs_f64() / 60.0;
            self.penalty *= 0.95_f64.powf(elapsed_mins);
        }
        self.last_evicted = Some(now);
    }
}

/// Stability score = decodeCost × viewportFreq × reentryPenalty (R20).
/// Higher score = less likely to be evicted.
fn stability_score(frame: &TierRgbaFrame, decode_cost: f64, reentry_penalty: f64) -> f64 {
    let access_count = frame.access_count.load(Ordering::Relaxed);
    let recency = {
        let secs = frame.seconds_since_access();
        if secs < 5 {
            1.0
        } else if secs < 30 {
            0.7
        } else if secs < 120 {
            0.4
        } else {
            0.1
        }
    };
    let viewport_freq = (access_count as f64 / 10.0).min(1.0) * recency;
    decode_cost * viewport_freq * reentry_penalty
}

// ─── BackendFrameCache ───────────────────────────────────────────────────────

/// Raw RGBA at full resolution. 60% of 300 MB = 180 MB budget.
///
/// NOTE (R24): At 4K (31.6 MB/frame) this holds ~5 frames.
/// Tile-Based Decode is a future requirement before 8K scaling is viable.
pub struct BackendFrameCache {
    entries: DashMap<FrameContentHash, Arc<RawRgbaFrame>>,
    total_bytes: AtomicU64,
}

const FRAME_CACHE_BUDGET: u64 = 180 * 1024 * 1024; // 180 MB

impl Default for BackendFrameCache {
    fn default() -> Self {
        Self::new()
    }
}

impl BackendFrameCache {
    pub fn new() -> Self {
        Self {
            entries: DashMap::new(),
            total_bytes: AtomicU64::new(0),
        }
    }

    pub fn get(&self, hash: &FrameContentHash) -> Option<Arc<RawRgbaFrame>> {
        self.entries.get(hash).map(|e| e.clone())
    }

    pub fn insert(&self, hash: FrameContentHash, frame: Arc<RawRgbaFrame>) {
        let bytes = frame.byte_size;
        self.entries.insert(hash, frame);
        self.total_bytes.fetch_add(bytes, Ordering::Relaxed);
        self.evict_if_needed();
    }

    pub fn contains(&self, hash: &FrameContentHash) -> bool {
        self.entries.contains_key(hash)
    }

    fn evict_if_needed(&self) {
        if self.total_bytes.load(Ordering::Relaxed) <= FRAME_CACHE_BUDGET {
            return;
        }
        // Evict oldest (decoded_at) until under budget
        let mut entries: Vec<_> = self
            .entries
            .iter()
            .map(|e| (e.key().clone(), e.value().decoded_at, e.value().byte_size))
            .collect();
        entries.sort_by_key(|(_, t, _)| *t); // oldest first

        for (hash, _, bytes) in entries {
            self.entries.remove(&hash);
            self.total_bytes.fetch_sub(bytes, Ordering::Relaxed);
            if self.total_bytes.load(Ordering::Relaxed) <= FRAME_CACHE_BUDGET {
                break;
            }
        }
    }
}

// ─── BackendTierCache ─────────────────────────────────────────────────────────

/// Downsampled RGBA per (FrameContentHash, SpatialTier). 40% of 300 MB = 120 MB.
pub struct BackendTierCache {
    entries: DashMap<TierCacheKey, Arc<TierRgbaFrame>>,
    reentry: DashMap<TierCacheKey, std::sync::Mutex<ReentryRecord>>,
    total_bytes: AtomicU64,
    eviction_warnings: DashMap<TierCacheKey, AtomicU32>,
}

const TIER_CACHE_BUDGET: u64 = 120 * 1024 * 1024; // 120 MB
const TIER_INACTIVE_EVICT_SECS: u64 = 10;

impl Default for BackendTierCache {
    fn default() -> Self {
        Self::new()
    }
}

impl BackendTierCache {
    pub fn new() -> Self {
        Self {
            entries: DashMap::new(),
            reentry: DashMap::new(),
            total_bytes: AtomicU64::new(0),
            eviction_warnings: DashMap::new(),
        }
    }

    pub fn get(&self, key: &TierCacheKey) -> Option<Arc<TierRgbaFrame>> {
        let frame = self.entries.get(key)?.clone();
        frame.touch();
        Some(frame)
    }

    pub fn contains(&self, key: &TierCacheKey) -> bool {
        self.entries.contains_key(key)
    }

    pub fn insert(&self, key: TierCacheKey, frame: Arc<TierRgbaFrame>) {
        let bytes = frame.byte_size;
        self.entries.insert(key, frame);
        self.total_bytes.fetch_add(bytes, Ordering::Relaxed);
        self.evict_if_needed();
    }

    /// Evict entries inactive for >10s (R18 tier inactive rule).
    pub fn evict_inactive(&self) {
        let keys_to_evict: Vec<TierCacheKey> = self
            .entries
            .iter()
            .filter(|e| e.value().seconds_since_access() > TIER_INACTIVE_EVICT_SECS)
            .map(|e| e.key().clone())
            .collect();

        for key in keys_to_evict {
            self.evict_key(&key);
        }
    }

    fn evict_key(&self, key: &TierCacheKey) {
        if let Some((_, frame)) = self.entries.remove(key) {
            self.total_bytes
                .fetch_sub(frame.byte_size, Ordering::Relaxed);
            // Update reentry record
            self.reentry
                .entry(key.clone())
                .or_insert_with(|| std::sync::Mutex::new(ReentryRecord::new()))
                .value()
                .lock()
                .map(|mut r| r.on_evict())
                .ok();
            // Track warning count (R20: warn if evicted 3× within 60s)
            let count = self
                .eviction_warnings
                .entry(key.clone())
                .or_insert_with(|| AtomicU32::new(0))
                .fetch_add(1, Ordering::Relaxed)
                + 1;
            if count >= 3 {
                eprintln!(
                    "[BackendTierCache] ⚠ key {:?} evicted {} times — possible thrash",
                    key.content_hash.0, count
                );
            }
        }
    }

    fn evict_if_needed(&self) {
        if self.total_bytes.load(Ordering::Relaxed) <= TIER_CACHE_BUDGET {
            return;
        }
        // Score all entries; evict lowest-stability first
        let mut scored: Vec<(TierCacheKey, f64)> = self
            .entries
            .iter()
            .map(|e| {
                let key = e.key().clone();
                let frame = e.value();
                let decode_cost = decode_cost_weight(frame.tier);
                let reentry = self
                    .reentry
                    .get(&key)
                    .and_then(|r| r.lock().ok().map(|rr| rr.penalty))
                    .unwrap_or(1.0);
                let score = stability_score(frame, decode_cost, reentry);
                (key, score)
            })
            .collect();

        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        for (key, _) in scored {
            if self.total_bytes.load(Ordering::Relaxed) <= TIER_CACHE_BUDGET {
                break;
            }
            self.evict_key(&key);
        }
    }
}

/// Decode cost weight by tier (smaller tier = cheaper; larger tier = more
/// expensive to re-decode). Used in stability score to protect expensive frames.
fn decode_cost_weight(tier: SpatialTier) -> f64 {
    match tier {
        SpatialTier::L0 => 0.5,
        SpatialTier::L1 => 0.8,
        SpatialTier::L2 => 1.2,
        SpatialTier::L3 => 2.0,
    }
}

// ─── Global caches ────────────────────────────────────────────────────────────

pub static FRAME_CACHE: Lazy<BackendFrameCache> = Lazy::new(BackendFrameCache::new);
pub static TIER_CACHE: Lazy<BackendTierCache> = Lazy::new(BackendTierCache::new);

// ─── RenderArtifact ──────────────────────────────────────────────────────────

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

// ─── In-flight dedup map (R12) ────────────────────────────────────────────────

/// Key: "${content_hash}:${tier_label}" — prevents duplicate parallel decodes
/// for the same (frame, tier) combination.
pub static IN_FLIGHT_TIER: Lazy<DashMap<String, ()>> = Lazy::new(DashMap::new);

pub fn tier_inflight_key(hash: &FrameContentHash, tier: SpatialTier) -> String {
    format!("{}:{}", hash.0, tier.label())
}

// ─── Pyramid Downsample ──────────────────────────────────────────────────────

/// Decode-once parallel pyramid (R2).
/// Given raw full-resolution RGBA, produce all requested tiers in parallel
/// using rayon. Each tier uses LANCZOS via ffmpeg software scaling.
///
/// Returns Vec of (SpatialTier, Arc<TierRgbaFrame>).
pub fn downsample_pyramid(
    raw: &RawRgbaFrame,
    tiers: &[SpatialTier],
) -> Vec<(SpatialTier, Result<Arc<TierRgbaFrame>, String>)> {
    tiers
        .par_iter()
        .map(|&tier| {
            let (out_w, out_h) = aspect_preserving_tier_dims(raw.width, raw.height, tier);
            let result = scale_rgba_lanczos(&raw.data, raw.width, raw.height, out_w, out_h)
                .map(|data| Arc::new(TierRgbaFrame::new(data, out_w, out_h, tier)));
            (tier, result)
        })
        .collect()
}

/// Calculate aspect-preserving dimensions for a spatial tier.
///
/// Wrapper around shared geometry utility with tier-specific logic.
/// DEPRECATED: Use geometry::fit_preserving_aspect_aligned directly.
/// Kept for backward compatibility with existing call sites.
pub fn aspect_preserving_tier_dims(src_w: u32, src_h: u32, tier: SpatialTier) -> (u32, u32) {
    let (tier_w, tier_h) = tier.dims();
    fit_preserving_aspect_aligned(src_w, src_h, tier_w, tier_h)
}

/// Scale an RGBA buffer using FFmpeg LANCZOS scaler.
pub fn scale_rgba_lanczos(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    use ffmpeg_next as ffmpeg;
    use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

    let mut src_frame = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::RGBA, src_w, src_h);
    let stride = src_frame.stride(0);
    let data = src_frame.data_mut(0);
    for y in 0..src_h as usize {
        let dst_off = y * stride;
        let src_off = y * src_w as usize * 4;
        data[dst_off..dst_off + src_w as usize * 4]
            .copy_from_slice(&src[src_off..src_off + src_w as usize * 4]);
    }

    let mut scaler = Context::get(
        ffmpeg::format::Pixel::RGBA,
        src_w,
        src_h,
        ffmpeg::format::Pixel::RGBA,
        dst_w,
        dst_h,
        Flags::LANCZOS,
    )
    .map_err(|e| e.to_string())?;

    let mut dst_frame = ffmpeg::frame::Video::empty();
    scaler
        .run(&src_frame, &mut dst_frame)
        .map_err(|e| e.to_string())?;

    let stride = dst_frame.stride(0);
    let out = dst_frame.data(0);
    let mut result = Vec::with_capacity(dst_w as usize * dst_h as usize * 4);
    for y in 0..dst_h as usize {
        let off = y * stride;
        result.extend_from_slice(&out[off..off + dst_w as usize * 4]);
    }
    Ok(result)
}

// ─── Progress Event (R16) ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ExtractionProgressEvent {
    pub clip_id: String,
    pub spatial_tier: SpatialTier,
    pub progress: f32, // 0.0–1.0
    pub frames_done: u32,
    pub frames_total: u32,
    pub cancelled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgba(width: u32, height: u32) -> Vec<u8> {
        vec![128; (width * height * 4) as usize]
    }

    fn assert_aspect_close(width: u32, height: u32, expected: f64) {
        let actual = width as f64 / height as f64;
        assert!(
            (actual - expected).abs() < 0.03,
            "aspect {}x{} = {}, expected {}",
            width,
            height,
            actual,
            expected
        );
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_landscape_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1920, 1080, SpatialTier::L2);

        assert_eq!((width, height), (320, 180));
        assert_aspect_close(width, height, 16.0 / 9.0);
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_portrait_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1080, 1920, SpatialTier::L2);

        assert_eq!((width, height), (180, 320));
        assert_ne!((width, height), SpatialTier::L2.dims());
        assert_aspect_close(width, height, 9.0 / 16.0);
    }

    #[test]
    fn aspect_preserving_tier_dims_keeps_square_ratio() {
        let (width, height) = aspect_preserving_tier_dims(1000, 1000, SpatialTier::L1);

        assert_eq!((width, height), (240, 240));
        assert_aspect_close(width, height, 1.0);
    }

    #[test]
    fn downsample_pyramid_reports_actual_aspect_preserved_dimensions() {
        ffmpeg_next::init().expect("ffmpeg init");
        let raw = RawRgbaFrame::new(solid_rgba(18, 32), 18, 32);
        let results = downsample_pyramid(&raw, &[SpatialTier::L0]);
        let frame = results
            .into_iter()
            .next()
            .expect("tier result")
            .1
            .expect("downsample result");

        assert_eq!((frame.width, frame.height), (92, 160));
        assert_eq!(frame.data.len(), (frame.width * frame.height * 4) as usize);
        assert_aspect_close(frame.width, frame.height, 18.0 / 32.0);
    }
}
