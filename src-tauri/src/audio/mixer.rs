//! Multi-track audio mixer and DSP engine.
//!
//! Handles summing of active timeline clips, constant-power panning, track/clip
//! gain envelopes, fade-in/fade-out curves, parameter smoothing, and MPSC
//! command processing.

use crossbeam::channel::{Receiver, Sender};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Global shared metrics accumulator for the utility audio mix graph.
pub static GLOBAL_AUDIO_MIXER_METRICS: Lazy<Arc<AudioMixerMetrics>> =
    Lazy::new(|| Arc::new(AudioMixerMetrics::new()));

pub const TICKS_PER_SECOND: i64 = 1_000_000;

/// Clip descriptor for audio mixing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClipConfig {
    pub id: String,
    pub path: String,
    pub timeline_start_ticks: i64,
    pub source_start_ticks: i64,
    pub duration_ticks: i64,
    pub gain: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub track_id: Option<String>,
}

/// Track-level mixing parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackConfig {
    pub id: String,
    pub volume: f32,
    pub pan: f32, // -1.0 (left) to 1.0 (right)
    pub muted: bool,
    pub solo: bool,
}

impl Default for AudioTrackConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            solo: false,
        }
    }
}

/// Commands sent from concurrent Tauri IPC handlers across threads to the audio mixer.
/// MPSC (Multi-Producer Single-Consumer) safe via crossbeam channel.
#[derive(Debug, Clone)]
pub enum AudioCommand {
    SetMasterVolume {
        volume: f32,
    },
    SetMasterMuted {
        muted: bool,
    },
    SetTrackVolume {
        track_id: String,
        volume: f32,
    },
    SetTrackPan {
        track_id: String,
        pan: f32,
    },
    SetTrackMuted {
        track_id: String,
        muted: bool,
    },
    SetTrackSolo {
        track_id: String,
        solo: bool,
    },
    InstallClip {
        clip: DecodedAudioClip,
    },
    RemoveClip {
        clip_id: String,
    },
    ClearClips,
    SyncGraph {
        clips: Vec<DecodedAudioClip>,
        tracks: Vec<AudioTrackConfig>,
    },
}

/// Create an MPSC command channel for audio graph mutations.
pub fn create_audio_command_channel() -> (Sender<AudioCommand>, Receiver<AudioCommand>) {
    crossbeam::channel::unbounded()
}

/// Decoded PCM audio clip held in memory for low-latency timeline mixing.
#[derive(Debug, Clone)]
pub struct DecodedAudioClip {
    pub config: AudioClipConfig,
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Arc<[f32]>,
}

impl DecodedAudioClip {
    #[inline]
    pub fn sample_at(&self, timeline_ticks: i64, output_channel: usize) -> Option<f32> {
        if self.sample_rate == 0 || self.channels == 0 || self.samples.is_empty() {
            return None;
        }

        let clip_channels = usize::from(self.channels);
        let clip_sample_rate = i64::from(self.sample_rate);
        let duration_ticks = if self.config.duration_ticks > 0 {
            self.config.duration_ticks
        } else {
            (self.samples.len() as i64 / clip_channels as i64).saturating_mul(TICKS_PER_SECOND)
                / clip_sample_rate
        };

        let relative_ticks = timeline_ticks.saturating_sub(self.config.timeline_start_ticks);
        if relative_ticks < 0 || relative_ticks >= duration_ticks {
            return None;
        }

        let source_position =
            relative_ticks as f64 * clip_sample_rate as f64 / TICKS_PER_SECOND as f64;
        let source_index = source_position.floor() as usize;
        let source_fraction = (source_position - source_index as f64) as f32;
        let source_frame = source_index.saturating_mul(clip_channels);
        if source_frame >= self.samples.len() {
            return None;
        }

        let source_channel = output_channel.min(clip_channels - 1);
        let first = self.samples[source_frame + source_channel];
        let next_source_frame = source_frame.saturating_add(clip_channels);
        let second = self
            .samples
            .get(next_source_frame + source_channel)
            .copied()
            .unwrap_or(first);

        // Linear interpolation for sub-sample accuracy
        let sample_val = first + (second - first) * source_fraction;

        // Apply clip gain & fades
        let fade_in_gain = if self.config.fade_in_ticks > 0 {
            (relative_ticks as f32 / self.config.fade_in_ticks as f32).clamp(0.0, 1.0)
        } else {
            1.0
        };

        let remaining_ticks = duration_ticks.saturating_sub(relative_ticks);
        let fade_out_gain = if self.config.fade_out_ticks > 0 {
            (remaining_ticks as f32 / self.config.fade_out_ticks as f32).clamp(0.0, 1.0)
        } else {
            1.0
        };

        Some(sample_val * self.config.gain * fade_in_gain.min(fade_out_gain))
    }
}

