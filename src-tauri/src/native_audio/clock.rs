use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use super::clip::{NativeAudioKeyframe, NativePcmClip};
use super::mixer::NativeAudioMixer;
use super::types::{
    output_latency_bucket, NativeAudioClipStatus, NativeAudioDiagnostics,
    NativeAudioMixerInspection, NativeAudioStatus, OutputLatencyMetrics,
    INTERVAL_RING_SIZE, MAX_PITCH_CACHE_BYTES, TICKS_PER_SECOND, TRANSPORT_RAMP_FRAMES,
};

pub(crate) struct NativeAudioClockInner {
    pub(crate) stream: Option<cpal::Stream>,
    pub(crate) host: Option<String>,
    pub(crate) device_name: Option<String>,
    pub(crate) sample_rate: Option<u32>,
    pub(crate) channels: Option<u16>,
    pub(crate) sample_format: Option<String>,
    pub(crate) played_frames: Arc<AtomicU64>,
    pub(crate) callback_count: Arc<AtomicU64>,
    pub(crate) non_silent_frames: Arc<AtomicU64>,
    pub(crate) position_ticks: Arc<AtomicI64>,
    pub(crate) playing: Arc<AtomicBool>,
    pub(crate) speed_milli: Arc<AtomicU32>,
    /// Cancels obsolete background WSOLA jobs when speed or graph changes.
    pub(crate) pitch_cache_generation: Arc<AtomicU64>,
    /// Ensures rate scrubbing cannot create competing CPU-heavy WSOLA jobs.
    pub(crate) pitch_cache_worker_running: Arc<AtomicBool>,
    pub(crate) volume_milli: Arc<AtomicU32>,
    pub(crate) muted: Arc<AtomicBool>,
    pub(crate) transport_ramp_frames: Arc<AtomicU32>,
    pub(crate) mixer_lock_misses: Arc<AtomicU64>,
    pub(crate) callback_time_us: Arc<AtomicU64>,
    pub(crate) callback_max_time_us: Arc<AtomicU64>,
    pub(crate) callback_over_budget_count: Arc<AtomicU64>,
    /// Incremented by `seek()` on every call.
    pub(crate) seek_count: Arc<AtomicU64>,
    /// Accumulated seek latency in microseconds. Incremented by `seek()`.
    pub(crate) seek_latency_total_us: Arc<AtomicU64>,
    pub(crate) mixer: Arc<RwLock<NativeAudioMixer>>,
    pub(crate) last_error: Arc<Mutex<Option<String>>>,
    /// Fixed reference point set at `NativeAudioClock::new()`. Used to
    /// convert `last_callback_ns` (nanoseconds from this epoch) back into
    /// an `Instant` for freshness calculations without storing an `Instant`
    /// in an atomic. Only read from non-callback contexts.
    pub(crate) clock_epoch: Instant,
    /// Nanoseconds elapsed from `clock_epoch` at the time of the most recent
    /// CPAL callback. Zero means no callback has fired yet.
    /// Written with `Relaxed` ordering inside the audio callback (lock-free,
    /// no heap allocation). Read with `Acquire` in `status()`.
    pub(crate) last_callback_ns: Arc<AtomicU64>,
    /// Lock-free ring buffer of the last INTERVAL_RING_SIZE inter-callback
    /// spacing values, in microseconds. Each slot is written by the CPAL
    /// callback (Relaxed store) as: `(current_callback_ns - prev_callback_ns) / 1_000`.
    /// Zero slots have never been written (ring not yet full on first few callbacks).
    /// Read from `status()` to compute the median for the freshness threshold.
    /// Must never be accessed under a lock from the audio callback.
    pub(crate) interval_ring: Arc<[AtomicU64; INTERVAL_RING_SIZE]>,
    /// Monotonically incrementing cursor into `interval_ring`.
    /// Written from the callback (Relaxed). Read from `status()` (Acquire).
    pub(crate) interval_cursor: Arc<AtomicU64>,
    /// Lock-free linear histogram and atomics for CPAL output latency.
    pub(crate) output_latency: OutputLatencyMetrics,
}

pub struct NativeAudioClock {
    pub(crate) inner: NativeAudioClockInner,
}

