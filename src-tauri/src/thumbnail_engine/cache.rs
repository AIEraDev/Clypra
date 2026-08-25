use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use web_time::Instant;

use super::types::{DensityLevel, ResolutionTier};

#[derive(Debug)]
pub struct CachedFrame {
    pub time: f64,
    pub path: PathBuf,
    pub timestamp: Instant,
    pub access_count: AtomicU64,
    pub last_access: RwLock<Instant>,
    pub in_viewport: RwLock<bool>,
}

impl CachedFrame {
    pub fn new(time: f64, path: PathBuf) -> Self {
        Self {
            time,
            path,
            timestamp: Instant::now(),
            access_count: AtomicU64::new(1),
            last_access: RwLock::new(Instant::now()),
            in_viewport: RwLock::new(false),
        }
    }

    pub fn touch(&self) {
        self.access_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut last) = self.last_access.try_write() {
            *last = Instant::now();
        }
    }

    pub async fn set_in_viewport(&self, visible: bool) {
        let mut in_vp = self.in_viewport.write().await;
        *in_vp = visible;
    }

    pub async fn eviction_score(&self, density: DensityLevel) -> u64 {
        let viewport_priority = if *self.in_viewport.read().await {
            10
        } else {
            0
        };
        let last_access_time = *self.last_access.read().await;
        let seconds_since_access = Instant::now().duration_since(last_access_time).as_secs();
        let recency_weight = if seconds_since_access < 5 {
            10 // Very recent (< 5s)
        } else if seconds_since_access < 30 {
            7 // Recent (< 30s)
        } else if seconds_since_access < 120 {
            4 // Somewhat recent (< 2min)
        } else if seconds_since_access < 600 {
            2 // Old (< 10min)
        } else {
            0
        };

        let access_count = self.access_count.load(Ordering::Relaxed);
        let access_frequency = if access_count >= 50 {
            10 // Very frequently accessed (looping playback)
        } else if access_count >= 20 {
            7 // Frequently accessed
        } else if access_count >= 10 {
            5 // Moderately accessed
        } else if access_count >= 5 {
            3 // Occasionally accessed
        } else {
            0
        };

        let density_weight = match density {
            DensityLevel::Low => 10,
            DensityLevel::Medium => 7,
            DensityLevel::High => 4,
            DensityLevel::Ultra => 0,
        };

        viewport_priority * 10 + recency_weight * 5 + access_frequency * 3 + density_weight * 2
    }
}

#[derive(Debug)]
pub struct DensityCache {
    pub video_id: String,
    pub density: DensityLevel,
    pub frames: DashMap<u64, CachedFrame>,
    pub max_size: usize,
    pub total_size: AtomicU64,
}

impl DensityCache {
    pub fn new(video_id: String, density: DensityLevel) -> Self {
        Self {
            video_id,
            density,
            frames: DashMap::new(),
            max_size: 500,
            total_size: AtomicU64::new(0),
        }
    }

    fn time_key(time: f64) -> u64 {
        (time * 1000.0).round() as u64
    }

    pub fn get_path(&self, time: f64) -> Option<PathBuf> {
        let key = Self::time_key(time);
        self.frames.get(&key).map(|entry| {
            entry.value().touch();
            entry.value().path.clone()
        })
    }

    pub async fn insert(&self, time: f64, frame: CachedFrame) {
        let key = Self::time_key(time);
        self.frames.insert(key, frame);
        self.evict_if_needed().await;
    }

    async fn evict_if_needed(&self) {
        if self.frames.len() > self.max_size {
            let mut scored_entries: Vec<(u64, u64)> = Vec::new();

            for entry in self.frames.iter() {
                let time_key = *entry.key();
                let frame = entry.value();
                let score = frame.eviction_score(self.density).await;
                scored_entries.push((time_key, score));
            }

            scored_entries.sort_by_key(|(_, score)| *score);
            let to_remove = (self.max_size / 5).max(1);
            let mut removed = 0;
            let mut viewport_protected = 0;

            for (key, score) in scored_entries.into_iter().take(to_remove) {
                if score >= 100 {
                    viewport_protected += 1;
                    continue;
                }

                if let Some((_, frame)) = self.frames.remove(&key) {
                    if let Ok(metadata) = std::fs::metadata(&frame.path) {
                        GLOBAL_CACHE
                            .total_size
                            .fetch_sub(metadata.len(), Ordering::Relaxed);
                    }
                    removed += 1;
                }
            }

            if removed > 0 || viewport_protected > 0 {
                eprintln!(
                    "[DensityCache] Evicted {} frames (protected {} viewport frames) from {} density cache",
                    removed, viewport_protected, self.density.label()
                );
            }
        }
    }
}