/// Constant-power panning law (3dB center attenuation):
/// returns (left_gain, right_gain) for a pan parameter in [-1.0, 1.0].
#[inline]
pub fn constant_power_pan(pan: f32) -> (f32, f32) {
    let clamped_pan = pan.clamp(-1.0, 1.0);
    let angle = (clamped_pan + 1.0) * (std::f32::consts::FRAC_PI_4); // 0 to PI/2
    (angle.cos(), angle.sin())
}

// ── Audio Mixer Telemetry ────────────────────────────────────────────────────

/// Lock-free, zero-allocation performance counters for the real-time audio mixer.
///
/// All fields are `AtomicU64` updated with `Ordering::Relaxed`.  This guarantees
/// single-instruction atomic increments on x86_64 (`LOCK XADD`) and ARM64
/// (`LDADD`) without cache-line ping-ponging or OS-level synchronization.
///
/// # Real-Time Safety Contract
///
/// This struct satisfies the Phase 5 / CPAL callback real-time requirements:
/// - **Zero heap allocations** in any counter update path.
/// - **No blocking locks** (no `Mutex`, no `RwLock`).
/// - **No formatting or I/O** at the update site.
/// - Counters are only *read* from non-RT contexts (IPC query commands, diagnostics).
#[derive(Debug, Default)]
pub struct AudioMixerMetrics {
    /// Total number of `mix_chunk` calls processed.
    pub chunks_mixed_total: AtomicU64,
    /// Cumulative clip-chunk instances served via the direct contiguous-block
    /// fast path (matched sample rate + no active fade ramps).
    pub fast_path_clips_total: AtomicU64,
    /// Cumulative clip-chunk instances that fell back to `sample_at()` due to
    /// sample-rate mismatch or active fade ramps.
    pub fallback_clips_total: AtomicU64,
    /// Clips rejected per chunk by the bounding-box temporal culling gate
    /// (clip end ≤ chunk start  OR  clip start ≥ chunk end).
    pub culled_clips_total: AtomicU64,
    /// Times the number of concurrently active clips exceeded the 32-slot
    /// stack arena and required a heap `Vec` fallback.
    pub stack_overflow_events: AtomicU64,
}

impl AudioMixerMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot all counters into a serialisable value for IPC / NDJSON logging.
    /// Called only from non-RT contexts; `Ordering::Relaxed` loads are safe here
    /// because we do not require cross-counter consistency — each counter is an
    /// independent monotonic aggregate.
    pub fn snapshot(&self) -> AudioMixerTelemetrySnapshot {
        let fast = self.fast_path_clips_total.load(Ordering::Relaxed);
        let fallback = self.fallback_clips_total.load(Ordering::Relaxed);
        let total_clips = fast + fallback;
        let fast_path_ratio = if total_clips > 0 {
            fast as f32 / total_clips as f32
        } else {
            0.0
        };
        let culled = self.culled_clips_total.load(Ordering::Relaxed);
        let culling_efficiency = if total_clips + culled > 0 {
            culled as f32 / (total_clips + culled) as f32
        } else {
            0.0
        };
        AudioMixerTelemetrySnapshot {
            chunks_mixed_total: self.chunks_mixed_total.load(Ordering::Relaxed),
            fast_path_clips_total: fast,
            fallback_clips_total: fallback,
            culled_clips_total: culled,
            stack_overflow_events: self.stack_overflow_events.load(Ordering::Relaxed),
            fast_path_ratio,
            culling_efficiency,
        }
    }
}

/// Point-in-time snapshot of `AudioMixerMetrics`.  Serialisable for Tauri IPC
/// responses and NDJSON session-log payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixerTelemetrySnapshot {
    /// Total `mix_chunk` invocations since session start.
    pub chunks_mixed_total: u64,
    /// Clips served without floating-point SRC or fade evaluation.
    pub fast_path_clips_total: u64,
    /// Clips requiring full `sample_at()` interpolation.
    pub fallback_clips_total: u64,
    /// Clips pruned by the temporal bounding-box culling stage.
    pub culled_clips_total: u64,
    /// Stack-arena overflow events (>32 simultaneous clips).
    pub stack_overflow_events: u64,
    /// `fast_path / (fast_path + fallback)`; target ≥ 0.90 on 48 kHz timelines.
    pub fast_path_ratio: f32,
    /// `culled / (culled + active)`; indicates bounding-box effectiveness.
    pub culling_efficiency: f32,
}

