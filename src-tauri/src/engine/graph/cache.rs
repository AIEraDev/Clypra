//! Render Graph Cache
//!
//! Stores intermediate rendered branch outputs to enable zero-cost static branch reuse.
//! When overlays, captions, or upper layers change, non-modified video decoding,
//! color grading, and transform passes are bypassed completely.

use super::super::surface::VideoSurface;
use super::node::NodeCacheKey;
use std::collections::HashMap;

/// Cached intermediate pass output with lifetime and memory tracking.
#[derive(Debug, Clone)]
pub struct CachedNodeOutput {
    pub surface: VideoSurface,
    pub last_used_frame: u64,
    pub memory_bytes: usize,
    pub hits: u64,
}

/// Bounded cache for intermediate Render Graph branches.
pub struct RenderGraphCache {
    entries: HashMap<NodeCacheKey, CachedNodeOutput>,
    max_entries: usize,
    max_memory_bytes: usize,
    current_memory_bytes: usize,
    current_frame: u64,
    // Telemetry counters
    pub hit_count: usize,
    pub miss_count: usize,
    pub eviction_count: usize,
}

impl RenderGraphCache {
    pub fn new(max_entries: usize, max_memory_bytes: usize) -> Self {
        Self {
            entries: HashMap::with_capacity(max_entries),
            max_entries,
            max_memory_bytes,
            current_memory_bytes: 0,
            current_frame: 0,
            hit_count: 0,
            miss_count: 0,
            eviction_count: 0,
        }
    }

    /// Advance the internal frame generation counter.
    #[inline]
    pub fn advance_frame(&mut self) {
        self.current_frame += 1;
    }

    /// Look up a cached surface by node cache key.
    pub fn get(&mut self, key: &NodeCacheKey) -> Option<&VideoSurface> {
        let current_frame = self.current_frame;
        if let Some(entry) = self.entries.get_mut(key) {
            entry.last_used_frame = current_frame;
            entry.hits += 1;
            self.hit_count += 1;
            Some(&entry.surface)
        } else {
            self.miss_count += 1;
            None
        }
    }

    /// Checks if a cache key exists without updating hit counters.
    #[inline]
    pub fn contains(&self, key: &NodeCacheKey) -> bool {
        self.entries.contains_key(key)
    }

    /// Stores a rendered surface into the cache.
    pub fn insert(&mut self, key: NodeCacheKey, surface: VideoSurface) {
        let bpp = match surface.format {
            crate::engine::types::PixelFormat::P010 => 3, // ~15-20 bits per pixel
            crate::engine::types::PixelFormat::Nv12 => 2,
            crate::engine::types::PixelFormat::Rgba16Float => 8,
            _ => 4, // Rgba8 / Bgra8
        };
        let memory_bytes = (surface.width as usize) * (surface.height as usize) * bpp;

        // Ensure capacity
        while (self.entries.len() >= self.max_entries
            || self.current_memory_bytes + memory_bytes > self.max_memory_bytes)
            && !self.entries.is_empty()
        {
            self.evict_lru();
        }

        if let Some(old) = self.entries.remove(&key) {
            self.current_memory_bytes = self.current_memory_bytes.saturating_sub(old.memory_bytes);
        }

        self.current_memory_bytes += memory_bytes;
        self.entries.insert(
            key,
            CachedNodeOutput {
                surface,
                last_used_frame: self.current_frame,
                memory_bytes,
                hits: 0,
            },
        );
    }

    /// Evicts the least recently used entry from the cache.
    fn evict_lru(&mut self) {
        let oldest_key = self
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.last_used_frame)
            .map(|(key, _)| *key);

        if let Some(key) = oldest_key {
            if let Some(removed) = self.entries.remove(&key) {
                self.current_memory_bytes = self
                    .current_memory_bytes
                    .saturating_sub(removed.memory_bytes);
                self.eviction_count += 1;
            }
        }
    }

    /// Clears all entries from the cache.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.current_memory_bytes = 0;
    }

    #[inline]
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    #[inline]
    pub fn current_memory_bytes(&self) -> usize {
        self.current_memory_bytes
    }
}
