use super::types::MediaTime;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Operating mode of the authoritative playback clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClockMode {
    /// Audio output callback provides authoritative timing (normal playback with audio)
    AudioMaster,
    /// High-resolution monotonic timer drives playback (muted, scrub, step, or no audio)
    MonotonicHighRes,
    /// Driven by external synchronization or timeline scrubbing
    Manual,
}

/// The authoritative playback clock governing presentation deadlines.
pub trait PlaybackClock: Send + Sync {
    /// Current media presentation time
    fn now(&self) -> MediaTime;

    /// Current clock mode
    fn mode(&self) -> ClockMode;

    /// True if the clock is actively advancing
    fn is_running(&self) -> bool;

    /// Current playback speed multiplier (1.0 = normal forward, -1.0 = reverse)
    fn speed(&self) -> f64;
}

/// Standard thread-safe monotonic clock implementation.
/// Seamlessly falls back between audio callback timestamps and high-res OS timer.
#[derive(Debug)]
pub struct EngineClock {
    current_time_micros: Arc<AtomicI64>,
    is_running: Arc<AtomicBool>,
    speed: f64,
    mode: ClockMode,
    last_tick_instant: Option<Instant>,
}

impl EngineClock {
    pub fn new() -> Self {
        Self {
            current_time_micros: Arc::new(AtomicI64::new(0)),
            is_running: Arc::new(AtomicBool::new(false)),
            speed: 1.0,
            mode: ClockMode::MonotonicHighRes,
            last_tick_instant: None,
        }
    }

    pub fn set_time(&mut self, time: MediaTime) {
        self.current_time_micros
            .store(time.as_micros(), Ordering::SeqCst);
        self.last_tick_instant = Some(Instant::now());
    }

    pub fn update_from_audio(&mut self, audio_time: MediaTime) {
        self.current_time_micros
            .store(audio_time.as_micros(), Ordering::Release);
        self.mode = ClockMode::AudioMaster;
    }

    pub fn start(&mut self) {
        self.is_running.store(true, Ordering::SeqCst);
        self.last_tick_instant = Some(Instant::now());
    }

    pub fn pause(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        self.last_tick_instant = None;
    }

    pub fn set_speed(&mut self, speed: f64) {
        self.speed = speed;
    }

    pub fn tick(&mut self) -> MediaTime {
        if !self.is_running.load(Ordering::Acquire) {
            return self.now();
        }

        if let Some(last) = self.last_tick_instant {
            let now = Instant::now();
            let elapsed_micros = now.duration_since(last).as_micros() as f64 * self.speed;
            self.last_tick_instant = Some(now);
            let prev = self.current_time_micros.load(Ordering::Relaxed);
            let next = (prev + elapsed_micros.round() as i64).max(0);
            self.current_time_micros.store(next, Ordering::Relaxed);
        } else {
            self.last_tick_instant = Some(Instant::now());
        }

        self.now()
    }
}

impl Default for EngineClock {
    fn default() -> Self {
        Self::new()
    }
}

impl PlaybackClock for EngineClock {
    fn now(&self) -> MediaTime {
        MediaTime::from_micros(self.current_time_micros.load(Ordering::Acquire))
    }

    fn mode(&self) -> ClockMode {
        self.mode
    }

    fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Acquire)
    }

    fn speed(&self) -> f64 {
        self.speed
    }
}
