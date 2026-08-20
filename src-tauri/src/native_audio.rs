use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const TICKS_PER_SECOND: i64 = 1_000_000;
const MAX_PCM_BYTES: usize = 256 * 1024 * 1024;
const MAX_MIXER_PCM_BYTES: usize = 512 * 1024 * 1024;
const MAX_ACTIVE_CLIPS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
    pub available: bool,
    pub running: bool,
    pub host: Option<String>,
    pub device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub sample_format: Option<String>,
    pub audio_position_ticks: u64,
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
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
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
    pub fade_in_ticks: i64,
    pub fade_out_ticks: i64,
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
            fade_in_ticks: self.fade_in_ticks,
            fade_out_ticks: self.fade_out_ticks,
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

    fn mix_into<T>(
        &self,
        output: &mut [T],
        output_channels: u16,
        output_sample_rate: u32,
        timeline_start_ticks: i64,
        master_gain: f32,
    ) where
        T: SizedSample + FromSample<f32>,
    {
        for sample in output.iter_mut() {
            *sample = T::EQUILIBRIUM;
        }

        if self.clips.is_empty() {
            return;
        }
        if output_channels == 0 || output_sample_rate == 0 {
            return;
        }

        let output_channels = usize::from(output_channels);
        let output_sample_rate = i64::from(output_sample_rate);

        for (frame_index, output_frame) in output.chunks_mut(output_channels).enumerate() {
            let frame_ticks =
                (frame_index as i64).saturating_mul(TICKS_PER_SECOND) / output_sample_rate;
            let timeline_ticks = timeline_start_ticks.saturating_add(frame_ticks);
            for (channel_index, sample) in output_frame.iter_mut().enumerate() {
                let value = self
                    .clips
                    .iter()
                    .filter_map(|clip| sample_at(clip, timeline_ticks, channel_index))
                    .sum::<f32>()
                    * master_gain;
                *sample = T::from_sample(value.clamp(-1.0, 1.0));
            }
        }
    }
}

fn sample_at(clip: &NativePcmClip, timeline_ticks: i64, output_channel: usize) -> Option<f32> {
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
    let source_index = source_position.floor() as usize;
    let source_fraction = (source_position - source_index as f64) as f32;
    let source_frame = source_index.saturating_mul(clip_channels);
    if source_frame >= clip.samples.len() {
        return None;
    }
    let source_channel = output_channel.min(clip_channels - 1);
    let first = clip.samples[source_frame + source_channel];
    let next_source_frame = source_frame.saturating_add(clip_channels);
    let second = clip
        .samples
        .get(next_source_frame + source_channel)
        .copied()
        .unwrap_or(first);
    let fade_in_gain = if clip.fade_in_ticks > 0 {
        (relative_ticks as f32 / clip.fade_in_ticks as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let remaining_ticks = duration_ticks.saturating_sub(relative_ticks);
    let fade_out_gain = if clip.fade_out_ticks > 0 {
        (remaining_ticks as f32 / clip.fade_out_ticks as f32).clamp(0.0, 1.0)
    } else {
        1.0
    };
    Some((first + (second - first) * source_fraction) * clip.gain * fade_in_gain.min(fade_out_gain))
}

struct NativeAudioClockInner {
    stream: Option<cpal::Stream>,
    host: Option<String>,
    device_name: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    sample_format: Option<String>,
    played_frames: Arc<AtomicU64>,
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
        self.inner.playing.store(true, Ordering::Release);
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
            volume.clamp(0.0, 1.0)
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
            host: self.inner.host.clone(),
            device_name: self.inner.device_name.clone(),
            sample_rate,
            channels: self.inner.channels,
            sample_format: self.inner.sample_format.clone(),
            audio_position_ticks,
            last_error,
            speed: self.inner.speed_milli.load(Ordering::Acquire) as f32 / 1_000.0,
            volume: self.inner.volume_milli.load(Ordering::Acquire) as f32 / 1_000.0,
            muted: self.inner.muted.load(Ordering::Acquire),
        }
    }
}

fn build_audio_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: u16,
    sample_rate: u32,
    played_frames: Arc<AtomicU64>,
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
            if !playing.load(Ordering::Acquire) {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
                return;
            }

            let start_ticks = position_ticks.load(Ordering::Acquire);
            if muted.load(Ordering::Acquire) {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
            } else if let Ok(mixer) = mixer.try_read() {
                mixer.mix_into(
                    data,
                    channels,
                    sample_rate,
                    start_ticks,
                    volume_milli.load(Ordering::Acquire) as f32 / 1_000.0,
                );
            } else {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
            }
            let frames = data.len() / usize::from(channels.max(1));
            played_frames.fetch_add(frames as u64, Ordering::AcqRel);
            let elapsed_ticks = (frames as i64)
                .saturating_mul(TICKS_PER_SECOND)
                .saturating_mul(i64::from(speed_milli.load(Ordering::Acquire)))
                / i64::from(sample_rate.max(1))
                / 1_000;
            position_ticks.fetch_add(elapsed_ticks, Ordering::AcqRel);
        },
        move |error| {
            if let Ok(mut last_error) = last_error.lock() {
                *last_error = Some(error.to_string());
            }
        },
        None,
    )
}

