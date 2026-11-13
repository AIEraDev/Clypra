use crate::commands::render_target_manager::RenderTargetId;
use crate::wgpu_compositor::frame_correlation::FrameOutputCorrelation;
use crate::wgpu_compositor::frame_memory::FrameMemoryTelemetry;
use crate::wgpu_compositor::render_path::FrameSource;

/// Per-frame timing and provenance for a single rendered frame.
///
/// # CPU vs GPU timing distinction
///
/// `render_submit_cpu_us` measures wall-clock time to encode and submit GPU
/// commands on the CPU thread. It is **not** GPU execution time. Actual GPU
/// render duration comes from wgpu timestamp queries (Phase 6, requires
/// `TIMESTAMP_QUERY` device feature). The field names make this distinction
/// explicit from the beginning.
///
/// # Collection
///
/// `FrameTelemetry` is filled in the hot render path and pushed to a
/// fixed-size ring buffer (e.g. 300 samples ≈ 5 s at 60 fps). p50/p95/p99
/// percentiles are computed per stage in Phase 6 via `get_renderer_diagnostics`.
///
/// # Defaults
///
/// `Option<u64>` fields start as `None` and are populated by later phases:
/// - `gpu_render_us`:  Phase 6 (wgpu timestamp queries)
/// - `queue_wait_us`:  Phase 4 (scheduler integration)
/// - `ipc_wait_us`:    Phase 4 (IPC round-trip instrumentation)
#[derive(Debug, Default, Clone)]
pub struct FrameTelemetry {
    // ------------------------------------------------------------------
    // CPU-side wall-clock timings (microseconds)
    // ------------------------------------------------------------------
    /// Time spent in the decoder (FFmpeg demux + decode, or cache hit).
    pub decode_cpu_us: u64,

    /// Time spent in DXGI zero-copy import (`OpenSharedHandle` + wgpu HAL).
    /// Zero on the CPU upload path.
    pub import_cpu_us: u64,

    /// Time spent uploading CPU planes to a wgpu texture via `queue.write_texture`.
    /// Zero on the DXGI zero-copy path.
    pub upload_cpu_us: u64,

    /// Time to encode render commands and call `queue.submit()` on the CPU thread.
    ///
    /// # ⚠ Not GPU execution time
    ///
    /// This is CPU orchestration time only. GPU execution is async and can
    /// overlap with the CPU. Use `gpu_render_us` (Phase 6) for actual GPU timing.
    pub render_submit_cpu_us: u64,

    /// Time from `SurfaceTexture::present()` call returning to the OS.
    pub present_cpu_us: u64,

    // ------------------------------------------------------------------
    // GPU-side timings — populated in Phase 6
    // ------------------------------------------------------------------
    /// Actual GPU execution time for the render pass (µs), from wgpu timestamp
    /// queries. `None` until Phase 6 instruments this.
    pub gpu_render_us: Option<u64>,

    // ------------------------------------------------------------------
    // Scheduler / IPC timings — populated in Phase 5
    // ------------------------------------------------------------------
    /// Time the frame request spent waiting in the scheduler queue (µs).
    /// Populated by [`PerformanceManager`] in Phase 5.
    pub queue_wait_us: Option<u64>,

    /// IPC round-trip time (frontend seek → backend frame → frontend display, µs).
    /// Populated by the Tauri command layer in Phase 5.
    pub ipc_wait_us: Option<u64>,

    // ------------------------------------------------------------------
    // End-to-end Rust-side timings (Phase 3.1) — µs unless noted
    // ------------------------------------------------------------------
    /// Wall-clock time from the Rust command entry point to `surface.present()`
    /// returning.  Measured entirely within the Rust clock domain
    /// (`Instant::now()`); cannot be directly compared with JavaScript
    /// `performance.now()` timestamps.
    ///
    /// `None` until Phase 3.1 instruments this call site.
    pub command_entry_to_present_enqueue_us: Option<u64>,

    /// Total frame production time: from the moment Rust starts assembling the
    /// frame (after decode) to the moment `surface.present()` is called.
    ///
    /// `None` until Phase 3.1 instruments the render path.
    pub frame_processing_us: Option<u64>,

