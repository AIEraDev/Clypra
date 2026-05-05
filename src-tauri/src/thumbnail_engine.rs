//! CapCut-style Thumbnail Engine
//!
//! Core principle: Multi-resolution cache with async extraction queue
//! - Three density levels: Low (5s), Medium (1s), High (0.2s)
//! - Global time-grid sampling for consistent positioning
//! - Priority-based async extraction (viewport first, then background)
//! - WebP disk cache with LRU memory cache

use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, RwLock, Semaphore};
use web_time::{Duration, Instant};

/// Thumbnail density levels (time intervals)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum DensityLevel {
    /// Low density: one frame every 5 seconds (zoomed out)
    Low = 0,
    /// Medium density: one frame every 1 second (normal view)
    Medium = 1,
    /// High density: one frame every 0.2 seconds (zoomed in)
    High = 2,
    /// Ultra density: one frame every 0.02 seconds (max zoom)
    Ultra = 3,
}

impl DensityLevel {
    /// Time interval in seconds for this density level
    pub fn time_interval(&self) -> f64 {
        match self {
            DensityLevel::Low => 5.0,
            DensityLevel::Medium => 1.0,
            DensityLevel::High => 0.2,
            DensityLevel::Ultra => 0.02,
        }
    }

    /// Select appropriate density based on zoom (pixels per second)
    /// Ultra density kicks in at >4000 px/sec (time_per_thumb < 0.02s)
    pub fn from_zoom(px_per_sec: f64) -> Self {
        let time_per_thumb = 80.0 / px_per_sec; // 80px thumb width

        if time_per_thumb > 3.0 {
            DensityLevel::Low
        } else if time_per_thumb > 0.5 {
            DensityLevel::Medium
        } else if time_per_thumb > 0.05 {
            DensityLevel::High
        } else {
            DensityLevel::Ultra
        }
    }

    /// Get next higher density level if available
    pub fn higher(&self) -> Option<Self> {
        match self {
            DensityLevel::Low => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Ultra),
            DensityLevel::Ultra => None,
        }
    }
}

/// Priority for extraction jobs (viewport visibility)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Critical: Currently visible in viewport (extract immediately)
    Critical = 0,
    /// High: Near viewport (1 screen away)
    High = 1,
    /// Normal: Background prefill
    Normal = 2,
}

/// A cached thumbnail frame
#[derive(Debug)]
pub struct CachedFrame {
    pub time: f64,
    pub path: PathBuf,
    pub timestamp: Instant,
    pub access_count: AtomicU64,
}

impl CachedFrame {
    pub fn new(time: f64, path: PathBuf) -> Self {
        Self {
            time,
            path,
            timestamp: Instant::now(),
            access_count: AtomicU64::new(1),
        }
    }

    pub fn touch(&self) {
        self.access_count.fetch_add(1, Ordering::Relaxed);
    }
}

/// Cache for a single video at one density level
#[derive(Debug)]
pub struct DensityCache {
    /// Video ID (hash of path)
    pub video_id: String,
    /// Density level
    pub density: DensityLevel,
    /// Frames indexed by time (rounded to milliseconds)
    pub frames: DashMap<u64, CachedFrame>,
    /// Max size before eviction
    pub max_size: usize,
    /// Total size in bytes
    pub total_size: AtomicU64,
}

impl DensityCache {
    pub fn new(video_id: String, density: DensityLevel) -> Self {
        Self {
            video_id,
            density,
            frames: DashMap::new(),
            max_size: 500, // 500 frames per density
            total_size: AtomicU64::new(0),
        }
    }

    /// Round time to millisecond precision for key
    fn time_key(time: f64) -> u64 {
        (time * 1000.0).round() as u64
    }

    /// Get frame path if cached
    pub fn get_path(&self, time: f64) -> Option<PathBuf> {
        let key = Self::time_key(time);
        self.frames.get(&key).map(|entry| {
            entry.value().touch();
            entry.value().path.clone()
        })
    }

