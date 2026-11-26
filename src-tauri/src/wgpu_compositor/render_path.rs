use serde::{Deserialize, Serialize};

/// High-level frame render path chosen by the preview pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameRenderPath {
    /// Optimal zero-copy path: D3D11VA -> DXGI NT shared handle -> wgpu HAL texture (VRAM only).
    ZeroCopyDxgi,
    /// Optimal zero-copy path on macOS: VideoToolbox -> IOSurface -> Metal -> wgpu HAL texture (Unified Memory).
    ZeroCopyMetal,
    /// Direct DMA upload path: Hardware or software decode -> CPU-accessible NV12 -> YUV ring buffer -> wgpu texture.
    GpuUploadRing,
    /// Software decode or CPU readback compatibility path.
    CpuFallback,
}

impl FrameRenderPath {
    #[inline]
    pub fn is_zero_copy(&self) -> bool {
        matches!(self, Self::ZeroCopyDxgi | Self::ZeroCopyMetal)
    }
}

/// Describes how a single decoded video layer will be sourced for GPU rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum FrameSource {
    /// Zero-copy: D3D11VA DXGI NT handle imported directly into wgpu (Windows DX12 only).
    DxgiNv12 { width: u32, height: u32 },
    /// Zero-copy on macOS: VideoToolbox CVPixelBuffer imported directly into wgpu (Metal only).
    MetalNv12 { width: u32, height: u32 },
    /// Zero-copy on macOS for 10-bit VideoToolbox P010 frames.
    MetalP010 { width: u32, height: u32 },
    /// GPU upload: CPU-decoded NV12 planes written into ring-buffer textures via queue.write_texture.
    CpuNv12 { width: u32, height: u32 },
    /// GPU upload: CPU-produced 10-bit P010 planes written to the renderer.
    CpuP010 { width: u32, height: u32 },
    /// CPU readback: RGBA decoded frame uploaded to GPU texture (compatibility/debugging path).
    CpuRgba { width: u32, height: u32 },
    /// A composition without a video layer.
    GpuRaster,
    /// A frame staged by the lookahead queue rather than presented.
    LookaheadQueue,
    /// A presentation that retained the already-visible frame.
    UnchangedSkipped,
    /// A presentation containing layers with different source paths.
    Mixed,
    /// An explicit absence of a source tag for a dropped or pre-compositor sample.
    #[default]
    Unknown,
}

// ---------------------------------------------------------------------------
// DXGI failure classification
// ---------------------------------------------------------------------------

/// Why the DXGI import path was administratively disabled.
///
/// Carried in [`DxgiImportState::Disabled`] for diagnostics and telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisableReason {
    /// `CLYPRA_DISABLE_DXGI=1` or `CLYPRA_DISABLE_DXGI_ZERO_COPY=1` env var.
    EnvVar,
    /// NV12 or DX12 not available on this adapter (`!capabilities.zero_copy_available()`).
    UnsupportedFeature,
    /// Administrative policy (reserved for future use).
    AdminPolicy,
}

impl std::fmt::Display for DisableReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EnvVar => write!(f, "CLYPRA_DISABLE_DXGI env var"),
            Self::UnsupportedFeature => write!(f, "NV12/DX12 not supported on this adapter"),
            Self::AdminPolicy => write!(f, "admin policy"),
        }
    }
}

/// Why a structural DXGI import failure occurred.
///
/// Carried in [`DxgiImportState::Failed`] for diagnostics and GPU recovery logic.
///
/// # Recovery semantics
///
/// - Most variants → disable DXGI for this session; CPU fallback continues.
/// - [`DxgiFailureReason::DeviceLost`] → GPU context recreation required
///   (Phase 5 `PerformanceManager`). The discriminant is defined here so the
///   state machine can identify device-lost vs ordinary import failure from
///   Phase 3 onwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DxgiFailureReason {
    /// `IDXGIResource1::CreateSharedHandle` or `ID3D12Device::OpenSharedHandle` failed.
    ImportFailed,
    /// The imported texture is null or its COM interface cannot be retrieved.
    InvalidTexture,
    /// The DXGI format is neither NV12 nor P010 — unexpected codec output.
    UnsupportedFormat,
    /// `array_index` from `AVFrame.data[1]` is out of bounds for the texture array.
    /// Catching this prevents a valid-looking `FrameResource` containing the wrong frame.
    WrongArraySlice,
    /// D3D12 device was lost. Requires GPU context recreation, not just DXGI disable.
    /// Phase 5 (`PerformanceManager`) handles device recovery when this is observed.
    DeviceLost,
    /// `wgpu::Instance::create_surface` failed on the native window.
    SurfaceCreationFailed,
    /// The imported texture dimensions do not match the expected frame dimensions.
    DimensionMismatch,
    /// The wgpu adapter used for import does not match the adapter that decoded
    /// the frame.  Importing across adapters requires a PCIe copy which this
    /// pipeline does not perform.  Triggers immediate session-level DXGI disable.
    AdapterMismatchForCurrentImportPath,
    /// The D3D11 texture has a resource configuration that is incompatible with
    /// the DXGI shared handle protocol (e.g. not shareable, wrong bind flags).
    UnsupportedResourceConfiguration,
    /// A keyed mutex acquire or release operation failed, indicating that the
    /// texture is still owned by another device or process.
    SynchronizationFailure,
}

