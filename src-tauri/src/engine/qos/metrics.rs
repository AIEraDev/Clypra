//! Performance Snapshots and Rolling Metrics Window
//!
//! Evaluates performance across rolling 250–500 ms windows to classify bottlenecks
//! without reacting to isolated single-frame spikes.

use super::super::types::MediaTime;
use super::types::Bottleneck;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

/// Instantaneous performance telemetry recorded for a single presented frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PerformanceSnapshot {
    pub decode_us: u64,
    pub render_cpu_us: u64,
    pub render_gpu_us: u64,
    pub effect_timings: HashMap<String, u64>,
    pub decode_queue_depth: usize,
    pub ready_queue_depth: usize,
    pub surface_pool_used: usize,
    pub surface_pool_capacity: usize,
    pub deadline_missed: bool,
    pub frame_pts: MediaTime,
}

impl Default for PerformanceSnapshot {
    fn default() -> Self {
        Self {
            decode_us: 0,
            render_cpu_us: 0,
            render_gpu_us: 0,
            effect_timings: HashMap::new(),
            decode_queue_depth: 0,
            ready_queue_depth: 4,
            surface_pool_used: 2,
            surface_pool_capacity: 10,
            deadline_missed: false,
            frame_pts: MediaTime::ZERO,
        }
    }
}

/// Rolling performance window aggregating frame telemetry over 250–500 ms.
#[derive(Debug, Clone)]
pub struct PerformanceWindow {
    snapshots: VecDeque<PerformanceSnapshot>,
    window_capacity: usize,
    target_frame_budget_us: u64,
}

impl PerformanceWindow {
    /// Creates a new rolling window with specified capacity (e.g. 15 frames = ~250ms at 60 FPS).
    pub fn new(capacity: usize, target_fps: f64) -> Self {
        let budget_us = if target_fps > 0.0 {
            (1_000_000.0 / target_fps) as u64
        } else {
            16_667
        };
        Self {
            snapshots: VecDeque::with_capacity(capacity),
            window_capacity: capacity.max(5),
            target_frame_budget_us: budget_us,
        }
    }

    /// Pushes a new frame performance snapshot into the rolling window.
    pub fn push(&mut self, snapshot: PerformanceSnapshot) {
        if self.snapshots.len() >= self.window_capacity {
            self.snapshots.pop_front();
        }
        self.snapshots.push_back(snapshot);
    }

    /// Number of samples currently in the window.
    #[inline]
    pub fn len(&self) -> usize {
        self.snapshots.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.snapshots.is_empty()
    }

    /// Clears all recorded samples in the window.
    pub fn clear(&mut self) {
        self.snapshots.clear();
    }

    /// Mean decode latency in microseconds.
    pub fn mean_decode_us(&self) -> u64 {
        if self.snapshots.is_empty() {
            return 0;
        }
        let sum: u64 = self.snapshots.iter().map(|s| s.decode_us).sum();
        sum / self.snapshots.len() as u64
    }

    /// Mean GPU render/compositing latency in microseconds.
    pub fn mean_render_gpu_us(&self) -> u64 {
        if self.snapshots.is_empty() {
            return 0;
        }
        let sum: u64 = self.snapshots.iter().map(|s| s.render_gpu_us).sum();
        sum / self.snapshots.len() as u64
    }

    /// Mean ready queue depth (available pre-decoded frames).
    pub fn mean_ready_queue_depth(&self) -> f32 {
        if self.snapshots.is_empty() {
            return 0.0;
        }
        let sum: usize = self.snapshots.iter().map(|s| s.ready_queue_depth).sum();
        sum as f32 / self.snapshots.len() as f32
    }

    /// Deadline miss ratio in the rolling window [0.0, 1.0].
    pub fn deadline_miss_ratio(&self) -> f32 {
        if self.snapshots.is_empty() {
            return 0.0;
        }
        let misses = self.snapshots.iter().filter(|s| s.deadline_missed).count();
        misses as f32 / self.snapshots.len() as f32
    }