/// Multi-density cache for a single video
#[derive(Debug)]
pub struct VideoCache {
    pub video_id: String,
    pub video_path: String,
    pub duration: f64,
    pub levels: DashMap<DensityLevel, DensityCache>,
    pub last_accessed: RwLock<Instant>,
}

impl VideoCache {
    pub fn new(video_id: String, video_path: String, duration: f64) -> Self {
        let levels = DashMap::new();
        levels.insert(
            DensityLevel::Low,
            DensityCache::new(video_id.clone(), DensityLevel::Low),
        );
        levels.insert(
            DensityLevel::Medium,
            DensityCache::new(video_id.clone(), DensityLevel::Medium),
        );
        levels.insert(
            DensityLevel::High,
            DensityCache::new(video_id.clone(), DensityLevel::High),
        );
        levels.insert(
            DensityLevel::Ultra,
            DensityCache::new(video_id.clone(), DensityLevel::Ultra),
        );

        Self {
            video_id,
            video_path,
            duration,
            levels,
            last_accessed: RwLock::new(Instant::now()),
        }
    }

    pub async fn touch(&self) {
        let mut last = self.last_accessed.write().await;
        *last = Instant::now();
    }

    pub fn get_frame_path(
        &self,
        time: f64,
        target_density: DensityLevel,
    ) -> Option<(PathBuf, DensityLevel)> {
        self.get_frame_with_fallback(time, target_density)
    }

    pub fn get_frame_with_fallback(
        &self,
        time: f64,
        target_density: DensityLevel,
    ) -> Option<(PathBuf, DensityLevel)> {
        if let Some(path) = self.get_frame_at_density(time, target_density) {
            return Some((path, target_density));
        }

        // Try higher densities (more detail)
        let mut current = target_density;
        while let Some(higher) = current.higher() {
            if let Some(path) = self.get_frame_at_density(time, higher) {
                return Some((path, higher));
            }
            current = higher;
        }

        let fallback_order = [DensityLevel::High, DensityLevel::Medium, DensityLevel::Low];

        for density in fallback_order {
            if density >= target_density {
                continue;
            }
            if let Some(path) = self.get_frame_at_density(time, density) {
                return Some((path, density));
            }
        }

        None
    }

    /// Get frame at specific density level (no fallback)
    fn get_frame_at_density(&self, time: f64, density: DensityLevel) -> Option<PathBuf> {
        let cache = self.levels.get(&density)?;
        cache.get_path(time)
    }
}

/// Global cache for all videos
#[derive(Debug)]
pub struct ThumbnailCache {
    /// Video ID -> Video cache
    pub videos: DashMap<String, Arc<VideoCache>>,
    /// Max videos to keep in memory
    #[allow(dead_code)]
    max_videos: usize,
    /// Base cache directory
    cache_dir: RwLock<Option<PathBuf>>,
    /// Total size in bytes across all videos and all density levels
    pub total_size: AtomicU64,
}

impl Default for ThumbnailCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ThumbnailCache {
    pub fn new() -> Self {
        Self {
            videos: DashMap::new(),
            max_videos: 50, // Keep 50 videos in memory
            cache_dir: RwLock::new(None),
            total_size: AtomicU64::new(0),
        }
    }

    pub async fn init_cache_dir(&self, app_cache_dir: PathBuf) -> Result<(), String> {
        let thumb_dir = app_cache_dir.join("thumbnails");
        tokio::fs::create_dir_all(&thumb_dir)
            .await
            .map_err(|e| format!("Failed to create thumbnail cache dir: {}", e))?;

        let mut dir = self.cache_dir.write().await;
        *dir = Some(thumb_dir);
        Ok(())
    }

    pub async fn get_or_create_video(&self, video_path: &str, duration: f64) -> Arc<VideoCache> {
        let video_id = format!("{:x}", md5::compute(video_path));

        if let Some(cached) = self.videos.get(&video_id) {
            cached.touch().await;
            return cached.clone();
        }

        let cache = Arc::new(VideoCache::new(
            video_id.clone(),
            video_path.to_string(),
            duration,
        ));
        self.videos.insert(video_id, cache.clone());
        self.evict_if_needed().await;
        cache
    }

    pub fn get_video(&self, video_path: &str) -> Option<Arc<VideoCache>> {
        let video_id = format!("{:x}", md5::compute(video_path));
        self.videos.get(&video_id).map(|e| e.clone())
    }

