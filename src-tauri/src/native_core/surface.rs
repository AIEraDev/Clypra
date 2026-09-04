use super::contracts::NATIVE_CORE_CONTRACT_VERSION;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSurfaceGeometry {
    pub x_physical: i32,
    pub y_physical: i32,
    pub width_physical: u32,
    pub height_physical: u32,
    pub device_pixel_ratio: f32,
}

impl NativeSurfaceGeometry {
    pub fn validate(self) -> Result<(), String> {
        if self.width_physical == 0 || self.height_physical == 0 {
            return Err("Native surface dimensions must be non-zero".to_string());
        }
        if !self.device_pixel_ratio.is_finite() || self.device_pixel_ratio <= 0.0 {
            return Err("Native surface device pixel ratio must be positive".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeSurfaceStatus {
    Ready,
    Resizing,
    DeviceLost,
    Recovering,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeGpuRuntimeState {
    Initializing,
    Ready,
    Failed,
}

/// Process-wide native GPU availability. This is deliberately separate from
/// surface state: a GPU can be available before a window surface exists, and
/// a surface can fail or be recreated without rebuilding the whole media core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGpuRuntimeStatus {
    pub contract_version: u32,
    pub state: NativeGpuRuntimeState,
    pub available: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
    pub device_type: Option<String>,
    pub surface_available: bool,
    pub failure_reason: Option<String>,
}

impl NativeGpuRuntimeStatus {
    pub fn initializing() -> Self {
        Self {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            state: NativeGpuRuntimeState::Initializing,
            available: false,
            adapter_name: None,
            backend: None,
            device_type: None,
            surface_available: false,
            failure_reason: None,
        }
    }

    pub fn ready(
        adapter_name: String,
        backend: String,
        device_type: String,
        surface_available: bool,
    ) -> Self {
        Self {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            state: NativeGpuRuntimeState::Ready,
            available: true,
            adapter_name: Some(adapter_name),
            backend: Some(backend),
            device_type: Some(device_type),
            surface_available,
            failure_reason: None,
        }
    }

    pub fn failed(reason: String, surface_available: bool) -> Self {
        Self {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            state: NativeGpuRuntimeState::Failed,
            available: false,
            adapter_name: None,
            backend: None,
            device_type: None,
            surface_available,
            failure_reason: Some(reason),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSurfaceProbe {
    pub contract_version: u32,
    pub status: NativeSurfaceStatus,
    pub geometry: NativeSurfaceGeometry,
    pub window_width_physical: u32,
    pub window_height_physical: u32,
    pub adapter_name: String,
    pub backend: String,
    pub format: String,
    pub present_mode: String,
    pub alpha_mode: String,
    pub supported_formats: Vec<String>,
}

/// Acknowledgement returned after a native frame has been submitted directly
/// to the configured surface. The request identity remains visible at the
/// boundary so callers can discard a late acknowledgement after a seek.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSurfacePresentation {
    pub contract_version: u32,
    pub request_id: String,
    pub frame_index: u64,
    pub presented: bool,
    /// True when the frame was intentionally discarded because it was stale
    /// relative to the native audio clock or superseded by a newer request.
    pub dropped: bool,
    /// `stale`, `cancelled`, or `late-for-audio` when a frame is discarded.
    #[serde(default)]
    pub drop_reason: Option<String>,
    /// Native audio position in the audio clock's canonical 1 MHz ticks.
    pub audio_position_ticks: u64,
    /// Audio position minus frame position in canonical 1 MHz ticks.
    pub frame_age_ticks: i64,
    pub surface: NativeSurfaceProbe,
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub cancelled: bool,
    /// Optional stage timings for playback diagnosis. These are attached only
    /// to successful surface submissions so the acknowledgement stays small on
    /// the common path while exposing which native stage misses the frame
    /// budget when a request is slow.
    #[serde(default)]
    pub timings: Option<NativeSurfacePresentationTimings>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSurfacePresentationTimings {
    pub total_us: u64,
    pub decode_us: u32,
    pub decoder_mutex_wait_us: u64,
    pub conversion_upload_us: u64,
    pub compose_us: u64,
    pub surface_acquire_us: u64,
    pub submit_present_us: u64,
    pub queue_hit: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_gpu_status_is_actionable() {
        let status = NativeGpuRuntimeStatus::failed("No compatible adapter".to_string(), true);
        assert_eq!(status.state, NativeGpuRuntimeState::Failed);
        assert!(!status.available);
        assert!(status.surface_available);
        assert_eq!(
            status.failure_reason.as_deref(),
            Some("No compatible adapter")
        );
    }

    #[test]
    fn rejects_invalid_dpr() {
        let geometry = NativeSurfaceGeometry {
            x_physical: 0,
            y_physical: 0,
            width_physical: 100,
            height_physical: 100,
            device_pixel_ratio: 0.0,
        };
        assert!(geometry.validate().is_err());
    }
}