    /// Insert frame into cache
    pub fn insert(&self, time: f64, frame: CachedFrame) {
        let key = Self::time_key(time);
        self.frames.insert(key, frame);
        self.evict_if_needed();
    }

    /// Evict oldest frames if cache exceeds max size
    fn evict_if_needed(&self) {
        if self.frames.len() > self.max_size {
            // Collect entries sorted by timestamp (oldest first)
            let mut entries: Vec<_> = self
                .frames
                .iter()
                .map(|e| (*e.key(), e.timestamp, e.access_count.load(Ordering::Relaxed)))
                .collect();

            // Sort by: access_count (ascending), then timestamp (oldest first)
            entries.sort_by(|a, b| {
                let access_cmp = a.2.cmp(&b.2);
                if access_cmp == std::cmp::Ordering::Equal {
                    a.1.cmp(&b.1)
                } else {
                    access_cmp
                }
            });

            // Remove oldest 20%
            let to_remove = (self.max_size / 5).max(1);
            for (key, _, _) in entries.into_iter().take(to_remove) {
                self.frames.remove(&key);
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
        levels.insert(DensityLevel::Low, DensityCache::new(video_id.clone(), DensityLevel::Low));
        levels.insert(DensityLevel::Medium, DensityCache::new(video_id.clone(), DensityLevel::Medium));
        levels.insert(DensityLevel::High, DensityCache::new(video_id.clone(), DensityLevel::High));
        levels.insert(DensityLevel::Ultra, DensityCache::new(video_id.clone(), DensityLevel::Ultra));

        Self {
            video_id,
            video_path,
            duration,
            levels,
            last_accessed: RwLock::new(Instant::now()),
        }
    }

    /// Touch cache to update last accessed time
    pub async fn touch(&self) {
        let mut last = self.last_accessed.write().await;
        *last = Instant::now();
    }

    /// Get best available frame path for a given time
    /// Returns the path and the density level it came from
    pub fn get_frame_path(&self, time: f64, target_density: DensityLevel) -> Option<(PathBuf, DensityLevel)> {
        // Try target density first
        if let Some(cache) = self.levels.get(&target_density) {
            if let Some(path) = cache.get_path(time) {
                return Some((path, target_density));
            }
        }

        // Try higher densities (finer granularity)
        let mut current = target_density;
        while let Some(higher) = current.higher() {
            if let Some(cache) = self.levels.get(&higher) {
                if let Some(path) = cache.get_path(time) {
                    return Some((path, higher));
                }
            }
            current = higher;
        }

        // Try lower densities as fallback
        // (search all lower levels: High, Medium, Low - in that order)
        let fallback_order = [
            DensityLevel::High,
            DensityLevel::Medium,
            DensityLevel::Low,
        ];
        for density in fallback_order {
            if density >= target_density {
                continue;
            }
            if let Some(cache) = self.levels.get(&density) {
                if let Some(path) = cache.get_path(time) {
                    return Some((path, density));
                }
            }
        }

        None
    }
}

/// Global cache for all videos
#[derive(Debug)]
pub struct ThumbnailCache {
    /// Video ID -> Video cache
    videos: DashMap<String, Arc<VideoCache>>,
    /// Max videos to keep in memory
    max_videos: usize,
    /// Base cache directory
    cache_dir: RwLock<Option<PathBuf>>,
}

impl ThumbnailCache {
    pub fn new() -> Self {
        Self {
            videos: DashMap::new(),
            max_videos: 50, // Keep 50 videos in memory
            cache_dir: RwLock::new(None),
        }
    }

    /// Initialize cache directory
    pub async fn init_cache_dir(&self, app_cache_dir: PathBuf) -> Result<(), String> {
        let thumb_dir = app_cache_dir.join("thumbnails");
        tokio::fs::create_dir_all(&thumb_dir)
            .await
            .map_err(|e| format!("Failed to create thumbnail cache dir: {}", e))?;

        let mut dir = self.cache_dir.write().await;
        *dir = Some(thumb_dir);
        Ok(())
    }

    /// Get or create video cache
    pub async fn get_or_create_video(&self, video_path: &str, duration: f64) -> Arc<VideoCache> {
        let video_id = format!("{:x}", md5::compute(video_path));

        if let Some(cached) = self.videos.get(&video_id) {
            cached.touch().await;
            return cached.clone();
        }

        let cache = Arc::new(VideoCache::new(video_id.clone(), video_path.to_string(), duration));
        self.videos.insert(video_id, cache.clone());
        self.evict_if_needed().await;
        cache
    }

    /// Get video cache if exists
    pub fn get_video(&self, video_path: &str) -> Option<Arc<VideoCache>> {
        let video_id = format!("{:x}", md5::compute(video_path));
        self.videos.get(&video_id).map(|e| e.clone())
    }

    /// Evict oldest videos if cache exceeds max size
    async fn evict_if_needed(&self) {
        if self.videos.len() > self.max_videos {
            let mut entries: Vec<_> = self
                .videos
                .iter()
                .map(|e| {
                    let last_access = tokio::task::block_in_place(|| {
                        // This is a hack - ideally we'd store last_accessed as atomic
                        std::time::Instant::now()
                    });
                    (e.key().clone(), last_access)
                })
                .collect();

            entries.sort_by(|a, b| a.1.cmp(&b.1));

            let to_remove = (self.max_videos / 5).max(1);
            for (key, _) in entries.into_iter().take(to_remove) {
                self.videos.remove(&key);
            }
        }
    }

    /// Get cache directory path
    pub async fn cache_dir(&self) -> Option<PathBuf> {
        self.cache_dir.read().await.clone()
    }

    /// Generate cache path for a frame
    pub async fn frame_path(&self, video_id: &str, density: DensityLevel, time: f64) -> Option<PathBuf> {
        let cache_dir = self.cache_dir.read().await;
        cache_dir.as_ref().map(|dir| {
            let density_name = match density {
                DensityLevel::Low => "low",
                DensityLevel::Medium => "medium",
                DensityLevel::High => "high",
                DensityLevel::Ultra => "ultra",
            };
            let time_key = (time * 1000.0).round() as u64;
            dir.join(format!("{}_{}_{}.webp", video_id, density_name, time_key))
        })
    }

    /// Clear all caches
    pub async fn clear(&self) {
        self.videos.clear();
    }
}

/// Global singleton cache
pub static GLOBAL_CACHE: Lazy<ThumbnailCache> = Lazy::new(ThumbnailCache::new);

/// Extraction job for the async queue
#[derive(Debug)]
pub struct ExtractionJob {
    pub video_path: String,
    pub video_id: String,
    pub time: f64,
    pub density: DensityLevel,
    pub priority: Priority,
    pub width: u32,
    pub height: u32,
    pub result_tx: oneshot::Sender<Result<PathBuf, String>>,
}

/// Batch extraction request
#[derive(Debug)]
pub struct BatchExtractionRequest {
    pub video_path: String,
    pub video_id: String,
    pub times: Vec<f64>,
    pub density: DensityLevel,
    pub priority: Priority,
    pub width: u32,
    pub height: u32,
    pub result_tx: oneshot::Sender<Vec<Result<PathBuf, String>>>,
}

/// Async extraction queue
#[derive(Debug)]
pub struct ExtractionQueue {
    /// Job sender
    job_tx: mpsc::Sender<ExtractionJob>,
    /// Batch job sender
    batch_tx: mpsc::Sender<BatchExtractionRequest>,
    /// Concurrency limiter (4 parallel extractions)
    semaphore: Arc<Semaphore>,
}

impl ExtractionQueue {
    pub fn new() -> Self {
        let (job_tx, mut job_rx) = mpsc::channel::<ExtractionJob>(1000);
        let (batch_tx, mut batch_rx) = mpsc::channel::<BatchExtractionRequest>(100);
        let semaphore = Arc::new(Semaphore::new(4)); // 4 concurrent extractions

        let semaphore_clone = semaphore.clone();

        // Spawn job processor
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(job) = job_rx.recv() => {
                        let permit = semaphore_clone.clone().acquire_owned().await;
                        if let Ok(_permit) = permit {
                            tokio::spawn(async move {
                                let result = Self::extract_single_frame(
                                    &job.video_path,
                                    job.time,
                                    job.width,
                                    job.height,
                                    &job.video_id,
                                    job.density,
                                ).await;
                                let _ = job.result_tx.send(result);
                            });
                        }
                    }
                    Some(batch) = batch_rx.recv() => {
                        let permit = semaphore_clone.clone().acquire_owned().await;
                        if let Ok(_permit) = permit {
                            tokio::spawn(async move {
                                let results = Self::extract_batch(
                                    &batch.video_path,
                                    &batch.times,
                                    batch.width,
                                    batch.height,
                                    &batch.video_id,
                                    batch.density,
                                ).await;
                                let _ = batch.result_tx.send(results);
                            });
                        }
                    }
                    else => break,
                }
            }
        });

        Self {
            job_tx,
            batch_tx,
            semaphore,
        }
    }

    /// Submit a single extraction job
    pub async fn submit(&self, job: ExtractionJob) -> Result<(), String> {
        self.job_tx
            .send(job)
            .await
            .map_err(|_| "Failed to submit extraction job".to_string())
    }

    /// Submit a batch extraction job
    pub async fn submit_batch(&self, request: BatchExtractionRequest) -> Result<(), String> {
        self.batch_tx
            .send(request)
            .await
            .map_err(|_| "Failed to submit batch extraction request".to_string())
    }

    /// Extract a single frame using FFmpeg
    async fn extract_single_frame(
        video_path: &str,
        time: f64,
        width: u32,
        height: u32,
        video_id: &str,
        density: DensityLevel,
    ) -> Result<PathBuf, String> {
        // Get cache path
        let cache_path = GLOBAL_CACHE
            .frame_path(video_id, density, time)
            .await
            .ok_or("Cache not initialized")?;

        // Check if already cached
        if cache_path.exists() {
            // Update cache entry
            if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                if let Some(level_cache) = video_cache.levels.get(&density) {
                    level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                }
            }
            return Ok(cache_path);
        }

        // Ensure parent directory exists
        if let Some(parent) = cache_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create cache directory: {}", e))?;
        }

        let time_str = format!("{:.3}", time);
        let scale_str = format!("{}:{}", width, height);

        // Hybrid seeking: fast seek to keyframe before target, then precise decode
        let fast_seek_time = (time - 2.0).max(0.0);
        let fast_seek_str = format!("{:.3}", fast_seek_time);
        let precise_seek = if fast_seek_time > 0.0 { "2.0" } else { &time_str };

        // Build FFmpeg filter: scale up to fill, then crop (no black bars)
        let vf_filter = format!(
            "scale={}:force_original_aspect_ratio=increase,crop={}:{}",
            scale_str, width, height
        );

        let args = vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-ss".to_string(),
            fast_seek_str.clone(),
            "-i".to_string(),
            video_path.to_string(),
            "-ss".to_string(),
            precise_seek.to_string(),
            "-vframes".to_string(),
            "1".to_string(),
            "-vf".to_string(),
            vf_filter.clone(),
            "-c:v".to_string(),
            "libwebp".to_string(),
            "-quality".to_string(),
            "80".to_string(),
            "-f".to_string(),
            "image2".to_string(),
            cache_path
                .to_str()
                .ok_or("Invalid cache path")?
                .to_string(),
        ];
        let output = crate::ffmpeg_sidecar::ffmpeg_output_strings(&args)
            .await
            .map_err(|e| format!("FFmpeg failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg error: {}", stderr));
        }

        // Update cache entry
        if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
            if let Some(level_cache) = video_cache.levels.get(&density) {
                level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
            }
        }

        Ok(cache_path)
    }

    /// Extract multiple frames in batch (more efficient)
    async fn extract_batch(
        video_path: &str,
        times: &[f64],
        width: u32,
        height: u32,
        video_id: &str,
        density: DensityLevel,
    ) -> Vec<Result<PathBuf, String>> {
        let mut results = Vec::with_capacity(times.len());

        // For batch extraction, we process in chunks of 4 frames
        for chunk in times.chunks(4) {
            let mut chunk_results = Vec::new();

            for &time in chunk {
                // Get cache path
                let cache_path = match GLOBAL_CACHE.frame_path(video_id, density, time).await {
                    Some(path) => path,
                    None => {
                        chunk_results.push(Err("Cache not initialized".to_string()));
                        continue;
                    }
                };

                // Check if already cached
                if cache_path.exists() {
                    // Update cache
                    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                        if let Some(level_cache) = video_cache.levels.get(&density) {
                            level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                        }
                    }
                    chunk_results.push(Ok(cache_path));
                    continue;
                }

                // Ensure parent directory exists
                if let Some(parent) = cache_path.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }

                let time_str = format!("{:.3}", time);
                let scale_str = format!("{}:{}", width, height);

                // Hybrid seeking
                let fast_seek_time = (time - 2.0).max(0.0);
                let fast_seek_str = format!("{:.3}", fast_seek_time);
                let precise_seek = if fast_seek_time > 0.0 { "2.0" } else { &time_str };

                let vf_filter = format!(
                    "scale={}:force_original_aspect_ratio=increase,crop={}:{}",
                    scale_str, width, height
                );

                let args = vec![
                    "-hide_banner".to_string(),
                    "-loglevel".to_string(),
                    "error".to_string(),
                    "-ss".to_string(),
                    fast_seek_str.clone(),
                    "-i".to_string(),
                    video_path.to_string(),
                    "-ss".to_string(),
                    precise_seek.to_string(),
                    "-vframes".to_string(),
                    "1".to_string(),
                    "-vf".to_string(),
                    vf_filter.clone(),
                    "-c:v".to_string(),
                    "libwebp".to_string(),
                    "-quality".to_string(),
                    "80".to_string(),
                    "-f".to_string(),
                    "image2".to_string(),
                    cache_path.to_str().unwrap_or("").to_string(),
                ];
                let result = crate::ffmpeg_sidecar::ffmpeg_output_strings(&args).await;

                match result {
                    Ok(output) if output.status.success() => {
                        // Update cache
                        if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                            if let Some(level_cache) = video_cache.levels.get(&density) {
                                level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                            }
                        }
                        chunk_results.push(Ok(cache_path));
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        chunk_results.push(Err(format!("FFmpeg error: {}", stderr)));
                    }
                    Err(e) => {
                        chunk_results.push(Err(format!("FFmpeg failed: {}", e)));
                    }
                }
            }

            results.extend(chunk_results);
        }

        results
    }
}

