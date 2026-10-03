//! VRAM-resident text layer SDF cache.
//!
//! Keyed by a 64-bit hash of `(effect_id, effect_version, params_hash, text_hash, font_id, font_size)`.
//! Cache misses trigger full SDF generation + effect interpreter pass-chain.
//! Cache hits are a GPU-side texture blit — $O(1)$ and sub-microsecond.
//!
//! The cache uses an LRU eviction policy with a configurable VRAM budget.
//! Default: 256 MB (holds ~120 1080p RGBA text layers simultaneously).

use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

/// A single cached text layer GPU texture.
pub struct CachedTextLayer {
    /// The composited RGBA output texture after the full SDF effect pass-chain.
    pub texture: Arc<wgpu::Texture>,
    pub view: Arc<wgpu::TextureView>,
    pub width: u32,
    pub height: u32,
    bytes: usize,
}

/// VRAM-resident cache keyed by a 64-bit content hash.
pub struct TextLayerCache {
    entries: HashMap<u64, CachedTextLayer>,
    order: VecDeque<u64>,
    current_bytes: usize,
    max_bytes: usize,

    // Telemetry — kept separate from frame decode/compose counters per ADR.
    pub cache_hits: u64,
    pub cache_misses: u64,
}

impl TextLayerCache {
    /// Create a cache with a VRAM budget. Default: 256 MB.
    pub fn new(max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            current_bytes: 0,
            max_bytes,
            cache_hits: 0,
            cache_misses: 0,
        }
    }

    /// Look up a cached layer. Updates LRU order and increments telemetry.
    pub fn get(&mut self, key: u64) -> Option<(&Arc<wgpu::Texture>, &Arc<wgpu::TextureView>)> {
        if self.entries.contains_key(&key) {
            self.touch(key);
            self.cache_hits += 1;
            crate::native_core::performance::record_text_layer_cache_hit();
            let entry = self.entries.get(&key)?;
            Some((&entry.texture, &entry.view))
        } else {
            self.cache_misses += 1;
            crate::native_core::performance::record_text_layer_cache_miss();
            None
        }
    }

    /// Insert a rendered texture. Evicts LRU entries until the budget is met.
    pub fn insert(
        &mut self,
        key: u64,
        texture: Arc<wgpu::Texture>,
        view: Arc<wgpu::TextureView>,
        width: u32,
        height: u32,
    ) {
        let bytes = (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4); // Rgba8Unorm

        if bytes == 0 || bytes > self.max_bytes {
            return; // single layer too large — skip caching
        }

        self.remove(key); // remove any existing entry for this key first

        while self.current_bytes.saturating_add(bytes) > self.max_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.current_bytes = self.current_bytes.saturating_sub(removed.bytes);
            }
        }

        self.current_bytes = self.current_bytes.saturating_add(bytes);
        self.order.push_back(key);
        self.entries.insert(
            key,
            CachedTextLayer {
                texture,
                view,
                width,
                height,
                bytes,
            },
        );
    }

    /// Invalidate a specific cache entry.
    pub fn remove(&mut self, key: u64) {
        self.order.retain(|k| *k != key);
        if let Some(removed) = self.entries.remove(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(removed.bytes);
        }
    }

    /// Flush all entries (e.g., on GPU device loss or project close).
    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.current_bytes = 0;
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }
    pub fn current_bytes(&self) -> usize {
        self.current_bytes
    }
    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    fn touch(&mut self, key: u64) {
        self.order.retain(|k| *k != key);
        self.order.push_back(key);
    }
}

/// Compute a stable 64-bit cache key for a text layer snapshot.
pub fn text_layer_cache_key(
    text: &str,
    font_id: &str,
    font_size: f32,
    effect_id: &str,
    effect_version: u32,
    params_json: &str,
) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher.update(b"\x00");
    hasher.update(font_id.as_bytes());
    hasher.update(b"\x00");
    hasher.update(font_size.to_bits().to_le_bytes());
    hasher.update(b"\x00");
    hasher.update(effect_id.as_bytes());
    hasher.update(b"\x00");
    hasher.update(effect_version.to_le_bytes());
    hasher.update(b"\x00");
    hasher.update(params_json.as_bytes());

    let digest = hasher.finalize();
    // Use first 8 bytes as a u64 key — collision probability negligible for
    // typical project sizes (< 10k unique text layers per session).
    u64::from_le_bytes(digest[..8].try_into().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_deterministic() {
        let k1 = text_layer_cache_key("Clypra", "inter", 48.0, "neon-glow", 1, r#"{"radius":0.2}"#);
        let k2 = text_layer_cache_key("Clypra", "inter", 48.0, "neon-glow", 1, r#"{"radius":0.2}"#);
        assert_eq!(k1, k2);
    }

    #[test]
    fn cache_key_changes_on_text_change() {
        let k1 = text_layer_cache_key("Clypra", "inter", 48.0, "neon-glow", 1, "{}");
        let k2 = text_layer_cache_key("CLYPRA", "inter", 48.0, "neon-glow", 1, "{}");
        assert_ne!(k1, k2);
    }

    #[test]
    fn cache_key_changes_on_param_change() {
        let k1 = text_layer_cache_key("A", "f", 12.0, "glow", 1, r#"{"r":0.1}"#);
        let k2 = text_layer_cache_key("A", "f", 12.0, "glow", 1, r#"{"r":0.9}"#);
        assert_ne!(k1, k2);
    }

    #[tokio::test]
    async fn test_text_layer_cache_get_hit_and_miss_delta() {
        let mut cache = TextLayerCache::new(1024 * 1024);

        let initial_misses = crate::native_core::performance::text_layer_cache_misses();
        let initial_hits = crate::native_core::performance::text_layer_cache_hits();

        // Real miss through cache.get()
        assert!(cache.get(9999).is_none());
        let misses_after = crate::native_core::performance::text_layer_cache_misses();
        let hits_after = crate::native_core::performance::text_layer_cache_hits();
        assert_eq!(misses_after.saturating_sub(initial_misses), 1);
        assert_eq!(hits_after.saturating_sub(initial_hits), 0);
        assert_eq!(cache.cache_misses, 1);
        assert_eq!(cache.cache_hits, 0);

        // Try to obtain a wgpu device to test real hit through cache.insert() and cache.get()
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        if let Some(adapter) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
        {
            if let Ok((device, _queue)) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
            {
                let texture = Arc::new(device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Test Text Layer"),
                    size: wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                }));
                let view = Arc::new(texture.create_view(&wgpu::TextureViewDescriptor::default()));

                let key = 12345u64;
                cache.insert(key, texture, view, 1, 1);

                let hits_before = crate::native_core::performance::text_layer_cache_hits();
                let misses_before = crate::native_core::performance::text_layer_cache_misses();

                let entry = cache.get(key);
                assert!(entry.is_some());

                let hits_after = crate::native_core::performance::text_layer_cache_hits();
                let misses_after = crate::native_core::performance::text_layer_cache_misses();

                assert_eq!(hits_after.saturating_sub(hits_before), 1);
                assert_eq!(misses_after.saturating_sub(misses_before), 0);
                assert_eq!(cache.cache_hits, 1);
            }
        }
    }
}
