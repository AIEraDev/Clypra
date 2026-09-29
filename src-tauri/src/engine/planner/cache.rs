//! Budgeted Frame Cache with Surface Pressure Awareness (Phase F)
//!
//! Enforces:
//! - Multi-key indexing: (asset_id, source_time, variant)
//! - Memory budget & LRU/Priority clock eviction
//! - Surface pressure awareness: drops Background and Lookahead frames first

use super::super::frame::VideoFrame;
use super::super::types::MediaTime;
use super::MediaPriority;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

/// Variant of a cached video frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CacheVariant {
    Original,
    Proxy,
}

/// Composite lookup key for cached video frames.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FrameCacheKey {
    pub asset_id: String,
    pub source_time: MediaTime,
    pub variant: CacheVariant,
}

impl FrameCacheKey {
    pub fn original(asset_id: impl Into<String>, source_time: MediaTime) -> Self {
        Self {
            asset_id: asset_id.into(),
            source_time,
            variant: CacheVariant::Original,
        }
    }

    pub fn proxy(asset_id: impl Into<String>, source_time: MediaTime) -> Self {
        Self {
            asset_id: asset_id.into(),
            source_time,
            variant: CacheVariant::Proxy,
        }
    }
}

/// An entry in the frame cache tracking access history and priority.
#[derive(Debug, Clone)]
struct CacheEntry {
    frame: VideoFrame,
    last_access: Instant,
    access_count: u64,
    priority: MediaPriority,
    byte_size: usize,
}

/// Budget-bounded frame cache.
#[derive(Debug)]
pub struct MediaFrameCache {
    max_frames: usize,
    max_bytes: usize,
    current_bytes: usize,
    entries: HashMap<FrameCacheKey, CacheEntry>,
    hits: u64,
    misses: u64,
}

impl MediaFrameCache {
    pub fn new(max_frames: usize, max_bytes: usize) -> Self {
        Self {
            max_frames,
            max_bytes,
            current_bytes: 0,
            entries: HashMap::new(),
            hits: 0,
            misses: 0,
        }
    }

    pub fn hits(&self) -> u64 {
        self.hits
    }

    pub fn misses(&self) -> u64 {
        self.misses
    }

    pub fn hit_ratio(&self) -> f32 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f32 / total as f32
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Looks up a frame in the cache.
    pub fn get(&mut self, key: &FrameCacheKey) -> Option<VideoFrame> {
        if let Some(entry) = self.entries.get_mut(key) {
            self.hits += 1;
            entry.last_access = Instant::now();
            entry.access_count += 1;
            Some(entry.frame.clone())
        } else {
            self.misses += 1;
            None
        }
    }

    /// Inserts a decoded frame into the cache, evicting if budget is exceeded.
    pub fn insert(&mut self, key: FrameCacheKey, frame: VideoFrame, priority: MediaPriority) {
        // Approximate VRAM footprint: width * height * 2 (e.g. for P010 10-bit YUV)
        let byte_size = (frame.surface.width * frame.surface.height * 2) as usize;

        // Ensure capacity before inserting
        while self.entries.len() >= self.max_frames
            || (self.current_bytes + byte_size > self.max_bytes && !self.entries.is_empty())
        {
            if !self.evict_one() {
                break;
            }
        }

        let entry = CacheEntry {
            frame,
            last_access: Instant::now(),
            access_count: 1,
            priority,
            byte_size,
        };

        if let Some(old) = self.entries.insert(key, entry) {
            self.current_bytes = self.current_bytes.saturating_sub(old.byte_size);
        }
        self.current_bytes += byte_size;
    }

    /// Evicts frames proactively when surface pool or memory pressure is detected.
    /// Drops Background and Lookahead frames first, strictly preserving Current and Next.
    pub fn on_surface_pressure(&mut self) -> usize {
        let mut keys_to_evict = Vec::new();

        for (key, entry) in &self.entries {
            if entry.priority <= MediaPriority::Lookahead {
                keys_to_evict.push(key.clone());
            }
        }

        let evicted_count = keys_to_evict.len();
        for key in keys_to_evict {
            if let Some(entry) = self.entries.remove(&key) {
                self.current_bytes = self.current_bytes.saturating_sub(entry.byte_size);
            }
        }
        evicted_count
    }

    /// Evicts the lowest priority and least-recently-used entry.
    fn evict_one(&mut self) -> bool {
        if self.entries.is_empty() {
            return false;
        }

        // Find candidate with lowest priority, then oldest last_access
        let mut best_key = None;
        let mut best_priority = MediaPriority::Current;
        let mut oldest_access = Instant::now();

        for (key, entry) in &self.entries {
            if best_key.is_none()
                || entry.priority < best_priority
                || (entry.priority == best_priority && entry.last_access < oldest_access)
            {
                best_key = Some(key.clone());
                best_priority = entry.priority;
                oldest_access = entry.last_access;
            }
        }

        if let Some(key) = best_key {
            if let Some(entry) = self.entries.remove(&key) {
                self.current_bytes = self.current_bytes.saturating_sub(entry.byte_size);
                return true;
            }
        }

        false
    }

    /// Clears the entire cache.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.current_bytes = 0;
    }

    /// Invalidates all cached frames belonging to a specific asset (e.g. file modified).
    pub fn invalidate_asset(&mut self, asset_id: &str) -> usize {
        let keys_to_remove: Vec<FrameCacheKey> = self
            .entries
            .keys()
            .filter(|k| k.asset_id == asset_id)
            .cloned()
            .collect();

        let count = keys_to_remove.len();
        for key in keys_to_remove {
            if let Some(entry) = self.entries.remove(&key) {
                self.current_bytes = self.current_bytes.saturating_sub(entry.byte_size);
            }
        }
        count
    }
}