impl NativeAudioClock {
    pub fn new() -> Self {
        Self {
            inner: NativeAudioClockInner {
                stream: None,
                host: None,
                device_name: None,
                sample_rate: None,
                channels: None,
                sample_format: None,
                played_frames: Arc::new(AtomicU64::new(0)),
                callback_count: Arc::new(AtomicU64::new(0)),
                non_silent_frames: Arc::new(AtomicU64::new(0)),
                position_ticks: Arc::new(AtomicI64::new(0)),
                playing: Arc::new(AtomicBool::new(false)),
                speed_milli: Arc::new(AtomicU32::new(1_000)),
                pitch_cache_generation: Arc::new(AtomicU64::new(0)),
                pitch_cache_worker_running: Arc::new(AtomicBool::new(false)),
                volume_milli: Arc::new(AtomicU32::new(1_000)),
                muted: Arc::new(AtomicBool::new(false)),
                transport_ramp_frames: Arc::new(AtomicU32::new(0)),
                mixer_lock_misses: Arc::new(AtomicU64::new(0)),
                callback_time_us: Arc::new(AtomicU64::new(0)),
                callback_max_time_us: Arc::new(AtomicU64::new(0)),
                callback_over_budget_count: Arc::new(AtomicU64::new(0)),
                seek_count: Arc::new(AtomicU64::new(0)),
                seek_latency_total_us: Arc::new(AtomicU64::new(0)),
                mixer: Arc::new(RwLock::new(NativeAudioMixer::default())),
                last_error: Arc::new(Mutex::new(None)),
                clock_epoch: Instant::now(),
                last_callback_ns: Arc::new(AtomicU64::new(0)),
                interval_ring: Arc::new([
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                    AtomicU64::new(0),
                ]),
                interval_cursor: Arc::new(AtomicU64::new(0)),
                output_latency: OutputLatencyMetrics::new(),
            },
        }
    }