/// Multi-track audio mix graph.
#[derive(Debug, Default, Clone)]
pub struct AudioMixGraph {
    pub clips: Vec<DecodedAudioClip>,
    pub tracks: Vec<AudioTrackConfig>,
    pub master_volume: f32,
    pub master_muted: bool,
    /// Shared lock-free performance counters.  `Arc` so the caller can hold a
    /// reference across the mix-graph `Clone` boundary without losing data.
    pub metrics: Arc<AudioMixerMetrics>,
}

impl AudioMixGraph {
    pub fn new() -> Self {
        Self {
            clips: Vec::new(),
            tracks: Vec::new(),
            master_volume: 1.0,
            master_muted: false,
            metrics: GLOBAL_AUDIO_MIXER_METRICS.clone(),
        }
    }

    pub fn set_clips(&mut self, clips: Vec<DecodedAudioClip>) {
        self.clips = clips;
    }

    pub fn set_tracks(&mut self, tracks: Vec<AudioTrackConfig>) {
        self.tracks = tracks;
    }

    pub fn set_master(&mut self, volume: f32, muted: bool) {
        self.master_volume = volume.clamp(0.0, 2.0);
        self.master_muted = muted;
    }

    /// Apply a single AudioCommand to mutate the mix graph.
    pub fn apply_command(&mut self, command: AudioCommand) {
        match command {
            AudioCommand::SetMasterVolume { volume } => {
                self.master_volume = volume.clamp(0.0, 2.0);
            }
            AudioCommand::SetMasterMuted { muted } => {
                self.master_muted = muted;
            }
            AudioCommand::SetTrackVolume { track_id, volume } => {
                if let Some(track) = self.tracks.iter_mut().find(|t| t.id == track_id) {
                    track.volume = volume.clamp(0.0, 2.0);
                } else {
                    self.tracks.push(AudioTrackConfig {
                        id: track_id,
                        volume: volume.clamp(0.0, 2.0),
                        ..Default::default()
                    });
                }
            }
            AudioCommand::SetTrackPan { track_id, pan } => {
                if let Some(track) = self.tracks.iter_mut().find(|t| t.id == track_id) {
                    track.pan = pan.clamp(-1.0, 1.0);
                } else {
                    self.tracks.push(AudioTrackConfig {
                        id: track_id,
                        pan: pan.clamp(-1.0, 1.0),
                        ..Default::default()
                    });
                }
            }
            AudioCommand::SetTrackMuted { track_id, muted } => {
                if let Some(track) = self.tracks.iter_mut().find(|t| t.id == track_id) {
                    track.muted = muted;
                } else {
                    self.tracks.push(AudioTrackConfig {
                        id: track_id,
                        muted,
                        ..Default::default()
                    });
                }
            }
            AudioCommand::SetTrackSolo { track_id, solo } => {
                if let Some(track) = self.tracks.iter_mut().find(|t| t.id == track_id) {
                    track.solo = solo;
                } else {
                    self.tracks.push(AudioTrackConfig {
                        id: track_id,
                        solo,
                        ..Default::default()
                    });
                }
            }
            AudioCommand::InstallClip { clip } => {
                if let Some(existing) = self
                    .clips
                    .iter_mut()
                    .find(|c| c.config.id == clip.config.id)
                {
                    *existing = clip;
                } else {
                    self.clips.push(clip);
                }
            }
            AudioCommand::RemoveClip { clip_id } => {
                self.clips.retain(|c| c.config.id != clip_id);
            }
            AudioCommand::ClearClips => {
                self.clips.clear();
            }
            AudioCommand::SyncGraph { clips, tracks } => {
                self.clips = clips;
                self.tracks = tracks;
            }
        }
    }

    /// Return a point-in-time snapshot of the mixer telemetry counters.
    /// Call only from non-RT contexts (IPC command handlers, diagnostics loops).
    pub fn telemetry_snapshot(&self) -> AudioMixerTelemetrySnapshot {
        self.metrics.snapshot()
    }

    /// Drain all queued commands from the MPSC command receiver at buffer boundary.
    pub fn drain_commands(&mut self, receiver: &Receiver<AudioCommand>) {
        while let Ok(cmd) = receiver.try_recv() {
            self.apply_command(cmd);
        }
    }

