use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use cpal::{FromSample, SizedSample};
use super::clip::{NativeAudioKeyframe, NativePcmClip};
use super::types::{
    NativeAudioClipDiagnostic, NativeAudioClipStatus, NativeAudioMixerInspection,
    MAX_ACTIVE_CLIPS, MAX_MIXER_PCM_BYTES, TICKS_PER_SECOND,
};

#[derive(Debug, Clone)]
pub(crate) struct PitchCache {
    pub(crate) tempo_milli: u32,
    pub(crate) samples: Arc<[f32]>,
}

#[derive(Debug, Default)]
pub struct NativeAudioMixer {
    pub(crate) clips: Vec<NativePcmClip>,
    /// Prepared only outside the audio callback. The callback reads this while
    /// holding its existing non-blocking mixer read lock.
    pitch_cache: HashMap<String, PitchCache>,
}

impl NativeAudioMixer {
    pub fn install_clip(&mut self, clip: NativePcmClip) -> Result<NativeAudioClipStatus, String> {
        let status = clip.status();
        let total_bytes = {
            let mut seen = HashSet::new();
            let mut total = 0usize;
            for existing in &self.clips {
                if existing.id != clip.id {
                    let ptr = Arc::as_ptr(&existing.samples);
                    if !existing.samples.is_empty() && seen.insert(ptr) {
                        total = total.saturating_add(
                            existing
                                .samples
                                .len()
                                .saturating_mul(std::mem::size_of::<f32>()),
                        );
                    }
                }
            }
            let incoming_ptr = Arc::as_ptr(&clip.samples);
            if !clip.samples.is_empty() && seen.insert(incoming_ptr) {
                total = total.saturating_add(
                    clip.samples
                        .len()
                        .saturating_mul(std::mem::size_of::<f32>()),
                );
            }
            total
        };
        if total_bytes > MAX_MIXER_PCM_BYTES {
            return Err(format!(
                "Native audio mixer exceeds the {} MiB PCM budget",
                MAX_MIXER_PCM_BYTES / 1024 / 1024
            ));
        }
        if let Some(existing) = self
            .clips
            .iter_mut()
            .find(|existing| existing.id == clip.id)
        {
            *existing = clip;
            self.pitch_cache.clear();
            return Ok(status);
        }
        if self.clips.len() >= MAX_ACTIVE_CLIPS {
            return Err(format!(
                "Native audio mixer supports at most {MAX_ACTIVE_CLIPS} active clips"
            ));
        }
        self.clips.push(clip);
        self.pitch_cache.clear();
        Ok(status)
    }

    pub fn clear(&mut self) {
        self.clips.clear();
        self.pitch_cache.clear();
    }

    /// Replace the complete graph only after every clip has been decoded and
    /// validated. The callback therefore observes either the previous healthy
    /// graph or this complete candidate, never an empty/partial graph.
    pub fn replace_clips(&mut self, clips: Vec<NativePcmClip>) -> Result<(), String> {
        if clips.len() > MAX_ACTIVE_CLIPS {
            return Err(format!(
                "Native audio mixer supports at most {MAX_ACTIVE_CLIPS} active clips"
            ));
        }
        let total_bytes = {
            let mut seen = HashSet::new();
            let mut total = 0usize;
            for clip in &clips {
                let ptr = Arc::as_ptr(&clip.samples);
                if !clip.samples.is_empty() && seen.insert(ptr) {
                    total = total.saturating_add(
                        clip.samples
                            .len()
                            .saturating_mul(std::mem::size_of::<f32>()),
                    );
                }
            }
            total
        };
        if total_bytes > MAX_MIXER_PCM_BYTES {
            return Err(format!(
                "Native audio mixer exceeds the {} MiB PCM budget",
                MAX_MIXER_PCM_BYTES / 1024 / 1024
            ));
        }
        self.clips = clips;
        self.pitch_cache.clear();
        Ok(())
    }

    pub(crate) fn install_pitch_cache(&mut self, tempo_milli: u32, values: HashMap<String, Arc<[f32]>>) {
        self.pitch_cache = values
            .into_iter()
            .map(|(id, samples)| {
                (
                    id,
                    PitchCache {
                        tempo_milli,
                        samples,
                    },
                )
            })
            .collect();
    }

    pub(crate) fn clear_pitch_cache(&mut self) {
        self.pitch_cache.clear();
    }

