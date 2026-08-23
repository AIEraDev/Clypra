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
        self.timestamps.iter().position(|&t| (t - time).abs() < 0.001).map(|idx| {
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
        self.timestamp_map.get(&timestamp_ms).map(|entry| entry.clone())
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

    pub fn add_thumbnail(&mut self, rgba_data: &[u8], actual_width: u32, actual_height: u32) -> Result<(u32, u32), String> {
        if self.count >= THUMBNAILS_PER_ATLAS {
            return Err("Atlas is full".to_string());
        }

        let expected_bytes = (actual_width * actual_height * 4) as usize;
        if rgba_data.len() != expected_bytes {
            return Err(format!(
                "Buffer size mismatch: expected {} bytes for {}×{} image, got {}",
                expected_bytes, actual_width, actual_height, rgba_data.len()
            ));
        }

        let col = (self.count as u32) % ATLAS_COLS;
        let row = (self.count as u32) / ATLAS_COLS;
        
        let cell_x = col * self.thumb_width;
        let cell_y = row * self.thumb_height;
        
        let offset_x = cell_x + (self.thumb_width - actual_width) / 2;
        let offset_y = cell_y + (self.thumb_height - actual_height) / 2;
        let atlas_width = self.atlas.width() as usize;
        let src_row_bytes = (actual_width * 4) as usize;
        let dst_raw: &mut [u8] = &mut self.atlas;

        for y in 0..actual_height as usize {
            let dst_y = offset_y as usize + y;
            let dst_row_start = (dst_y * atlas_width + offset_x as usize) * 4;
            let dst_row_end = dst_row_start + src_row_bytes;
            let src_row_start = y * src_row_bytes;
            let src_row_end = src_row_start + src_row_bytes;
            dst_raw[dst_row_start..dst_row_end].copy_from_slice(&rgba_data[src_row_start..src_row_end]);
        }

        self.count += 1;
        Ok((col, row))
    }

    pub async fn save(&self, path: &PathBuf) -> Result<(), String> {
        use image::codecs::webp::WebPEncoder;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| format!("Failed to create atlas directory: {}", e))?;
        }
        let mut webp_data = Vec::new();
        let encoder = WebPEncoder::new_lossless(&mut webp_data);
        encoder.encode(
            self.atlas.as_raw(),
            self.atlas.width(),
            self.atlas.height(),
            image::ExtendedColorType::Rgba8,
        ).map_err(|e| format!("WebP encoding failed: {}", e))?;

        // Atomic write: write to a .tmp file then rename to avoid half-written corruptions
        let tmp_path = path.with_extension("tmp.webp");
        tokio::fs::write(&tmp_path, &webp_data).await
            .map_err(|e| format!("Failed to write temporary atlas file: {}", e))?;

        if let Err(e) = tokio::fs::rename(&tmp_path, path).await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(format!("Failed to commit atlas file: {}", e));
        }

        eprintln!("[AtlasBuilder] Atomically saved atlas: {} ({} thumbnails, {} bytes)",
                  path.display(), self.count, webp_data.len());

        Ok(())
    }

    pub fn count(&self) -> usize {
        self.count
    }
}

pub static ATLAS_CACHE: Lazy<DashMap<String, Arc<RwLock<AtlasManager>>>> =
    Lazy::new(DashMap::new);

/// Global configurable disk cache size limit in bytes. Default: 5 GB. (0 = unlimited).
pub static DISK_CACHE_LIMIT_BYTES: Lazy<std::sync::atomic::AtomicU64> =
    Lazy::new(|| std::sync::atomic::AtomicU64::new(5 * 1024 * 1024 * 1024));

pub fn set_disk_cache_limit(limit_bytes: u64) {
    DISK_CACHE_LIMIT_BYTES.store(limit_bytes, std::sync::atomic::Ordering::Relaxed);
}

pub fn get_disk_cache_limit() -> u64 {
    DISK_CACHE_LIMIT_BYTES.load(std::sync::atomic::Ordering::Relaxed)
}

