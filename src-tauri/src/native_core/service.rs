use super::performance;
use super::performance::{
    now_ms, optional_stage_percentiles, percentile_ms, ModeStats, PreviewMode, ServedFrom,
};
use super::{
    FrameCache, FramePacket, FrameRequest, NativeCoreError, NativeFrameServiceStats,
    NativePerformanceSampleBatch, PerformanceSample,
};
use std::collections::VecDeque;

/// Identity of the most-recently delivered playback frame. Stored in
/// `NativeFrameService` so that `render_native_frame` can short-circuit
/// repeated RAF ticks that arrive while the video is at the same position.
#[derive(Debug, Clone, PartialEq)]
struct LastDeliveredPlaybackFrame {
    generation: u64,
    frame_index: u64,
    output_width: u32,
    output_height: u32,
    /// SHA-256 prefix of `request.cache_key()` (first 16 hex chars) used to
    /// detect layer-composition changes without storing the full key string.
    cache_key_prefix: String,
}

impl LastDeliveredPlaybackFrame {
    fn from_request(generation: u64, request: &FrameRequest, cache_key: &str) -> Self {
        Self {
            generation,
            frame_index: request.frame_time.frame_index,
            output_width: request.output_width,
            output_height: request.output_height,
            cache_key_prefix: cache_key.chars().take(16).collect(),
        }
    }
}

/// Reusable native frame service boundary.
///
/// Commands, playback, thumbnails, and export should ask this service for a
/// validated frame. Tauri is only the transport adapter; cache policy and
/// request identity stay in the platform-neutral core.
pub struct NativeFrameService {
    cache: FrameCache,
    total_requests: u64,
    cache_hits: u64,
    cache_misses: u64,
    last_sample: Option<PerformanceSample>,
    last_sample_sequence: u64,
    window_samples: VecDeque<(u64, u64, PerformanceSample)>,
    // Export history is independent from the five-second HUD window. This
    // lets a delayed telemetry poll catch up without making the statistics
    // window grow or turning the service into an unbounded event log.
    sample_history: VecDeque<(u64, u64, PerformanceSample)>,
    /// Last frame successfully delivered to the frontend during playback.
    /// Used by the UNCH optimization to short-circuit RAF ticks that arrive
    /// while the playback head has not advanced.
    last_delivered_playback: Option<LastDeliveredPlaybackFrame>,
}

impl NativeFrameService {
    pub fn new(max_bytes: usize) -> Result<Self, NativeCoreError> {
        Ok(Self {
            cache: FrameCache::new(max_bytes)?,
            total_requests: 0,
            cache_hits: 0,
            cache_misses: 0,
            last_sample: None,
            last_sample_sequence: 0,
            window_samples: VecDeque::new(),
            sample_history: VecDeque::new(),
            last_delivered_playback: None,
        })
    }

    pub fn get_cached(
        &mut self,
        request: &FrameRequest,
    ) -> Result<Option<FramePacket>, NativeCoreError> {
        self.total_requests = self.total_requests.saturating_add(1);
        let key = request.cache_key()?;
        let packet = self.cache.get(&key);
        if packet.is_some() {
            self.cache_hits = self.cache_hits.saturating_add(1);
        } else {
            self.cache_misses = self.cache_misses.saturating_add(1);
        }
        Ok(packet)
    }

    pub fn insert(
        &mut self,
        request: &FrameRequest,
        packet: FramePacket,
    ) -> Result<(), NativeCoreError> {
        let key = request.cache_key()?;
        if self.cache.insert(key, packet) {
            Ok(())
        } else {
            Err(NativeCoreError::Cache(
                "Frame packet exceeds the native frame cache budget".to_string(),
            ))
        }
    }

    pub fn cache_stats(&self) -> (usize, usize) {
        (self.cache.len(), self.cache.current_bytes())
    }

    /// Discard all cached frames and reset per-session counters. Called on
    /// project close so the next project starts with a clean frame cache and
    /// fresh performance telemetry. The cache budget (max_bytes) is unchanged.
    pub fn reset(&mut self) {
        self.cache.clear();
        self.total_requests = 0;
        self.cache_hits = 0;
        self.cache_misses = 0;
        self.last_sample = None;
        self.last_sample_sequence = 0;
        self.window_samples.clear();
        self.sample_history.clear();
        self.last_delivered_playback = None;
    }