impl DxgiFailureReason {
    /// Total number of [`DxgiFailureReason`] variants.
    pub const COUNT: usize = 10;

    /// Canonical ordered list of all [`DxgiFailureReason`] variants.
    pub const ALL: [Self; Self::COUNT] = [
        Self::ImportFailed,
        Self::InvalidTexture,
        Self::UnsupportedFormat,
        Self::WrongArraySlice,
        Self::DeviceLost,
        Self::SurfaceCreationFailed,
        Self::DimensionMismatch,
        Self::AdapterMismatchForCurrentImportPath,
        Self::UnsupportedResourceConfiguration,
        Self::SynchronizationFailure,
    ];

    /// Dense index in `0..Self::COUNT` for fixed-array atomic counters.
    pub const fn as_index(self) -> usize {
        match self {
            Self::ImportFailed => 0,
            Self::InvalidTexture => 1,
            Self::UnsupportedFormat => 2,
            Self::WrongArraySlice => 3,
            Self::DeviceLost => 4,
            Self::SurfaceCreationFailed => 5,
            Self::DimensionMismatch => 6,
            Self::AdapterMismatchForCurrentImportPath => 7,
            Self::UnsupportedResourceConfiguration => 8,
            Self::SynchronizationFailure => 9,
        }
    }

    /// Stable snake_case wire key for telemetry payloads.
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::ImportFailed => "import_failed",
            Self::InvalidTexture => "invalid_texture",
            Self::UnsupportedFormat => "unsupported_format",
            Self::WrongArraySlice => "wrong_array_slice",
            Self::DeviceLost => "device_lost",
            Self::SurfaceCreationFailed => "surface_creation_failed",
            Self::DimensionMismatch => "dimension_mismatch",
            Self::AdapterMismatchForCurrentImportPath => "adapter_mismatch",
            Self::UnsupportedResourceConfiguration => "unsupported_resource_configuration",
            Self::SynchronizationFailure => "synchronization_failure",
        }
    }
}

impl std::fmt::Display for DxgiFailureReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ImportFailed => write!(f, "DXGI shared handle import failed"),
            Self::InvalidTexture => write!(f, "imported texture is null or invalid"),
            Self::UnsupportedFormat => write!(f, "unsupported DXGI format (not NV12/P010)"),
            Self::WrongArraySlice => write!(f, "array_index out of bounds for texture array"),
            Self::DeviceLost => write!(f, "D3D12 device lost — GPU recovery required"),
            Self::SurfaceCreationFailed => write!(f, "wgpu surface creation failed"),
            Self::DimensionMismatch => write!(f, "imported texture dimensions do not match frame"),
            Self::AdapterMismatchForCurrentImportPath => write!(
                f,
                "DXGI import adapter mismatch — decode and render adapters differ"
            ),
            Self::UnsupportedResourceConfiguration => write!(
                f,
                "D3D11 texture resource configuration is incompatible with DXGI sharing"
            ),
            Self::SynchronizationFailure => write!(
                f,
                "DXGI keyed mutex acquire/release failed — texture still owned by another device"
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// DxgiImportState — session-level sticky state
// ---------------------------------------------------------------------------

/// Session-level state for the DXGI zero-copy import pipeline.
///
/// Sticky failure prevents per-frame retry after a structural failure.
/// Reset via `NativePreviewSession::reset_dxgi_state()` on project close.
///
/// # State machine
///
/// ```text
/// Unknown  ──► Supported   (on first successful import)
/// Unknown  ──► Failed      (on structural error)
/// Unknown  ──► Disabled    (on env var / capability check)
/// Supported ──► Failed     (on subsequent structural error)
/// Failed   ──► Unknown     (on reset_dxgi_state — project close)
/// Disabled ──► Unknown     (on reset_dxgi_state — project close)
/// ```
///
/// `DeviceLost` failure additionally triggers GPU context recreation (Phase 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DxgiImportState {
    /// Not yet probed on this session.
    #[default]
    Unknown,
    /// Import succeeded at least once; optimistically retry.
    Supported,
    /// Administratively disabled; do not attempt until session restart.
    Disabled { reason: DisableReason },
    /// Structural failure; do not retry until session restart.
    /// If `reason == DeviceLost`, the GPU context should also be recreated.
    Failed { reason: DxgiFailureReason },
}

impl DxgiImportState {
    /// True when the import pipeline should be attempted this frame.
    /// `Unknown` and `Supported` are usable; `Disabled` and `Failed` are not.
    pub fn is_usable(&self) -> bool {
        matches!(self, Self::Unknown | Self::Supported)
    }