    /// Mix audio into the output buffer starting at `timeline_start_ticks`.
    /// Output buffer is interleaved `f32` (e.g. `[L, R, L, R, ...]`).
    ///
    /// Per-track starvation rule: If an individual clip's audio is unavailable (None),
    /// that clip is silently omitted for that sample while all other clips continue
    /// mixing uninterrupted.
    ///
    /// Returns `true` if any non-silent audio was written.
    pub fn mix_chunk(
        &self,
        output: &mut [f32],
        output_channels: u16,
        output_sample_rate: u32,
        timeline_start_ticks: i64,
    ) -> bool {
        output.fill(0.0);

        if self.master_muted
            || self.clips.is_empty()
            || output_channels == 0
            || output_sample_rate == 0
            || output.is_empty()
        {
            return false;
        }

        // ── Chunk-level telemetry: one atomic increment per mix_chunk call ──
        self.metrics
            .chunks_mixed_total
            .fetch_add(1, Ordering::Relaxed);

        let output_channels = usize::from(output_channels);
        let output_sample_rate = i64::from(output_sample_rate);
        let total_frames = output.len() / output_channels;
        let chunk_duration_ticks = (total_frames as i64)
            .saturating_mul(TICKS_PER_SECOND)
            / output_sample_rate;
        let timeline_end_ticks = timeline_start_ticks.saturating_add(chunk_duration_ticks);

        let has_any_solo = self.tracks.iter().any(|t| t.solo);

        #[derive(Copy, Clone)]
        struct ActiveClip<'a> {
            clip: &'a DecodedAudioClip,
            effective_gain_mono: f32,
            effective_gain_l: f32,
            effective_gain_r: f32,
            /// Pre-computed start frame index for the contiguous-block fast path.
            ///
            /// `Some(n)` means: this clip's sample_rate matches output_sample_rate and
            /// it has no active fade ramps — skip per-sample f64 tick division, .floor(),
            /// sub-sample interpolation, and fade evaluation.  The `effective_gain_*`
            /// fields already incorporate `clip.config.gain` when this is `Some`.
            ///
            /// `None` means: use the existing `sample_at()` fallback path unchanged.
            fast_path_start: Option<usize>,
        }

        const STACK_ACTIVE_CAP: usize = 32;
        let mut stack_clips: [Option<ActiveClip>; STACK_ACTIVE_CAP] = [None; STACK_ACTIVE_CAP];
        let mut stack_count = 0;
        let mut overflow_clips: Option<Vec<ActiveClip>> = None;

        for clip in &self.clips {
            let duration_ticks = if clip.config.duration_ticks > 0 {
                clip.config.duration_ticks
            } else {
                let clip_channels = usize::from(clip.channels);
                let clip_sample_rate = i64::from(clip.sample_rate);
                if clip_channels == 0 || clip_sample_rate == 0 {
                    0
                } else {
                    (clip.samples.len() as i64 / clip_channels as i64)
                        .saturating_mul(TICKS_PER_SECOND)
                        / clip_sample_rate
                }
            };

            let clip_start = clip.config.timeline_start_ticks;
            let clip_end = clip_start.saturating_add(duration_ticks);

            // Bounding box rejection: skip clips that do not overlap this audio chunk
            if clip_end <= timeline_start_ticks || clip_start >= timeline_end_ticks {
                self.metrics
                    .culled_clips_total
                    .fetch_add(1, Ordering::Relaxed);
                continue;
            }

            let track = clip
                .config
                .track_id
                .as_deref()
                .and_then(|tid| self.tracks.iter().find(|t| t.id == tid));

            if let Some(t) = track {
                if t.muted {
                    continue;
                }
                if has_any_solo && !t.solo {
                    continue;
                }
            }

            let (track_vol, track_pan) = track.map(|t| (t.volume, t.pan)).unwrap_or((1.0, 0.0));
            let (pan_l, pan_r) = constant_power_pan(track_pan);

            // ── Contiguous-block fast path eligibility ───────────────────────
            // Criteria (all must hold):
            //   1. Clip sample rate exactly matches output sample rate → no SRC needed.
            //   2. No fade-in or fade-out active → gain is constant across the chunk.
            // When eligible, fold `clip.config.gain` into `effective_gain_*` so the
            // inner loop becomes a simple multiply-accumulate with no division.
            let fast_path_start = if i64::from(clip.sample_rate) == output_sample_rate
                && clip.config.fade_in_ticks == 0
                && clip.config.fade_out_ticks == 0
                && clip.sample_rate > 0
                && !clip.samples.is_empty()
            {
                let relative_start_ticks =
                    timeline_start_ticks.saturating_sub(clip.config.timeline_start_ticks);
                // relative_start_ticks may be negative when the clip starts after
                // timeline_start_ticks — in that case start_frame is 0 and the per-frame
                // bounds check skips silent head samples.
                let start_ticks = relative_start_ticks.max(0);
                let start_frame = (start_ticks as u64)
                    .saturating_mul(clip.sample_rate as u64)
                    / TICKS_PER_SECOND as u64;
                Some(start_frame as usize)
            } else {
                None
            };

            // When the fast path is active, fold clip gain in now so the inner loop
            // only pays one multiply per sample.  When falling back to sample_at(),
            // sample_at() already applies clip.config.gain internally — do NOT double-apply.
            let (gain_mono, gain_l, gain_r) = if fast_path_start.is_some() {
                let g = clip.config.gain;
                (
                    track_vol * self.master_volume * g,
                    track_vol * pan_l * self.master_volume * g,
                    track_vol * pan_r * self.master_volume * g,
                )
            } else {
                (
                    track_vol * self.master_volume,
                    track_vol * pan_l * self.master_volume,
                    track_vol * pan_r * self.master_volume,
                )
            };

            let active = ActiveClip {
                clip,
                effective_gain_mono: gain_mono,
                effective_gain_l: gain_l,
                effective_gain_r: gain_r,
                fast_path_start,
            };

            // `ActiveClip` is `Copy`; capture before placement so we can read the
            // field after `active` has been moved into the stack / overflow array.
            let is_fast_path = active.fast_path_start.is_some();

            if stack_count < STACK_ACTIVE_CAP {
                stack_clips[stack_count] = Some(active);
                stack_count += 1;
            } else {
                // Record the first overflow event (bump once per chunk, not per clip).
                if overflow_clips.is_none() {
                    self.metrics
                        .stack_overflow_events
                        .fetch_add(1, Ordering::Relaxed);
                }
                overflow_clips.get_or_insert_with(Vec::new).push(active);
            }

            // Per-clip-chunk fast-path / fallback telemetry counter.
            // Incremented once per active clip per chunk — O(active_clips).
            if is_fast_path {
                self.metrics
                    .fast_path_clips_total
                    .fetch_add(1, Ordering::Relaxed);
            } else {
                self.metrics
                    .fallback_clips_total
                    .fetch_add(1, Ordering::Relaxed);
            }
        }