    pub fn record_sample(&mut self, sample: PerformanceSample) {
        let now = now_ms();
        self.last_sample_sequence = self.last_sample_sequence.saturating_add(1);
        self.last_sample = Some(sample.clone());
        self.window_samples
            .push_back((now, self.last_sample_sequence, sample));
        let sample = self.last_sample.as_ref().expect("sample stored").clone();
        self.sample_history
            .push_back((now, self.last_sample_sequence, sample));
        while self.sample_history.len() > 4096 {
            self.sample_history.pop_front();
        }
        while self
            .window_samples
            .front()
            .is_some_and(|(timestamp, _, _)| now.saturating_sub(*timestamp) > 5_000)
        {
            self.window_samples.pop_front();
        }
    }

    /// Returns `true` when the current request is identical to the last frame
    /// successfully delivered to the frontend during playback, meaning the
    /// Rust side can return a lightweight `UNCH` sentinel instead of RGBA bytes.
    ///
    /// The check is deliberately conservative: it only fires in `"playback"`
    /// mode, only when a generation is present, and never on the very first
    /// frame after the service starts (i.e. when `last_delivered_playback` is
    /// `None`).
    pub fn should_skip_unchanged(
        &self,
        mode: Option<&str>,
        generation: Option<u64>,
        request: &FrameRequest,
        cache_key: &str,
    ) -> bool {
        // Only applies during live playback — never for seek, scrub, frame-step,
        // export, or thumbnail requests.
        if mode != Some("playback") {
            return false;
        }
        // A missing generation means the frontend has not started a play session
        // yet; never short-circuit in that case.
        let Some(gen) = generation else {
            return false;
        };
        // Short-circuit only when we have a prior delivery to compare against.
        let Some(last) = &self.last_delivered_playback else {
            return false;
        };
        last.generation == gen
            && last.frame_index == request.frame_time.frame_index
            && last.output_width == request.output_width
            && last.output_height == request.output_height
            && last.cache_key_prefix == cache_key.chars().take(16).collect::<String>()
    }

    /// Record that `request` was just successfully delivered to the frontend
    /// so that subsequent identical requests can be short-circuited.
    ///
    /// Must be called **after** the full render + cache-insert path succeeds,
    /// never on a cache hit or UNCH short-circuit.
    pub fn record_delivered_playback(
        &mut self,
        generation: u64,
        request: &FrameRequest,
        cache_key: &str,
    ) {
        self.last_delivered_playback =
            Some(LastDeliveredPlaybackFrame::from_request(generation, request, cache_key));
    }

    /// Clear the UNCH guard so the next playback frame is always delivered
    /// in full. Call whenever the play session ends, the project is reset,
    /// or the generation advances.
    pub fn clear_delivered_playback(&mut self) {
        self.last_delivered_playback = None;
    }

    /// Returns samples recorded after `after_sequence`, bounded to the latest
    /// `limit` entries. A bounded ring is intentional: telemetry must not be
    /// allowed to grow with a long-running editor session.
    pub fn samples_since(&self, after_sequence: u64, limit: usize) -> NativePerformanceSampleBatch {
        let limit = limit.clamp(1, 512);
        let oldest_sequence = self
            .sample_history
            .front()
            .map(|(_, sequence, _)| *sequence)
            .unwrap_or(self.last_sample_sequence.saturating_add(1));
        let latest_sequence = self.last_sample_sequence;
        let cursor_truncated = after_sequence.saturating_add(1) < oldest_sequence;
        let available: Vec<(u64, PerformanceSample)> = self
            .sample_history
            .iter()
            .filter(|(_, sequence, _)| *sequence > after_sequence)
            .map(|(_, sequence, sample)| (*sequence, sample.clone()))
            .collect();
        let truncated = cursor_truncated || available.len() > limit;
        let samples = available
            .into_iter()
            .rev()
            .take(limit)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        let first_sequence = samples
            .first()
            .map(|(sequence, _)| *sequence)
            .unwrap_or(after_sequence.saturating_add(1));
        let last_sequence = samples
            .last()
            .map(|(sequence, _)| *sequence)
            .unwrap_or(after_sequence);
        NativePerformanceSampleBatch {
            samples: samples.into_iter().map(|(_, sample)| sample).collect(),
            first_sequence,
            last_sequence,
            next_sequence: last_sequence,
            oldest_sequence,
            latest_sequence,
            truncated,
        }
    }

