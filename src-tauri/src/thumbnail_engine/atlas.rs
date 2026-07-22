//! Atlas-based thumbnail storage (4×8 grid, 32 thumbnails per atlas).
//! Reduces file count by 32x and improves I/O performance.

use dashmap::DashMap;
use image::{ImageBuffer, Rgba, RgbaImage};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::{DensityLevel, ResolutionTier};

pub const THUMBNAILS_PER_ATLAS: usize = 32;
pub const ATLAS_COLS: u32 = 8;
pub const ATLAS_ROWS: u32 = 4;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasMetadata {
    /// Atlas file path
    pub path: PathBuf,
    /// Atlas index (0, 1, 2, ...)
    pub index: u32,
    /// Timestamps stored in this atlas (up to 32)
    pub timestamps: Vec<f64>,
    /// Number of thumbnails currently in this atlas
    pub count: usize,
}

impl AtlasMetadata {
    pub fn new(path: PathBuf, index: u32) -> Self {
        Self {
            path,
            index,
            timestamps: Vec::with_capacity(THUMBNAILS_PER_ATLAS),
            count: 0,
        }
    }

    pub fn is_full(&self) -> bool {
        self.count >= THUMBNAILS_PER_ATLAS
    }

    pub fn get_position(&self, time: f64) -> Option<(u32, u32)> {
        self.timestamps
            .iter()
            .position(|&t| (t - time).abs() < 0.001)
            .map(|idx| {
                let col = (idx as u32) % ATLAS_COLS;
                let row = (idx as u32) / ATLAS_COLS;
                (col, row)
            })
    }

    pub fn add_timestamp(&mut self, time: f64) -> usize {
        let idx = self.count;
        self.timestamps.push(time);
        self.count += 1;
        idx
    }
}

#[derive(Debug, Clone)]
pub struct AtlasLocation {
    pub atlas_path: PathBuf,
    pub atlas_index: u32,
    pub col: u32,
    pub row: u32,
}
pub struct AtlasManager {
    video_id: String,
    density: DensityLevel,
    resolution_tier: ResolutionTier,
    cache_dir: PathBuf,
    atlases: Vec<AtlasMetadata>,
    timestamp_map: DashMap<u64, AtlasLocation>,
    current_atlas_index: u32,
}

impl AtlasManager {
    pub fn new(
        video_id: String,
        density: DensityLevel,
        resolution_tier: ResolutionTier,
        cache_dir: PathBuf,
    ) -> Self {
        Self {
            video_id,
            density,
            resolution_tier,
            cache_dir,
            atlases: Vec::new(),
            timestamp_map: DashMap::new(),
            current_atlas_index: 0,
        }
    }

    pub fn get_location(&self, time: f64) -> Option<AtlasLocation> {
        let timestamp_ms = (time * 1000.0).round() as u64;
        self.timestamp_map
            .get(&timestamp_ms)
            .map(|entry| entry.clone())
    }

    pub fn allocate(&mut self, time: f64) -> AtlasLocation {
        let timestamp_ms = (time * 1000.0).round() as u64;
        if let Some(location) = self.timestamp_map.get(&timestamp_ms) {
            return location.clone();
        }
        if self.atlases.is_empty() || self.atlases.last().unwrap().is_full() {
            let atlas_path = self.atlas_path(self.current_atlas_index);
            let atlas = AtlasMetadata::new(atlas_path, self.current_atlas_index);
            self.atlases.push(atlas);
            self.current_atlas_index += 1;
        }

        let atlas = self.atlases.last_mut().unwrap();
        let idx = atlas.add_timestamp(time);
        let col = (idx as u32) % ATLAS_COLS;
        let row = (idx as u32) / ATLAS_COLS;

        let location = AtlasLocation {
            atlas_path: atlas.path.clone(),
            atlas_index: atlas.index,
            col,
            row,
        };

        self.timestamp_map.insert(timestamp_ms, location.clone());
        location
    }

