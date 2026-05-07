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
use std::collections::{BinaryHeap, HashSet};
use std::cmp::Reverse;
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock, Semaphore};
use web_time::Instant;

/// Errors that can occur during frame extraction
#[derive(Debug, Clone)]
pub enum ExtractionError {
    /// FFmpeg process failed to spawn (retriable with exponential backoff)
    ProcessSpawn(String),
    /// Video codec not supported or file is corrupted (not retriable)
    CodecError(String),
    /// Extraction exceeded the timeout limit (retry with lower density)
    Timeout,
    /// Cache directory not initialized or write failed
    CacheError(String),
    /// Generic extraction failure
    Other(String),
}

impl fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExtractionError::ProcessSpawn(msg) => write!(f, "Process spawn error: {}", msg),
            ExtractionError::CodecError(msg) => write!(f, "Codec error: {}", msg),
            ExtractionError::Timeout => write!(f, "Extraction timed out"),
            ExtractionError::CacheError(msg) => write!(f, "Cache error: {}", msg),
            ExtractionError::Other(msg) => write!(f, "Extraction error: {}", msg),
        }
    }
}

/// Thumbnail tile for streaming results to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailTile {
    /// Timestamp in seconds
    pub time: f64,
    /// Filesystem path to cached thumbnail
    pub path: String,
    /// Density level used for this tile
    pub density: DensityLevel,
}

/// Resolution tier for high-DPI displays
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResolutionTier {
    /// Standard resolution: 80x60px (DPR 1.0-1.4)
    Tier1x,
    /// High resolution: 160x120px (DPR 1.5+)
    Tier2x,
}

impl ResolutionTier {
    /// Map device pixel ratio to resolution tier
    pub fn from_dpr(dpr: f64) -> Self {
        if dpr >= 1.5 {
            ResolutionTier::Tier2x
        } else {
            ResolutionTier::Tier1x
        }
    }

    /// Get thumbnail dimensions for this tier
    pub fn dimensions(&self) -> (u32, u32) {
        match self {
            ResolutionTier::Tier1x => (80, 60),
            ResolutionTier::Tier2x => (160, 120),
        }
    }

    /// Get string label for this tier
    pub fn label(&self) -> &'static str {
        match self {
            ResolutionTier::Tier1x => "1x",
            ResolutionTier::Tier2x => "2x",
        }
    }

    /// Parse resolution tier from label string
    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "1x" => Ok(ResolutionTier::Tier1x),
            "2x" => Ok(ResolutionTier::Tier2x),
            _ => Err(format!("Invalid resolution tier: {}", label)),
        }
    }
}

/// Cache key for thumbnail lookups (zoom-invariant)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CacheKey {
    /// Video identifier (MD5 hash of path)
    pub video_id: String,
    /// Timestamp in milliseconds
    pub timestamp_ms: u64,
    /// Density level
    pub density: DensityLevel,
    /// Resolution tier
    pub resolution_tier: ResolutionTier,
}

impl CacheKey {
    /// Create a new cache key
    pub fn new(video_path: &str, time: f64, density: DensityLevel, dpr: f64) -> Self {
        let video_id = format!("{:x}", md5::compute(video_path));
        let timestamp_ms = (time * 1000.0).round() as u64;
        let resolution_tier = ResolutionTier::from_dpr(dpr);

        Self {
            video_id,
            timestamp_ms,
            density,
            resolution_tier,
        }
    }