    pub fn stats(&self) -> NativeFrameServiceStats {
        let now = now_ms();
        let mut seek_samples: Vec<u32> = self
            .window_samples
            .iter()
            .filter(|(_, _, sample)| {
                matches!(
                    sample.mode,
                    Some(PreviewMode::Seek | PreviewMode::Scrub | PreviewMode::FrameStep)
                )
            })
            .map(|(_, _, sample)| sample.total_time_us)
            .collect();
        let requests = self.window_samples.len() as u64;
        let hits = self
            .window_samples
            .iter()
            .filter(|(_, _, sample)| sample.cache_hit)
            .count() as u64;
        let cache_samples = self
            .window_samples
            .iter()
            .filter(|(_, _, sample)| {
                !matches!(
                    sample.strategy.as_deref(),
                    Some("SURFACE_WARM" | "SURFACE_COLD")
                )
            })
            .count() as u64;
        let mode_stats = [
            PreviewMode::Playback,
            PreviewMode::PlaybackLookahead,
            PreviewMode::Seek,
            PreviewMode::Scrub,
            PreviewMode::FrameStep,
            PreviewMode::Prefetch,
        ]
        .into_iter()
        .map(|mode| {
            let window_entries: Vec<(u64, PerformanceSample)> = self
                .window_samples
                .iter()
                .filter(|(_, _, sample)| sample.mode == Some(mode))
                .map(|(ts, _, sample)| (*ts, sample.clone()))
                .collect();
            // Fall back to recent sample history when window has fewer than 30 samples,
            // ensuring statistical validity when presentation rate is low.
            let (entries, fell_back) = if window_entries.len() < 30 {
                let history_entries: Vec<(u64, PerformanceSample)> = self
                    .sample_history
                    .iter()
                    .rev()
                    .filter(|(_, _, sample)| sample.mode == Some(mode))
                    .take(256)
                    .map(|(ts, _, sample)| (*ts, sample.clone()))
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                if history_entries.len() > window_entries.len() {
                    (history_entries, true)
                } else {
                    (window_entries, false)
                }
            } else {
                (window_entries, false)
            };

            let window_source = if fell_back { "history" } else { "window" }.to_string();

            let sample_span_ms = if entries.len() >= 2 {
                let first_ts = entries.first().map(|(ts, _)| *ts).unwrap_or(0);
                let last_ts = entries.last().map(|(ts, _)| *ts).unwrap_or(0);
                Some(last_ts.saturating_sub(first_ts))
            } else if !entries.is_empty() {
                Some(0)
            } else {
                None
            };

            let mut unique_frames_delivered = 0usize;
            let mut repeated_frames_delivered = 0usize;
            let mut last_delivered_key: Option<(Option<u64>, u64)> = None;

            let mut served_from_decoded_count = 0usize;
            let mut served_from_ready_cache_count = 0usize;
            let mut served_from_reused_current_count = 0usize;
            let mut skipped_unchanged_count = 0usize;
            let mut lookahead_downloads_skipped_count = 0usize;

            for (_, sample) in &entries {
                match sample.served_from {
                    Some(ServedFrom::DecodedInRequest) => served_from_decoded_count += 1,
                    Some(ServedFrom::ReadyCache) => served_from_ready_cache_count += 1,
                    Some(ServedFrom::ReusedCurrent) => served_from_reused_current_count += 1,
                    Some(ServedFrom::UnchangedSkipped) => skipped_unchanged_count += 1,
                    None => {}
                }
                if sample.strategy.as_deref() == Some("PRODUCER_PRIME_SKIP_DL") {
                    lookahead_downloads_skipped_count += 1;
                }
                if sample.dropped || sample.cancelled {
                    continue;
                }
                let current_key = (sample.generation, sample.frame_index);
                let is_repeated = matches!(
                    sample.served_from,
                    Some(ServedFrom::ReadyCache)
                        | Some(ServedFrom::ReusedCurrent)
                        | Some(ServedFrom::UnchangedSkipped)
                ) || last_delivered_key == Some(current_key);
                if is_repeated {
                    repeated_frames_delivered += 1;
                } else {
                    unique_frames_delivered += 1;
                }
                last_delivered_key = Some(current_key);
            }

            let delivered_unique_fps = match sample_span_ms {
                Some(span_ms) if span_ms > 0 => {
                    Some((unique_frames_delivered as f64 * 1000.0) / (span_ms as f64))
                }
                _ => None,
            };

            let samples: Vec<PerformanceSample> =
                entries.into_iter().map(|(_, sample)| sample).collect();

            let decoded_samples: Vec<PerformanceSample> = samples
                .iter()
                .filter(|s| {
                    // Exclude requests that were satisfied from any cache path without
                    // new FFmpeg decode work; their decode_us reflects 0 or noise.
                    s.served_from != Some(ServedFrom::ReadyCache)
                        && s.served_from != Some(ServedFrom::ReusedCurrent)
                        && s.served_from != Some(ServedFrom::UnchangedSkipped)
                        && s.decode_us.is_some()
                        && s.decode_us != Some(0)
                })
                .cloned()
                .collect();

            ModeStats {
                mode,
                decode: optional_stage_percentiles(&decoded_samples, |sample| sample.decode_us),
                packet_decode: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.decode_us.map(|decode| {
                        decode
                            .saturating_sub(sample.hardware_frame_download_us.unwrap_or(0))
                            .saturating_sub(sample.scale_colorspace_us.unwrap_or(0))
                    })
                }),
                conversion_upload: optional_stage_percentiles(&samples, |sample| {
                    sample.conversion_upload_us
                }),
                compose: optional_stage_percentiles(&samples, |sample| sample.compose_us),
                readback: optional_stage_percentiles(&samples, |sample| sample.readback_us),
                map_wait: optional_stage_percentiles(&samples, |sample| sample.map_wait_us),
                present: optional_stage_percentiles(&samples, |sample| sample.present_us),
                scheduler_wait: optional_stage_percentiles(&samples, |sample| {
                    sample.scheduler_wait_us
                }),
                lookahead_wait: optional_stage_percentiles(&samples, |sample| {
                    sample.lookahead_wait_us
                }),
                cold_start_init: optional_stage_percentiles(&samples, |sample| {
                    sample.cold_start_init_us
                }),
                queue_residency: optional_stage_percentiles(&samples, |sample| {
                    sample.queue_residency_us
                }),
                ipc_wait: optional_stage_percentiles(&samples, |sample| sample.ipc_wait_us),
                decoder_mutex_wait: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.decoder_mutex_wait_us
                }),
                demux_wait: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.demux_wait_us
                }),
                decoder_seek_count: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.decoder_seek_count.map(u64::from)
                }),
                decoder_frames_decoded: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.decoder_frames_decoded.map(u64::from)
                }),
                hardware_frame_download: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.hardware_frame_download_us
                }),
                scale_colorspace: optional_stage_percentiles(&decoded_samples, |sample| {
                    sample.scale_colorspace_us
                }),
                gpu_queue_wait: optional_stage_percentiles(&samples, |sample| {
                    sample.gpu_queue_wait_us
                }),
                surface_acquire: optional_stage_percentiles(&samples, |sample| {
                    sample.surface_acquire_us
                }),
                submit_present: optional_stage_percentiles(&samples, |sample| {
                    sample.submit_present_us
                }),
                stage_overlap: optional_stage_percentiles(&samples, |sample| {
                    sample.stage_overlap_us
                }),
                unaccounted: optional_stage_percentiles(&samples, |sample| {
                    sample.unaccounted_us
                }),
                cache_lock_wait: optional_stage_percentiles(&samples, |sample| {
                    sample.cache_lock_wait_us
                }),
                cache_insert: optional_stage_percentiles(&samples, |sample| {
                    sample.cache_insert_us
                }),
                unique_frames_delivered,
                repeated_frames_delivered,
                delivered_unique_fps,
                served_from_decoded_count,
                served_from_ready_cache_count,
                served_from_reused_current_count,
                skipped_unchanged_count,
                lookahead_downloads_skipped_count,
                downloads_wasted_count: 0,
                window_source,
                sample_span_ms,
                dropped_count: samples.iter().filter(|sample| sample.dropped).count(),
                stale_count: samples.iter().filter(|sample| sample.stale).count(),
            }
        })
        .collect();
        NativeFrameServiceStats {
            total_requests: self.total_requests,
            cache_hits: self.cache_hits,
            cache_misses: self.cache_misses,
            cached_entries: self.cache.len(),
            cached_bytes: self.cache.current_bytes(),
            cache_budget_bytes: self.cache.max_bytes(),
            cache_eviction_count: self.cache.eviction_count(),
            cache_rejected_entry_count: self.cache.rejected_entry_count(),
            last_sample: self.last_sample.clone(),
            last_sample_sequence: self.last_sample_sequence,
            window_started_at_ms: self
                .window_samples
                .front()
                .map(|(timestamp, _, _)| *timestamp)
                .unwrap_or(now),
            window_request_count: requests,
            window_dropped_frames: self
                .window_samples
                .iter()
                .filter(|(_, _, sample)| sample.dropped)
                .count() as u64,
            window_stale_frames: self
                .window_samples
                .iter()
                .filter(|(_, _, sample)| sample.stale)
                .count() as u64,
            window_cancelled_frames: self
                .window_samples
                .iter()
                .filter(|(_, _, sample)| sample.cancelled)
                .count() as u64,
            window_seek_p50_ms: percentile_ms(&mut seek_samples, 0.50),
            window_seek_p95_ms: percentile_ms(&mut seek_samples, 0.95),
            window_seek_p99_ms: percentile_ms(&mut seek_samples, 0.99),
            window_cache_hit_rate: if cache_samples == 0 {
                0.0
            } else {
                hits as f64 / cache_samples as f64
            },
            mode_stats,
            text_layer_cache_hits: performance::text_layer_cache_hits(),
            glyph_cache_hits: performance::glyph_cache_hits(),
            glyph_cache_misses: performance::glyph_cache_misses(),
            lookahead_trigger_count: performance::lookahead_trigger_count(),
            lookahead_trigger_dropped: performance::lookahead_trigger_dropped(),
            producer_idle_total_ms: performance::producer_idle_total_ms(),
            producer_ahead_of_clock_ms: performance::producer_ahead_of_clock_ms(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_core::{
        ColorPolicy, FrameTime, PixelFormat, ProjectSnapshot, QualityTier, VideoLayerSnapshot,
        NATIVE_CORE_CONTRACT_VERSION,
    };

    fn request() -> FrameRequest {
        FrameRequest {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "request-1".to_string(),
            frame_time: FrameTime::new(0, 0, 1_000_000).unwrap(),
            project: ProjectSnapshot {
                schema_version: 1,
                project_revision: "project:1".to_string(),
                frame_rate: 30,
                canvas_width: 2,
                canvas_height: 2,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                transition: None,
                video_layers: vec![VideoLayerSnapshot {
                    layer_id: "layer-1".to_string(),
                    asset_id: "asset-1".to_string(),
                    video_path: "/tmp/clip.mp4".to_string(),
                    source_time: FrameTime::new(0, 0, 1_000_000).unwrap(),
                    x: 0.0,
                    y: 0.0,
                    width: 2.0,
                    height: 2.0,
                    rotation: 0.0,
                    opacity: 1.0,
                    z_index: 0,
                    blend_mode: "normal".to_string(),
                    color_grade: None,
                    body_effect: None,
                }],
                raster_layers: vec![],
                text_layers: vec![],
            },
            output_width: 2,
            output_height: 2,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
            generation: None,
            mode: None,
            scrub_velocity_px_per_second: None,
            requested_at_ms: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
        }
    }

    fn sample(frame_index: u64) -> PerformanceSample {
        PerformanceSample {
            request_id: format!("request-{frame_index}"),
            frame_index,
            decode_time_us: 1,
            compose_time_us: 1,
            readback_time_us: 0,
            total_time_us: 2,
            bytes_transferred: 0,
            cache_hit: true,
            generation: Some(1),
            mode: Some(PreviewMode::Playback),
            quality: None,
            strategy: None,
            transfer_path: None,
            cancelled: false,
            stale: false,
            dropped: false,
            drop_reason: None,
            seek_time_us: 0,
            conversion_time_us: 0,
            upload_time_us: 0,
            present_time_us: 0,
            decode_us: Some(1),
            conversion_upload_us: None,
            compose_us: Some(1),
            readback_us: None,
            map_wait_us: None,
            timestamp_query_available: None,
            present_us: Some(0),
            scheduler_wait_us: None,
            lookahead_wait_us: None,
            cold_start_init_us: None,
            queue_residency_us: None,
            ipc_wait_us: None,
            decoder_mutex_wait_us: None,
            actor_wait_us: None,
            gpu_queue_wait_us: None,
            surface_acquire_us: None,
            submit_present_us: Some(0),
            capability_policy: None,
            capability_probe_us: None,
            demux_wait_us: None,
            container_format: None,
            is_hardware_accelerated: None,
            decoder_seek_count: None,
            decoder_frames_decoded: None,
            hardware_frame_download_us: None,
            scale_colorspace_us: None,
            source_width: None,
            source_height: None,
            source_bits_per_raw_sample: None,
            source_frame_rate_milli: None,
            unaccounted_us: None,
            codec_name: None,
            hardware_frames_downloaded: None,
            stage_overlap_us: None,
            served_from: None,
            cache_lock_wait_us: None,
            cache_insert_us: None,
            hw_device_type: None,
        }
    }

    #[test]
    fn service_uses_request_identity_for_cache() {
        let mut service = NativeFrameService::new(1024).unwrap();
        let packet = FramePacket {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: "request-1".to_string(),
            frame_time: request().frame_time,
            width: 2,
            height: 2,
            stride: 8,
            format: PixelFormat::Rgba8Srgb,
            data: vec![0; 16],
        };
        service.insert(&request(), packet).unwrap();
        assert!(service.get_cached(&request()).unwrap().is_some());
    }

    #[test]
    fn sample_cursor_returns_each_sample_once_and_is_bounded() {
        let mut service = NativeFrameService::new(1024).unwrap();
        service.record_sample(sample(1));
        service.record_sample(sample(2));

        let first = service.samples_since(0, 256);
        assert_eq!(first.samples.len(), 2);
        assert_eq!(first.first_sequence, 1);
        assert_eq!(first.last_sequence, 2);
        assert_eq!(first.next_sequence, 2);

        let second = service.samples_since(first.next_sequence, 256);
        assert!(second.samples.is_empty());
        assert_eq!(second.next_sequence, 2);
    }

    #[test]
    fn mode_stats_packet_decode_and_stage_overlap() {
        let mut service = NativeFrameService::new(1024).unwrap();
        let mut test_sample = sample(1);
        test_sample.decode_us = Some(260_000);
        test_sample.hardware_frame_download_us = Some(134_000);
        test_sample.scale_colorspace_us = Some(6_000);
        test_sample.total_time_us = 200_000;
        test_sample.stage_overlap_us = Some(60_000);
        test_sample.served_from = Some(ServedFrom::DecodedInRequest);
        service.record_sample(test_sample);

        let stats = service.stats();
        let playback_stats = stats
            .mode_stats
            .iter()
            .find(|m| m.mode == PreviewMode::Playback)
            .expect("playback mode stats present");

        assert_eq!(playback_stats.decode.p50, Some(260_000));
        assert_eq!(playback_stats.hardware_frame_download.p50, Some(134_000));
        assert_eq!(playback_stats.scale_colorspace.p50, Some(6_000));
        assert_eq!(playback_stats.packet_decode.p50, Some(120_000));
        assert_eq!(playback_stats.stage_overlap.p50, Some(60_000));
        assert_eq!(playback_stats.unique_frames_delivered, 1);
        assert_eq!(playback_stats.repeated_frames_delivered, 0);
    }

    #[test]
    fn mode_stats_cache_hits_do_not_dilute_decode_percentiles() {
        let mut service = NativeFrameService::new(1024).unwrap();
        // Record 1 freshly decoded frame
        let mut decoded = sample(1);
        decoded.decode_us = Some(100_000);
        decoded.hardware_frame_download_us = Some(20_000);
        decoded.scale_colorspace_us = Some(5_000);
        decoded.served_from = Some(ServedFrom::DecodedInRequest);
        service.record_sample(decoded);

        // Record 5 cached frames with 0µs decode time
        for i in 2..=6 {
            let mut cached = sample(i);
            cached.decode_us = Some(0);
            cached.hardware_frame_download_us = None;
            cached.scale_colorspace_us = None;
            cached.served_from = Some(ServedFrom::ReadyCache);
            service.record_sample(cached);
        }

        let stats = service.stats();
        let playback_stats = stats
            .mode_stats
            .iter()
            .find(|m| m.mode == PreviewMode::Playback)
            .expect("playback mode stats present");

        // Decode percentiles must NOT be diluted to 0 by the 5 cache hits
        assert_eq!(playback_stats.decode.sample_count, 1);
        assert_eq!(playback_stats.decode.p50, Some(100_000));
        assert_eq!(playback_stats.packet_decode.sample_count, 1);
        assert_eq!(playback_stats.packet_decode.p50, Some(75_000));

        // Delivery metrics track total unique vs repeated frames
        assert_eq!(playback_stats.unique_frames_delivered, 1);
        assert_eq!(playback_stats.repeated_frames_delivered, 5);
    }

    #[test]
    fn mode_stats_breakdown_and_cache_wait_aggregation() {
        let mut service = NativeFrameService::new(1024).unwrap();

        let mut s1 = sample(1);
        s1.seek_time_us = 15_000;
        s1.decode_time_us = 45_000;
        s1.served_from = Some(ServedFrom::DecodedInRequest);
        s1.cache_lock_wait_us = Some(1_200);
        s1.cache_insert_us = Some(450);
        service.record_sample(s1);

        let mut s2 = sample(2);
        s2.seek_time_us = 0;
        s2.decode_time_us = 0;
        s2.served_from = Some(ServedFrom::ReadyCache);
        s2.cache_lock_wait_us = Some(800);
        s2.cache_insert_us = None;
        service.record_sample(s2);

        let mut s3 = sample(3);
        s3.seek_time_us = 0;
        s3.decode_time_us = 0;
        s3.served_from = Some(ServedFrom::ReusedCurrent);
        service.record_sample(s3);

        let stats = service.stats();
        let playback = stats
            .mode_stats
            .iter()
            .find(|m| m.mode == PreviewMode::Playback)
            .expect("playback mode stats present");

        assert_eq!(playback.served_from_decoded_count, 1);
        assert_eq!(playback.served_from_ready_cache_count, 1);
        assert_eq!(playback.served_from_reused_current_count, 1);
        assert_eq!(playback.cache_lock_wait.sample_count, 2);
        assert_eq!(playback.cache_insert.sample_count, 1);
        assert_eq!(playback.cache_insert.p50, Some(450));

        // Verify seek_time_us is recorded independently and not aliased to decode_time_us
        let last_sample = stats.last_sample.unwrap();
        assert_eq!(last_sample.frame_index, 3);
    }

    #[test]
    fn unch_guard_invalidation_rules() {
        let mut service = NativeFrameService::new(1024).unwrap();
        let mut req = request();
        req.frame_time.frame_index = 42;
        req.output_width = 1920;
        req.output_height = 1080;
        let key = req.cache_key().unwrap();

        // 1. Initial state: no prior delivery, cannot skip
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));

        // Record successful delivery
        service.record_delivered_playback(1, &req, &key);

        // 2. Exact match in playback mode -> skip allowed
        assert!(service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));

        // 3. Mode not playback (seek, scrub, frame-step, None) -> skip rejected
        assert!(!service.should_skip_unchanged(Some("seek"), Some(1), &req, &key));
        assert!(!service.should_skip_unchanged(Some("scrub"), Some(1), &req, &key));
        assert!(!service.should_skip_unchanged(Some("frameStep"), Some(1), &req, &key));
        assert!(!service.should_skip_unchanged(None, Some(1), &req, &key));

        // 4. Generation mismatch or missing -> skip rejected
        assert!(!service.should_skip_unchanged(Some("playback"), Some(2), &req, &key));
        assert!(!service.should_skip_unchanged(Some("playback"), None, &req, &key));

        // 5. Frame index mismatch -> skip rejected
        let mut diff_frame = req.clone();
        diff_frame.frame_time.frame_index = 43;
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &diff_frame, &key));

        // 6. Dimension mismatch -> skip rejected
        let mut diff_width = req.clone();
        diff_width.output_width = 1280;
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &diff_width, &key));

        let mut diff_height = req.clone();
        diff_height.output_height = 720;
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &diff_height, &key));

        // 7. Cache key mismatch (e.g. layers or visual styling changed) -> skip rejected
        assert!(!service.should_skip_unchanged(
            Some("playback"),
            Some(1),
            &req,
            "different-cache-key-hash"
        ));

        // 8. Explicit clear -> skip rejected
        service.clear_delivered_playback();
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));

        // 9. Reset -> skip rejected
        service.record_delivered_playback(1, &req, &key);
        assert!(service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));
        service.reset();
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));
    }

    #[test]
    fn test_commit_d_generation_bump_and_canvas_clear_force_full_frame() {
        let mut service = NativeFrameService::new(1024).unwrap();
        let mut req = request();
        req.frame_time.frame_index = 42;
        req.output_width = 1920;
        req.output_height = 1080;
        let key = req.cache_key().unwrap();

        // 1. Deliver frame in generation 1
        service.record_delivered_playback(1, &req, &key);
        assert!(service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));

        // 2. Generation bump (gen 1 -> 2) MUST reject UNCH and deliver full frame
        assert!(!service.should_skip_unchanged(Some("playback"), Some(2), &req, &key));

        // 3. Canvas resize (1920x1080 -> 1280x720) MUST reject UNCH
        let mut resized = req.clone();
        resized.output_width = 1280;
        resized.output_height = 720;
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &resized, &key));

        // 4. Canvas clear / invalidate MUST reject UNCH
        service.clear_delivered_playback();
        assert!(!service.should_skip_unchanged(Some("playback"), Some(1), &req, &key));
    }

    #[test]
    fn unch_skipped_telemetry_aggregation() {
        let mut service = NativeFrameService::new(1024).unwrap();

        // Frame 1: Decoded in request
        let mut s1 = sample(1);
        s1.decode_us = Some(50_000);
        s1.served_from = Some(ServedFrom::DecodedInRequest);
        service.record_sample(s1);

        // Frame 1 duplicate: UnchangedSkipped (zero decode work)
        let mut s1_unch = sample(1);
        s1_unch.decode_us = None;
        s1_unch.bytes_transferred = 12;
        s1_unch.served_from = Some(ServedFrom::UnchangedSkipped);
        service.record_sample(s1_unch);

        // Frame 2: Decoded in request
        let mut s2 = sample(2);
        s2.decode_us = Some(40_000);
        s2.served_from = Some(ServedFrom::DecodedInRequest);
        service.record_sample(s2);

        let stats = service.stats();
        let playback = stats
            .mode_stats
            .iter()
            .find(|m| m.mode == PreviewMode::Playback)
            .expect("playback mode stats present");

        assert_eq!(playback.served_from_decoded_count, 2);
        assert_eq!(playback.skipped_unchanged_count, 1);
        assert_eq!(playback.unique_frames_delivered, 2);
        assert_eq!(playback.repeated_frames_delivered, 1);

        // Crucial: UnchangedSkipped must not pollute decode timing percentiles
        assert_eq!(playback.decode.sample_count, 2);
    }

    #[test]
    fn test_text_cache_telemetry_is_not_literal() {
        let service = NativeFrameService::new(1024).unwrap();
        let initial_text_hits = performance::text_layer_cache_hits();
        let initial_glyph_hits = performance::glyph_cache_hits();
        let initial_glyph_misses = performance::glyph_cache_misses();

        performance::record_text_layer_cache_hit();
        performance::record_glyph_cache_hit();
        performance::record_glyph_cache_miss();

        let stats = service.stats();
        assert_eq!(stats.text_layer_cache_hits, initial_text_hits + 1);
        assert_eq!(stats.glyph_cache_hits, initial_glyph_hits + 1);
        assert_eq!(stats.glyph_cache_misses, initial_glyph_misses + 1);
    }
}