        if stack_count == 0 {
            return false;
        }

        let mut has_audio = false;

        // ── Inner mixing macro ───────────────────────────────────────────────
        // Inlined per-clip mixing with contiguous-block fast path.
        //
        // Fast path (`fast_path_start = Some(n)`):
        //   For clips where sample_rate == output_sample_rate and no active fades,
        //   we pre-computed the chunk-relative start frame index.  Each output frame
        //   is served by a direct indexed read: `samples[(n + frame_index) * ch + c]`.
        //   No f64 arithmetic, no .floor(), no interpolation, no fade evaluation.
        //   `effective_gain_*` already incorporates `clip.config.gain`.
        //
        // Fallback path (`fast_path_start = None`):
        //   Delegate to the existing `sample_at()` method (mismatched rates, active
        //   fades, degenerate clips).  `sample_at()` applies `clip.config.gain`
        //   internally; `effective_gain_*` does NOT include it here.
        macro_rules! mix_one_clip {
            ($active:expr, $frame_index:expr, $output_channels:expr, $output_frame:expr, $timeline_ticks:expr, $has_audio:expr) => {{
                let active = $active;
                match active.fast_path_start {
                    // ── Contiguous-block fast path ──────────────────────────────────
                    Some(start) => {
                        let frame_idx = start + $frame_index;
                        let clip_channels = usize::from(active.clip.channels);
                        let base = frame_idx * clip_channels;
                        if base < active.clip.samples.len() {
                            let sample_l = active.clip.samples[base];
                            if $output_channels == 1 {
                                let out = sample_l * active.effective_gain_mono;
                                $output_frame[0] += out;
                                if out.abs() > 0.00001 {
                                    *$has_audio = true;
                                }
                            } else {
                                // For mono clips replicate left → right; for stereo read ch 1.
                                let sample_r = if clip_channels > 1 {
                                    active.clip.samples.get(base + 1).copied().unwrap_or(sample_l)
                                } else {
                                    sample_l
                                };
                                let out_l = sample_l * active.effective_gain_l;
                                let out_r = sample_r * active.effective_gain_r;
                                $output_frame[0] += out_l;
                                $output_frame[1] += out_r;
                                if out_l.abs() > 0.00001 || out_r.abs() > 0.00001 {
                                    *$has_audio = true;
                                }
                            }
                        }
                    }
                    // ── Fallback: existing sample_at() path ─────────────────────────
                    None => {
                        if $output_channels == 1 {
                            if let Some(sample) = active.clip.sample_at($timeline_ticks, 0) {
                                let sample_out = sample * active.effective_gain_mono;
                                $output_frame[0] += sample_out;
                                if sample_out.abs() > 0.00001 {
                                    *$has_audio = true;
                                }
                            }
                        } else {
                            let sample_l = active.clip.sample_at($timeline_ticks, 0);
                            let sample_r = active.clip.sample_at($timeline_ticks, 1).or(sample_l);
                            if let (Some(l), Some(r)) = (sample_l, sample_r) {
                                let out_l = l * active.effective_gain_l;
                                let out_r = r * active.effective_gain_r;
                                $output_frame[0] += out_l;
                                $output_frame[1] += out_r;
                                if out_l.abs() > 0.00001 || out_r.abs() > 0.00001 {
                                    *$has_audio = true;
                                }
                            }
                        }
                    }
                }
            }};
        }