    pub fn start(&mut self) -> Result<NativeAudioStatus, String> {
        if self.inner.stream.is_some() {
            let status = self.status();
            if status.running {
                return Ok(status);
            }
            self.inner.stream = None;
        }

        if let Ok(mut last_error) = self.inner.last_error.lock() {
            *last_error = None;
        }
        self.inner.played_frames.store(0, Ordering::Release);
        self.inner.callback_count.store(0, Ordering::Release);
        self.inner.non_silent_frames.store(0, Ordering::Release);
        self.inner.position_ticks.store(0, Ordering::Release);
        self.inner.playing.store(false, Ordering::Release);
        self.inner.transport_ramp_frames.store(0, Ordering::Release);
        self.inner.mixer_lock_misses.store(0, Ordering::Release);
        self.inner.callback_time_us.store(0, Ordering::Release);
        self.inner.callback_max_time_us.store(0, Ordering::Release);
        self.inner
            .callback_over_budget_count
            .store(0, Ordering::Release);
        self.inner.seek_count.store(0, Ordering::Release);
        self.inner.seek_latency_total_us.store(0, Ordering::Release);
        // Reset the freshness tracker so the new stream starts with a clean slate.
        // Zero is the sentinel for "no callback has fired yet".
        self.inner.last_callback_ns.store(0, Ordering::Release);
        // Clear the interval ring so stale spacings from a previous stream
        // session don't seed the median on restart.
        for slot in self.inner.interval_ring.iter() {
            slot.store(0, Ordering::Release);
        }
        self.inner.interval_cursor.store(0, Ordering::Release);
        self.inner.output_latency.reset();

        let host = cpal::default_host();
        let host_name = format!("{:?}", host.id());
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default native audio output device is available".to_string())?;
        let device_name = device
            .description()
            .map(|description| description.to_string())
            .unwrap_or_else(|_| "Default output device".to_string());
        let supported = device.default_output_config().map_err(|error| {
            format!("Unable to read native audio output configuration: {error}")
        })?;
        let sample_rate = supported.sample_rate();
        let channels = supported.channels();
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();

        let played_frames = self.inner.played_frames.clone();
        let callback_count = self.inner.callback_count.clone();
        let non_silent_frames = self.inner.non_silent_frames.clone();
        let position_ticks = self.inner.position_ticks.clone();
        let playing = self.inner.playing.clone();
        let speed_milli = self.inner.speed_milli.clone();
        let volume_milli = self.inner.volume_milli.clone();
        let muted = self.inner.muted.clone();
        let transport_ramp_frames = self.inner.transport_ramp_frames.clone();
        let mixer_lock_misses = self.inner.mixer_lock_misses.clone();
        let callback_time_us = self.inner.callback_time_us.clone();
        let callback_max_time_us = self.inner.callback_max_time_us.clone();
        let callback_over_budget_count = self.inner.callback_over_budget_count.clone();
        let mixer = self.inner.mixer.clone();
        let last_error = self.inner.last_error.clone();
        // Freshness tracker — cloned into every format variant of build_audio_stream.
        let last_callback_ns = self.inner.last_callback_ns.clone();
        let clock_epoch = self.inner.clock_epoch;
        let interval_ring = self.inner.interval_ring.clone();
        let interval_cursor = self.inner.interval_cursor.clone();
        let output_latency = self.inner.output_latency.clone();

        let stream = match sample_format {
            cpal::SampleFormat::I8 => build_audio_stream::<i8>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::F32 => build_audio_stream::<f32>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::I16 => build_audio_stream::<i16>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::I24 => build_audio_stream::<cpal::I24>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::I32 => build_audio_stream::<i32>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::I64 => build_audio_stream::<i64>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::U8 => build_audio_stream::<u8>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::U16 => build_audio_stream::<u16>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::U24 => build_audio_stream::<cpal::U24>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::U32 => build_audio_stream::<u32>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::U64 => build_audio_stream::<u64>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames.clone(),
                mixer_lock_misses.clone(),
                callback_time_us.clone(),
                callback_max_time_us.clone(),
                callback_over_budget_count.clone(),
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            cpal::SampleFormat::F64 => build_audio_stream::<f64>(
                &device,
                config,
                channels,
                sample_rate,
                played_frames,
                callback_count,
                non_silent_frames,
                position_ticks,
                playing,
                speed_milli,
                volume_milli,
                muted,
                transport_ramp_frames,
                mixer_lock_misses,
                callback_time_us,
                callback_max_time_us,
                callback_over_budget_count,
                mixer,
                last_error,
                last_callback_ns.clone(),
                clock_epoch,
                interval_ring.clone(),
                interval_cursor.clone(),
                output_latency.clone(),
            ),
            unsupported => {
                return Err(format!(
                    "Native audio sample format is unsupported: {unsupported:?}"
                ));
            }
        }
        .map_err(|error| format!("Unable to build native audio output stream: {error}"))?;

        // INVESTIGATION ONLY — remove before Phase 6
        log::debug!("[TR2] CPAL stream.play() call at timestamp: {:?}", std::time::Instant::now());
        stream
            .play()
            .map_err(|error| format!("Unable to start native audio output stream: {error}"))?;

        self.inner.host = Some(host_name);
        self.inner.device_name = Some(device_name);
        self.inner.sample_rate = Some(sample_rate);
        self.inner.channels = Some(channels);
        self.inner.sample_format = Some(format!("{sample_format:?}"));
        self.inner.stream = Some(stream);
        self.inner.playing.store(false, Ordering::Release);
        Ok(self.status())
    }

    pub fn stop(&mut self) {
        self.inner.playing.store(false, Ordering::Release);
        self.inner.stream = None;
        self.inner.played_frames.store(0, Ordering::Release);
        self.inner.position_ticks.store(0, Ordering::Release);
        self.inner.speed_milli.store(1_000, Ordering::Release);
        self.inner
            .pitch_cache_generation
            .fetch_add(1, Ordering::AcqRel);
        if let Ok(mut mixer) = self.inner.mixer.write() {
            mixer.clear_pitch_cache();
        }
        self.inner.volume_milli.store(1_000, Ordering::Release);
        self.inner.muted.store(false, Ordering::Release);
        self.inner.transport_ramp_frames.store(0, Ordering::Release);
    }

    pub fn pause(&self) {
        self.inner.playing.store(false, Ordering::Release);
        self.inner.transport_ramp_frames.store(0, Ordering::Release);
    }

    pub fn resume(&self) {
        if self.inner.stream.is_some() {
            self.inner
                .transport_ramp_frames
                .store(TRANSPORT_RAMP_FRAMES, Ordering::Release);
            self.inner.playing.store(true, Ordering::Release);
        }
    }

    pub fn set_speed(&self, speed: f32) {
        let safe_speed = if speed.is_finite() {
            speed.clamp(0.1, 4.0)
        } else {
            1.0
        };
        let speed_milli = (safe_speed * 1_000.0).round() as u32;
        let previous = self.inner.speed_milli.swap(speed_milli, Ordering::AcqRel);
        if previous != speed_milli {
            self.request_pitch_cache();
        }
    }