    /// True when the failure reason indicates the GPU device was lost.
    /// Callers should trigger GPU context recreation, not just DXGI fallback.
    pub fn is_device_lost(&self) -> bool {
        matches!(
            self,
            Self::Failed {
                reason: DxgiFailureReason::DeviceLost
            }
        )
    }
}

impl std::fmt::Display for DxgiImportState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown => write!(f, "Unknown"),
            Self::Supported => write!(f, "Supported"),
            Self::Disabled { reason } => write!(f, "Disabled ({reason})"),
            Self::Failed { reason } => write!(f, "Failed ({reason})"),
        }
    }
}

// ---------------------------------------------------------------------------
// PreviewRenderError — explicit render errors
// ---------------------------------------------------------------------------

/// Explicit render error type replacing silent `Ok(black_texture)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewRenderError {
    UnsupportedFeature(String),
    ImportFailed(String),
    ShaderFailed(String),
    DimensionMismatch {
        expected: (u32, u32),
        got: (u32, u32),
    },
    RenderFailed(String),
}

impl std::fmt::Display for PreviewRenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFeature(msg) => write!(f, "Unsupported GPU feature: {msg}"),
            Self::ImportFailed(msg) => write!(f, "DXGI texture import failed: {msg}"),
            Self::ShaderFailed(msg) => write!(f, "Preview shader failed: {msg}"),
            Self::DimensionMismatch { expected, got } => {
                write!(f, "Dimension mismatch: expected {expected:?}, got {got:?}")
            }
            Self::RenderFailed(msg) => write!(f, "Preview rendering pass failed: {msg}"),
        }
    }
}

impl std::error::Error for PreviewRenderError {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dxgi_import_state_lifecycle() {
        let state = DxgiImportState::Unknown;
        assert!(state.is_usable());

        let state = DxgiImportState::Supported;
        assert!(state.is_usable());

        let state = DxgiImportState::Failed {
            reason: DxgiFailureReason::ImportFailed,
        };
        assert!(!state.is_usable());

        let state = DxgiImportState::Disabled {
            reason: DisableReason::EnvVar,
        };
        assert!(!state.is_usable());
    }

    #[test]
    fn device_lost_is_distinguishable_from_import_failed() {
        let device_lost = DxgiImportState::Failed {
            reason: DxgiFailureReason::DeviceLost,
        };
        let import_fail = DxgiImportState::Failed {
            reason: DxgiFailureReason::ImportFailed,
        };

        assert!(device_lost.is_device_lost());
        assert!(!import_fail.is_device_lost());
        // Both are sticky (not usable)
        assert!(!device_lost.is_usable());
        assert!(!import_fail.is_usable());
    }

    #[test]
    fn wrong_array_slice_is_not_device_lost() {
        let state = DxgiImportState::Failed {
            reason: DxgiFailureReason::WrongArraySlice,
        };
        assert!(!state.is_device_lost());
        assert!(!state.is_usable());
    }

    #[test]
    fn disable_reasons_display() {
        assert!(!DisableReason::EnvVar.to_string().is_empty());
        assert!(!DisableReason::UnsupportedFeature.to_string().is_empty());
    }

    #[test]
    fn failure_reasons_display() {
        assert!(!DxgiFailureReason::ImportFailed.to_string().is_empty());
        assert!(!DxgiFailureReason::DeviceLost.to_string().is_empty());
        assert!(!DxgiFailureReason::WrongArraySlice.to_string().is_empty());
    }

    #[test]
    fn new_failure_variants_display_non_empty() {
        assert!(!DxgiFailureReason::AdapterMismatchForCurrentImportPath
            .to_string()
            .is_empty());
        assert!(!DxgiFailureReason::UnsupportedResourceConfiguration
            .to_string()
            .is_empty());
        assert!(!DxgiFailureReason::SynchronizationFailure
            .to_string()
            .is_empty());
    }

    #[test]
    fn new_failure_variants_are_not_device_lost() {
        let not_device_lost = [
            DxgiImportState::Failed {
                reason: DxgiFailureReason::AdapterMismatchForCurrentImportPath,
            },
            DxgiImportState::Failed {
                reason: DxgiFailureReason::UnsupportedResourceConfiguration,
            },
            DxgiImportState::Failed {
                reason: DxgiFailureReason::SynchronizationFailure,
            },
        ];
        for state in &not_device_lost {
            assert!(!state.is_device_lost());
            assert!(!state.is_usable());
        }
    }

    #[test]
    fn dxgi_state_display() {
        assert_eq!(DxgiImportState::Unknown.to_string(), "Unknown");
        assert_eq!(DxgiImportState::Supported.to_string(), "Supported");
        assert!(DxgiImportState::Failed {
            reason: DxgiFailureReason::DeviceLost
        }
        .to_string()
        .contains("device lost"));
    }
}
