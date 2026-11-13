use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// GpuTimestampCapabilities
// ---------------------------------------------------------------------------

/// GPU timestamp query capability negotiation result.
///
/// Recorded once at adapter/device initialization and cached for the session.
///
/// # Two-level distinction
///
/// `adapter_supports_*` reflects what the physical adapter exposes via
/// `adapter.features()`, **before** the device is created.
///
/// `device_enabled_*` reflects what was actually requested and granted by
/// `device.features()`, **after** `request_device`.  A feature can be
/// adapter-supported but not device-enabled (e.g. if `required_features`
/// didn't include it).
///
/// Both levels must be recorded because a mismatch (supported but not enabled)
/// indicates an initialization bug, not a hardware limitation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuTimestampCapabilities {
    // ── Adapter-level (physical hardware support) ─────────────────────────────
    /// Adapter supports `TIMESTAMP_QUERY` (render-pass timing via
    /// `RenderPassDescriptor::timestamp_writes`).
    pub adapter_supports_timestamp_query: bool,
    /// Adapter supports `TIMESTAMP_QUERY_INSIDE_ENCODERS`
    /// (`CommandEncoder::write_timestamp`).
    pub adapter_supports_timestamp_inside_encoders: bool,
    /// Adapter supports `TIMESTAMP_QUERY_INSIDE_PASSES`
    /// (`RenderPass::write_timestamp`).
    pub adapter_supports_timestamp_inside_passes: bool,

    // ── Device-level (what was actually granted at device creation) ───────────
    /// Device has `TIMESTAMP_QUERY` enabled.
    pub device_enabled_timestamp_query: bool,
    /// Device has `TIMESTAMP_QUERY_INSIDE_ENCODERS` enabled.
    pub device_enabled_timestamp_inside_encoders: bool,
    /// Device has `TIMESTAMP_QUERY_INSIDE_PASSES` enabled.
    pub device_enabled_timestamp_inside_passes: bool,
}

impl GpuTimestampCapabilities {
    /// Returns `true` if render-pass compositor timing is available.
    ///
    /// Requires `TIMESTAMP_QUERY` at the device level (sufficient for
    /// `RenderPassDescriptor::timestamp_writes` in wgpu 24.x).
    pub fn compositor_timing_available(&self) -> bool {
        self.device_enabled_timestamp_query
    }
}

// ---------------------------------------------------------------------------
// PreviewCapabilities
// ---------------------------------------------------------------------------
/// Capability-negotiated rendering hardware capabilities.
/// Probed once at GPU initialization and cached for the session lifetime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewCapabilities {
    /// wgpu device supports TEXTURE_FORMAT_NV12 biplanar views.
    pub wgpu_nv12: bool,
    /// wgpu backend is DX12, enabling DXGI shared handle import on Windows.
    pub dxgi_import: bool,
    /// FFmpeg D3D11VA hardware decode is available on this adapter.
    pub hw_decode: bool,
    /// Native HWND/NSWindow/X11 surface presentation is available.
    pub native_surface: bool,
    /// HDR surface format is supported (Rgba16Float or P010).
    pub hdr: bool,
    /// GPU timestamp query capability (Phase 3.1).
    pub gpu_timestamp_caps: GpuTimestampCapabilities,
}

impl PreviewCapabilities {
    /// Probe capabilities given the active wgpu adapter and device.
    pub fn probe(adapter: &wgpu::Adapter, device: &wgpu::Device) -> Self {
        let info = adapter.get_info();
        let adapter_features = adapter.features();
        let device_features = device.features();

        let wgpu_nv12 = device_features.contains(wgpu::Features::TEXTURE_FORMAT_NV12);
        let dxgi_import = cfg!(target_os = "windows") && info.backend == wgpu::Backend::Dx12;
        let hw_decode = cfg!(target_os = "windows") || cfg!(target_os = "macos");
        let hdr = device_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM);

        let gpu_timestamp_caps = GpuTimestampCapabilities {
            adapter_supports_timestamp_query: adapter_features
                .contains(wgpu::Features::TIMESTAMP_QUERY),
            adapter_supports_timestamp_inside_encoders: adapter_features
                .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
            adapter_supports_timestamp_inside_passes: adapter_features
                .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
            device_enabled_timestamp_query: device_features
                .contains(wgpu::Features::TIMESTAMP_QUERY),
            device_enabled_timestamp_inside_encoders: device_features
                .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
            device_enabled_timestamp_inside_passes: device_features
                .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
        };

        Self {
            wgpu_nv12,
            dxgi_import,
            hw_decode,
            native_surface: true,
            hdr,
            gpu_timestamp_caps,
        }
    }

    /// Returns true if the full zero-copy DXGI pipeline is available.
    #[allow(dead_code)]
    pub fn zero_copy_available(&self) -> bool {
        self.dxgi_import && self.wgpu_nv12 && self.hw_decode
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_copy_available_requires_all_three() {
        let caps = PreviewCapabilities {
            wgpu_nv12: true,
            dxgi_import: true,
            hw_decode: true,
            native_surface: true,
            hdr: false,
            gpu_timestamp_caps: GpuTimestampCapabilities::default(),
        };
        assert!(caps.zero_copy_available());

        let caps_no_nv12 = PreviewCapabilities {
            wgpu_nv12: false,
            ..caps.clone()
        };
        assert!(!caps_no_nv12.zero_copy_available());

        let caps_no_dxgi = PreviewCapabilities {
            dxgi_import: false,
            ..caps.clone()
        };
        assert!(!caps_no_dxgi.zero_copy_available());

        let caps_no_hw = PreviewCapabilities {
            hw_decode: false,
            ..caps.clone()
        };
        assert!(!caps_no_hw.zero_copy_available());
    }
}