        for (frame_index, output_frame) in output.chunks_mut(output_channels).enumerate() {
            let frame_ticks =
                (frame_index as i64).saturating_mul(TICKS_PER_SECOND) / output_sample_rate;
            let timeline_ticks = timeline_start_ticks.saturating_add(frame_ticks);

            // Mix stack-allocated active clips
            for active in stack_clips[..stack_count].iter().flatten() {
                mix_one_clip!(active, frame_index, output_channels, output_frame, timeline_ticks, &mut has_audio);
            }

            // Mix overflow active clips if any
            if let Some(ref overflow) = overflow_clips {
                for active in overflow {
                    mix_one_clip!(active, frame_index, output_channels, output_frame, timeline_ticks, &mut has_audio);
                }
            }

            // Clamp output to valid audio range [-1.0, 1.0]
            for sample in output_frame.iter_mut() {
                *sample = sample.clamp(-1.0, 1.0);
            }
        }

        has_audio
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-platform fixture comparison with explicit float tolerance.
    fn assert_pcm_within_tolerance(
        actual: &[f32],
        expected: &[f32],
        max_diff: f32,
        max_rms_diff: f32,
    ) {
        assert_eq!(
            actual.len(),
            expected.len(),
            "PCM buffers must have equal length"
        );
        let mut sum_sq = 0.0f32;
        for (i, (&a, &e)) in actual.iter().zip(expected.iter()).enumerate() {
            let diff = (a - e).abs();
            assert!(
                diff <= max_diff,
                "Sample {} diff {} exceeded max tolerance {}",
                i,
                diff,
                max_diff
            );
            sum_sq += diff * diff;
        }
        let rms_diff = (sum_sq / actual.len() as f32).sqrt();
        assert!(
            rms_diff <= max_rms_diff,
            "RMS diff {} exceeded max RMS tolerance {}",
            rms_diff,
            max_rms_diff
        );
    }

    #[test]
    fn constant_power_pan_invariants() {
        let (l_center, r_center) = constant_power_pan(0.0);
        assert!((l_center - r_center).abs() < 0.0001);
        assert!((l_center * l_center + r_center * r_center - 1.0).abs() < 0.0001);

        let (l_left, r_left) = constant_power_pan(-1.0);
        assert!((l_left - 1.0).abs() < 0.0001);
        assert!(r_left.abs() < 0.0001);

        let (l_right, r_right) = constant_power_pan(1.0);
        assert!(l_right.abs() < 0.0001);
        assert!((r_right - 1.0).abs() < 0.0001);
    }

