//! Real-time safe lock-free SPSC audio ring buffer.
//!
//! Connects the background audio mixing pipeline (producer) to the CPAL
//! hardware callback thread (consumer) without any heap allocations,
//! blocking mutexes, or system calls in the audio callback.

use cpal::{FromSample, SizedSample};
use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

/// Default ring buffer capacity in frames at 48kHz (e.g. 500ms = 24,000 frames).
pub const DEFAULT_RING_BUFFER_FRAMES: usize = 24_000;

/// Producer handle for writing mixed PCM samples from the mixer thread.
pub struct AudioRingBufferProducer {
    producer: Producer<f32>,
    channels: u16,
    underrun_flag: Arc<AtomicBool>,
    frames_written: Arc<AtomicU64>,
}

/// Real-time safe consumer handle for reading PCM samples in the CPAL callback.
pub struct AudioRingBufferConsumer {
    consumer: Consumer<f32>,
    channels: u16,
    underrun_flag: Arc<AtomicBool>,
    frames_read: Arc<AtomicU64>,
    underrun_count: Arc<AtomicU64>,
}

/// Create a new pair of (Producer, Consumer) with the specified frame capacity and channel count.
pub fn create_audio_ring_buffer(
    frames_capacity: usize,
    channels: u16,
) -> (AudioRingBufferProducer, AudioRingBufferConsumer) {
    let channels = channels.max(1);
    let sample_capacity = frames_capacity
        .saturating_mul(usize::from(channels))
        .max(1024);
    let (producer, consumer) = RingBuffer::new(sample_capacity);

    let underrun_flag = Arc::new(AtomicBool::new(false));
    let frames_written = Arc::new(AtomicU64::new(0));
    let frames_read = Arc::new(AtomicU64::new(0));
    let underrun_count = Arc::new(AtomicU64::new(0));

    let prod = AudioRingBufferProducer {
        producer,
        channels,
        underrun_flag: underrun_flag.clone(),
        frames_written,
    };

    let cons = AudioRingBufferConsumer {
        consumer,
        channels,
        underrun_flag,
        frames_read,
        underrun_count,
    };

    (prod, cons)
}

impl AudioRingBufferProducer {
    /// Available capacity for new samples.
    #[inline]
    pub fn available_samples(&self) -> usize {
        self.producer.slots()
    }

    /// Available capacity in whole frames.
    #[inline]
    pub fn available_frames(&self) -> usize {
        self.producer.slots() / usize::from(self.channels)
    }

    /// Write interleaved f32 samples into the ring buffer.
    /// Returns the number of samples actually written.
    pub fn write_samples(&mut self, samples: &[f32]) -> usize {
        let available = self.producer.slots();
        let to_write = samples.len().min(available);
        if to_write == 0 {
            return 0;
        }

        let mut written = 0;
        if let Ok(mut chunk) = self.producer.write_chunk(to_write) {
            let (first, second) = chunk.as_mut_slices();
            let first_len = first.len().min(to_write);
            first[..first_len].copy_from_slice(&samples[..first_len]);
            written += first_len;

            let remaining = to_write - first_len;
            if remaining > 0 && !second.is_empty() {
                let second_len = second.len().min(remaining);
                second[..second_len].copy_from_slice(&samples[first_len..first_len + second_len]);
                written += second_len;
            }
            chunk.commit_all();
        }

        let frames = written / usize::from(self.channels);
        self.frames_written
            .fetch_add(frames as u64, Ordering::Release);
        written
    }

    /// Check if the consumer experienced an underrun since last check.
    #[inline]
    pub fn check_and_clear_underrun(&self) -> bool {
        self.underrun_flag.swap(false, Ordering::AcqRel)
    }
}

impl AudioRingBufferConsumer {
    /// Number of samples currently ready to read.
    #[inline]
    pub fn available_samples(&self) -> usize {
        self.consumer.slots()
    }

