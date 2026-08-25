use crate::audio::decoder::decode_audio_clip;
use crate::audio::mixer::{AudioClipConfig, DecodedAudioClip};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

pub const TICKS_PER_SECOND: i64 = 1_000_000;
pub const MAX_PCM_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_MIXER_PCM_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_ACTIVE_CLIPS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
    pub available: bool,
    pub running: bool,
    pub playing: bool,
    pub host: Option<String>,
    pub device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub sample_format: Option<String>,
    pub audio_position_ticks: u64,
    pub callback_count: u64,
    pub rendered_frames: u64,
    pub non_silent_frames: u64,
    pub last_error: Option<String>,
    pub speed: f32,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioClipStatus {
    pub id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_count: usize,
    pub duration_ticks: i64,
    pub timeline_start_ticks: i64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub channel_mode: String,
    pub downmix: String,
    pub channel_map: Option<Vec<usize>>,
    pub preserve_pitch: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioKeyframe {
    /// Relative clip time in native timeline ticks.
    pub time: i64,
    pub gain: f32,
    pub easing: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NativePcmClip {
    pub id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Arc<[f32]>,
    pub timeline_start_ticks: i64,
    pub duration_ticks: i64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
    pub fade_in_curve: String,
    pub fade_out_curve: String,
    pub volume_keyframes: Vec<NativeAudioKeyframe>,
    pub channel_mode: String,
    pub downmix: String,
    pub channel_map: Option<Vec<usize>>,
    pub preserve_pitch: bool,
}

impl NativePcmClip {
    pub fn status(&self) -> NativeAudioClipStatus {
        NativeAudioClipStatus {
            id: self.id.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels,
            sample_count: self.samples.len(),
            duration_ticks: self.duration_ticks,
            timeline_start_ticks: self.timeline_start_ticks,
            gain: self.gain,
            pan: self.pan,
            fade_in_ticks: self.fade_in_ticks,
            fade_out_ticks: self.fade_out_ticks,
            channel_mode: self.channel_mode.clone(),
            downmix: self.downmix.clone(),
            channel_map: self.channel_map.clone(),
            preserve_pitch: self.preserve_pitch,
        }
    }
}

impl From<DecodedAudioClip> for NativePcmClip {
    fn from(clip: DecodedAudioClip) -> Self {
        Self {
            id: clip.config.id,
            sample_rate: clip.sample_rate,
            channels: clip.channels,
            samples: clip.samples,
            timeline_start_ticks: clip.config.timeline_start_ticks,
            duration_ticks: clip.config.duration_ticks,
            gain: clip.config.gain,
            pan: 0.0,
            fade_in_ticks: clip.config.fade_in_ticks,
            fade_out_ticks: clip.config.fade_out_ticks,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        }
    }
}

impl From<NativePcmClip> for DecodedAudioClip {
    fn from(clip: NativePcmClip) -> Self {
        Self {
            config: AudioClipConfig {
                id: clip.id,
                path: String::new(),
                timeline_start_ticks: clip.timeline_start_ticks,
                source_start_ticks: 0,
                duration_ticks: clip.duration_ticks,
                gain: clip.gain,
                fade_in_ticks: clip.fade_in_ticks,
                fade_out_ticks: clip.fade_out_ticks,
                track_id: None,
            },
            sample_rate: clip.sample_rate,
            channels: clip.channels,
            samples: clip.samples,
        }
    }
}

#[derive(Debug, Default)]
pub struct NativeAudioMixer {
    clips: Vec<NativePcmClip>,
}

impl NativeAudioMixer {
    pub fn install_clip(&mut self, clip: NativePcmClip) -> Result<NativeAudioClipStatus, String> {
        let status = clip.status();
        let incoming_bytes = clip
            .samples
            .len()
            .saturating_mul(std::mem::size_of::<f32>());
        let replaced_bytes = self
            .clips
            .iter()
            .find(|existing| existing.id == clip.id)
            .map(|existing| {
                existing
                    .samples
                    .len()
                    .saturating_mul(std::mem::size_of::<f32>())
            })
            .unwrap_or(0);
        let total_bytes = self
            .clips
            .iter()
            .map(|existing| {
                existing
                    .samples
                    .len()
                    .saturating_mul(std::mem::size_of::<f32>())
            })
            .sum::<usize>()
            .saturating_sub(replaced_bytes)
            .saturating_add(incoming_bytes);
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
            return Ok(status);
        }
        if self.clips.len() >= MAX_ACTIVE_CLIPS {
            return Err(format!(
                "Native audio mixer supports at most {MAX_ACTIVE_CLIPS} active clips"
            ));
        }
        self.clips.push(clip);
        Ok(status)
    }

    pub fn clear(&mut self) {
        self.clips.clear();
    }

    pub fn clip_status(&self) -> Option<NativeAudioClipStatus> {
        self.clips.first().map(NativePcmClip::status)
    }

    pub fn clip_statuses(&self) -> Vec<NativeAudioClipStatus> {
        self.clips.iter().map(NativePcmClip::status).collect()
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
                        sample_at(clip, timeline_ticks, channel_index, playback_speed)
                    })
                    .sum::<f32>()
                    * master_gain;
                if value.abs() > 0.000001 {
                    has_audio = true;
                }
                *sample = T::from_sample(value.clamp(-1.0, 1.0));
            }
        }
        has_audio
    }
}