pub async fn decode_native_audio_clip(
    path: &Path,
    clip_id: String,
    timeline_start_ticks: i64,
    source_start_ticks: i64,
    duration_ticks: i64,
    gain: f32,
    fade_in_ticks: i64,
    fade_out_ticks: i64,
    sample_rate: u32,
    channels: u16,
) -> Result<NativePcmClip, String> {
    if sample_rate == 0 || channels == 0 {
        return Err("Native audio output configuration is invalid".to_string());
    }

    let mut command = Command::new("ffmpeg");
    command
        .env("PATH", crate::commands::export::augmented_path())
        .arg("-v")
        .arg("error")
        .arg("-nostdin")
        .arg("-threads")
        .arg("1");
    if source_start_ticks > 0 {
        command.arg("-ss").arg(format_seconds(source_start_ticks));
    }
    command
        .arg("-i")
        .arg(path)
        .arg("-vn")
        .arg("-ac")
        .arg(channels.to_string())
        .arg("-ar")
        .arg(sample_rate.to_string());
    if duration_ticks > 0 {
        command.arg("-t").arg(format_seconds(duration_ticks));
    }
    command
        .arg("-f")
        .arg("f32le")
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start native audio decoder: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Native audio decoder did not expose PCM output".to_string())?;
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = stdout
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Unable to read native PCM audio: {error}"))?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > MAX_PCM_BYTES {
            let _ = child.kill().await;
            return Err(format!(
                "Native audio clip exceeds the {} MiB PCM limit",
                MAX_PCM_BYTES / 1024 / 1024
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("Unable to finish native audio decode: {error}"))?;
    if !status.success() {
        return Err("Native audio decoder failed to decode the clip".to_string());
    }
    if bytes.len() % std::mem::size_of::<f32>() != 0 {
        return Err("Native audio decoder returned incomplete PCM samples".to_string());
    }

    let samples = bytes
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect::<Vec<_>>();
    if samples.is_empty() {
        return Err("Native audio decoder returned no samples".to_string());
    }
    let decoded_duration_ticks = (samples.len() as i64 / i64::from(channels))
        .saturating_mul(TICKS_PER_SECOND)
        / i64::from(sample_rate);

    Ok(NativePcmClip {
        id: clip_id,
        sample_rate,
        channels,
        samples: samples.into(),
        timeline_start_ticks,
        duration_ticks: if duration_ticks > 0 {
            duration_ticks.min(decoded_duration_ticks)
        } else {
            decoded_duration_ticks
        },
        gain: gain.clamp(0.0, 4.0),
        fade_in_ticks: fade_in_ticks.max(0),
        fade_out_ticks: fade_out_ticks.max(0),
    })
}

fn format_seconds(ticks: i64) -> String {
    format!(
        "{}.{:06}",
        ticks.div_euclid(TICKS_PER_SECOND),
        ticks.rem_euclid(TICKS_PER_SECOND)
    )
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
                fade_in_ticks: 0,
                fade_out_ticks: 0,
            })
            .unwrap();

        let mut output = [9.0_f32; 4];
        mixer.mix_into(&mut output, 1, 4, 500_000, 1.0);

        assert_eq!(output, [0.0, 0.5, 0.0, -0.5]);
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
                fade_in_ticks: 0,
                fade_out_ticks: 0,
            })
            .unwrap();

        let mut before = [9.0_f32; 1];
        mixer.mix_into(&mut before, 1, 1, 0, 1.0);
        let mut after = [9.0_f32; 1];
        mixer.mix_into(&mut after, 1, 1, 2_000_000, 1.0);

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
                fade_in_ticks: 0,
                fade_out_ticks: 0,
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
                fade_in_ticks: 0,
                fade_out_ticks: 0,
            })
            .unwrap();

        let mut output = [0.0_f32; 1];
        mixer.mix_into(&mut output, 1, 1, 0, 1.0);
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
                fade_in_ticks: 0,
                fade_out_ticks: 0,
            })
            .unwrap();
        let mut replaced = [0.0_f32; 1];
        mixer.mix_into(&mut replaced, 1, 1, 0, 1.0);
        assert_eq!(replaced, [0.6]);
        assert_eq!(mixer.clip_statuses().len(), 2);
    }
}