    pub async fn evict_if_needed(&self) {
        const CACHE_SIZE_LIMIT: u64 = 200 * 1024 * 1024;

        let current_size = self.total_size.load(Ordering::Relaxed);
        if current_size <= CACHE_SIZE_LIMIT {
            return;
        }

        eprintln!(
            "[ThumbnailCache] Cache size {}MB exceeds 200MB limit, evicting with weighted scoring...",
            current_size / (1024 * 1024)
        );

        let mut scored_frames: Vec<(String, DensityLevel, u64, u64, PathBuf)> = Vec::new();

        for video_entry in self.videos.iter() {
            let video_cache = video_entry.value();
            for level_entry in video_cache.levels.iter() {
                let density = *level_entry.key();
                let density_cache = level_entry.value();
                for frame_entry in density_cache.frames.iter() {
                    let time_key = *frame_entry.key();
                    let frame = frame_entry.value();
                    let path = frame.path.clone();
                    let vid_id = video_cache.video_id.clone();

                    let score = frame.eviction_score(density).await;

                    scored_frames.push((vid_id, density, time_key, score, path));
                }
            }
        }

        scored_frames.sort_by_key(|(_, _, _, score, _)| *score);
        let total_frames = scored_frames.len();
        let to_remove = ((total_frames / 5).max(1)).min(total_frames);

        eprintln!(
            "[ThumbnailCache] Evicting {} of {} frames using weighted scoring",
            to_remove, total_frames
        );

        if !scored_frames.is_empty() {
            let lowest_score = scored_frames.first().map(|(_, _, _, s, _)| *s).unwrap_or(0);
            let highest_score = scored_frames.last().map(|(_, _, _, s, _)| *s).unwrap_or(0);
            let median_score = scored_frames
                .get(total_frames / 2)
                .map(|(_, _, _, s, _)| *s)
                .unwrap_or(0);
            eprintln!(
                "[ThumbnailCache] Score distribution: lowest={}, median={}, highest={}",
                lowest_score, median_score, highest_score
            );
        }

        let mut removed = 0;
        let mut viewport_protected = 0;

        for (vid_id, density, time_key, score, file_path) in
            scored_frames.into_iter().take(to_remove)
        {
            if score >= 100 {
                viewport_protected += 1;
                continue;
            }

            if let Some(video_entry) = self.videos.get(&vid_id) {
                if let Some(level_cache) = video_entry.levels.get(&density) {
                    if level_cache.frames.remove(&time_key).is_some() {
                        if let Ok(metadata) = std::fs::metadata(&file_path) {
                            self.total_size.fetch_sub(metadata.len(), Ordering::Relaxed);
                        }
                        removed += 1;
                    }
                }
            }
        }

        eprintln!(
            "[ThumbnailCache] Eviction complete: removed {} frames, protected {} viewport frames, new size ~{}MB",
            removed,
            viewport_protected,
            self.total_size.load(Ordering::Relaxed) / (1024 * 1024)
        );
    }

    pub async fn cache_dir(&self) -> Option<PathBuf> {
        self.cache_dir.read().await.clone()
    }

    pub async fn frame_path(
        &self,
        video_id: &str,
        density: DensityLevel,
        time: f64,
        resolution_tier: ResolutionTier,
    ) -> Option<PathBuf> {
        let cache_dir = self.cache_dir.read().await;
        cache_dir.as_ref().map(|dir| {
            let density_name = density.label();
            let tier_name = resolution_tier.label();
            let time_key = (time * 1000.0).round() as u64;
            dir.join(format!(
                "{}_{}_{}_{}.webp",
                video_id, density_name, time_key, tier_name
            ))
        })
    }

    pub async fn clear(&self) {
        self.videos.clear();
    }
}

pub static GLOBAL_CACHE: Lazy<ThumbnailCache> = Lazy::new(ThumbnailCache::new);

pub async fn get_video_cache(video_path: &str, duration: f64) -> Arc<VideoCache> {
    GLOBAL_CACHE.get_or_create_video(video_path, duration).await
}

pub async fn clear_video_thumbnail_cache(video_path: &str) {
    let video_id = format!("{:x}", md5::compute(video_path));
    GLOBAL_CACHE.videos.remove(&video_id);
}

pub fn get_cache_stats() -> serde_json::Value {
    let video_count = GLOBAL_CACHE.videos.len();
    let mut total_frames = 0usize;

    for video in GLOBAL_CACHE.videos.iter() {
        for level in video.levels.iter() {
            total_frames += level.frames.len();
        }
    }

    serde_json::json!({
        "video_count": video_count,
        "total_frames": total_frames,
    })
}
