use super::{
    FrameCache, FramePacket, FrameRequest, NativeCoreError, NativeFrameServiceStats,
    PerformanceSample,
};
use std::collections::VecDeque;
use super::performance::{
    now_ms, optional_stage_percentiles, percentile_ms, ModeStats, PreviewMode,
};

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
    window_samples: VecDeque<(u64, PerformanceSample)>,
    last_window_log_ms: u64,
}

impl NativeFrameService {
    pub fn new(max_bytes: usize) -> Result<Self, NativeCoreError> {
        Ok(Self {
            cache: FrameCache::new(max_bytes)?,
            total_requests: 0,
            cache_hits: 0,
            cache_misses: 0,
            last_sample: None,
            window_samples: VecDeque::new(),
            last_window_log_ms: 0,
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

    pub fn record_sample(&mut self, sample: PerformanceSample) {
        let now = now_ms();
        self.last_sample = Some(sample);
        self.window_samples.push_back((now, self.last_sample.clone().expect("sample stored")));
        while self.window_samples.front().is_some_and(|(timestamp, _)| now.saturating_sub(*timestamp) > 5_000) {
            self.window_samples.pop_front();
        }
        if now.saturating_sub(self.last_window_log_ms) >= 5_000 {
            self.last_window_log_ms = now;
            let request_count = self.window_samples.len();
            let cache_hits = self.window_samples.iter().filter(|(_, item)| item.cache_hit).count();
            let dropped = self.window_samples.iter().filter(|(_, item)| item.dropped).count();
            let stale = self.window_samples.iter().filter(|(_, item)| item.stale).count();
            let cancelled = self.window_samples.iter().filter(|(_, item)| item.cancelled).count();
            eprintln!(
                "[playback:5s] {{\"requests\":{},\"cacheHitRate\":{:.3},\"dropped\":{},\"stale\":{},\"cancelled\":{}}}",
                request_count,
                if request_count == 0 { 0.0 } else { cache_hits as f64 / request_count as f64 },
                dropped,
                stale,
                cancelled,
            );
        }
    }

    pub fn stats(&self) -> NativeFrameServiceStats {
        let now = now_ms();
        let mut seek_samples: Vec<u32> = self
            .window_samples
            .iter()
            .filter(|(_, sample)| {
                matches!(
                    sample.mode,
                    Some(PreviewMode::Seek | PreviewMode::Scrub | PreviewMode::FrameStep)
                )
            })
            .map(|(_, sample)| sample.total_time_us)
            .collect();
        let requests = self.window_samples.len() as u64;
        let hits = self.window_samples.iter().filter(|(_, sample)| sample.cache_hit).count() as u64;
        let cache_samples = self
            .window_samples
            .iter()
            .filter(|(_, sample)| {
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
            let samples: Vec<PerformanceSample> = self
                .window_samples
                .iter()
                .filter(|(_, sample)| sample.mode == Some(mode))
                .map(|(_, sample)| sample.clone())
                .collect();
            ModeStats {
                mode,
                decode: optional_stage_percentiles(&samples, |sample| sample.decode_us),
                conversion_upload: optional_stage_percentiles(&samples, |sample| sample.conversion_upload_us),
                compose: optional_stage_percentiles(&samples, |sample| sample.compose_us),
                readback: optional_stage_percentiles(&samples, |sample| sample.readback_us),
                present: optional_stage_percentiles(&samples, |sample| sample.present_us),
                scheduler_wait: optional_stage_percentiles(&samples, |sample| sample.scheduler_wait_us),
                ipc_wait: optional_stage_percentiles(&samples, |sample| sample.ipc_wait_us),
                decoder_mutex_wait: optional_stage_percentiles(&samples, |sample| sample.decoder_mutex_wait_us),
                gpu_queue_wait: optional_stage_percentiles(&samples, |sample| sample.gpu_queue_wait_us),
                surface_acquire: optional_stage_percentiles(&samples, |sample| sample.surface_acquire_us),
                submit_present: optional_stage_percentiles(&samples, |sample| sample.submit_present_us),
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
            last_sample: self.last_sample.clone(),
            window_started_at_ms: self.window_samples.front().map(|(timestamp, _)| *timestamp).unwrap_or(now),
            window_request_count: requests,
            window_dropped_frames: self.window_samples.iter().filter(|(_, sample)| sample.dropped).count() as u64,
            window_stale_frames: self.window_samples.iter().filter(|(_, sample)| sample.stale).count() as u64,
            window_cancelled_frames: self.window_samples.iter().filter(|(_, sample)| sample.cancelled).count() as u64,
            window_seek_p50_ms: percentile_ms(&mut seek_samples, 0.50),
            window_seek_p95_ms: percentile_ms(&mut seek_samples, 0.95),
            window_seek_p99_ms: percentile_ms(&mut seek_samples, 0.99),
            window_cache_hit_rate: if cache_samples == 0 { 0.0 } else { hits as f64 / cache_samples as f64 },
            mode_stats,
            text_layer_cache_hits: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_core::{
        ColorPolicy, FrameTime, PixelFormat, ProjectSnapshot, QualityTier, VideoLayerSnapshot,
    };

    fn request() -> FrameRequest {
        FrameRequest {
            contract_version: 1,
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
        }
    }

    #[test]
    fn service_uses_request_identity_for_cache() {
        let mut service = NativeFrameService::new(1024).unwrap();
        let packet = FramePacket {
            contract_version: 1,
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
}