    fn atlas_path(&self, index: u32) -> PathBuf {
        let filename = format!(
            "{}_{}_{:04}_{}.webp",
            self.video_id,
            self.density.label(),
            index,
            self.resolution_tier.label()
        );
        self.cache_dir.join(filename)
    }
}

pub struct AtlasBuilder {
    thumb_width: u32,
    thumb_height: u32,
    atlas: RgbaImage,
    count: usize,
}

impl AtlasBuilder {
    pub fn new(thumb_width: u32, thumb_height: u32) -> Self {
        let atlas_width = thumb_width * ATLAS_COLS;
        let atlas_height = thumb_height * ATLAS_ROWS;
        let atlas = ImageBuffer::from_pixel(atlas_width, atlas_height, Rgba([0, 0, 0, 0]));

        Self {
            thumb_width,
            thumb_height,
            atlas,
            count: 0,
        }
    }

    pub fn add_thumbnail(
        &mut self,
        rgba_data: &[u8],
        actual_width: u32,
        actual_height: u32,
    ) -> Result<(u32, u32), String> {
        if self.count >= THUMBNAILS_PER_ATLAS {
            return Err("Atlas is full".to_string());
        }

        let expected_bytes = (actual_width * actual_height * 4) as usize;
        if rgba_data.len() != expected_bytes {
            return Err(format!(
                "Buffer size mismatch: expected {} bytes for {}×{} image, got {}",
                expected_bytes,
                actual_width,
                actual_height,
                rgba_data.len()
            ));
        }

        let col = (self.count as u32) % ATLAS_COLS;
        let row = (self.count as u32) / ATLAS_COLS;

        let cell_x = col * self.thumb_width;
        let cell_y = row * self.thumb_height;

        let offset_x = cell_x + (self.thumb_width - actual_width) / 2;
        let offset_y = cell_y + (self.thumb_height - actual_height) / 2;

        for y in 0..actual_height {
            for x in 0..actual_width {
                let src_idx = ((y * actual_width + x) * 4) as usize;
                let pixel = Rgba([
                    rgba_data[src_idx],
                    rgba_data[src_idx + 1],
                    rgba_data[src_idx + 2],
                    rgba_data[src_idx + 3],
                ]);
                self.atlas.put_pixel(offset_x + x, offset_y + y, pixel);
            }
        }

        self.count += 1;
        Ok((col, row))
    }

    pub async fn save(&self, path: &PathBuf) -> Result<(), String> {
        use image::codecs::webp::WebPEncoder;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create atlas directory: {}", e))?;
        }
        let mut webp_data = Vec::new();
        let encoder = WebPEncoder::new_lossless(&mut webp_data);
        encoder
            .encode(
                self.atlas.as_raw(),
                self.atlas.width(),
                self.atlas.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("WebP encoding failed: {}", e))?;
        tokio::fs::write(path, &webp_data)
            .await
            .map_err(|e| format!("Failed to write atlas file: {}", e))?;

        eprintln!(
            "[AtlasBuilder] Saved atlas: {} ({} thumbnails, {} bytes)",
            path.display(),
            self.count,
            webp_data.len()
        );

        Ok(())
    }

    pub fn count(&self) -> usize {
        self.count
    }
}

pub static ATLAS_CACHE: Lazy<DashMap<String, Arc<RwLock<AtlasManager>>>> = Lazy::new(DashMap::new);
pub async fn get_atlas_manager(
    video_id: &str,
    density: DensityLevel,
    resolution_tier: ResolutionTier,
    cache_dir: PathBuf,
) -> Arc<RwLock<AtlasManager>> {
    let key = format!(
        "{}:{}:{}",
        video_id,
        density.label(),
        resolution_tier.label()
    );

    if let Some(manager) = ATLAS_CACHE.get(&key) {
        return manager.clone();
    }

    let manager = Arc::new(RwLock::new(AtlasManager::new(
        video_id.to_string(),
        density,
        resolution_tier,
        cache_dir,
    )));

    ATLAS_CACHE.insert(key, manager.clone());
    manager
}
