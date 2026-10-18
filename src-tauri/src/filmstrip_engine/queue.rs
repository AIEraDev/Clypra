use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Semaphore};

use super::cache::GLOBAL_CACHE;
use super::types::{DensityLevel, Priority, ResolutionTier};

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
    fn is_cancelled(&self) -> bool {
        let timestamp_key = (self.time * 1000.0).round() as u64;

        if let Some(entry) = ACTIVE_TRACKER.active_requests.get(&self.video_id) {
            !entry.value().contains(&timestamp_key)
        } else {
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

#[derive(Debug)]
pub struct ExtractionQueue {
    job_tx: mpsc::Sender<ExtractionJob>,
    batch_tx: mpsc::Sender<BatchExtractionRequest>,
    #[allow(dead_code)]
    semaphore: Arc<Semaphore>,
}
pub struct PrioritizedJob(pub ExtractionJob);

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
        Reverse(self.0.priority).cmp(&Reverse(other.0.priority))
    }
}

impl Default for ExtractionQueue {
    fn default() -> Self {
        Self::new()
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
            let mut priority_queue: BinaryHeap<PrioritizedJob> = BinaryHeap::new();

            loop {
                if priority_queue.is_empty() {
                    tokio::select! {
                        Some(job) = job_rx.recv() => {
                            priority_queue.push(PrioritizedJob(job));
                        }
                        Some(batch) = batch_rx.recv() => {
                            let permit = semaphore_clone.clone().acquire_owned().await;
                            if let Ok(permit) = permit {
                                tokio::spawn(async move {
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

                while let Ok(job) = job_rx.try_recv() {
                    priority_queue.push(PrioritizedJob(job));
                }

                while let Ok(batch) = batch_rx.try_recv() {
                    let sem = semaphore_clone.clone();
                    tokio::spawn(async move {
                        let permit = sem.acquire_owned().await;
                        if let Ok(permit) = permit {
                            let _permit = permit;
                            let results = Self::extract_batch(
                                &batch.video_path,
                                &batch.times,
                                batch.width,
                                batch.height,
                                &batch.video_id,
                                batch.density,
                                batch.resolution_tier,
                            )
                            .await;
                            let _ = batch.result_tx.send(results);
                        }
                    });
                }

                if let Some(PrioritizedJob(job)) = priority_queue.pop() {
                    if job.is_cancelled() {
                        let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                        continue;
                    }

                    let permit = match semaphore_clone.clone().try_acquire_owned() {
                        Ok(permit) => permit,
                        Err(_) => {
                            let sem = semaphore_clone.clone();
                            let permit = tokio::select! {
                                Ok(permit) = sem.acquire_owned() => {
                                    while let Ok(new_job) = job_rx.try_recv() {
                                        priority_queue.push(PrioritizedJob(new_job));
                                    }
                                    while let Ok(batch) = batch_rx.try_recv() {
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
                                    if let Some(top) = priority_queue.peek() {
                                        if top.0.priority < job.priority {
                                            priority_queue.push(PrioritizedJob(job));
                                            drop(permit);
                                            continue;
                                        }
                                    }
                                    permit
                                }
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
                        if job.is_cancelled() {
                            let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                            return;
                        }

                        let _permit = permit;
                        let result = Self::extract_single_frame(
                            &job.video_path,
                            job.time,
                            job.width,
                            job.height,
                            &job.video_id,
                            job.density,
                            job.resolution_tier,
                        )
                        .await;
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

    pub async fn submit(&self, job: ExtractionJob) -> Result<(), String> {
        self.job_tx
            .send(job)
            .await
            .map_err(|_| "Failed to submit extraction job".to_string())
    }

    pub async fn submit_batch(&self, request: BatchExtractionRequest) -> Result<(), String> {
        self.batch_tx
            .send(request)
            .await
            .map_err(|_| "Failed to submit batch extraction request".to_string())
    }

    async fn extract_single_frame(
        _video_path: &str,
        _time: f64,
        _width: u32,
        _height: u32,
        _video_id: &str,
        _density: DensityLevel,
        _resolution_tier: ResolutionTier,
    ) -> Result<PathBuf, String> {
        Err("extract_single_frame is deprecated - use decode_frames_streaming instead".to_string())
    }

    async fn extract_batch(
        _video_path: &str,
        _times: &[f64],
        _width: u32,
        _height: u32,
        _video_id: &str,
        _density: DensityLevel,
        _resolution_tier: ResolutionTier,
    ) -> Vec<Result<PathBuf, String>> {
        vec![
            Err("extract_batch is deprecated - use decode_frames_streaming instead".to_string());
            _times.len()
        ]
    }
}

pub static GLOBAL_QUEUE: Lazy<ExtractionQueue> = Lazy::new(ExtractionQueue::new);

#[derive(Debug)]
pub struct ActiveExtractionTracker {
    pub(crate) active_requests: DashMap<String, HashSet<u64>>,
}

impl Default for ActiveExtractionTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveExtractionTracker {
    pub fn new() -> Self {
        Self {
            active_requests: DashMap::new(),
        }
    }

    pub fn register_request(&self, video_id: &str, timestamps: &[f64]) {
        let timestamp_keys: HashSet<u64> = timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        self.active_requests
            .insert(video_id.to_string(), timestamp_keys);
    }

    pub fn cancel_stale_timestamps(&self, video_id: &str, new_timestamps: &[f64]) -> Vec<u64> {
        let new_keys: HashSet<u64> = new_timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        let mut cancelled = Vec::new();

        if let Some(mut entry) = self.active_requests.get_mut(video_id) {
            let old_keys = entry.value().clone();

            for old_key in old_keys.iter() {
                if !new_keys.contains(old_key) {
                    cancelled.push(*old_key);
                }
            }

            *entry.value_mut() = new_keys;
        } else {
            self.active_requests.insert(video_id.to_string(), new_keys);
        }

        cancelled
    }

    pub fn clear_video(&self, video_id: &str) {
        self.active_requests.remove(video_id);
    }
}

pub static ACTIVE_TRACKER: Lazy<ActiveExtractionTracker> = Lazy::new(ActiveExtractionTracker::new);

pub async fn request_thumbnail(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    priority: Priority,
    width: u32,
    height: u32,
    dpr: f64,
) -> Result<PathBuf, String> {
    let video_id = format!("{:x}", md5::compute(video_path));
    let resolution_tier = ResolutionTier::from_dpr(dpr);

    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
        if let Some((path, _)) = video_cache.get_frame_path(time, density) {
            return Ok(path);
        }
    }

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

    rx.await
        .map_err(|_| "Extraction channel closed".to_string())?
}

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

    if missing_times.is_empty() {
        return cached_results.into_iter().flatten().collect();
    }

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

    match rx.await {
        Ok(batch_results) => {
            for ((orig_idx, _), result) in missing_times.iter().zip(batch_results.iter()) {
                cached_results[*orig_idx] = Some(result.clone());
            }
            cached_results.into_iter().flatten().collect()
        }
        Err(_) => {
            for (i, _) in missing_times {
                cached_results[i] = Some(Err("Extraction cancelled".to_string()));
            }
            cached_results.into_iter().flatten().collect()
        }
    }
}

pub async fn preload_density_level(
    video_path: &str,
    density: DensityLevel,
    duration: f64,
    dpr: f64,
) -> Result<(), String> {
    let interval = density.time_interval();
    let times: Vec<f64> = (0..)
        .map(|i| i as f64 * interval)
        .take_while(|&t| t < duration)
        .collect();

    let resolution_tier = ResolutionTier::from_dpr(dpr);
    let (width, height) = resolution_tier.dimensions();

    let _results = request_batch_thumbnails(
        video_path,
        times,
        density,
        Priority::Normal,
        width,
        height,
        dpr,
    )
    .await;

    Ok(())
}

pub fn generate_timestamp_grid(
    visible_start: f64,
    visible_end: f64,
    time_per_thumb: f64,
) -> Vec<f64> {
    let first_thumb = (visible_start / time_per_thumb).floor() * time_per_thumb;
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