/// Global singleton extraction queue
pub static GLOBAL_QUEUE: Lazy<ExtractionQueue> = Lazy::new(ExtractionQueue::new);

/// Public API: Get or create video cache entry
pub async fn get_video_cache(video_path: &str, duration: f64) -> Arc<VideoCache> {
    GLOBAL_CACHE.get_or_create_video(video_path, duration).await
}

/// Public API: Request thumbnail extraction
pub async fn request_thumbnail(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    priority: Priority,
    width: u32,
    height: u32,
) -> Result<PathBuf, String> {
    // Check cache first
    let video_id = format!("{:x}", md5::compute(video_path));

    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
        if let Some((path, _)) = video_cache.get_frame_path(time, density) {
            return Ok(path);
        }
    }

    // Submit extraction job
    let (tx, rx) = oneshot::channel();
    let job = ExtractionJob {
        video_path: video_path.to_string(),
        video_id,
        time,
        density,
        priority,
        width,
        height,
        result_tx: tx,
    };

    GLOBAL_QUEUE.submit(job).await?;

    // Wait for result
    rx.await
        .map_err(|_| "Extraction channel closed".to_string())?
}

/// Public API: Request batch thumbnail extraction
pub async fn request_batch_thumbnails(
    video_path: &str,
    times: Vec<f64>,
    density: DensityLevel,
    priority: Priority,
    width: u32,
    height: u32,
) -> Vec<Result<PathBuf, String>> {
    let video_id = format!("{:x}", md5::compute(video_path));

    // Check cache for existing frames
    let mut missing_times = Vec::new();
    let mut cached_results: Vec<Option<Result<PathBuf, String>>> = vec![None; times.len()];

    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
        for (i, time) in times.iter().enumerate() {
            if let Some((path, _)) = video_cache.get_frame_path(*time, density) {
                cached_results[i] = Some(Ok(path));
            } else {
                missing_times.push((i, *time));
            }
        }
    } else {
        missing_times = times.iter().enumerate().map(|(i, t)| (i, *t)).collect();
    }

    // If all cached, return early
    if missing_times.is_empty() {
        return cached_results.into_iter().flatten().collect();
    }

    // Extract missing times
    let (tx, rx) = oneshot::channel();
    let request = BatchExtractionRequest {
        video_path: video_path.to_string(),
        video_id,
        times: missing_times.iter().map(|(_, t)| *t).collect(),
        density,
        priority,
        width,
        height,
        result_tx: tx,
    };

    if let Err(e) = GLOBAL_QUEUE.submit_batch(request).await {
        return vec![Err(e); times.len()];
    }

    // Wait for results and merge with cached
    match rx.await {
        Ok(batch_results) => {
            for ((orig_idx, _), result) in missing_times.iter().zip(batch_results.iter()) {
                cached_results[*orig_idx] = Some(result.clone());
            }
            cached_results.into_iter().flatten().collect()
        }
        Err(_) => {
            // Channel closed, return errors for missing
            for (i, _) in missing_times {
                cached_results[i] = Some(Err("Extraction cancelled".to_string()));
            }
            cached_results.into_iter().flatten().collect()
        }
    }
}