fn sample_at(
    clip: &NativePcmClip,
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
    let interpolate_channel = |source_position: f64, source_channel: usize| {
        let source_index = source_position.floor().max(0.0) as usize;
        let source_fraction = (source_position - source_index as f64) as f32;
        let source_frame = source_index.saturating_mul(clip_channels);
        let channel = source_channel.min(clip_channels - 1);
        let first = clip.samples.get(source_frame + channel).copied()?;
        let second = clip
            .samples
            .get(source_frame.saturating_add(clip_channels) + channel)
            .copied()
            .unwrap_or(first);
        Some(first + (second - first) * source_fraction)
    };
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
    let sample_channel = |source_channel: usize| {
        if clip.preserve_pitch && (playback_speed - 1.0).abs() > 0.001 {
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

fn evaluate_curve(progress: f32, curve: &str) -> f32 {
    let t = progress.clamp(0.0, 1.0);
    match curve {
        "exponential" => t * t,
        "logarithmic" => t.sqrt(),
        "s-curve" => t * t * (3.0 - 2.0 * t),
        _ => t,
    }
}

fn evaluate_keyframes(points: &[NativeAudioKeyframe], time: i64) -> f32 {
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

struct NativeAudioClockInner {
    stream: Option<cpal::Stream>,
    host: Option<String>,
    device_name: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    sample_format: Option<String>,
    played_frames: Arc<AtomicU64>,
    callback_count: Arc<AtomicU64>,
    non_silent_frames: Arc<AtomicU64>,
    position_ticks: Arc<AtomicI64>,
    playing: Arc<AtomicBool>,
    speed_milli: Arc<AtomicU32>,
    volume_milli: Arc<AtomicU32>,
    muted: Arc<AtomicBool>,
    mixer: Arc<RwLock<NativeAudioMixer>>,
    last_error: Arc<Mutex<Option<String>>>,
}

pub struct NativeAudioClock {
    inner: NativeAudioClockInner,
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
                volume_milli: Arc::new(AtomicU32::new(1_000)),
                muted: Arc::new(AtomicBool::new(false)),
                mixer: Arc::new(RwLock::new(NativeAudioMixer::default())),
                last_error: Arc::new(Mutex::new(None)),
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
        let mixer = self.inner.mixer.clone();
        let last_error = self.inner.last_error.clone();

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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
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
                mixer,
                last_error,
            ),
            unsupported => {
                return Err(format!(
                    "Native audio sample format is unsupported: {unsupported:?}"
                ));
            }
        }
        .map_err(|error| format!("Unable to build native audio output stream: {error}"))?;

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
        self.inner.volume_milli.store(1_000, Ordering::Release);
        self.inner.muted.store(false, Ordering::Release);
    }

    pub fn pause(&self) {
        self.inner.playing.store(false, Ordering::Release);
    }

    pub fn resume(&self) {
        if self.inner.stream.is_some() {
            self.inner.playing.store(true, Ordering::Release);
        }
    }

    pub fn set_speed(&self, speed: f32) {
        let safe_speed = if speed.is_finite() {
            speed.clamp(0.1, 4.0)
        } else {
            1.0
        };
        self.inner
            .speed_milli
            .store((safe_speed * 1_000.0).round() as u32, Ordering::Release);
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
        self.inner
            .position_ticks
            .store(position_ticks.max(0), Ordering::Release);
        self.inner.played_frames.store(0, Ordering::Release);
    }

    pub fn install_clip(&mut self, clip: NativePcmClip) -> Result<NativeAudioClipStatus, String> {
        self.inner
            .mixer
            .write()
            .expect("native audio mixer lock poisoned")
            .install_clip(clip)
    }

    pub fn clear_clip(&mut self) {
        if let Ok(mut mixer) = self.inner.mixer.write() {
            mixer.clear();
        }
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
        }
    }
}

