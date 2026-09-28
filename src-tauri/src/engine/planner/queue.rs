//! Bounded Queues and Per-Asset Fair Arbitration (Phase F)
//!
//! Enforces:
//! - Configurable queue capacities derived dynamically from workload
//! - Per-asset queues preventing unfair monopolization across tracks
//! - Presentation-aware ReadyFrame (Early, OnTime, Late, Obsolete)

use super::super::frame::VideoFrame;
use super::super::types::MediaTime;
use super::MediaRequest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Configuration governing bounded queue capacities.
/// Derived dynamically from frame duration, streams, and surface pool capacity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueConfig {
    pub demux_capacity: usize,
    pub decode_capacity: usize,
    pub ready_frame_capacity: usize,
}

impl QueueConfig {
    /// Dynamically derives optimal queue capacities based on engine workload.
    pub fn derive_defaults(fps: f64, active_streams: usize, surface_pool_capacity: usize) -> Self {
        let streams = active_streams.max(1);
        let frame_budget_factor = if fps >= 50.0 { 2 } else { 1 };

        let ready_frame_capacity = (streams * 2 * frame_budget_factor)
            .min(surface_pool_capacity / 2)
            .max(2);
        let decode_capacity = (ready_frame_capacity * 2).min(surface_pool_capacity).max(4);
        let demux_capacity = (decode_capacity * 2).max(8);

        Self {
            demux_capacity,
            decode_capacity,
            ready_frame_capacity,
        }
    }
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            demux_capacity: 8,
            decode_capacity: 4,
            ready_frame_capacity: 2,
        }
    }
}

/// Timing status of a ready frame relative to presentation deadline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyTimingStatus {
    Early(Duration),
    OnTime,
    Late(Duration),
    Obsolete,
}

/// A decoded video frame queued in the ready frame queue awaiting presentation.
#[derive(Debug, Clone)]
pub struct ReadyFrame {
    pub frame: VideoFrame,
    pub project_revision: u64,
    pub playback_generation: u64,
    pub target_pts: MediaTime,
    pub ready_at: Instant,
}

impl ReadyFrame {
    pub fn new(
        frame: VideoFrame,
        project_revision: u64,
        playback_generation: u64,
        target_pts: MediaTime,
    ) -> Self {
        Self {
            frame,
            project_revision,
            playback_generation,
            target_pts,
            ready_at: Instant::now(),
        }
    }

    /// Evaluates if this ready frame arrived early, on-time, late, or obsolete.
    pub fn timing_status(
        &self,
        deadline_instant: Instant,
        current_revision: u64,
        current_generation: u64,
    ) -> ReadyTimingStatus {
        if self.project_revision != current_revision
            || self.playback_generation != current_generation
        {
            return ReadyTimingStatus::Obsolete;
        }

        let now = Instant::now();
        if now > deadline_instant {
            ReadyTimingStatus::Late(now.duration_since(deadline_instant))
        } else {
            let margin = deadline_instant.duration_since(now);
            if margin > Duration::from_millis(5) {
                ReadyTimingStatus::Early(margin)
            } else {
                ReadyTimingStatus::OnTime
            }
        }
    }
}

/// Bounded ready frame queue holding decoded surfaces ready for immediate compositor sampling.
#[derive(Debug)]
pub struct ReadyFrameQueue {
    capacity: usize,
    frames: VecDeque<ReadyFrame>,
}

impl ReadyFrameQueue {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            frames: VecDeque::with_capacity(capacity),
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn is_full(&self) -> bool {
        self.frames.len() >= self.capacity
    }

    /// Pushes a decoded ready frame into the queue.
    /// If the queue is at capacity, the oldest non-current frame is dropped to relieve backpressure.
    pub fn push(&mut self, ready: ReadyFrame) {
        if self.frames.len() >= self.capacity {
            self.frames.pop_front();
        }
        self.frames.push_back(ready);
    }