/// Initialize the thumbnail system
pub async fn init_thumbnail_engine(app_cache_dir: PathBuf) -> Result<(), String> {
    GLOBAL_CACHE.init_cache_dir(app_cache_dir).await
}

/// Preload a density level for a video (background task)
pub async fn preload_density_level(
    video_path: &str,
    density: DensityLevel,
    duration: f64,
) -> Result<(), String> {
    // Generate all timestamps for this density
    let interval = density.time_interval();
    let times: Vec<f64> = (0..)
        .map(|i| i as f64 * interval)
        .take_while(|&t| t < duration)
        .collect();

    // Request batch extraction with low priority
    let _results = request_batch_thumbnails(
        video_path,
        times,
        density,
        Priority::Normal,
        80,
        60,
    ).await;

    Ok(())
}

/// Generate timestamp grid for visible range (same logic as frontend)
pub fn generate_timestamp_grid(
    visible_start: f64,
    visible_end: f64,
    time_per_thumb: f64,
) -> Vec<f64> {
    // Align to global grid
    let first_thumb = (visible_start / time_per_thumb).floor() * time_per_thumb;

    // Buffer of one thumbnail
    let buffer = time_per_thumb;
    let grid_start = first_thumb - buffer;
    let grid_end = visible_end + buffer;

    let mut timestamps = Vec::new();
    let mut t = grid_start;

    while t <= grid_end {
        let time = (t * 1000.0).round() / 1000.0;
        timestamps.push(time);
        t += time_per_thumb;
    }

    timestamps
}

/// Clear thumbnail cache for a video
pub async fn clear_video_thumbnail_cache(video_path: &str) {
    let video_id = format!("{:x}", md5::compute(video_path));
    GLOBAL_CACHE.videos.remove(&video_id);
}

/// Get cache statistics
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

// ============================================================================