    /// Convert cache key to string format: {video_id}:{timestamp_ms}:{density_label}:{resolution_tier}
    pub fn to_string(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.video_id,
            self.timestamp_ms,
            self.density.label(),
            self.resolution_tier.label()
        )
    }

    /// Parse cache key from string format
    pub fn from_string(s: &str) -> Result<Self, String> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 4 {
            return Err(format!("Invalid cache key format: expected 4 parts, got {}", parts.len()));
        }

        Ok(Self {
            video_id: parts[0].to_string(),
            timestamp_ms: parts[1]
                .parse()
                .map_err(|_| format!("Invalid timestamp: {}", parts[1]))?,
            density: DensityLevel::from_label(parts[2])?,
            resolution_tier: ResolutionTier::from_label(parts[3])?,
        })
    }
}

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

    /// Get string label for this density level
    pub fn label(&self) -> &'static str {
        match self {
            DensityLevel::Low => "low",
            DensityLevel::Medium => "medium",
            DensityLevel::High => "high",
            DensityLevel::Ultra => "ultra",
        }
    }

    /// Parse density level from label string
    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "low" => Ok(DensityLevel::Low),
            "medium" => Ok(DensityLevel::Medium),
            "high" => Ok(DensityLevel::High),
            "ultra" => Ok(DensityLevel::Ultra),
            _ => Err(format!("Invalid density level: {}", label)),
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

    /// Get next lower density level if available
    pub fn lower(&self) -> Option<Self> {
        match self {
            DensityLevel::Ultra => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::Low),
            DensityLevel::Low => None,
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
                if let Some((_, frame)) = self.frames.remove(&key) {
                    // Decrement global total_size by the file size of the removed frame
                    if let Ok(metadata) = std::fs::metadata(&frame.path) {
                        GLOBAL_CACHE.total_size.fetch_sub(metadata.len(), Ordering::Relaxed);
                    }
                }
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
        self.get_frame_with_fallback(time, target_density)
    }

    /// Get frame with progressive density fallback
    /// Implements the fallback chain: Ultra → High → Medium → Low
    /// Returns the path and the actual density level used
    pub fn get_frame_with_fallback(
        &self,
        time: f64,
        target_density: DensityLevel,
    ) -> Option<(PathBuf, DensityLevel)> {
        // Try target density first
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

        // Try lower densities (less detail)
        // Fallback order: High → Medium → Low
        let fallback_order = [
            DensityLevel::High,
            DensityLevel::Medium,
            DensityLevel::Low,
        ];

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
    videos: DashMap<String, Arc<VideoCache>>,
    /// Max videos to keep in memory
    max_videos: usize,
    /// Base cache directory
    cache_dir: RwLock<Option<PathBuf>>,
    /// Total size in bytes across all videos and all density levels
    pub total_size: AtomicU64,
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

    /// Evict frames when total cache size exceeds 200MB.
    ///
    /// Eviction strategy (Property 12 & 13):
    /// 1. Check if total_size exceeds 200MB limit
    /// 2. Collect all frames across all videos, grouped by density priority:
    ///    - High-priority eviction: Ultra and High density frames
    ///    - Low-priority eviction: Medium and Low density frames
    /// 3. Within each group, sort by access_count (ascending) then timestamp (oldest first)
    /// 4. Remove the oldest 20% of total frames, preferring Ultra/High first
    pub async fn evict_if_needed(&self) {
        const CACHE_SIZE_LIMIT: u64 = 200 * 1024 * 1024; // 200MB

        let current_size = self.total_size.load(Ordering::Relaxed);
        if current_size <= CACHE_SIZE_LIMIT {
            return;
        }

        eprintln!(
            "[ThumbnailCache] Cache size {}MB exceeds 200MB limit, evicting...",
            current_size / (1024 * 1024)
        );

        // Collect all frames across all videos and density levels.
        // Each entry: (video_id, density, time_key, access_count, timestamp, file_path)
        // We separate into high-priority eviction (Ultra/High) and low-priority (Medium/Low).
        let mut high_priority: Vec<(String, DensityLevel, u64, u64, Instant, PathBuf)> = Vec::new();
        let mut low_priority: Vec<(String, DensityLevel, u64, u64, Instant, PathBuf)> = Vec::new();

        for video_entry in self.videos.iter() {
            let video_cache = video_entry.value();
            for level_entry in video_cache.levels.iter() {
                let density = *level_entry.key();
                let density_cache = level_entry.value();
                for frame_entry in density_cache.frames.iter() {
                    let time_key = *frame_entry.key();
                    let frame = frame_entry.value();
                    let access_count = frame.access_count.load(Ordering::Relaxed);
                    let timestamp = frame.timestamp;
                    let path = frame.path.clone();
                    let vid_id = video_cache.video_id.clone();

                    match density {
                        DensityLevel::Ultra | DensityLevel::High => {
                            high_priority.push((vid_id, density, time_key, access_count, timestamp, path));
                        }
                        DensityLevel::Medium | DensityLevel::Low => {
                            low_priority.push((vid_id, density, time_key, access_count, timestamp, path));
                        }
                    }
                }
            }
        }

        // Sort each group: access_count ascending (LRU first), then timestamp oldest first
        let sort_fn = |a: &(String, DensityLevel, u64, u64, Instant, PathBuf),
                       b: &(String, DensityLevel, u64, u64, Instant, PathBuf)| {
            let access_cmp = a.3.cmp(&b.3);
            if access_cmp == std::cmp::Ordering::Equal {
                a.4.cmp(&b.4)
            } else {
                access_cmp
            }
        };
        high_priority.sort_by(sort_fn);
        low_priority.sort_by(sort_fn);

        // Calculate total frames and how many to remove (20%)
        let total_frames = high_priority.len() + low_priority.len();
        let to_remove = ((total_frames / 5).max(1)).min(total_frames);

        eprintln!(
            "[ThumbnailCache] Evicting {} of {} frames (Ultra/High: {}, Medium/Low: {})",
            to_remove,
            total_frames,
            high_priority.len(),
            low_priority.len()
        );

        // Evict from high-priority (Ultra/High) first, then low-priority (Medium/Low)
        let mut removed = 0;
        let eviction_list = high_priority.into_iter().chain(low_priority.into_iter());

        for (vid_id, density, time_key, _, _, file_path) in eviction_list {
            if removed >= to_remove {
                break;
            }

            // Remove from the in-memory cache
            if let Some(video_entry) = self.videos.get(&vid_id) {
                if let Some(level_cache) = video_entry.levels.get(&density) {
                    if level_cache.frames.remove(&time_key).is_some() {
                        // Decrement total_size by the file size
                        if let Ok(metadata) = std::fs::metadata(&file_path) {
                            self.total_size.fetch_sub(metadata.len(), Ordering::Relaxed);
                        }
                        removed += 1;
                    }
                }
            }
        }

        eprintln!(
            "[ThumbnailCache] Eviction complete: removed {} frames, new size ~{}MB",
            removed,
            self.total_size.load(Ordering::Relaxed) / (1024 * 1024)
        );
    }

    /// Get cache directory path
    pub async fn cache_dir(&self) -> Option<PathBuf> {
        self.cache_dir.read().await.clone()
    }

    /// Generate cache path for a frame
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
            dir.join(format!("{}_{}_{}_{}.webp", video_id, density_name, time_key, tier_name))
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
    pub resolution_tier: ResolutionTier,
    pub result_tx: oneshot::Sender<Result<PathBuf, String>>,
}