    /// Time spent waiting for a swapchain surface texture to become available.
    /// Populated only when a surface acquisition is actually attempted.
    ///
    /// Zero is a valid measurement.  `None` means no surface acquisition was
    /// attempted (e.g. frame was dropped before reaching the compositor).
    pub texture_acquire_wait_us: Option<u64>,

    /// Wall-clock nanoseconds consumed by writing this `FrameTelemetry` record
    /// itself.  Used to quantify instrumentation overhead.
    ///
    /// **Must NOT** include its own measurement time (non-recursive).
    /// `None` when overhead tracking is disabled.
    pub telemetry_overhead_ns: Option<u64>,

    // ------------------------------------------------------------------
    // Correlation and memory metadata (Phase 3.1)
    // ------------------------------------------------------------------
    /// Correlation IDs linking this frame output to the originating operation
    /// and enabling workload-level aggregation in `SessionTelemetry`.
    ///
    /// `None` for frames produced without a frontend request correlation
    /// (e.g. during export, background prefetch, or unit tests).
    pub correlation: Option<FrameOutputCorrelation>,

    /// Memory domain and transfer path description for this frame.
    ///
    /// `None` until the render path populates this.  Callers must not infer
    /// GPU readback from `FrameSource::CpuRgba` alone — the memory path must
    /// be explicitly recorded by the decoder or upload code.
    pub memory: Option<FrameMemoryTelemetry>,

    // ------------------------------------------------------------------
    // Frame disposition
    // ------------------------------------------------------------------
    /// Frame was not presented (dropped under scheduler pressure).
    pub dropped: bool,

    /// The frame's presentation deadline was missed: the frame was ready
    /// after its `FrameDeadline::present_by` instant.
    /// Populated by [`PerformanceManager`] in Phase 5. Drives backpressure policy.
    pub deadline_miss: bool,

    // ------------------------------------------------------------------
    // Provenance and identity
    // ------------------------------------------------------------------
    /// How the frame was sourced (DXGI zero-copy, CPU NV12, CPU RGBA).
    pub source: FrameSource,

    /// Which render target this frame was presented to.
    pub target: RenderTargetId,

    /// Monotonic sequence number from the decode pipeline.
    pub sequence: u64,

    /// Wall-clock instant when this telemetry sample was recorded.
    ///
    /// Set by [`PerformanceManager::record`] before pushing to the ring.
    /// `None` on samples that bypassed the performance manager (e.g., unit tests).
    /// Used for time-windowed metrics such as `deadline_miss_count_1s`.
    pub recorded_at: Option<std::time::Instant>,
}

impl FrameTelemetry {
    /// Total CPU time spent on this frame (decode + import/upload + submit + present).
    pub fn total_cpu_us(&self) -> u64 {
        self.decode_cpu_us
            + self.import_cpu_us
            + self.upload_cpu_us
            + self.render_submit_cpu_us
            + self.present_cpu_us
    }

    /// Returns true if this frame used the DXGI zero-copy path.
    pub fn used_zero_copy(&self) -> bool {
        matches!(self.source, FrameSource::DxgiNv12 { .. })
    }
}

// ---------------------------------------------------------------------------
// Ring buffer for telemetry accumulation
// ---------------------------------------------------------------------------

/// Fixed-size ring buffer of recent frame telemetry samples.
///
/// Phase 6 reads this to compute per-stage p50/p95/p99 percentiles for the
/// diagnostics panel.
pub struct FrameTelemetryRing {
    samples: Vec<FrameTelemetry>,
    head: usize,
    count: usize,
    capacity: usize,
}

impl FrameTelemetryRing {
    pub fn new(capacity: usize) -> Self {
        Self {
            samples: Vec::with_capacity(capacity),
            head: 0,
            count: 0,
            capacity,
        }
    }

    /// Push a new sample, overwriting the oldest when full.
    pub fn push(&mut self, sample: FrameTelemetry) {
        if self.samples.len() < self.capacity {
            self.samples.push(sample);
        } else {
            self.samples[self.head] = sample;
        }
        self.head = (self.head + 1) % self.capacity;
        self.count = (self.count + 1).min(self.capacity);
    }