    /// Build the pitch-preserving representation on a normal worker thread.
    /// This is never called by CPAL's real-time callback: its only work is a
    /// cache lookup plus interpolation under a non-blocking read lock.
    fn request_pitch_cache(&self) {
        let tempo_milli = self.inner.speed_milli.load(Ordering::Acquire);
        self.inner
            .pitch_cache_generation
            .fetch_add(1, Ordering::AcqRel);

        if tempo_milli == 1_000 {
            if let Ok(mut mixer) = self.inner.mixer.write() {
                mixer.clear_pitch_cache();
            }
            return;
        }

        let worker_running = self.inner.pitch_cache_worker_running.clone();
        if worker_running.swap(true, Ordering::AcqRel) {
            return;
        }

        let mixer = self.inner.mixer.clone();
        let current_speed = self.inner.speed_milli.clone();
        let current_generation = self.inner.pitch_cache_generation.clone();
        let worker_running_in_thread = worker_running.clone();
        let spawn_result = std::thread::Builder::new()
            .name("clypra-audio-wsola".to_string())
            .spawn(move || {
                loop {
                    let job_generation = current_generation.load(Ordering::Acquire);
                    let job_tempo_milli = current_speed.load(Ordering::Acquire);
                    if job_tempo_milli == 1_000 {
                        if let Ok(mut mixer) = mixer.write() {
                            mixer.clear_pitch_cache();
                        }
                    } else {
                        let clips = mixer
                            .read()
                            .map(|mixer| mixer.clips.clone())
                            .unwrap_or_default();
                        let mut prepared = HashMap::new();
                        let mut used_bytes = 0usize;
                        let tempo = job_tempo_milli as f32 / 1_000.0;

                        for clip in clips.into_iter().filter(|clip| clip.preserve_pitch) {
                            if current_generation.load(Ordering::Acquire) != job_generation {
                                break;
                            }
                            if clip.sample_rate == 0
                                || clip.channels == 0
                                || clip.samples.is_empty()
                            {
                                continue;
                            }
                            let Ok(samples) = wsola::stretch(
                                &clip.samples,
                                clip.sample_rate,
                                clip.channels,
                                tempo,
                            ) else {
                                continue;
                            };
                            let bytes = samples.len().saturating_mul(std::mem::size_of::<f32>());
                            if used_bytes.saturating_add(bytes) > MAX_PITCH_CACHE_BYTES {
                                continue;
                            }
                            used_bytes = used_bytes.saturating_add(bytes);
                            prepared.insert(clip.id, Arc::<[f32]>::from(samples));
                        }

                        if current_speed.load(Ordering::Acquire) == job_tempo_milli
                            && current_generation.load(Ordering::Acquire) == job_generation
                        {
                            if let Ok(mut mixer) = mixer.write() {
                                if current_speed.load(Ordering::Acquire) == job_tempo_milli
                                    && current_generation.load(Ordering::Acquire) == job_generation
                                {
                                    mixer.install_pitch_cache(job_tempo_milli, prepared);
                                }
                            }
                        }
                    }

                    if current_generation.load(Ordering::Acquire) == job_generation {
                        worker_running_in_thread.store(false, Ordering::Release);
                        // A request can land between the generation check and
                        // dropping this flag. Reacquire it to guarantee that
                        // latest request still gets a worker.
                        if current_generation.load(Ordering::Acquire) != job_generation
                            && !worker_running_in_thread.swap(true, Ordering::AcqRel)
                        {
                            continue;
                        }
                        return;
                    }
                }
            });
        if spawn_result.is_err() {
            worker_running.store(false, Ordering::Release);
        }
    }

    pub fn set_output(&self, volume: f32, muted: bool) {
        let safe_volume = if volume.is_finite() {
            volume.clamp(0.0, 2.0)
        } else {
            1.0
        };
        self.inner
            .volume_milli
            .store((safe_volume * 1_000.0).round() as u32, Ordering::Release);
        self.inner.muted.store(muted, Ordering::Release);
    }