/// Resilient loader for thumbnail extraction from an atlas.
/// Validates file integrity and automatically quarantines/deletes corrupted or truncated atlas files,
/// returning an error so the rendering pipeline falls through to fresh decode safely.
pub async fn load_from_atlas_resilient(
    location: &AtlasLocation,
    thumb_width: u32,
    thumb_height: u32,
) -> Result<Vec<u8>, String> {
    let atlas_data = match tokio::fs::read(&location.atlas_path).await {
        Ok(data) => {
            if data.is_empty() {
                eprintln!("[load_from_atlas] Quarantining 0-byte truncated atlas: {:?}", location.atlas_path);
                let _ = tokio::fs::remove_file(&location.atlas_path).await;
                return Err("Atlas file is 0 bytes (truncated)".to_string());
            }
            data
        }
        Err(e) => {
            return Err(format!("Failed to read atlas file: {}", e));
        }
    };

    let atlas_img = match image::load_from_memory(&atlas_data) {
        Ok(img) => img.to_rgba8(),
        Err(e) => {
            eprintln!("[load_from_atlas] Corrupted WebP detected in {:?}. Auto-quarantining file: {}", location.atlas_path, e);
            let _ = tokio::fs::remove_file(&location.atlas_path).await;
            return Err(format!("Corrupted atlas image removed: {}", e));
        }
    };

    let x = location.col * thumb_width;
    let y = location.row * thumb_height;

    // Bounds check within the atlas dimensions
    if x + thumb_width > atlas_img.width() || y + thumb_height > atlas_img.height() {
        eprintln!("[load_from_atlas] Tile location ({}, {}) with dims {}x{} exceeds atlas dims {}x{}",
                  x, y, thumb_width, thumb_height, atlas_img.width(), atlas_img.height());
        let _ = tokio::fs::remove_file(&location.atlas_path).await;
        return Err("Tile position out of atlas bounds".to_string());
    }

    let mut rgba_data = Vec::with_capacity((thumb_width * thumb_height * 4) as usize);
    for row in y..(y + thumb_height) {
        for col in x..(x + thumb_width) {
            let pixel = atlas_img.get_pixel(col, row);
            rgba_data.extend_from_slice(&pixel.0);
        }
    }

    Ok(rgba_data)
}

/// Calculate current disk cache statistics.
pub async fn get_disk_cache_stats_from_dir(cache_dir: &PathBuf) -> (u64, usize) {
    let mut total_bytes: u64 = 0;
    let mut file_count: usize = 0;

    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if meta.is_file() {
                    let path = entry.path();
                    if let Some(ext) = path.extension() {
                        if ext == "webp" {
                            total_bytes += meta.len();
                            file_count += 1;
                        }
                    }
                }
            }
        }
    }

    (total_bytes, file_count)
}

/// Prune oldest atlas files if disk cache usage exceeds the configured limit.
pub async fn prune_disk_cache_if_needed(cache_dir: &PathBuf) {
    let limit = get_disk_cache_limit();
    if limit == 0 {
        return; // 0 means unlimited
    }

    let (current_bytes, _) = get_disk_cache_stats_from_dir(cache_dir).await;
    if current_bytes <= limit {
        return;
    }

    eprintln!("[prune_disk_cache] Cache usage {} bytes exceeds limit {} bytes. Pruning oldest files...",
              current_bytes, limit);

    let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if meta.is_file() {
                    let path = entry.path();
                    if let Some(ext) = path.extension() {
                        if ext == "webp" {
                            let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                            files.push((path, modified, meta.len()));
                        }
                    }
                }
            }
        }
    }

    // Sort oldest first
    files.sort_by_key(|(_, modified, _)| *modified);

    let target_bytes = (limit as f64 * 0.80) as u64; // Trim to 80% of limit
    let mut bytes_to_remove = current_bytes.saturating_sub(target_bytes);
    let mut pruned_count = 0;

    for (path, _, size) in files {
        if bytes_to_remove == 0 {
            break;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            bytes_to_remove = bytes_to_remove.saturating_sub(size);
            pruned_count += 1;
        }
    }

    eprintln!("[prune_disk_cache] Pruned {} atlas files.", pruned_count);
}

/// Purge all thumbnail and render atlases from the disk cache.
pub async fn purge_all_disk_cache(cache_dir: &PathBuf) -> Result<usize, String> {
    let mut deleted_count = 0;

    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if meta.is_file() {
                    let path = entry.path();
                    if let Some(ext) = path.extension() {
                        if (ext == "webp" || path.to_string_lossy().contains(".tmp."))
                            && tokio::fs::remove_file(&path).await.is_ok()
                        {
                            deleted_count += 1;
                        }
                    }
                }
            }
        }
    }

    // Clear in-memory managers
    ATLAS_CACHE.clear();

    Ok(deleted_count)
}

pub async fn get_atlas_manager(
    video_id: &str,
    density: DensityLevel,
    resolution_tier: ResolutionTier,
    cache_dir: PathBuf,
) -> Arc<RwLock<AtlasManager>> {
    let key = format!("{}:{}:{}", video_id, density.label(), resolution_tier.label());

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