    /// Number of valid samples in the ring.
    pub fn len(&self) -> usize {
        self.count
    }

    /// True if no samples have been pushed yet.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Discard all samples. Resets to an empty ring with the same capacity.
    pub fn clear(&mut self) {
        self.samples.clear();
        self.head = 0;
        self.count = 0;
    }

    /// Iterate samples in insertion order (oldest first).
    pub fn iter(&self) -> impl Iterator<Item = &FrameTelemetry> {
        let start = if self.count < self.capacity {
            0
        } else {
            self.head
        };
        (0..self.count).map(move |i| &self.samples[(start + i) % self.capacity])
    }

    /// Compute p50 of a field across all samples. Returns None if empty.
    pub fn percentile_us<F>(&self, field: F, percentile: f64) -> Option<u64>
    where
        F: Fn(&FrameTelemetry) -> u64,
    {
        if self.is_empty() {
            return None;
        }
        let mut values: Vec<u64> = self.iter().map(field).collect();
        values.sort_unstable();
        let idx = ((percentile / 100.0) * (values.len() as f64 - 1.0)).round() as usize;
        Some(values[idx.min(values.len() - 1)])
    }

    /// Number of samples with `deadline_miss = true` recorded within the last
    /// second (based on `recorded_at`).
    ///
    /// Samples without a `recorded_at` timestamp are excluded from the count.
    /// Used by [`PerformanceManager`] to drive backpressure policy.
    pub fn deadline_miss_count_1s(&self) -> u32 {
        let one_second_ago =
            std::time::Instant::now().checked_sub(std::time::Duration::from_secs(1));
        self.iter()
            .filter(|s| {
                s.deadline_miss
                    && match (one_second_ago, s.recorded_at) {
                        (Some(cutoff), Some(t)) => t >= cutoff,
                        (None, _) => true,  // clock near zero — include all
                        (_, None) => false, // no timestamp — exclude
                    }
            })
            .count() as u32
    }

    /// Number of samples with `dropped = true` recorded within the last second.
    ///
    /// Same windowing semantics as [`deadline_miss_count_1s`].
    pub fn dropped_count_1s(&self) -> u32 {
        let one_second_ago =
            std::time::Instant::now().checked_sub(std::time::Duration::from_secs(1));
        self.iter()
            .filter(|s| {
                s.dropped
                    && match (one_second_ago, s.recorded_at) {
                        (Some(cutoff), Some(t)) => t >= cutoff,
                        (None, _) => true,
                        (_, None) => false,
                    }
            })
            .count() as u32
    }

    /// Compute a [`ResourceBudget`] snapshot from current telemetry.
    ///
    /// `in_flight_count` and `pending_count` are populated by the caller
    /// ([`PerformanceManager`]) which has access to the scheduler state.
    pub fn compute_budget(&self) -> ResourceBudget {
        ResourceBudget {
            in_flight_count: 0, // caller fills from scheduler
            pending_count: 0,   // caller fills from scheduler
            decode_p50_us: self.percentile_us(|s| s.decode_cpu_us, 50.0),
            decode_p95_us: self.percentile_us(|s| s.decode_cpu_us, 95.0),
            queue_wait_p50_us: self.percentile_us(|s| s.queue_wait_us.unwrap_or(0), 50.0),
            deadline_misses_1s: self.deadline_miss_count_1s(),
            dropped_frames_1s: self.dropped_count_1s(),
            frames_produced: self.len() as u64,
        }
    }
}

// ---------------------------------------------------------------------------
// ResourceBudget — derived from FrameTelemetryRing
// ---------------------------------------------------------------------------