    /// Retrieves the frame matching target PTS and active generation.
    pub fn pop_for_pts(&mut self, target_pts: MediaTime, generation: u64) -> Option<ReadyFrame> {
        let index = self
            .frames
            .iter()
            .position(|f| f.playback_generation == generation && f.target_pts == target_pts);

        if let Some(i) = index {
            self.frames.remove(i)
        } else {
            None
        }
    }

    /// Discards all frames belonging to obsolete seek/scrub generations.
    pub fn prune_obsolete(&mut self, current_revision: u64, current_generation: u64) -> usize {
        let initial_len = self.frames.len();
        self.frames.retain(|f| {
            f.project_revision == current_revision && f.playback_generation == current_generation
        });
        initial_len - self.frames.len()
    }

    pub fn clear(&mut self) {
        self.frames.clear();
    }
}

/// Fair multi-track queue manager.
/// Manages separate queues per asset to prevent high-bitrate tracks from starving other tracks.
#[derive(Debug, Default)]
pub struct PerAssetQueueManager {
    asset_queues: HashMap<String, VecDeque<MediaRequest>>,
    round_robin_keys: Vec<String>,
    rr_cursor: usize,
}

impl PerAssetQueueManager {
    pub fn new() -> Self {
        Self {
            asset_queues: HashMap::new(),
            round_robin_keys: Vec::new(),
            rr_cursor: 0,
        }
    }

    /// Enqueues a request into its respective asset queue.
    pub fn enqueue(&mut self, request: MediaRequest) {
        if !self.asset_queues.contains_key(&request.asset_id) {
            self.round_robin_keys.push(request.asset_id.clone());
        }
        let queue = self
            .asset_queues
            .entry(request.asset_id.clone())
            .or_default();
        queue.push_back(request);
    }

    /// Enqueues multiple requests from a work plan.
    pub fn enqueue_plan(&mut self, plan: &super::MediaWorkPlan) {
        for request in &plan.requests {
            self.enqueue(request.clone());
        }
    }

    /// Pops the next highest-priority request across all assets.
    /// If priorities are equal, round-robins across active assets to ensure fairness.
    pub fn pop_next(&mut self) -> Option<MediaRequest> {
        if self.asset_queues.is_empty() {
            return None;
        }

        // 1. First search for highest priority request across all queues
        let mut highest_priority = None;
        for queue in self.asset_queues.values() {
            for req in queue {
                highest_priority = match highest_priority {
                    None => Some(req.priority),
                    Some(p) => Some(p.max(req.priority)),
                };
            }
        }

        let target_priority = highest_priority?;

        // 2. Select the next asset matching target_priority using fair round-robin
        let keys_len = self.round_robin_keys.len();
        for i in 0..keys_len {
            let idx = (self.rr_cursor + i) % keys_len;
            let asset_id = &self.round_robin_keys[idx];

            if let Some(queue) = self.asset_queues.get_mut(asset_id) {
                if let Some(req_idx) = queue.iter().position(|r| r.priority == target_priority) {
                    let req = queue.remove(req_idx).unwrap();
                    self.rr_cursor = (idx + 1) % keys_len;
                    return Some(req);
                }
            }
        }

        None
    }

    /// Total number of pending requests across all asset queues.
    pub fn total_pending(&self) -> usize {
        self.asset_queues.values().map(|q| q.len()).sum()
    }

    /// Number of active asset queues.
    pub fn active_asset_count(&self) -> usize {
        self.asset_queues.len()
    }

    /// Prunes requests belonging to obsolete generations.
    pub fn prune_obsolete(&mut self, current_revision: u64, current_generation: u64) -> usize {
        let mut pruned = 0;
        for queue in self.asset_queues.values_mut() {
            let initial = queue.len();
            queue.retain(|r| !r.is_obsolete(current_revision, current_generation));
            pruned += initial - queue.len();
        }
        pruned
    }

    pub fn clear(&mut self) {
        self.asset_queues.clear();
        self.round_robin_keys.clear();
        self.rr_cursor = 0;
    }
}