    pub fn seek(&self, position_ticks: i64) {
        let t0 = std::time::Instant::now();
        self.inner
            .transport_ramp_frames
            .store(TRANSPORT_RAMP_FRAMES, Ordering::Release);
        self.inner
            .position_ticks
            .store(position_ticks.max(0), Ordering::Release);
        self.inner.played_frames.store(0, Ordering::Release);
        // Record seek count and cumulative latency for telemetry.
        // The actual cost of a seek is the atomic store above — negligible —
        // but we measure it end-to-end so callers that hold a lock before
        // calling seek() also contribute to the latency sum.
        let elapsed_us = t0.elapsed().as_micros().min(u64::MAX as u128) as u64;
        self.inner.seek_count.fetch_add(1, Ordering::Relaxed);
        self.inner
            .seek_latency_total_us
            .fetch_add(elapsed_us, Ordering::Relaxed);
    }

    pub fn install_clip(&mut self, clip: NativePcmClip) -> Result<NativeAudioClipStatus, String> {
        let result = self
            .inner
            .mixer
            .write()
            .map_err(|_| "native audio mixer lock poisoned".to_string())?
            .install_clip(clip);
        if result.is_ok() {
            self.request_pitch_cache();
        }
        result
    }

    pub fn clear_clip(&mut self) {
        if let Ok(mut mixer) = self.inner.mixer.write() {
            mixer.clear();
        }
        self.request_pitch_cache();
    }

    pub fn replace_clips(&mut self, clips: Vec<NativePcmClip>) -> Result<(), String> {
        let result = self
            .inner
            .mixer
            .write()
            .map_err(|_| "native audio mixer lock poisoned".to_string())?
            .replace_clips(clips);
        if result.is_ok() {
            self.request_pitch_cache();
        }
        result
    }

    pub fn update_clip_parameters(
        &mut self,
        clip_id: &str,
        gain: f32,
        pan: f32,
        fade_in_ticks: i64,
        fade_out_ticks: i64,
        fade_in_curve: String,
        fade_out_curve: String,
        volume_keyframes: Vec<NativeAudioKeyframe>,
    ) -> Result<NativeAudioClipStatus, String> {
        self.inner
            .mixer
            .write()
            .map_err(|_| "native audio mixer lock poisoned".to_string())?
            .update_clip_parameters(
                clip_id,
                gain,
                pan,
                fade_in_ticks,
                fade_out_ticks,
                fade_in_curve,
                fade_out_curve,
                volume_keyframes,
            )
    }

    pub fn clip_status(&self) -> Option<NativeAudioClipStatus> {
        self.inner
            .mixer
            .read()
            .ok()
            .and_then(|mixer| mixer.clip_status())
    }

    pub fn clip_statuses(&self) -> Vec<NativeAudioClipStatus> {
        self.inner
            .mixer
            .read()
            .map(|mixer| mixer.clip_statuses())
            .unwrap_or_default()
    }