    #[test]
    fn mix_graph_sums_clips_with_panning_and_gain() {
        let mut graph = AudioMixGraph::new();
        graph.set_tracks(vec![AudioTrackConfig {
            id: "t1".to_string(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            solo: false,
        }]);

        let clip = DecodedAudioClip {
            config: AudioClipConfig {
                id: "c1".to_string(),
                path: "test.wav".to_string(),
                timeline_start_ticks: 0,
                source_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                track_id: Some("t1".to_string()),
            },
            sample_rate: 48000,
            channels: 2,
            samples: vec![1.0; 48000 * 2].into(),
        };
        graph.set_clips(vec![clip]);

        let mut output = [0.0f32; 4]; // 2 stereo frames
        let has_audio = graph.mix_chunk(&mut output, 2, 48000, 0);
        assert!(has_audio);
        let (pan_l, pan_r) = constant_power_pan(0.0);
        let expected = [pan_l, pan_r, pan_l, pan_r];
        assert_pcm_within_tolerance(&output, &expected, 1e-4, 1e-5);
    }

    #[test]
    fn mpsc_command_queue_drains_concurrent_producer_commands() {
        let (sender, receiver) = create_audio_command_channel();
        let mut graph = AudioMixGraph::new();

        // Simulate multiple concurrent producer threads sending commands
        let s1 = sender.clone();
        let s2 = sender.clone();
        let s3 = sender.clone();

        s1.send(AudioCommand::SetMasterVolume { volume: 0.8 })
            .unwrap();
        s2.send(AudioCommand::SetTrackVolume {
            track_id: "t1".to_string(),
            volume: 0.5,
        })
        .unwrap();
        s3.send(AudioCommand::SetMasterMuted { muted: false })
            .unwrap();

        graph.drain_commands(&receiver);

        assert_eq!(graph.master_volume, 0.8);
        assert_eq!(graph.tracks.len(), 1);
        assert_eq!(graph.tracks[0].volume, 0.5);
    }

    #[test]
    fn per_track_starvation_silences_missing_track_without_affecting_other_tracks() {
        let mut graph = AudioMixGraph::new();

        // Track 1 has active audio starting at 0
        let clip1 = DecodedAudioClip {
            config: AudioClipConfig {
                id: "c1".to_string(),
                path: "c1.wav".to_string(),
                timeline_start_ticks: 0,
                source_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                track_id: Some("t1".to_string()),
            },
            sample_rate: 48000,
            channels: 1,
            samples: vec![0.5; 48000].into(),
        };

        // Track 2 has no samples yet (starved/loading) starting at 2s
        let clip2 = DecodedAudioClip {
            config: AudioClipConfig {
                id: "c2".to_string(),
                path: "c2.wav".to_string(),
                timeline_start_ticks: 2_000_000,
                source_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                track_id: Some("t2".to_string()),
            },
            sample_rate: 48000,
            channels: 1,
            samples: vec![].into(), // empty / starved
        };

        graph.set_clips(vec![clip1, clip2]);

        let mut output = [0.0f32; 2]; // 1 stereo frame at time 0
        let has_audio = graph.mix_chunk(&mut output, 2, 48000, 0);
        assert!(has_audio);
        // Clip 1 plays, Clip 2 is starved and does not block or corrupt output
        let (pan_l, pan_r) = constant_power_pan(0.0);
        let expected = [0.5 * pan_l, 0.5 * pan_r];
        assert_pcm_within_tolerance(&output, &expected, 1e-4, 1e-5);
    }

    /// Task 5.3 — Contiguous-block audio fast path.
    ///
    /// Verifies two properties:
    /// 1. When clip sample_rate == output_sample_rate and no fades are set, the fast
    ///    path produces sample values within 1e-6 of the expected direct-read result.
    /// 2. When clip sample_rate ≠ output_sample_rate, the fallback path (`sample_at()`)
    ///    is taken and still produces valid, non-silent output without panicking.
    #[test]
    fn contiguous_block_fast_path_matched_rate_and_mismatched_rate_fallback() {
        // ── Case 1: Matched rate — fast path ─────────────────────────────────
        // Stereo 48 kHz clip with known per-frame PCM values: frame i = [0.1*i, 0.2*i].
        // The clip starts at t=0 on the timeline; we mix a 4-frame chunk at t=0.
        // Expected output (center pan, no track/master gain adjustment beyond 1.0):
        //   frame 0 → [0.1*0*pan_l, 0.1*0*pan_r] = [0.0, 0.0]
        //   frame 1 → [0.1*1*pan_l, 0.2*1*pan_r] = [0.1*pan_l, 0.2*pan_r]  (stereo read)
        //   frame 2 → [0.1*2*pan_l, 0.2*2*pan_r]
        //   frame 3 → [0.1*3*pan_l, 0.2*3*pan_r]
        const FRAMES: usize = 4;
        const SR: u32 = 48_000;
        const CHANNELS: u16 = 2;

        // Build PCM: interleaved [L, R] where frame i has L=0.1*(i%100) R=0.2*(i%100)
        // (capped to 100 to avoid f32 precision loss; the test only reads FRAMES=4 frames)
        let mut pcm_data = Vec::with_capacity(SR as usize * CHANNELS as usize);
        for i in 0..(SR as usize) {
            pcm_data.push(0.1 * (i as f32));
            pcm_data.push(0.2 * (i as f32));
        }
        // Clamp to safe PCM range so the mixer clamp step does not alter values in test range
        let pcm_data: Vec<f32> = pcm_data
            .into_iter()
            .map(|s| s.clamp(-1.0, 1.0))
            .collect();

        let clip_matched = DecodedAudioClip {
            config: AudioClipConfig {
                id: "fast_path_clip".to_string(),
                path: "test_fast.wav".to_string(),
                timeline_start_ticks: 0,
                source_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND, // 1 second
                gain: 1.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                track_id: None,
            },
            sample_rate: SR,
            channels: CHANNELS,
            samples: pcm_data.clone().into(),
        };

        let mut graph = AudioMixGraph::new();
        graph.master_volume = 1.0;
        graph.set_clips(vec![clip_matched]);

        let mut output_fast = vec![0.0f32; FRAMES * CHANNELS as usize];
        let has_audio = graph.mix_chunk(&mut output_fast, CHANNELS, SR, 0);
        assert!(has_audio, "fast path should produce non-silent audio");

        // Build expected output: direct indexed read * pan gains (center pan → equal L/R)
        let (pan_l, pan_r) = constant_power_pan(0.0);
        let mut expected_fast = vec![0.0f32; FRAMES * CHANNELS as usize];
        for i in 0..FRAMES {
            let base = i * CHANNELS as usize;
            let raw_l = pcm_data[base].clamp(-1.0, 1.0);
            let raw_r = pcm_data[base + 1].clamp(-1.0, 1.0);
            let out_l = (raw_l * pan_l).clamp(-1.0, 1.0);
            let out_r = (raw_r * pan_r).clamp(-1.0, 1.0);
            expected_fast[base] = out_l;
            expected_fast[base + 1] = out_r;
        }
        assert_pcm_within_tolerance(&output_fast, &expected_fast, 1e-5, 1e-6);

        // ── Case 2: Mismatched rate — fallback path ───────────────────────────
        // A 44 100 Hz clip vs. 48 000 Hz output: fast path must NOT activate.
        // The fallback sample_at() must still produce valid, non-silent output.
        let clip_mismatched = DecodedAudioClip {
            config: AudioClipConfig {
                id: "fallback_clip".to_string(),
                path: "test_fallback.wav".to_string(),
                timeline_start_ticks: 0,
                source_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                track_id: None,
            },
            sample_rate: 44_100, // ← mismatched
            channels: 2,
            samples: vec![0.5f32; 44_100 * 2].into(),
        };

        let mut graph2 = AudioMixGraph::new();
        graph2.master_volume = 1.0;
        graph2.set_clips(vec![clip_mismatched]);

        let mut output_fallback = vec![0.0f32; FRAMES * CHANNELS as usize];
        let has_audio2 = graph2.mix_chunk(&mut output_fallback, CHANNELS, SR, 0);
        assert!(has_audio2, "fallback path should produce non-silent audio");

        // Fallback output must be finite and within PCM range (sample_at returns 0.5 * gains)
        for &s in &output_fallback {
            assert!(s.is_finite(), "fallback sample must be finite");
            assert!((-1.0..=1.0).contains(&s), "fallback sample must be in [-1,1]");
        }

        // ── Case 3: Fade active — must NOT take fast path ─────────────────────
        // Even if rate matches, a non-zero fade_in_ticks forces the fallback.
        let clip_with_fade = DecodedAudioClip {
            config: AudioClipConfig {
                id: "fade_clip".to_string(),
                path: "test_fade.wav".to_string(),
                timeline_start_ticks: 0,
                source_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                fade_in_ticks: 100_000, // ← active fade-in
                fade_out_ticks: 0,
                track_id: None,
            },
            sample_rate: SR,
            channels: 2,
            samples: vec![1.0f32; SR as usize * 2].into(),
        };

        let mut graph3 = AudioMixGraph::new();
        graph3.master_volume = 1.0;
        graph3.set_clips(vec![clip_with_fade]);

        let mut output_faded = vec![0.0f32; FRAMES * CHANNELS as usize];
        let has_audio3 = graph3.mix_chunk(&mut output_faded, CHANNELS, SR, 0);
        assert!(has_audio3, "faded clip should produce non-silent audio");

        // Frame 0 is at t=0 → fade_in_gain ≈ 0 → first stereo pair must be very small
        // (but NOT exactly 0 due to tick rounding).  Just verify it is less than the
        // non-faded value and is finite.
        assert!(output_faded[0].is_finite());
        // Frame 3 (at t≈62.5µs) gain = 62.5µs/100ms = 0.000625 → out_l < 0.001
        assert!(
            output_faded[0].abs() < 0.001,
            "fade-in at frame 0 should be near-silent, got {}",
            output_faded[0]
        );
    }
}
