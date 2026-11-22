//! Count-bounded LRU cache used by the frame scheduler.
//!
//! [`FrameResourceCache<K, V>`] is a generic LRU keyed on any `Hash + Eq`
//! type. Two concrete instantiations appear in [`super::frame_scheduler`]:
//!
//! - `FrameResourceCache<DecodedCacheKey, Arc<FrameResource>>`
//!   Raw decoded frames, keyed **without** `render_revision`. A timeline edit
//!   (effects/transitions) invalidates the composition cache without discarding
//!   the decode result.
//!
//! - `FrameResourceCache<FrameKey, Arc<FrameResource>>`
//!   Composed frames, keyed with the full `FrameKey` including `render_revision`.

use std::collections::HashMap;
use std::hash::Hash;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

// ── Frame Cache Telemetry ─────────────────────────────────────────────────────

/// Global fallback statistics when a direct scheduler handle is not available.
pub static GLOBAL_DECODED_CACHE_STATS: Lazy<RwLock<FrameCacheStats>> =
    Lazy::new(|| RwLock::new(FrameCacheStats::default()));
pub static GLOBAL_COMPOSED_CACHE_STATS: Lazy<RwLock<FrameCacheStats>> =
    Lazy::new(|| RwLock::new(FrameCacheStats::default()));

/// Retrieve snapshot of global frame cache stats.
pub fn get_global_frame_cache_stats() -> (FrameCacheStats, FrameCacheStats) {
    (*GLOBAL_DECODED_CACHE_STATS.read(), *GLOBAL_COMPOSED_CACHE_STATS.read())
}

/// Point-in-time cache statistics snapshot. Serialisable for Tauri IPC and
/// NDJSON session-log payloads.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCacheStats {
    /// Successful O(1) cache lookups (`get` calls that found the key).
    pub hits: u64,
    /// Cache lookups that did not find the key (requires decode/recompose).
    pub misses: u64,
    /// LRU evictions triggered by capacity saturation on `insert`.
    pub evictions: u64,
    /// Number of live entries currently occupying slots.
    pub current_entries: usize,
    /// Maximum number of entries the cache can hold.
    pub capacity: usize,
    /// `hits / (hits + misses)`, or 0.0 when no lookups have occurred.
    pub hit_ratio: f32,
}

/// Internal node for the intrusive slot-indexed doubly-linked list.
struct LruNode<K, V> {
    key: K,
    value: V,
    prev: Option<usize>,
    next: Option<usize>,
}

