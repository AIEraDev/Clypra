use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::frame::{RawRgbaFrame, TierRgbaFrame};
use super::hash::{FrameContentHash, TierCacheKey};
use super::tiers::SpatialTier;

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

    pub fn clear(&self) {
        self.entries.clear();
        self.total_bytes.store(0, Ordering::Relaxed);
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

    pub fn clear(&self) {
        self.entries.clear();
        self.reentry.clear();
        self.eviction_warnings.clear();
        self.total_bytes.store(0, Ordering::Relaxed);
    }

    pub fn insert(&self, key: TierCacheKey, frame: Arc<TierRgbaFrame>) {
        let new_bytes = frame.byte_size;
        if let Some(old) = self.entries.insert(key.clone(), frame) {
            self.total_bytes.fetch_sub(old.byte_size, Ordering::Relaxed);
        }
        self.total_bytes.fetch_add(new_bytes, Ordering::Relaxed);
        self.evict_if_needed();
    }

    /// Evict entries inactive for >10s (R18 tier inactive rule).
    /// L0 is the filmstrip fallback floor — never time-evict it.
    pub fn evict_inactive(&self) {
        let keys_to_evict: Vec<TierCacheKey> = self
            .entries
            .iter()
            .filter(|e| {
                e.value().tier != SpatialTier::L0
                    && e.value().seconds_since_access() > TIER_INACTIVE_EVICT_SECS
            })
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
            crate::filmstrip_engine::metrics::METRICS
                .for_tier(key.tier)
                .evictions
                .fetch_add(1, Ordering::Relaxed);
            // Update reentry record
            self.reentry
                .entry(key.clone())
                .or_insert_with(|| std::sync::Mutex::new(ReentryRecord::new()))
                .value()
                .lock()
                .map(|mut r| r.on_evict())
                .ok();
        }
    }

    fn evict_if_needed(&self) {
        self.evict_down_to(TIER_CACHE_BUDGET);
    }

    fn evict_down_to(&self, budget: u64) {
        if self.total_bytes.load(Ordering::Relaxed) <= budget {
            return;
        }

        // Dense tiers are sacrificial. L0 is the fallback floor and is only
        // evicted after every L1/L2/L3 entry is gone.
        self.evict_scored_until(budget, |frame| frame.tier != SpatialTier::L0);
        if self.total_bytes.load(Ordering::Relaxed) > budget {
            self.evict_scored_until(budget, |_| true);
        }
    }

    fn evict_scored_until(&self, budget: u64, predicate: impl Fn(&TierRgbaFrame) -> bool) {
        let mut scored: Vec<(TierCacheKey, f64)> = self
            .entries
            .iter()
            .filter(|e| predicate(e.value()))
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
            if self.total_bytes.load(Ordering::Relaxed) <= budget {
                break;
            }
            self.evict_key(&key);
        }
    }

    #[cfg(test)]
    pub fn evict_down_to_for_test(&self, budget: u64) {
        self.evict_down_to(budget);
    }

    #[cfg(test)]
    pub fn current_bytes_for_test(&self) -> u64 {
        self.total_bytes.load(Ordering::Relaxed)
    }
}

/// Decode cost weight by tier. L0 is the cheapest to decode but the most
/// expensive to lose — it is the only guaranteed filmstrip fallback floor.
fn decode_cost_weight(tier: SpatialTier) -> f64 {
    match tier {
        SpatialTier::L0 => 4.0,
        SpatialTier::L1 => 2.0,
        SpatialTier::L2 => 1.2,
        SpatialTier::L3 => 0.8,
    }
}

pub static FRAME_CACHE: Lazy<BackendFrameCache> = Lazy::new(BackendFrameCache::new);
pub static TIER_CACHE: Lazy<BackendTierCache> = Lazy::new(BackendTierCache::new);

/// Key: "${content_hash}:${tier_label}" — prevents duplicate parallel decodes
/// for the same (frame, tier) combination.
pub static IN_FLIGHT_TIER: Lazy<DashMap<String, ()>> = Lazy::new(DashMap::new);

pub fn tier_inflight_key(hash: &FrameContentHash, tier: SpatialTier) -> String {
    format!("{}:{}", hash.0, tier.label())
}