    /// Number of frames currently ready to read.
    #[inline]
    pub fn available_frames(&self) -> usize {
        self.consumer.slots() / usize::from(self.channels)
    }

    /// Real-time safe read into CPAL output buffer.
    ///
    /// - Performs zero heap allocations.
    /// - Acquires no locks or mutexes.
    /// - If the ring buffer contains fewer samples than requested (underrun),
    ///   the remaining output samples are filled with silence (`T::EQUILIBRIUM`).
    ///
    /// Returns `(frames_rendered, has_non_silent_audio)`.
    #[inline]
    pub fn render_into<T>(&mut self, output: &mut [T], master_gain: f32) -> (usize, bool)
    where
        T: SizedSample + FromSample<f32>,
    {
        let channels = usize::from(self.channels);
        let requested_samples = output.len();
        let requested_frames = requested_samples / channels;
        if requested_samples == 0 {
            return (0, false);
        }

        let available = self.consumer.slots();
        let samples_to_read = requested_samples.min(available);
        let mut has_audio = false;

        if samples_to_read > 0 {
            if let Ok(chunk) = self.consumer.read_chunk(samples_to_read) {
                let (first, second) = chunk.as_slices();
                let mut out_idx = 0;

                // Process first contiguous slice
                for &sample in first {
                    let scaled = (sample * master_gain).clamp(-1.0, 1.0);
                    if scaled.abs() > 0.00001 {
                        has_audio = true;
                    }
                    output[out_idx] = T::from_sample(scaled);
                    out_idx += 1;
                }

                // Process second slice (wrap-around)
                for &sample in second {
                    let scaled = (sample * master_gain).clamp(-1.0, 1.0);
                    if scaled.abs() > 0.00001 {
                        has_audio = true;
                    }
                    output[out_idx] = T::from_sample(scaled);
                    out_idx += 1;
                }

                chunk.commit_all();
            }
        }

        // Fill underrun tail with silence
        if samples_to_read < requested_samples {
            for sample in &mut output[samples_to_read..] {
                *sample = T::EQUILIBRIUM;
            }
            if samples_to_read == 0 {
                self.underrun_flag.store(true, Ordering::Release);
                self.underrun_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        let frames_read = samples_to_read / channels;
        self.frames_read
            .fetch_add(frames_read as u64, Ordering::Relaxed);
        (requested_frames, has_audio)
    }

    /// Flush all buffered samples (used during seek or stop).
    pub fn flush(&mut self) {
        let available = self.consumer.slots();
        if available > 0 {
            if let Ok(chunk) = self.consumer.read_chunk(available) {
                chunk.commit_all();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_writes_and_reads_correctly() {
        let (mut producer, mut consumer) = create_audio_ring_buffer(1024, 2);
        let input = [0.1f32, 0.2, 0.3, 0.4, 0.5, 0.6];
        let written = producer.write_samples(&input);
        assert_eq!(written, 6);
        assert_eq!(consumer.available_samples(), 6);
        assert_eq!(consumer.available_frames(), 3);

        let mut output = [0.0f32; 6];
        let (frames, has_audio) = consumer.render_into(&mut output, 1.0);
        assert_eq!(frames, 3);
        assert!(has_audio);
        assert_eq!(output, input);
    }

    #[test]
    fn ring_buffer_zero_fills_on_underrun() {
        let (_producer, mut consumer) = create_audio_ring_buffer(1024, 2);
        let mut output = [9.0f32; 4];
        let (frames, has_audio) = consumer.render_into(&mut output, 1.0);
        assert_eq!(frames, 2);
        assert!(!has_audio);
        assert_eq!(output, [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn ring_buffer_flush_clears_all_samples() {
        let (mut producer, mut consumer) = create_audio_ring_buffer(1024, 2);
        producer.write_samples(&[0.5, 0.5]);
        assert_eq!(consumer.available_samples(), 2);
        consumer.flush();
        assert_eq!(consumer.available_samples(), 0);
    }
}