    pub fn status(&self) -> NativeAudioStatus {
        let sample_rate = self.inner.sample_rate;
        let audio_position_ticks = self.inner.position_ticks.load(Ordering::Acquire).max(0) as u64;
        let last_error = self
            .inner
            .last_error
            .lock()
            .ok()
            .and_then(|error| error.clone());

        // Compute how stale the audio clock is. last_callback_ns == 0 means
        // the callback has never fired (stream not yet started or just reset).
        let clock_freshness_us = {
            let last_ns = self.inner.last_callback_ns.load(Ordering::Acquire);
            if last_ns == 0 {
                None
            } else {
                let now_ns = self
                    .inner
                    .clock_epoch
                    .elapsed()
                    .as_nanos()
                    .min(u64::MAX as u128) as u64;
                Some(now_ns.saturating_sub(last_ns) / 1_000)
            }
        };

        // Compute median inter-callback spacing from the lock-free ring.
        // Read all INTERVAL_RING_SIZE slots; discard zeros (never-written slots).
        // A median over the non-zero values is used by record_with_freshness()
        // as the adaptive threshold base — replacing the old lifetime-mean of
        // callback processing duration, which was two to three orders of magnitude
        // smaller than the actual inter-callback spacing.
        let median_callback_interval_us = {
            let cursor = self.inner.interval_cursor.load(Ordering::Acquire);
            if cursor == 0 {
                // No intervals recorded yet (fewer than 2 callbacks have fired).
                None
            } else {
                let mut values: [u64; INTERVAL_RING_SIZE] = [0; INTERVAL_RING_SIZE];
                let mut count = 0usize;
                for slot in self.inner.interval_ring.iter() {
                    let v = slot.load(Ordering::Relaxed);
                    if v > 0 {
                        values[count] = v;
                        count += 1;
                    }
                }
                if count == 0 {
                    None
                } else {
                    // Sort the populated prefix and take the middle element.
                    values[..count].sort_unstable();
                    let mid = count / 2;
                    Some(values[mid])
                }
            }
        };

        NativeAudioStatus {
            available: self.inner.sample_rate.is_some(),
            running: self.inner.stream.is_some() && last_error.is_none(),
            playing: self.inner.playing.load(Ordering::Acquire),
            host: self.inner.host.clone(),
            device_name: self.inner.device_name.clone(),
            sample_rate,
            channels: self.inner.channels,
            sample_format: self.inner.sample_format.clone(),
            audio_position_ticks,
            callback_count: self.inner.callback_count.load(Ordering::Acquire),
            rendered_frames: self.inner.played_frames.load(Ordering::Acquire),
            non_silent_frames: self.inner.non_silent_frames.load(Ordering::Acquire),
            last_error,
            speed: self.inner.speed_milli.load(Ordering::Acquire) as f32 / 1_000.0,
            volume: self.inner.volume_milli.load(Ordering::Acquire) as f32 / 1_000.0,
            muted: self.inner.muted.load(Ordering::Acquire),
            mixer_lock_misses: self.inner.mixer_lock_misses.load(Ordering::Acquire),
            callback_time_us: self.inner.callback_time_us.load(Ordering::Acquire),
            callback_max_time_us: self.inner.callback_max_time_us.load(Ordering::Acquire),
            callback_over_budget_count: self
                .inner
                .callback_over_budget_count
                .load(Ordering::Acquire),
            seek_count: self.inner.seek_count.load(Ordering::Acquire),
            seek_latency_total_us: self.inner.seek_latency_total_us.load(Ordering::Acquire),
            output_latency_us_histogram: if self
                .inner
                .output_latency
                .available
                .load(Ordering::Acquire)
            {
                Some(
                    self.inner
                        .output_latency
                        .histogram
                        .iter()
                        .map(|s| s.load(Ordering::Relaxed))
                        .collect(),
                )
            } else {
                None
            },
            output_latency_last_us: if self.inner.output_latency.available.load(Ordering::Acquire) {
                Some(self.inner.output_latency.last_us.load(Ordering::Relaxed))
            } else {
                None
            },
            output_latency_min_us: if self.inner.output_latency.available.load(Ordering::Acquire) {
                let m = self.inner.output_latency.min_us.load(Ordering::Relaxed);
                Some(if m == u64::MAX { 0 } else { m })
            } else {
                None
            },
            output_latency_max_us: if self.inner.output_latency.available.load(Ordering::Acquire) {
                Some(self.inner.output_latency.max_us.load(Ordering::Relaxed))
            } else {
                None
            },
            output_latency_sum_us: if self.inner.output_latency.available.load(Ordering::Acquire) {
                Some(self.inner.output_latency.sum_us.load(Ordering::Relaxed))
            } else {
                None
            },
            output_latency_count: if self.inner.output_latency.available.load(Ordering::Acquire) {
                Some(self.inner.output_latency.count.load(Ordering::Relaxed))
            } else {
                None
            },
            clock_freshness_us,
            median_callback_interval_us,
        }
    }

    pub fn diagnostics(&self) -> NativeAudioDiagnostics {
        let status = self.status();
        let installed_clips = self.clip_statuses();
        let inspection = match (status.channels, status.sample_rate) {
            (Some(channels), Some(sample_rate)) => self
                .inner
                .mixer
                .read()
                .map(|mixer| {
                    mixer.inspect(
                        channels,
                        sample_rate,
                        status.audio_position_ticks.min(i64::MAX as u64) as i64,
                        status.volume,
                        status.speed,
                    )
                })
                .unwrap_or_default(),
            _ => NativeAudioMixerInspection::default(),
        };

        NativeAudioDiagnostics {
            status,
            installed_clips,
            active_clip_ids: inspection.active_clip_ids,
            mixer_peak: inspection.mixer_peak,
            clip_diagnostics: inspection.clip_diagnostics,
        }
    }
}

