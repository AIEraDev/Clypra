use super::frame::VideoFrame;
use super::types::MediaTime;
use std::time::Instant;

/// Precise deadline specification for real-time presentation.
#[derive(Debug, Clone)]
pub struct FrameDeadline {
    /// Desired media presentation timestamp
    pub target_pts: MediaTime,
    /// Absolute wall-clock deadline instant
    pub deadline_instant: Instant,
    /// Generation identifier; frames with older generation are dropped
    pub generation: u64,
}

impl FrameDeadline {
    pub fn new(target_pts: MediaTime, deadline_instant: Instant, generation: u64) -> Self {
        Self {
            target_pts,
            deadline_instant,
            generation,
        }
    }

    pub fn for_target(target_pts: MediaTime, _now: MediaTime, fps: f64) -> Self {
        let frame_duration = std::time::Duration::from_secs_f64(1.0 / fps.max(1.0));
        let deadline_instant = Instant::now() + frame_duration;
        Self {
            target_pts,
            deadline_instant,
            generation: 1,
        }
    }

    #[inline]
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.deadline_instant
    }

    #[inline]
    pub fn is_hard_drop_imminent(&self) -> bool {
        self.is_expired()
    }

    #[inline]
    pub fn time_remaining(&self) -> Option<std::time::Duration> {
        let now = Instant::now();
        if now < self.deadline_instant {
            Some(self.deadline_instant.duration_since(now))
        } else {
            None
        }
    }
}

/// Detailed reason why a frame presentation deadline could not be satisfied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StarvationReason {
    /// Target frame is completely missing from ready queue and cache
    CurrentFrameMissing,
    /// Decoder pipeline stalled or took too long to produce frame
    DecoderStall(std::time::Duration),
    /// Surface pool ran out of available hardware buffers
    PoolExhausted,
    /// Frame arrived after presentation deadline passed
    LateArrival(std::time::Duration),
}

/// The scheduler's real-time decision when presenting a frame deadline.
#[derive(Debug, Clone)]
pub enum FramePacingDecision {
    /// Frame is ready before deadline -> submit to render graph
    Present(VideoFrame),
    /// Frame was late or missing -> repeat previous usable frame to avoid stalling the presenter
    DropAndRepeatPrevious(VideoFrame),
    /// No frame available and no previous frame exists -> clear canvas
    Starved(StarvationReason),
}

/// Dedicated frame scheduler that evaluates ready frames against deadlines.
/// Enforces deadline-driven pacing, frame repetition on stall, and degradation signaling.
#[derive(Debug, Default)]
pub struct PlaybackScheduler {
    last_presented_frame: Option<VideoFrame>,
    presented_count: u64,
    dropped_count: u64,
    starved_count: u64,
}

impl PlaybackScheduler {
    pub fn new() -> Self {
        Self {
            last_presented_frame: None,
            presented_count: 0,
            dropped_count: 0,
            starved_count: 0,
        }
    }

    pub fn presented_count(&self) -> u64 {
        self.presented_count
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped_count
    }

    pub fn starved_count(&self) -> u64 {
        self.starved_count
    }

    /// Evaluates ready frame against the target deadline to make an immediate, non-blocking pacing decision.
    pub fn schedule(
        &mut self,
        ready_frame: Option<VideoFrame>,
        deadline: &FrameDeadline,
    ) -> FramePacingDecision {
        if let Some(frame) = ready_frame {
            if !deadline.is_expired() {
                self.last_presented_frame = Some(frame.clone());
                self.presented_count += 1;
                return FramePacingDecision::Present(frame);
            } else {
                // Arrived late!
                self.dropped_count += 1;
                if let Some(prev) = &self.last_presented_frame {
                    return FramePacingDecision::DropAndRepeatPrevious(prev.clone());
                } else {
                    self.starved_count += 1;
                    return FramePacingDecision::Starved(StarvationReason::LateArrival(
                        Instant::now().duration_since(deadline.deadline_instant),
                    ));
                }
            }
        }

        // Target frame is missing!
        self.dropped_count += 1;
        if let Some(prev) = &self.last_presented_frame {
            FramePacingDecision::DropAndRepeatPrevious(prev.clone())
        } else {
            self.starved_count += 1;
            FramePacingDecision::Starved(StarvationReason::CurrentFrameMissing)
        }
    }

    pub fn reset(&mut self) {
        self.last_presented_frame = None;
    }
}

/// FramePlanner answers: "What frames must exist next, and by when?"
/// Sits above the decoders to orchestrate demuxing, decoding, and caching.
#[derive(Debug)]
pub struct FramePlanner {
    pub prefetch_count: usize,
    pub generation: u64,
}

impl FramePlanner {
    pub fn new(prefetch_count: usize) -> Self {
        Self {
            prefetch_count,
            generation: 0,
        }
    }

    pub fn set_generation(&mut self, generation: u64) {
        self.generation = generation;
    }

    /// Generates the sequence of target timestamps that must be buffered ahead of current time T
    pub fn plan_ahead(
        &self,
        current_time: MediaTime,
        frame_duration: MediaTime,
        count: usize,
    ) -> Vec<MediaTime> {
        (0..count)
            .map(|i| current_time + MediaTime(frame_duration.as_micros() * (i as i64 + 1)))
            .collect()
    }
}