/// Real-time safe audio output stream builder.
///
/// Invariant: The stream callback performs ZERO heap allocations and acquires no
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
    mixer: Arc<RwLock<NativeAudioMixer>>,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
{
    device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            callback_count.fetch_add(1, Ordering::Relaxed);

            if !playing.load(Ordering::Acquire) || muted.load(Ordering::Acquire) {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
                return;
            }

            let start_ticks = position_ticks.load(Ordering::Acquire);
            let master_gain = volume_milli.load(Ordering::Acquire) as f32 / 1_000.0;
            let playback_speed = speed_milli.load(Ordering::Acquire) as f32 / 1_000.0;

            // Non-blocking try_read lock for real-time safety
            if let Ok(mixer_guard) = mixer.try_read() {
                if mixer_guard.mix_into(
                    data,
                    channels,
                    sample_rate,
                    start_ticks,
                    master_gain,
                    playback_speed,
                ) {
                    non_silent_frames.fetch_add(
                        (data.len() / usize::from(channels.max(1))) as u64,
                        Ordering::Relaxed,
                    );
                }
            } else {
                // Lock contention fallback (render silence rather than block the audio thread)
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
            }

            let frames = data.len() / usize::from(channels.max(1));
            played_frames.fetch_add(frames as u64, Ordering::Relaxed);

            // Hardware master clock tick update
            let elapsed_ticks = (frames as i64)
                .saturating_mul(TICKS_PER_SECOND)
                .saturating_mul(i64::from(speed_milli.load(Ordering::Acquire)))
                / i64::from(sample_rate.max(1))
                / 1_000;
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

/// Decodes an audio clip file into a `NativePcmClip` using the high-performance
/// format-agnostic audio decoder.
pub async fn decode_native_audio_clip(
    path: &Path,
    clip_id: String,
    timeline_start_ticks: i64,
    source_start_ticks: i64,
    duration_ticks: i64,
    gain: f32,
    pan: f32,
    fade_in_ticks: i64,
    fade_out_ticks: i64,
    fade_in_curve: String,
    fade_out_curve: String,
    volume_keyframes: Vec<NativeAudioKeyframe>,
    channel_mode: String,
    downmix: String,
    channel_map: Option<Vec<usize>>,
    preserve_pitch: bool,
    sample_rate: u32,
    channels: u16,
) -> Result<NativePcmClip, String> {
    let config = AudioClipConfig {
        id: clip_id,
        path: path.to_string_lossy().to_string(),
        timeline_start_ticks,
        source_start_ticks,
        duration_ticks,
        gain: gain.clamp(0.0, 4.0),
        fade_in_ticks: fade_in_ticks.max(0),
        fade_out_ticks: fade_out_ticks.max(0),
        track_id: None,
    };

    // Decode into the requested working layout, not blindly into the device
    // layout. This makes explicit mono/stereo downmix deterministic before the
    // real-time channel matrix is applied.
    let decode_channels = if channel_mode == "mono" || downmix == "mono" {
        1
    } else if channel_mode == "stereo" || downmix == "stereo" {
        2
    } else {
        channels
    };
    let decoded = decode_audio_clip(path, config, sample_rate, decode_channels).await?;
    let mut native: NativePcmClip = decoded.into();
    native.pan = pan.clamp(-1.0, 1.0);
    native.fade_in_curve = fade_in_curve;
    native.fade_out_curve = fade_out_curve;
    native.volume_keyframes = volume_keyframes;
    native.volume_keyframes.sort_by_key(|point| point.time);
    native.channel_mode = match channel_mode.as_str() {
        "mono" | "stereo" | "multichannel" => channel_mode,
        _ => "auto".to_string(),
    };
    native.downmix = match downmix.as_str() {
        "mono" | "stereo" => downmix,
        _ => "auto".to_string(),
    };
    native.channel_map = channel_map.filter(|map| !map.is_empty());
    native.preserve_pitch = preserve_pitch;
    Ok(native)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_clock_is_stopped_and_unconfigured() {
        let clock = NativeAudioClock::new();
        let status = clock.status();
        assert!(!status.available);
        assert!(!status.running);
        assert_eq!(status.audio_position_ticks, 0);
        assert_eq!(status.speed, 1.0);
    }

    #[test]
    fn native_speed_is_clamped_to_supported_playback_bounds() {
        let clock = NativeAudioClock::new();
        clock.set_speed(8.0);
        assert_eq!(clock.status().speed, 4.0);

        clock.set_speed(f32::NAN);
        assert_eq!(clock.status().speed, 1.0);
    }

    #[test]
    fn mixer_renders_clip_at_timeline_position_with_gain() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 4,
                channels: 1,
                samples: vec![0.0, 1.0, 0.0, -1.0].into(),
                timeline_start_ticks: 500_000,
                duration_ticks: 1_000_000,
                gain: 0.5,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [9.0_f32; 4];
        mixer.mix_into(&mut output, 1, 4, 500_000, 1.0, 1.0);

        assert_eq!(output, [0.0, 0.5, 0.0, -0.5]);
    }

    #[test]
    fn mixer_applies_fade_in_and_fade_out_to_rendered_samples() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![1.0; 4].into(),
                timeline_start_ticks: 0,
                duration_ticks: 4 * TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 2 * TICKS_PER_SECOND,
                fade_out_ticks: 2 * TICKS_PER_SECOND,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 4];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);

        assert_eq!(output, [0.0, 0.5, 1.0, 0.5]);
    }

    #[test]
    fn mixer_applies_keyframe_automation_with_the_same_relative_ticks_as_the_timeline() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "automation".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![1.0; 4].into(),
                timeline_start_ticks: 0,
                duration_ticks: 4 * TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: vec![
                    NativeAudioKeyframe {
                        time: 0,
                        gain: 0.25,
                        easing: Some("linear".to_string()),
                    },
                    NativeAudioKeyframe {
                        time: 2 * TICKS_PER_SECOND,
                        gain: 1.0,
                        easing: Some("linear".to_string()),
                    },
                    NativeAudioKeyframe {
                        time: 4 * TICKS_PER_SECOND,
                        gain: 0.5,
                        easing: Some("exponential".to_string()),
                    },
                ],
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 4];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);

        assert_eq!(output[0], 0.25);
        assert_eq!(output[1], 0.625);
        assert!((output[3] - 0.707_106_77).abs() < 0.0001);
    }

    #[test]
    fn mixer_applies_clip_pan_without_changing_center_gain() {
        let clip = NativePcmClip {
            id: "pan".to_string(),
            sample_rate: 1,
            channels: 2,
            samples: vec![1.0, 1.0].into(),
            timeline_start_ticks: 0,
            duration_ticks: TICKS_PER_SECOND,
            gain: 1.0,
            pan: 1.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "auto".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let mut mixer = NativeAudioMixer::default();
        mixer.install_clip(clip).unwrap();
        let mut output = [0.0_f32; 2];
        mixer.mix_into(&mut output, 2, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.0, 1.0]);
    }

    #[test]
    fn mixer_applies_explicit_downmix_and_channel_map() {
        let base = NativePcmClip {
            id: "routing".to_string(),
            sample_rate: 1,
            channels: 2,
            samples: vec![1.0, 0.0].into(),
            timeline_start_ticks: 0,
            duration_ticks: TICKS_PER_SECOND,
            gain: 1.0,
            pan: 0.0,
            fade_in_ticks: 0,
            fade_out_ticks: 0,
            fade_in_curve: "linear".to_string(),
            fade_out_curve: "linear".to_string(),
            volume_keyframes: Vec::new(),
            channel_mode: "auto".to_string(),
            downmix: "mono".to_string(),
            channel_map: None,
            preserve_pitch: false,
        };
        let mut mixer = NativeAudioMixer::default();
        mixer.install_clip(base.clone()).unwrap();
        let mut mono = [0.0_f32; 2];
        mixer.mix_into(&mut mono, 2, 1, 0, 1.0, 1.0);
        assert_eq!(mono, [0.5, 0.5]);

        let mut swapped = base;
        swapped.id = "swapped".to_string();
        swapped.downmix = "auto".to_string();
        swapped.channel_map = Some(vec![1, 0]);
        mixer.clear();
        mixer.install_clip(swapped).unwrap();
        let mut output = [0.0_f32; 2];
        mixer.mix_into(&mut output, 2, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.0, 1.0]);
    }

    #[test]
    fn mixer_pitch_preservation_keeps_a_constant_signal_audible_at_transport_speed() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "pitch".to_string(),
                sample_rate: 100,
                channels: 1,
                samples: vec![0.75; 100].into(),
                timeline_start_ticks: 0,
                duration_ticks: TICKS_PER_SECOND,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: true,
            })
            .unwrap();
        let mut output = [0.0_f32; 20];
        mixer.mix_into(&mut output, 1, 100, 0, 1.0, 2.0);
        assert!(output.iter().all(|sample| (*sample - 0.75).abs() < 0.001));
    }

    #[test]
    fn mixer_is_silent_before_and_after_clip_bounds() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "clip".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.75].into(),
                timeline_start_ticks: 1_000_000,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut before = [9.0_f32; 1];
        mixer.mix_into(&mut before, 1, 1, 0, 1.0, 1.0);
        let mut after = [9.0_f32; 1];
        mixer.mix_into(&mut after, 1, 1, 2_000_000, 1.0, 1.0);

        assert_eq!(before, [0.0]);
        assert_eq!(after, [0.0]);
    }

    #[test]
    fn mixer_sums_overlapping_clips_and_replaces_by_id() {
        let mut mixer = NativeAudioMixer::default();
        mixer
            .install_clip(NativePcmClip {
                id: "a".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.25].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();
        mixer
            .install_clip(NativePcmClip {
                id: "b".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.5].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();

        let mut output = [0.0_f32; 1];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0, 1.0);
        assert_eq!(output, [0.75]);

        mixer
            .install_clip(NativePcmClip {
                id: "a".to_string(),
                sample_rate: 1,
                channels: 1,
                samples: vec![0.1].into(),
                timeline_start_ticks: 0,
                duration_ticks: 1_000_000,
                gain: 1.0,
                pan: 0.0,
                fade_in_ticks: 0,
                fade_out_ticks: 0,
                fade_in_curve: "linear".to_string(),
                fade_out_curve: "linear".to_string(),
                volume_keyframes: Vec::new(),
                channel_mode: "auto".to_string(),
                downmix: "auto".to_string(),
                channel_map: None,
                preserve_pitch: false,
            })
            .unwrap();
        let mut replaced = [0.0_f32; 1];
        mixer.mix_into(&mut replaced, 1, 1, 0, 1.0, 1.0);
        assert_eq!(replaced, [0.6]);
        assert_eq!(mixer.clip_statuses().len(), 2);
    }
}
