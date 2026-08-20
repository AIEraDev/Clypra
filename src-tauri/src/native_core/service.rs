use super::{
    FrameCache, FramePacket, FrameRequest, NativeCoreError, NativeFrameServiceStats,
    PerformanceSample,
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
}

impl NativeFrameService {
    pub fn new(max_bytes: usize) -> Result<Self, NativeCoreError> {
        Ok(Self {
            cache: FrameCache::new(max_bytes)?,
            total_requests: 0,
            cache_hits: 0,
            cache_misses: 0,
            last_sample: None,
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
        self.last_sample = Some(sample);
    }

    pub fn stats(&self) -> NativeFrameServiceStats {
        NativeFrameServiceStats {
            total_requests: self.total_requests,
            cache_hits: self.cache_hits,
            cache_misses: self.cache_misses,
            cached_entries: self.cache.len(),
            cached_bytes: self.cache.current_bytes(),
            last_sample: self.last_sample.clone(),
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
                canvas_width: 2,
                canvas_height: 2,
                clear_color: [0.0, 0.0, 0.0, 1.0],
                video_layers: vec![VideoLayerSnapshot {
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
                }],
                raster_layers: vec![],
            },
            output_width: 2,
            output_height: 2,
            quality: QualityTier::Full,
            color_policy: ColorPolicy::default(),
            render_graph_version: 1,
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
