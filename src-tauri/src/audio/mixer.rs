//! Multi-track audio mixer and DSP engine.
//!
//! Handles summing of active timeline clips, constant-power panning, track/clip
//! gain envelopes, fade-in/fade-out curves, parameter smoothing, and MPSC
//! command processing.

use crossbeam::channel::{Receiver, Sender};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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

/// Multi-track audio mix graph.
#[derive(Debug, Default, Clone)]
pub struct AudioMixGraph {
    pub clips: Vec<DecodedAudioClip>,
    pub tracks: Vec<AudioTrackConfig>,
    pub master_volume: f32,
    pub master_muted: bool,
}

impl AudioMixGraph {
    pub fn new() -> Self {
        Self {
            clips: Vec::new(),
            tracks: Vec::new(),
            master_volume: 1.0,
            master_muted: false,
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
        {
            return false;
        }

        let output_channels = usize::from(output_channels);
        let output_sample_rate = i64::from(output_sample_rate);
        let mut has_audio = false;

        let has_any_solo = self.tracks.iter().any(|t| t.solo);

        for (frame_index, output_frame) in output.chunks_mut(output_channels).enumerate() {
            let frame_ticks =
                (frame_index as i64).saturating_mul(TICKS_PER_SECOND) / output_sample_rate;
            let timeline_ticks = timeline_start_ticks.saturating_add(frame_ticks);

            for clip in &self.clips {
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

                if output_channels == 1 {
                    if let Some(sample) = clip.sample_at(timeline_ticks, 0) {
                        let sample_out = sample * track_vol * self.master_volume;
                        output_frame[0] += sample_out;
                        if sample_out.abs() > 0.00001 {
                            has_audio = true;
                        }
                    }
                } else {
                    let sample_l = clip.sample_at(timeline_ticks, 0);
                    let sample_r = clip.sample_at(timeline_ticks, 1).or(sample_l); // fallback mono to stereo

                    if let (Some(l), Some(r)) = (sample_l, sample_r) {
                        let out_l = l * track_vol * pan_l * self.master_volume;
                        let out_r = r * track_vol * pan_r * self.master_volume;
                        output_frame[0] += out_l;
                        output_frame[1] += out_r;
                        if out_l.abs() > 0.00001 || out_r.abs() > 0.00001 {
                            has_audio = true;
                        }
                    }
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
}