/// A point-in-time snapshot of scheduler resource utilization.
///
/// Computed by [`FrameTelemetryRing::compute_budget`] and augmented by
/// [`PerformanceManager`] with live in-flight counts.
///
/// The `PerformanceManager` uses this to drive [`PolicyState`].
#[derive(Debug, Default, Clone)]
pub struct ResourceBudget {
    /// Number of production jobs currently in-flight (from FrameScheduler).
    pub in_flight_count: usize,
    /// Number of requests pending in the scheduler queue (from FrameScheduler).
    pub pending_count: usize,
    /// p50 decode latency over all ring samples (µs). `None` if ring empty.
    pub decode_p50_us: Option<u64>,
    /// p95 decode latency (µs). `None` if ring empty.
    pub decode_p95_us: Option<u64>,
    /// p50 scheduler queue-wait latency (µs). `None` if no Phase 5 data yet.
    pub queue_wait_p50_us: Option<u64>,
    /// Deadline misses in the last 1-second window.
    pub deadline_misses_1s: u32,
    /// Dropped frames in the last 1-second window.
    pub dropped_frames_1s: u32,
    /// Total frames pushed to the telemetry ring since last reset.
    pub frames_produced: u64,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sample(decode_us: u64, seq: u64) -> FrameTelemetry {
        FrameTelemetry {
            decode_cpu_us: decode_us,
            upload_cpu_us: 100,
            sequence: seq,
            source: FrameSource::CpuNv12 {
                width: 1920,
                height: 1080,
            },
            target: RenderTargetId::PROGRAM,
            ..Default::default()
        }
    }

    #[test]
    fn telemetry_default_has_no_gpu_timing() {
        let t = FrameTelemetry::default();
        assert!(t.gpu_render_us.is_none());
        assert!(t.queue_wait_us.is_none());
        assert!(t.ipc_wait_us.is_none());
        // Phase 3.1 fields
        assert!(t.command_entry_to_present_enqueue_us.is_none());
        assert!(t.frame_processing_us.is_none());
        assert!(t.texture_acquire_wait_us.is_none());
        assert!(t.telemetry_overhead_ns.is_none());
        assert!(t.correlation.is_none());
        assert!(t.memory.is_none());
    }

    #[test]
    fn total_cpu_us_sums_all_stages() {
        let t = FrameTelemetry {
            decode_cpu_us: 100,
            import_cpu_us: 20,
            upload_cpu_us: 30,
            render_submit_cpu_us: 50,
            present_cpu_us: 10,
            ..Default::default()
        };
        assert_eq!(t.total_cpu_us(), 210);
    }

    #[test]
    fn used_zero_copy_true_for_dxgi() {
        let t = FrameTelemetry {
            source: FrameSource::DxgiNv12 {
                width: 3840,
                height: 2160,
            },
            ..Default::default()
        };
        assert!(t.used_zero_copy());
    }

    #[test]
    fn used_zero_copy_false_for_cpu() {
        let t = FrameTelemetry {
            source: FrameSource::CpuNv12 {
                width: 1920,
                height: 1080,
            },
            ..Default::default()
        };
        assert!(!t.used_zero_copy());
    }

    #[test]
    fn ring_buffer_wraps_correctly() {
        let mut ring = FrameTelemetryRing::new(3);
        for i in 0u64..5 {
            ring.push(make_sample(i * 10, i));
        }
        assert_eq!(ring.len(), 3);
        // Oldest sample should be sequence 2 (0,1 were overwritten)
        let seqs: Vec<u64> = ring.iter().map(|s| s.sequence).collect();
        assert_eq!(seqs, vec![2, 3, 4]);
    }

    #[test]
    fn ring_percentile_p50() {
        let mut ring = FrameTelemetryRing::new(5);
        for i in 0u64..5 {
            ring.push(make_sample((i + 1) * 100, i)); // 100,200,300,400,500
        }
        let p50 = ring.percentile_us(|s| s.decode_cpu_us, 50.0).unwrap();
        assert_eq!(p50, 300); // median of [100,200,300,400,500]
    }

    #[test]
    fn ring_percentile_empty_returns_none() {
        let ring = FrameTelemetryRing::new(10);
        assert!(ring.percentile_us(|s| s.decode_cpu_us, 50.0).is_none());
    }

    #[test]
    fn cpu_timings_are_not_gpu_timings() {
        // Document the invariant: render_submit_cpu_us measures CPU orchestration,
        // not GPU execution. gpu_render_us starts as None.
        let t = FrameTelemetry {
            render_submit_cpu_us: 500,
            ..Default::default()
        };
        assert!(t.gpu_render_us.is_none());
    }
}