impl ExtractionJob {
    /// Check if this job has been cancelled
    fn is_cancelled(&self) -> bool {
        let timestamp_key = (self.time * 1000.0).round() as u64;
        
        // Check if this timestamp is still in the active request set
        if let Some(entry) = ACTIVE_TRACKER.active_requests.get(&self.video_id) {
            !entry.value().contains(&timestamp_key)
        } else {
            // No active requests for this video means all jobs are cancelled
            true
        }
    }
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
    pub resolution_tier: ResolutionTier,
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

/// Wrapper for ExtractionJob that implements Ord by priority (Critical > High > Normal).
/// Used to order jobs in a BinaryHeap (max-heap), so Critical jobs are processed first.
pub(crate) struct PrioritizedJob(pub ExtractionJob);

impl PartialEq for PrioritizedJob {
    fn eq(&self, other: &Self) -> bool {
        self.0.priority == other.0.priority
    }
}

impl Eq for PrioritizedJob {}

impl PartialOrd for PrioritizedJob {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PrioritizedJob {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Lower Priority value = higher urgency (Critical=0 > Normal=2)
        // Use Reverse so that Critical (0) sorts highest in the max-heap
        Reverse(self.0.priority).cmp(&Reverse(other.0.priority))
    }
}

impl ExtractionQueue {
    pub fn new() -> Self {
        let (job_tx, mut job_rx) = mpsc::channel::<ExtractionJob>(1000);
        let (batch_tx, mut batch_rx) = mpsc::channel::<BatchExtractionRequest>(100);
        let semaphore = Arc::new(Semaphore::new(4)); // 4 concurrent extractions

        let semaphore_clone = semaphore.clone();

        // Spawn job processor
        tokio::spawn(async move {
            // Priority queue: Critical jobs are processed before High, which before Normal.
            // BinaryHeap is a max-heap; PrioritizedJob's Ord maps Critical (0) to the
            // highest value so it is popped first.
            let mut priority_queue: BinaryHeap<PrioritizedJob> = BinaryHeap::new();

            loop {
                // If the priority queue is empty, block until at least one job arrives.
                // If it already has jobs, drain any additional pending jobs without blocking
                // so we can re-sort before picking the next one to run.
                if priority_queue.is_empty() {
                    tokio::select! {
                        Some(job) = job_rx.recv() => {
                            priority_queue.push(PrioritizedJob(job));
                        }
                        Some(batch) = batch_rx.recv() => {
                            // Batch requests bypass the priority heap and run immediately
                            // (they are always submitted with an explicit priority by the caller).
                            let permit = semaphore_clone.clone().acquire_owned().await;
                            if let Ok(permit) = permit {
                                tokio::spawn(async move {
                                    // Hold the permit for the duration of extraction;
                                    // it is dropped (released) when this closure returns.
                                    let _permit = permit;
                                    let results = Self::extract_batch(
                                        &batch.video_path,
                                        &batch.times,
                                        batch.width,
                                        batch.height,
                                        &batch.video_id,
                                        batch.density,
                                        batch.resolution_tier,
                                    ).await;
                                    let _ = batch.result_tx.send(results);
                                });
                            }
                            continue;
                        }
                        else => break,
                    }
                }

                // Drain all currently-available jobs into the priority queue without blocking.
                // This ensures that if a Critical job arrives while we are about to process a
                // Normal job, the Critical job gets picked up first.
                loop {
                    match job_rx.try_recv() {
                        Ok(job) => priority_queue.push(PrioritizedJob(job)),
                        Err(_) => break,
                    }
                }

                // Also drain any pending batch requests
                loop {
                    match batch_rx.try_recv() {
                        Ok(batch) => {
                            let sem = semaphore_clone.clone();
                            tokio::spawn(async move {
                                let permit = sem.acquire_owned().await;
                                if let Ok(permit) = permit {
                                    // Hold the permit for the duration of extraction;
                                    // it is dropped (released) when this closure returns.
                                    let _permit = permit;
                                    let results = Self::extract_batch(
                                        &batch.video_path,
                                        &batch.times,
                                        batch.width,
                                        batch.height,
                                        &batch.video_id,
                                        batch.density,
                                        batch.resolution_tier,
                                    ).await;
                                    let _ = batch.result_tx.send(results);
                                }
                            });
                        }
                        Err(_) => break,
                    }
                }

                // Pop the highest-priority job from the heap
                if let Some(PrioritizedJob(job)) = priority_queue.pop() {
                    // Check if job has been cancelled before acquiring semaphore
                    if job.is_cancelled() {
                        // Send cancellation error and skip execution
                        let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                        continue;
                    }

                    // Try to acquire a semaphore permit without blocking first.
                    // If all 4 permits are taken, we wait using tokio::select! so that
                    // new incoming jobs can still be queued while we wait for a free slot.
                    // This ensures additional requests are queued (not dropped) when the
                    // semaphore is full, and that higher-priority jobs arriving during the
                    // wait are re-sorted before the next dispatch.
                    let permit = match semaphore_clone.clone().try_acquire_owned() {
                        Ok(permit) => permit,
                        Err(_) => {
                            // All 4 permits are taken — wait for one to become available,
                            // but also keep draining new jobs into the priority queue so
                            // that Critical jobs arriving now can jump ahead of Normal jobs.
                            let sem = semaphore_clone.clone();
                            let permit = tokio::select! {
                                // A permit became available
                                Ok(permit) = sem.acquire_owned() => {
                                    // Drain any new jobs that arrived while we were waiting
                                    loop {
                                        match job_rx.try_recv() {
                                            Ok(new_job) => priority_queue.push(PrioritizedJob(new_job)),
                                            Err(_) => break,
                                        }
                                    }
                                    // Also drain any pending batch requests
                                    loop {
                                        match batch_rx.try_recv() {
                                            Ok(batch) => {
                                                let batch_sem = semaphore_clone.clone();
                                                tokio::spawn(async move {
                                                    if let Ok(p) = batch_sem.acquire_owned().await {
                                                        let _p = p;
                                                        let results = Self::extract_batch(
                                                            &batch.video_path,
                                                            &batch.times,
                                                            batch.width,
                                                            batch.height,
                                                            &batch.video_id,
                                                            batch.density,
                                                            batch.resolution_tier,
                                                        ).await;
                                                        let _ = batch.result_tx.send(results);
                                                    }
                                                });
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                    // Check if a higher-priority job arrived while waiting.
                                    // If so, push the current job back and re-sort.
                                    if let Some(top) = priority_queue.peek() {
                                        if top.0.priority < job.priority {
                                            // A higher-priority job is now at the top.
                                            // Push current job back and release the permit
                                            // so the loop re-sorts and picks the best job.
                                            priority_queue.push(PrioritizedJob(job));
                                            // Spawn a no-op to release the permit immediately
                                            drop(permit);
                                            continue;
                                        }
                                    }
                                    permit
                                }
                                // A new job arrived — push current job back, re-sort, retry
                                Some(new_job) = job_rx.recv() => {
                                    priority_queue.push(PrioritizedJob(new_job));
                                    priority_queue.push(PrioritizedJob(job));
                                    continue;
                                }
                            };
                            permit
                        }
                    };

                    tokio::spawn(async move {
                        // Double-check cancellation right before extraction
                        if job.is_cancelled() {
                            let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                            return;
                        }

                        // Hold the permit for the duration of extraction;
                        // it is dropped (released) when this closure returns,
                        // whether extraction succeeds or fails.
                        let _permit = permit;
                        let result = Self::extract_single_frame(
                            &job.video_path,
                            job.time,
                            job.width,
                            job.height,
                            &job.video_id,
                            job.density,
                            job.resolution_tier,
                        ).await;
                        let _ = job.result_tx.send(result);
                    });
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
        resolution_tier: ResolutionTier,
    ) -> Result<PathBuf, String> {
        // Get cache path
        let cache_path = GLOBAL_CACHE
            .frame_path(video_id, density, time, resolution_tier)
            .await
            .ok_or("Cache not initialized")?;

        // Check if already cached
        if cache_path.exists() {
            // Update cache entry (file already counted in total_size)
            if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                if let Some(level_cache) = video_cache.levels.get(&density) {
                    level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                }
            }
            // Enforce memory limits after adding frame to in-memory cache
            GLOBAL_CACHE.evict_if_needed().await;
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
                // Increment global total_size by the newly written file size
                if let Ok(metadata) = std::fs::metadata(&cache_path) {
                    GLOBAL_CACHE.total_size.fetch_add(metadata.len(), Ordering::Relaxed);
                }
            }
        }

        // Check if we need to evict frames to stay under 200MB limit
        GLOBAL_CACHE.evict_if_needed().await;

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
        resolution_tier: ResolutionTier,
    ) -> Vec<Result<PathBuf, String>> {
        let mut results = Vec::with_capacity(times.len());

        // For batch extraction, we process in chunks of 4 frames
        for chunk in times.chunks(4) {
            let mut chunk_results = Vec::new();

            for &time in chunk {
                // Get cache path
                let cache_path = match GLOBAL_CACHE.frame_path(video_id, density, time, resolution_tier).await {
                    Some(path) => path,
                    None => {
                        chunk_results.push(Err("Cache not initialized".to_string()));
                        continue;
                    }
                };

                // Check if already cached
                if cache_path.exists() {
                    // Update cache (file already counted in total_size)
                    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                        if let Some(level_cache) = video_cache.levels.get(&density) {
                            level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                        }
                    }
                    // Enforce memory limits after adding frame to in-memory cache
                    GLOBAL_CACHE.evict_if_needed().await;
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
                        // Update cache and increment global total_size
                        if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
                            if let Some(level_cache) = video_cache.levels.get(&density) {
                                level_cache.insert(time, CachedFrame::new(time, cache_path.clone()));
                                // Increment global total_size by the newly written file size
                                if let Ok(metadata) = std::fs::metadata(&cache_path) {
                                    GLOBAL_CACHE.total_size.fetch_add(metadata.len(), Ordering::Relaxed);
                                }
                            }
                        }
                        // Check if we need to evict frames to stay under 200MB limit
                        GLOBAL_CACHE.evict_if_needed().await;
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

/// Active extraction tracker for cancellation support
#[derive(Debug)]
pub struct ActiveExtractionTracker {
    /// Video ID -> Set of active timestamp keys (milliseconds)
    pub(crate) active_requests: DashMap<String, HashSet<u64>>,
}

impl ActiveExtractionTracker {
    pub fn new() -> Self {
        Self {
            active_requests: DashMap::new(),
        }
    }

    /// Register a new extraction request for a video
    pub fn register_request(&self, video_id: &str, timestamps: &[f64]) {
        let timestamp_keys: HashSet<u64> = timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        self.active_requests
            .insert(video_id.to_string(), timestamp_keys);
    }

    /// Cancel stale timestamps that are not in the new request
    /// Returns the list of cancelled timestamp keys (milliseconds)
    pub fn cancel_stale_timestamps(&self, video_id: &str, new_timestamps: &[f64]) -> Vec<u64> {
        let new_keys: HashSet<u64> = new_timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        let mut cancelled = Vec::new();

        if let Some(mut entry) = self.active_requests.get_mut(video_id) {
            let old_keys = entry.value().clone();

            // Find timestamps in old request but not in new request
            for old_key in old_keys.iter() {
                if !new_keys.contains(old_key) {
                    cancelled.push(*old_key);
                }
            }

            // Update to new timestamp set
            *entry.value_mut() = new_keys;
        } else {
            // No previous request, just register the new one
            self.active_requests
                .insert(video_id.to_string(), new_keys);
        }

        cancelled
    }

    /// Clear all active requests for a video
    pub fn clear_video(&self, video_id: &str) {
        self.active_requests.remove(video_id);
    }
}

/// Global singleton active extraction tracker
pub static ACTIVE_TRACKER: Lazy<ActiveExtractionTracker> = Lazy::new(ActiveExtractionTracker::new);

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
    dpr: f64,
) -> Result<PathBuf, String> {
    // Check cache first
    let video_id = format!("{:x}", md5::compute(video_path));
    let resolution_tier = ResolutionTier::from_dpr(dpr);

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
        resolution_tier,
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
    dpr: f64,
) -> Vec<Result<PathBuf, String>> {
    let video_id = format!("{:x}", md5::compute(video_path));
    let resolution_tier = ResolutionTier::from_dpr(dpr);

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
        resolution_tier,
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
    dpr: f64,
) -> Result<(), String> {
    // Generate all timestamps for this density
    let interval = density.time_interval();
    let times: Vec<f64> = (0..)
        .map(|i| i as f64 * interval)
        .take_while(|&t| t < duration)
        .collect();

    // Determine dimensions based on DPR
    let resolution_tier = ResolutionTier::from_dpr(dpr);
    let (width, height) = resolution_tier.dimensions();

    // Request batch extraction with low priority
    let _results = request_batch_thumbnails(
        video_path,
        times,
        density,
        Priority::Normal,
        width,
        height,
        dpr,
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

/// Extract a single frame, returning a typed ExtractionError on failure.
///
/// This is a thin wrapper around `request_thumbnail` that maps the
/// string-based errors into the structured `ExtractionError` variants used
/// by `extract_with_retry`.
pub async fn extract_frame(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    request_thumbnail(
        video_path,
        time,
        density,
        Priority::Critical,
        width,
        height,
        1.0, // default DPR; callers needing 2x should use request_thumbnail directly
    )
    .await
    .map_err(|e| {
        // Classify the string error into a typed ExtractionError.
        let lower = e.to_lowercase();
        if lower.contains("no such file")
            || lower.contains("permission denied")
            || lower.contains("spawn")
            || lower.contains("os error")
        {
            ExtractionError::ProcessSpawn(e)
        } else if lower.contains("codec")
            || lower.contains("decoder")
            || lower.contains("invalid data")
            || lower.contains("moov atom")
        {
            ExtractionError::CodecError(e)
        } else if lower.contains("timeout") || lower.contains("timed out") {
            ExtractionError::Timeout
        } else if lower.contains("cache") {
            ExtractionError::CacheError(e)
        } else {
            ExtractionError::Other(e)
        }
    })
}

/// Extract a frame with automatic retry and exponential backoff.
///
/// Retry policy (Property 15 — Validates: Requirements 16.1, 16.4):
/// - `ProcessSpawn` errors: retry up to 3 times with delays of 100 ms, 400 ms,
///   1600 ms (base-4 exponential backoff).
/// - `CodecError`: no retry — return immediately and let the caller use the
///   fallback chain.
/// - `Timeout`: retry once with the next lower density level; if already at
///   the lowest density, return the error.
/// - All other errors: return immediately without retry.
pub async fn extract_with_retry(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    let mut attempts = 0;
    let max_attempts = 3;
    let mut backoff_ms: u64 = 100;

    loop {
        attempts += 1;

        match extract_frame(video_path, time, density, width, height).await {
            Ok(path) => return Ok(path),
            Err(e) => {
                match e {
                    ExtractionError::CodecError(_) => {
                        // No retry for codec errors — use fallback chain immediately
                        eprintln!("[Extract] Codec error (no retry): {}", e);
                        return Err(e);
                    }
                    ExtractionError::Timeout => {
                        // Retry with lower density if available
                        if let Some(lower) = density.lower() {
                            eprintln!(
                                "[Extract] Timeout at density {:?}, retrying with lower density {:?}",
                                density, lower
                            );
                            return Box::pin(extract_with_retry(
                                video_path, time, lower, width, height,
                            ))
                            .await;
                        }
                        eprintln!("[Extract] Timeout at lowest density, giving up");
                        return Err(e);
                    }
                    ExtractionError::ProcessSpawn(_) => {
                        if attempts >= max_attempts {
                            eprintln!(
                                "[Extract] Max retries ({}) exceeded for process spawn error: {}",
                                max_attempts, e
                            );
                            return Err(e);
                        }

                        // Exponential backoff: sleep first, then log
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        eprintln!(
                            "[Extract] Retry {} after {}ms (process spawn error)",
                            attempts, backoff_ms
                        );
                        backoff_ms *= 4;
                    }
                    _ => {
                        eprintln!("[Extract] Non-retriable error: {}", e);
                        return Err(e);
                    }
                }
            }
        }
    }
}

// ============================================================================