/// Real-time safe audio output stream builder.
///
/// The stream callback performs ZERO heap allocations and acquires no
/// blocking mutexes. It advances `position_ticks` atomically based on the exact
/// hardware sample count.
fn build_audio_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: u16,
    sample_rate: u32,
    played_frames: Arc<AtomicU64>,
    callback_count: Arc<AtomicU64>,
    non_silent_frames: Arc<AtomicU64>,
    position_ticks: Arc<AtomicI64>,
    playing: Arc<AtomicBool>,
    speed_milli: Arc<AtomicU32>,
    volume_milli: Arc<AtomicU32>,
    muted: Arc<AtomicBool>,
    transport_ramp_frames: Arc<AtomicU32>,
    mixer_lock_misses: Arc<AtomicU64>,
    callback_time_us: Arc<AtomicU64>,
    callback_max_time_us: Arc<AtomicU64>,
    callback_over_budget_count: Arc<AtomicU64>,
    mixer: Arc<RwLock<NativeAudioMixer>>,
    last_error: Arc<Mutex<Option<String>>>,
    // Nanoseconds from `clock_epoch` written at the start of each callback.
    // Zero is the sentinel for "never fired". Written with Relaxed ordering —
    // the audio thread must never block or allocate.
    last_callback_ns: Arc<AtomicU64>,
    // Fixed epoch used to compute nanoseconds-since-epoch inside the callback.
    clock_epoch: Instant,
    // Lock-free ring buffer of inter-callback intervals (µs). Written from the
    // callback with no lock. Must be exactly INTERVAL_RING_SIZE elements.
    interval_ring: Arc<[AtomicU64; INTERVAL_RING_SIZE]>,
    // Monotonically incrementing write cursor for interval_ring.
    interval_cursor: Arc<AtomicU64>,
    // Linear histogram and atomics for `playback − callback` output latency in µs.
    // Written with fetch_add / store / fetch_min / fetch_max (Relaxed) — zero allocation, zero lock.
    output_latency: OutputLatencyMetrics,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
{
    let mut tick_remainder: i64 = 0;
    device.build_output_stream(
        config,
        move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
            callback_count.fetch_add(1, Ordering::Relaxed);

            // INVESTIGATION ONLY — remove before Phase 6
            // First callback detection (atomic flags, logged outside callback for real-time safety)
            static FIRST_CALLBACK_LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
            if !FIRST_CALLBACK_LOGGED.swap(true, Ordering::Relaxed) {
                // Note: actual logging happens in status() or after callback for real-time safety
                // We just mark that the first callback occurred
            }

            // Record the timestamp of this callback invocation so that the
            // A/V drift freshness guard can determine whether the audio clock
            // was actively advancing at the moment a drift sample was taken.
            // Relaxed ordering is sufficient: the value is a best-effort
            // monotonic hint, not a synchronisation point.
            let callback_ns = clock_epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64;
            // Avoid the zero sentinel — if elapsed is genuinely 0 ns, treat
            // it as 1 ns so a freshly-started clock isn't mistaken for
            // "never fired".
            let callback_ns = callback_ns.max(1);

            // Record inter-callback spacing in the lock-free ring buffer.
            // Compute spacing before overwriting last_callback_ns.
            // Zero in last_callback_ns means "first callback" — skip that slot
            // so the ring only holds genuine interval measurements.
            let prev_ns = last_callback_ns.load(Ordering::Relaxed);
            if prev_ns != 0 {
                let spacing_us = callback_ns.saturating_sub(prev_ns) / 1_000;
                let cursor = interval_cursor.fetch_add(1, Ordering::Relaxed);
                let slot = (cursor as usize) % INTERVAL_RING_SIZE;
                interval_ring[slot].store(spacing_us, Ordering::Relaxed);
            }

            last_callback_ns.store(callback_ns, Ordering::Relaxed);

            // Record `playback − callback` latency into linear histogram and atomics.
            // `info.timestamp().playback` is the moment the hardware will
            // actually present the first sample of this buffer; subtracting
            // `callback` gives the output latency the listener experiences.
            // All arithmetic is integer-only and allocation-free. If the host
            // does not populate the timestamp (checked_duration_since returns
            // None), we skip silently and leave the histogram untouched.
            if let Some(latency) = info
                .timestamp()
                .playback
                .checked_duration_since(info.timestamp().callback)
            {
                // Saturate at u64::MAX to keep the cast safe. Any latency
                // above ~584 years is effectively infinite and lands in the
                // top overflow bucket anyway.
                let us = latency.as_micros().min(u64::MAX as u128) as u64;
                let bucket = output_latency_bucket(us);
                output_latency.histogram[bucket].fetch_add(1, Ordering::Relaxed);
                output_latency.last_us.store(us, Ordering::Relaxed);
                output_latency.min_us.fetch_min(us, Ordering::Relaxed);
                output_latency.max_us.fetch_max(us, Ordering::Relaxed);
                output_latency.sum_us.fetch_add(us, Ordering::Relaxed);
                output_latency.count.fetch_add(1, Ordering::Relaxed);
                // Mark as available on the very first successful measurement.
                // compare_exchange is overkill; a store is fine because the
                // flag only ever transitions false → true.
                if !output_latency.available.load(Ordering::Relaxed) {
                    output_latency.available.store(true, Ordering::Relaxed);
                }
            }

            if !playing.load(Ordering::Acquire) || muted.load(Ordering::Acquire) {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
                return;
            }

            let start_ticks = position_ticks.load(Ordering::Acquire);
            let callback_started = Instant::now();
            let master_gain = volume_milli.load(Ordering::Acquire) as f32 / 1_000.0;
            let playback_speed = speed_milli.load(Ordering::Acquire) as f32 / 1_000.0;
            let frames = data.len() / usize::from(channels.max(1));
            let ramp_remaining = transport_ramp_frames.load(Ordering::Acquire);
            let ramp_consumed = ramp_remaining.min(frames as u32);
            if ramp_consumed > 0 {
                transport_ramp_frames.fetch_sub(ramp_consumed, Ordering::AcqRel);
            }

            // Non-blocking try_read lock for real-time safety
            if let Ok(mixer_guard) = mixer.try_read() {
                if mixer_guard.mix_into_with_ramp(
                    data,
                    channels,
                    sample_rate,
                    start_ticks,
                    master_gain,
                    playback_speed,
                    ramp_remaining as usize,
                    TRANSPORT_RAMP_FRAMES as usize,
                ) {
                    // INVESTIGATION ONLY — remove before Phase 6
                    // First non-silent callback detection
                    static FIRST_NON_SILENT_LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                    if !FIRST_NON_SILENT_LOGGED.swap(true, Ordering::Relaxed) {
                        // Logging from audio callback is unsafe; rely on external status polling
                        // to detect this transition via non_silent_frames counter
                    }
                    
                    let latency_us = output_latency.last_us.load(Ordering::Relaxed);
                    crate::cold_start::record_first_sound(latency_us);
                    non_silent_frames.fetch_add(
                        (data.len() / usize::from(channels.max(1))) as u64,
                        Ordering::Relaxed,
                    );
                }
            } else {
                // Lock contention fallback (render silence rather than block the audio thread)
                mixer_lock_misses.fetch_add(1, Ordering::Relaxed);
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
            }

            let callback_elapsed_us =
                callback_started.elapsed().as_micros().min(u64::MAX as u128) as u64;
            callback_time_us.fetch_add(callback_elapsed_us, Ordering::Relaxed);
            callback_max_time_us.fetch_max(callback_elapsed_us, Ordering::Relaxed);
            let callback_budget_us = (frames as u64)
                .saturating_mul(1_000_000)
                .checked_div(u64::from(sample_rate.max(1)))
                .unwrap_or(0);
            if callback_elapsed_us > callback_budget_us {
                callback_over_budget_count.fetch_add(1, Ordering::Relaxed);
            }

            played_frames.fetch_add(frames as u64, Ordering::Relaxed);

            // Hardware master clock tick update with drift-free sub-tick remainder carry
            let speed = i64::from(speed_milli.load(Ordering::Acquire));
            let total_numerator = (frames as i64)
                .saturating_mul(TICKS_PER_SECOND)
                .saturating_mul(speed)
                + tick_remainder;
            let denominator = i64::from(sample_rate.max(1)).saturating_mul(1_000);
            let elapsed_ticks = total_numerator / denominator;
            tick_remainder = total_numerator % denominator;
            position_ticks.fetch_add(elapsed_ticks, Ordering::Release);
        },
        move |error| {
            if let Ok(mut last_error) = last_error.lock() {
                *last_error = Some(error.to_string());
            }
        },
        None,
    )
}

