use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

pub const RGBA_LAYER_CACHE_BYTES: usize = 384 * 1024 * 1024;
pub const TEXT_LAYER_CACHE_BYTES: usize = 256 * 1024 * 1024;

struct RgbaLayerTextureCacheEntry {
    texture: Arc<wgpu::Texture>,
    width: u32,
    height: u32,
    bytes: usize,
}

/// Bounded GPU cache for browser-rendered assets such as Clypra Studio text.
/// Geometry and opacity remain per-frame compositor uniforms; only immutable
/// pixel data is retained here.
pub(crate) struct RgbaLayerTextureCache {
    entries: HashMap<String, RgbaLayerTextureCacheEntry>,
    order: VecDeque<String>,
    current_bytes: usize,
}

impl RgbaLayerTextureCache {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            current_bytes: 0,
        }
    }

    pub(crate) fn contains_key(&self, asset_id: &str) -> bool {
        self.entries.contains_key(asset_id)
    }

    pub(crate) fn get(&mut self, asset_id: &str, width: u32, height: u32) -> Option<Arc<wgpu::Texture>> {
        let entry = self.entries.get(asset_id)?;
        if entry.width != width || entry.height != height {
            self.remove(asset_id);
            return None;
        }
        let texture = Arc::clone(&entry.texture);
        self.touch(asset_id);
        Some(texture)
    }

    pub(crate) fn insert(&mut self, asset_id: String, texture: Arc<wgpu::Texture>, width: u32, height: u32) {
        let bytes = (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4);
        if bytes == 0 || bytes > RGBA_LAYER_CACHE_BYTES {
            return;
        }
        self.remove(&asset_id);
        while self.current_bytes.saturating_add(bytes) > RGBA_LAYER_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.current_bytes = self.current_bytes.saturating_sub(removed.bytes);
            }
        }
        self.current_bytes = self.current_bytes.saturating_add(bytes);
        self.order.push_back(asset_id.clone());
        self.entries.insert(
            asset_id,
            RgbaLayerTextureCacheEntry {
                texture,
                width,
                height,
                bytes,
            },
        );
    }

    pub(crate) fn touch(&mut self, asset_id: &str) {
        self.order.retain(|item| item != asset_id);
        self.order.push_back(asset_id.to_string());
    }

    pub(crate) fn remove(&mut self, asset_id: &str) {
        self.order.retain(|item| item != asset_id);
        if let Some(removed) = self.entries.remove(asset_id) {
            self.current_bytes = self.current_bytes.saturating_sub(removed.bytes);
        }
    }
}