    /// Number of deadline misses in the current window.
    pub fn deadline_miss_count(&self) -> u64 {
        self.snapshots.iter().filter(|s| s.deadline_missed).count() as u64
    }

    /// Peak surface pool utilization percentage [0.0, 1.0].
    pub fn peak_pool_utilization(&self) -> f32 {
        self.snapshots
            .iter()
            .map(|s| {
                if s.surface_pool_capacity > 0 {
                    s.surface_pool_used as f32 / s.surface_pool_capacity as f32
                } else {
                    0.0
                }
            })
            .fold(0.0f32, f32::max)
    }

    /// Identifies the most expensive individual effect in the render graph.
    pub fn dominant_effect(&self) -> Option<(String, u64)> {
        if self.snapshots.is_empty() {
            return None;
        }
        let mut effect_totals: HashMap<String, (u64, usize)> = HashMap::new();
        for s in &self.snapshots {
            for (name, &us) in &s.effect_timings {
                let entry = effect_totals.entry(name.clone()).or_insert((0, 0));
                entry.0 += us;
                entry.1 += 1;
            }
        }

        effect_totals
            .into_iter()
            .map(|(name, (total, count))| (name, total / count as u64))
            .max_by_key(|(_, mean)| *mean)
    }

    /// Diagnoses the root bottleneck of the current performance window.
    pub fn diagnose_bottleneck(&self) -> (Bottleneck, f32) {
        if self.snapshots.len() < 3 {
            return (Bottleneck::None, 0.5);
        }

        let mean_decode = self.mean_decode_us();
        let mean_gpu = self.mean_render_gpu_us();
        let miss_ratio = self.deadline_miss_ratio();
        let ready_depth = self.mean_ready_queue_depth();
        let pool_util = self.peak_pool_utilization();
        let budget = self.target_frame_budget_us;

        // 1. Surface Pool Memory Exhaustion
        if pool_util >= 0.90 {
            let conf = ((pool_util - 0.90) / 0.10).clamp(0.8, 1.0);
            return (Bottleneck::SurfacePool, conf);
        }

        // 2. Expensive Effect Domination (e.g. Blur alone taking > 60% of budget)
        if let Some((effect_name, effect_mean_us)) = self.dominant_effect() {
            if effect_mean_us > (budget * 6 / 10) {
                let conf = (effect_mean_us as f32 / budget as f32).clamp(0.75, 1.0);
                return (Bottleneck::Effect(effect_name), conf);
            }
        }

        // 3. Decode Starvation / Decoder Bottleneck
        // A shallow lookahead queue is normal for low-latency playback. It is
        // evidence of decode starvation only when decode work itself consumes
        // most of the frame budget; queue depth alone must never downgrade
        // quality.
        if mean_decode > budget
            || (ready_depth < 1.0 && miss_ratio > 0.25 && mean_decode > (budget * 9 / 10))
        {
            let conf = if mean_decode > budget {
                ((mean_decode as f32 / budget as f32) * 0.8).clamp(0.7, 1.0)
            } else {
                0.85
            };
            return (Bottleneck::Decode, conf);
        }

        // 4. GPU Render Bottleneck
        // Signs: GPU render execution exceeds budget or causes significant misses
        if mean_gpu > budget || (miss_ratio > 0.25 && mean_gpu > (budget * 8 / 10)) {
            let conf = (mean_gpu as f32 / budget as f32).clamp(0.7, 1.0);
            return (Bottleneck::RenderGpu, conf);
        }

        // 4b. High Deadline Miss Fallback
        // Misses without a near-budget stage are not actionable evidence for
        // a quality downgrade (they can be caused by a blocked UI thread or a
        // compositor wake-up). Do not mislabel them as decode starvation.
        if miss_ratio >= 0.25 {
            return (Bottleneck::None, 0.6);
        }

        // 5. System Healthy
        if miss_ratio < 0.05 && mean_decode < (budget * 7 / 10) && mean_gpu < (budget * 7 / 10) {
            return (Bottleneck::None, 0.95);
        }

        (Bottleneck::None, 0.6)
    }
}