    fn sample_at(
        &self,
        clip: &NativePcmClip,
        timeline_ticks: i64,
        output_channel: usize,
        playback_speed: f32,
    ) -> Option<f32> {
        sample_at_with_cache(
            clip,
            self.pitch_cache.get(&clip.id),
            timeline_ticks,
            output_channel,
            playback_speed,
        )
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
        let clip = self
            .clips
            .iter_mut()
            .find(|clip| clip.id == clip_id)
            .ok_or_else(|| format!("Native audio clip '{clip_id}' is not installed"))?;
        clip.gain = if gain.is_finite() {
            gain.clamp(0.0, 4.0)
        } else {
            0.0
        };
        clip.pan = if pan.is_finite() {
            pan.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        clip.fade_in_ticks = fade_in_ticks.max(0);
        clip.fade_out_ticks = fade_out_ticks.max(0);
        clip.fade_in_curve = fade_in_curve;
        clip.fade_out_curve = fade_out_curve;
        clip.volume_keyframes = volume_keyframes;
        clip.volume_keyframes.sort_by_key(|point| point.time);
        Ok(clip.status())
    }

    pub fn clip_status(&self) -> Option<NativeAudioClipStatus> {
        self.clips.first().map(NativePcmClip::status)
    }

    pub fn clip_statuses(&self) -> Vec<NativeAudioClipStatus> {
        self.clips.iter().map(NativePcmClip::status).collect()
    }

    /// Inspect the exact sample path used by `mix_into` without touching the
    /// real-time callback. This is called only by an explicit diagnostic IPC
    /// request, never from the audio thread.
    pub fn inspect(
        &self,
        output_channels: u16,
        output_sample_rate: u32,
        timeline_start_ticks: i64,
        master_gain: f32,
        playback_speed: f32,
    ) -> NativeAudioMixerInspection {
        if self.clips.is_empty() || output_channels == 0 || output_sample_rate == 0 {
            return NativeAudioMixerInspection::default();
        }

        let output_channels = usize::from(output_channels);
        let frames = (output_sample_rate / 50).clamp(1, 4_096) as usize;
        let output_sample_rate = i64::from(output_sample_rate);
        let mut inspection = NativeAudioMixerInspection {
            clip_diagnostics: self
                .clips
                .iter()
                .map(|clip| NativeAudioClipDiagnostic {
                    id: clip.id.clone(),
                    active: false,
                    mixer_peak: 0.0,
                })
                .collect(),
            ..Default::default()
        };

        for frame_index in 0..frames {
            let frame_ticks = ((frame_index as f64
                * TICKS_PER_SECOND as f64
                * playback_speed.clamp(0.25, 4.0) as f64)
                / output_sample_rate as f64)
                .round() as i64;
            let timeline_ticks = timeline_start_ticks.saturating_add(frame_ticks);
            for channel_index in 0..output_channels {
                let mut value = 0.0_f32;
                for (clip_index, clip) in self.clips.iter().enumerate() {
                    if let Some(sample) =
                        self.sample_at(clip, timeline_ticks, channel_index, playback_speed)
                    {
                        let clip_diagnostic = &mut inspection.clip_diagnostics[clip_index];
                        if !clip_diagnostic.active {
                            clip_diagnostic.active = true;
                            inspection.active_clip_ids.push(clip.id.clone());
                        }
                        clip_diagnostic.mixer_peak =
                            clip_diagnostic.mixer_peak.max((sample * master_gain).abs());
                        value += sample;
                    }
                }
                inspection.mixer_peak = inspection.mixer_peak.max((value * master_gain).abs());
            }
        }

        inspection
    }

    pub fn mix_into<T>(
        &self,
        output: &mut [T],
        output_channels: u16,
        output_sample_rate: u32,
        timeline_start_ticks: i64,
        master_gain: f32,
        playback_speed: f32,
    ) -> bool
    where
        T: SizedSample + FromSample<f32>,
    {
        self.mix_into_with_ramp(
            output,
            output_channels,
            output_sample_rate,
            timeline_start_ticks,
            master_gain,
            playback_speed,
            0,
            0,
        )
    }

    /// Mix with a short native transport fade-in. The caller supplies the
    /// remaining and total ramp frames from the clock's atomic transport gate;
    /// this keeps the real-time callback allocation- and lock-free.
    pub fn mix_into_with_ramp<T>(
        &self,
        output: &mut [T],
        output_channels: u16,
        output_sample_rate: u32,
        timeline_start_ticks: i64,
        master_gain: f32,
        playback_speed: f32,
        ramp_frames_remaining: usize,
        ramp_total_frames: usize,
    ) -> bool
    where
        T: SizedSample + FromSample<f32>,
    {
        for sample in output.iter_mut() {
            *sample = T::EQUILIBRIUM;
        }

        if self.clips.is_empty() || output_channels == 0 || output_sample_rate == 0 {
            return false;
        }

        let output_channels = usize::from(output_channels);
        let output_sample_rate = i64::from(output_sample_rate);
        let mut has_audio = false;

        for (frame_index, output_frame) in output.chunks_mut(output_channels).enumerate() {
            let transport_gain = if ramp_frames_remaining > 0 && ramp_total_frames > 0 {
                let ramp_frame = ramp_total_frames
                    .saturating_sub(ramp_frames_remaining)
                    .saturating_add(frame_index + 1);
                (ramp_frame as f32 / ramp_total_frames as f32).min(1.0)
            } else {
                1.0
            };
            let frame_ticks = ((frame_index as f64
                * TICKS_PER_SECOND as f64
                * playback_speed.clamp(0.25, 4.0) as f64)
                / output_sample_rate as f64)
                .round() as i64;
            let timeline_ticks = timeline_start_ticks.saturating_add(frame_ticks);
            for (channel_index, sample) in output_frame.iter_mut().enumerate() {
                let value = self
                    .clips
                    .iter()
                    .filter_map(|clip| {
                        self.sample_at(clip, timeline_ticks, channel_index, playback_speed)
                    })
                    .sum::<f32>()
                    * master_gain
                    * transport_gain;
                if value.abs() > 0.000001 {
                    has_audio = true;
                }
                *sample = T::from_sample(value.clamp(-1.0, 1.0));
            }
        }
        has_audio
    }
}


pub(crate) fn sample_at_with_cache(
    clip: &NativePcmClip,
    pitch_cache: Option<&PitchCache>,
    timeline_ticks: i64,
    output_channel: usize,
    playback_speed: f32,
) -> Option<f32> {
    if clip.sample_rate == 0 || clip.channels == 0 || clip.samples.is_empty() {
        return None;
    }
    let clip_channels = usize::from(clip.channels);
    let clip_sample_rate = i64::from(clip.sample_rate);
    let duration_ticks = if clip.duration_ticks > 0 {
        clip.duration_ticks
    } else {
        (clip.samples.len() as i64 / clip_channels as i64).saturating_mul(TICKS_PER_SECOND)
            / clip_sample_rate
    };
    let relative_ticks = timeline_ticks.saturating_sub(clip.timeline_start_ticks);
    if relative_ticks < 0 || relative_ticks >= duration_ticks {
        return None;
    }

    let source_position = relative_ticks as f64 * clip_sample_rate as f64 / TICKS_PER_SECOND as f64;
    let interpolate = |samples: &[f32], source_position: f64, source_channel: usize| {
        let source_index = source_position.floor().max(0.0) as usize;
        let source_fraction = (source_position - source_index as f64) as f32;
        let source_frame = source_index.saturating_mul(clip_channels);
        let channel = source_channel.min(clip_channels - 1);
        let first = samples.get(source_frame + channel).copied()?;
        let second = samples
            .get(source_frame.saturating_add(clip_channels) + channel)
            .copied()
            .unwrap_or(first);
        Some(first + (second - first) * source_fraction)
    };
    let interpolate_channel =
        |position: f64, channel: usize| interpolate(&clip.samples, position, channel);
    let pitch_preserved_channel = |source_channel: usize| {
        // Granular overlap-add time stretch: grain centers advance at transport
        // speed while samples inside each grain remain at their native rate.
        // That keeps perceived pitch stable without allocating or locking in the
        // real-time mixer callback.
        let speed = playback_speed.clamp(0.25, 4.0) as f64;
        let synthesis_position = source_position / speed;
        let grain_size = ((clip_sample_rate as f64 * 0.04).round() as i64).max(64);
        let hop = (grain_size / 4).max(1);
        let center = (synthesis_position / hop as f64).floor() as i64 * hop;
        let half = grain_size as f64 / 2.0;
        let mut mixed = 0.0;
        let mut weight = 0.0;
        for grain_center in [center - hop, center, center + hop, center + 2 * hop] {
            let local = synthesis_position - grain_center as f64;
            if local.abs() > half {
                continue;
            }
            let window = 0.5 + 0.5 * (std::f64::consts::PI * local / half).cos();
            if let Some(value) =
                interpolate_channel(grain_center as f64 * speed + local, source_channel)
            {
                mixed += value as f64 * window;
                weight += window;
            }
        }
        if weight > 0.000_001 {
            Some((mixed / weight) as f32)
        } else {
            None
        }
    };
    let cache_matches_speed = pitch_cache.is_some_and(|cache| {
        cache.tempo_milli == (playback_speed.clamp(0.1, 4.0) * 1_000.0).round() as u32
    });
    let sample_channel = |source_channel: usize| {
        if clip.preserve_pitch && (playback_speed - 1.0).abs() > 0.001 {
            if cache_matches_speed {
                // WSOLA output is indexed in wall-clock time. The timeline is
                // already moving at `playback_speed`, so divide back to obtain
                // the prepared output position.
                let cache = pitch_cache.expect("cache_matches_speed requires a cache");
                return interpolate(
                    &cache.samples,
                    source_position / playback_speed.clamp(0.1, 4.0) as f64,
                    source_channel,
                );
            }
            // A rate change may arrive before background preparation finishes.
            // Keep the bounded real-time fallback briefly rather than silence.
            pitch_preserved_channel(source_channel)
        } else {
            interpolate_channel(source_position, source_channel)
        }
    };
    // The decoder aligns source channels to the output device. This final matrix
    // is therefore deterministic for stereo devices and provides a safe,
    // explicit policy for every other output configuration too.
    let source_sample = if clip.channel_mode == "stereo" || clip.downmix == "stereo" {
        if output_channel >= 2 && clip.channel_map.is_none() {
            0.0
        } else {
            let source_channel = clip
                .channel_map
                .as_ref()
                .and_then(|map| map.get(output_channel))
                .copied()
                .unwrap_or_else(|| output_channel.min(clip_channels - 1));
            sample_channel(source_channel)?
        }
    } else if clip.channel_mode == "mono" || clip.downmix == "mono" {
        (0..clip_channels).filter_map(sample_channel).sum::<f32>() / clip_channels as f32
    } else {
        let source_channel = clip
            .channel_map
            .as_ref()
            .and_then(|map| map.get(output_channel))
            .copied()
            .unwrap_or_else(|| output_channel.min(clip_channels - 1));
        sample_channel(source_channel)?
    };

    // Fast-path: for ordinary clips with no fades, no keyframes, and centered pan,
    // avoid per-sample curve evaluation and automation search (CLY-BUG-022).
    if clip.fade_in_ticks <= 0
        && clip.fade_out_ticks <= 0
        && clip.volume_keyframes.is_empty()
        && clip.pan == 0.0
    {
        return Some(source_sample * clip.gain);
    }

    let fade_in_gain = if clip.fade_in_ticks > 0 {
        evaluate_curve(
            relative_ticks as f32 / clip.fade_in_ticks as f32,
            &clip.fade_in_curve,
        )
    } else {
        1.0
    };
    let remaining_ticks = duration_ticks.saturating_sub(relative_ticks);
    let fade_out_gain = if clip.fade_out_ticks > 0 {
        evaluate_curve(
            remaining_ticks as f32 / clip.fade_out_ticks as f32,
            &clip.fade_out_curve,
        )
    } else {
        1.0
    };
    let automation_gain = evaluate_keyframes(&clip.volume_keyframes, relative_ticks);
    let pan_gain = match output_channel {
        0 => (1.0 - clip.pan).clamp(0.0, 1.0),
        1 => (1.0 + clip.pan).clamp(0.0, 1.0),
        _ => 1.0,
    };
    Some(source_sample * clip.gain * pan_gain * automation_gain * fade_in_gain.min(fade_out_gain))
}

#[inline(always)]
pub(crate) fn evaluate_curve(progress: f32, curve: &str) -> f32 {
    let t = progress.clamp(0.0, 1.0);
    match curve {
        "exponential" => t * t,
        "logarithmic" => t.sqrt(),
        "s-curve" => t * t * (3.0 - 2.0 * t),
        _ => t,
    }
}

#[inline(always)]
pub(crate) fn evaluate_keyframes(points: &[NativeAudioKeyframe], time: i64) -> f32 {
    if points.is_empty() {
        return 1.0;
    }
    if time <= points[0].time {
        return points[0].gain;
    }
    let last = points.last().expect("points is non-empty");
    if time >= last.time {
        return last.gain;
    }
    for pair in points.windows(2) {
        let from = &pair[0];
        let to = &pair[1];
        if time < from.time || time > to.time {
            continue;
        }
        let span = (to.time - from.time).max(1) as f32;
        let t = ((time - from.time) as f32 / span).clamp(0.0, 1.0);
        return match to.easing.as_deref() {
            Some("exponential") if from.gain > 0.0001 && to.gain > 0.0001 => {
                from.gain * (to.gain / from.gain).powf(t)
            }
            Some("bezier") => from.gain + (to.gain - from.gain) * t * t * (3.0 - 2.0 * t),
            _ => from.gain + (to.gain - from.gain) * t,
        };
    }
    1.0
}