/// Count-bounded $O(1)$ LRU cache.
///
/// Evicts the least-recently-used entry when capacity is exceeded.
/// Backed by a slot-indexed intrusive doubly-linked list and a `HashMap<K, usize>`,
/// providing strictly $O(1)$ time complexity for `get`, `peek`, `insert`, and `remove`
/// with zero allocations during steady-state caching.
pub struct FrameResourceCache<K, V> {
    capacity: usize,
    map: HashMap<K, usize>,
    nodes: Vec<Option<LruNode<K, V>>>,
    free_indices: Vec<usize>,
    lru: Option<usize>, // Oldest entry (evicted first)
    mru: Option<usize>, // Most recently used entry
    // ── Telemetry counters ─────────────────────────────────────────────────
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl<K: Hash + Eq + Clone, V: Clone> FrameResourceCache<K, V> {
    /// Create a cache with the given maximum entry count.
    /// Clamped to a minimum of 1.
    pub fn new(capacity: usize) -> Self {
        let cap = capacity.max(1);
        Self {
            capacity: cap,
            map: HashMap::with_capacity(cap),
            nodes: Vec::with_capacity(cap),
            free_indices: Vec::new(),
            lru: None,
            mru: None,
            hits: 0,
            misses: 0,
            evictions: 0,
        }
    }

    /// Look up an entry. Promotes it to most-recently-used on hit.
    pub fn get(&mut self, key: &K) -> Option<V> {
        match self.map.get(key) {
            Some(&idx) => {
                self.promote_mru(idx);
                self.hits += 1;
                self.nodes[idx].as_ref().map(|n| n.value.clone())
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Peek without promoting (does not affect LRU order).
    pub fn peek(&self, key: &K) -> Option<&V> {
        let &idx = self.map.get(key)?;
        self.nodes[idx].as_ref().map(|n| &n.value)
    }

    /// Insert an entry. Evicts the LRU entry if at capacity.
    /// If the key already exists the entry is updated in-place and promoted.
    pub fn insert(&mut self, key: K, value: V) {
        if let Some(&idx) = self.map.get(&key) {
            if let Some(node) = self.nodes[idx].as_mut() {
                node.value = value;
            }
            self.promote_mru(idx);
        } else {
            if self.map.len() >= self.capacity {
                self.evictions += 1;
                self.pop_lru();
            }
            let idx = self.allocate_node(key.clone(), value);
            self.attach_mru(idx);
            self.map.insert(key, idx);
        }
    }

    /// Remove an entry if present.
    pub fn remove(&mut self, key: &K) {
        if let Some(idx) = self.map.remove(key) {
            self.detach(idx);
            self.free_indices.push(idx);
            self.nodes[idx] = None;
        }
    }

    /// Discard all entries.
    pub fn clear(&mut self) {
        self.map.clear();
        self.nodes.clear();
        self.free_indices.clear();
        self.lru = None;
        self.mru = None;
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Return a point-in-time statistics snapshot.
    ///
    /// All fields are plain `u64` integer reads — no locks, no allocation.
    /// Safe to call from any non-RT thread at any time.
    pub fn stats(&self) -> FrameCacheStats {
        let total_lookups = self.hits + self.misses;
        FrameCacheStats {
            hits: self.hits,
            misses: self.misses,
            evictions: self.evictions,
            current_entries: self.map.len(),
            capacity: self.capacity,
            hit_ratio: if total_lookups > 0 {
                self.hits as f32 / total_lookups as f32
            } else {
                0.0
            },
        }
    }

    fn detach(&mut self, idx: usize) {
        let (prev, next) = match self.nodes.get(idx).and_then(|n| n.as_ref()) {
            Some(node) => (node.prev, node.next),
            None => return,
        };

        if let Some(p) = prev {
            if let Some(Some(p_node)) = self.nodes.get_mut(p) {
                p_node.next = next;
            }
        } else {
            self.lru = next;
        }

        if let Some(n) = next {
            if let Some(Some(n_node)) = self.nodes.get_mut(n) {
                n_node.prev = prev;
            }
        } else {
            self.mru = prev;
        }

        if let Some(Some(node)) = self.nodes.get_mut(idx) {
            node.prev = None;
            node.next = None;
        }
    }

    fn attach_mru(&mut self, idx: usize) {
        if let Some(old_mru) = self.mru {
            if let Some(Some(old_node)) = self.nodes.get_mut(old_mru) {
                old_node.next = Some(idx);
            }
            if let Some(Some(node)) = self.nodes.get_mut(idx) {
                node.prev = Some(old_mru);
                node.next = None;
            }
            self.mru = Some(idx);
        } else {
            if let Some(Some(node)) = self.nodes.get_mut(idx) {
                node.prev = None;
                node.next = None;
            }
            self.lru = Some(idx);
            self.mru = Some(idx);
        }
    }

    fn promote_mru(&mut self, idx: usize) {
        if self.mru == Some(idx) {
            return;
        }
        self.detach(idx);
        self.attach_mru(idx);
    }

    fn allocate_node(&mut self, key: K, value: V) -> usize {
        if let Some(free_idx) = self.free_indices.pop() {
            self.nodes[free_idx] = Some(LruNode {
                key,
                value,
                prev: None,
                next: None,
            });
            free_idx
        } else {
            let idx = self.nodes.len();
            self.nodes.push(Some(LruNode {
                key,
                value,
                prev: None,
                next: None,
            }));
            idx
        }
    }

    fn pop_lru(&mut self) -> Option<(K, V)> {
        let lru_idx = self.lru?;
        self.detach(lru_idx);
        self.free_indices.push(lru_idx);
        let node = self.nodes[lru_idx].take()?;
        self.map.remove(&node.key);
        Some((node.key, node.value))
    }
}

// ---------------------------------------------------------------------------
// Tests — use cheap numeric types so no GPU device is required.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    type Cache = FrameResourceCache<u64, u32>;

    #[test]
    fn returns_inserted_value() {
        let mut c: Cache = FrameResourceCache::new(4);
        c.insert(1, 100);
        assert_eq!(c.get(&1), Some(100));
    }

    #[test]
    fn miss_returns_none() {
        let mut c: Cache = FrameResourceCache::new(4);
        assert_eq!(c.get(&99), None);
    }

    #[test]
    fn evicts_lru_when_at_capacity() {
        let mut c: Cache = FrameResourceCache::new(2);
        c.insert(1, 1);
        c.insert(2, 2);
        // Touch 1 so 2 becomes LRU.
        let _ = c.get(&1);
        // Insert 3 — should evict 2.
        c.insert(3, 3);
        assert_eq!(c.get(&1), Some(1));
        assert_eq!(c.get(&2), None, "LRU entry must be evicted");
        assert_eq!(c.get(&3), Some(3));
    }

    #[test]
    fn update_existing_key_does_not_grow_len() {
        let mut c: Cache = FrameResourceCache::new(4);
        c.insert(1, 10);
        c.insert(1, 20);
        assert_eq!(c.len(), 1);
        assert_eq!(c.get(&1), Some(20));
    }

    #[test]
    fn remove_shrinks_len() {
        let mut c: Cache = FrameResourceCache::new(4);
        c.insert(1, 10);
        c.remove(&1);
        assert!(c.is_empty());
        assert_eq!(c.get(&1), None);
    }

    #[test]
    fn clear_empties_all() {
        let mut c: Cache = FrameResourceCache::new(4);
        c.insert(1, 10);
        c.insert(2, 20);
        c.clear();
        assert!(c.is_empty());
    }

    #[test]
    fn capacity_minimum_is_one() {
        let c: Cache = FrameResourceCache::new(0);
        assert_eq!(c.capacity(), 1);
    }

    #[test]
    fn peek_does_not_promote() {
        let mut c: Cache = FrameResourceCache::new(2);
        c.insert(1, 1);
        c.insert(2, 2);
        // Peek at 1 — does NOT promote.
        assert_eq!(c.peek(&1), Some(&1));
        // Insert 3 — 1 is still LRU, so it is evicted.
        c.insert(3, 3);
        assert_eq!(c.get(&1), None, "peek must not promote");
        assert_eq!(c.get(&2), Some(2));
    }

    #[test]
    fn insert_beyond_capacity_maintains_capacity_bound() {
        let mut c: Cache = FrameResourceCache::new(3);
        for i in 0..10u64 {
            c.insert(i, i as u32);
        }
        assert!(c.len() <= 3);
    }

    #[test]
    fn intrusive_lru_slot_reuse_and_order() {
        let mut c: Cache = FrameResourceCache::new(3);
        c.insert(1, 10);
        c.insert(2, 20);
        c.insert(3, 30);
        assert_eq!(c.len(), 3);
        assert_eq!(c.nodes.len(), 3);

        // Touch 1 (MRU now 1, order LRU->MRU: 2, 3, 1)
        assert_eq!(c.get(&1), Some(10));

        // Insert 4 (evicts 2, reuses 2's slot! nodes.len() stays 3!)
        c.insert(4, 40);
        assert_eq!(c.get(&2), None);
        assert_eq!(c.len(), 3);
        assert_eq!(c.nodes.len(), 3);
        assert_eq!(c.free_indices.len(), 0);

        // Order is now LRU->MRU: 3, 1, 4
        // Touch 3 (order: 1, 4, 3)
        assert_eq!(c.get(&3), Some(30));

        // Insert 5 (evicts 1)
        c.insert(5, 50);
        assert_eq!(c.get(&1), None);
        assert_eq!(c.get(&3), Some(30));
        assert_eq!(c.get(&4), Some(40));
        assert_eq!(c.get(&5), Some(50));
        assert_eq!(c.nodes.len(), 3);
    }
}
