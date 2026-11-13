//! Zero-copy D3D11VA → wgpu texture import for Windows discrete GPUs.
//!
//! # Pipeline
//!
//! ```text
//! FFmpeg D3D11VA decoder
//!   └─ AVFrame.data[0] = ID3D11Texture2D*    (GPU VRAM — no copy yet)
//!   └─ AVFrame.data[1] = array_index
//!        │
//!        ▼  IDXGIResource1::CreateSharedHandle (NT handle, ~0 μs)
//!        │
//!        ▼  ID3D12Device::OpenSharedHandle     (~0 μs, same adapter bus)
//!        │
//!        ▼  wgpu::Device::create_texture_from_hal
//!             └─ two TextureViews: Plane0 (Y), Plane1 (UV)
//! ```
//!
//! The entire chain is zero-copy on modern NVIDIA/AMD discrete GPUs because
//! the D3D11 texture lives in VRAM that is accessible from D3D12 without a
//! PCIe round-trip, provided both devices share the same physical adapter.
//!
//! # Fallback
//!
//! Every step returns `Option` / `Result`. The caller must fall back to the
//! existing CPU path (`av_hwframe_transfer_data` + `queue.write_texture`) on
//! any failure so correctness is never compromised.
//!
//! # Diagnostic ring (Phase 3.1)
//!
//! Every import attempt is recorded in a module-level bounded ring of
//! [`DxgiAttemptMetadata`] (capacity 300).  The first structural failure also
//! sets a sticky [`DxgiFirstFailureEvent`].  Both are accessible for session
//! telemetry reporting via [`drain_attempt_log`] and [`first_failure_event`].

#![cfg(target_os = "windows")]

use std::collections::VecDeque;
use std::sync::Mutex as StdMutex;
use std::time::Instant;

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{ID3D11Texture2D, D3D11_TEXTURE2D_DESC};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12Device, ID3D12Resource, D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12;
use windows::Win32::Graphics::Dxgi::IDXGIResource1;

use crate::wgpu_compositor::render_path::DxgiFailureReason;

// ---------------------------------------------------------------------------
// Diagnostic structures (Phase 3.1)
// ---------------------------------------------------------------------------

/// Per-attempt diagnostic record stored in the bounded ring.
///
/// # HRESULT field
///
/// `hresult` is `None` when the failure occurred before any COM call was made
/// (e.g. a null pointer guard).  It is never invented — only the actual HRESULT
/// value returned by a Windows API call is stored here.
#[derive(Debug, Clone)]
pub struct DxgiAttemptMetadata {
    /// Wall-clock instant when this attempt started.
    pub attempted_at: Instant,
    /// Whether the import succeeded.
    pub success: bool,
    /// Classified failure reason (None on success).
    pub failure_reason: Option<DxgiFailureReason>,
    /// Raw HRESULT from the failing COM call, if one was made.
    /// `None` on success or when failure occurred before any COM call.
    pub hresult: Option<u32>,
    /// Whether the D3D11 texture exposes IDXGIKeyedMutex.
    pub has_keyed_mutex: bool,
    /// Wall-clock nanoseconds elapsed for the entire import attempt.
    pub attempt_duration_ns: u64,
}

/// First structural DXGI import failure in this process lifetime.
///
/// Sticky — only the first failure is recorded.  Reset is not supported
/// because the failure lifecycle is session-scoped.
#[derive(Debug, Clone)]
pub struct DxgiFirstFailureEvent {
    /// When the first failure was observed.
    pub observed_at: Instant,
    /// The classified failure reason.
    pub reason: DxgiFailureReason,
    /// Raw HRESULT, if available from a COM call.
    pub hresult: Option<u32>,
    /// Whether the D3D11 texture exposed IDXGIKeyedMutex at the time of failure.
    pub has_keyed_mutex: bool,
}

// ---------------------------------------------------------------------------
// Module-level bounded ring and first-failure event
// ---------------------------------------------------------------------------

/// Maximum diagnostic ring size.  At 300 × ~64 bytes ≈ 19 KB maximum.
const ATTEMPT_RING_CAPACITY: usize = 300;

static ATTEMPT_RING: StdMutex<VecDeque<DxgiAttemptMetadata>> =
    StdMutex::new(VecDeque::new());

static FIRST_FAILURE: StdMutex<Option<DxgiFirstFailureEvent>> =
    StdMutex::new(None);

/// Drain all diagnostic records accumulated since the last call.
///
/// Returns up to `ATTEMPT_RING_CAPACITY` records in insertion order.
pub fn drain_attempt_log() -> Vec<DxgiAttemptMetadata> {
    if let Ok(mut ring) = ATTEMPT_RING.lock() {
        ring.drain(..).collect()
    } else {
        Vec::new()
    }
}

/// Return the first structural DXGI failure event for this session, if any.
pub fn first_failure_event() -> Option<DxgiFirstFailureEvent> {
    FIRST_FAILURE.lock().ok()?.clone()
}

// ---------------------------------------------------------------------------
// HRESULT classification helper
// ---------------------------------------------------------------------------

/// Classify a Windows HRESULT into a [`DxgiFailureReason`] and return both.
///
/// Only call this when an actual COM API has returned an error.  Never invent
/// an HRESULT.
fn classify_hresult(hresult: u32) -> (DxgiFailureReason, u32) {
    // Well-known HRESULT codes:
    // DXGI_ERROR_DEVICE_REMOVED  = 0x887A0005
    // DXGI_ERROR_DEVICE_RESET    = 0x887A0007
    // DXGI_ERROR_UNSUPPORTED     = 0x887A0004
    // E_ACCESSDENIED             = 0x80070005
    let reason = match hresult {
        0x887A_0005 | 0x887A_0007 => DxgiFailureReason::DeviceLost,
        0x887A_0004 => DxgiFailureReason::UnsupportedResourceConfiguration,
        0x8007_0005 => DxgiFailureReason::SynchronizationFailure,
        _ => DxgiFailureReason::ImportFailed,
    };
    (reason, hresult)
}

fn record_attempt(meta: DxgiAttemptMetadata) {
    if let Ok(mut ring) = ATTEMPT_RING.lock() {
        if ring.len() >= ATTEMPT_RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(meta);
    }
}

fn record_first_failure(event: DxgiFirstFailureEvent) {
    if let Ok(mut guard) = FIRST_FAILURE.lock() {
        if guard.is_none() {
            log::warn!(
                "[dxgi_import] First structural failure: {:?} (HRESULT: {:?})",
                event.reason,
                event.hresult
            );
            *guard = Some(event);
        }
    }
}

// ---------------------------------------------------------------------------
// D3d11SharedFrame — raw handles from FFmpeg D3D11VA
// ---------------------------------------------------------------------------

/// Raw handles needed to import a D3D11VA frame into wgpu without a PCIe copy.
pub struct D3d11SharedFrame {
    /// DXGI NT shared handle (closed automatically on Drop).
    pub nt_handle: HANDLE,
    /// Texture array slice that contains this frame (D3D11VA array decode).
    pub array_index: u32,
    /// Decoded luma width in pixels.
    pub width: u32,
    /// Decoded luma height in pixels.
    pub height: u32,
}

// Windows NT kernel handles are process-wide and thread-safe to transfer across threads.
unsafe impl Send for D3d11SharedFrame {}
unsafe impl Sync for D3d11SharedFrame {}

impl D3d11SharedFrame {
    /// Duplicate the underlying NT kernel handle using Win32 `DuplicateHandle`.
    /// This allows a shared frame stored in the lookahead queue to produce independent
    /// handles for multiple import or presentation passes without lifetime conflicts.
    pub fn duplicate(&self) -> Option<Self> {
        if self.nt_handle.is_invalid() {
            return None;
        }
        unsafe {
            use windows::Win32::Foundation::DUPLICATE_SAME_ACCESS;
            use windows::Win32::System::Threading::GetCurrentProcess;
            let mut target_handle = HANDLE::default();
            let process = GetCurrentProcess();
            let ret = windows::Win32::Foundation::DuplicateHandle(
                process,
                self.nt_handle,
                process,
                &mut target_handle,
                0,
                false,
                DUPLICATE_SAME_ACCESS,
            );
            if ret.is_ok() && !target_handle.is_invalid() {
                Some(Self {
                    nt_handle: target_handle,
                    array_index: self.array_index,
                    width: self.width,
                    height: self.height,
                })
            } else {
                None
            }
        }
    }
}

impl Drop for D3d11SharedFrame {
    fn drop(&mut self) {
        if !self.nt_handle.is_invalid() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(self.nt_handle);
            }
            self.nt_handle = HANDLE::default();
        }
    }
}

/// Extract a DXGI shared NT handle from an FFmpeg D3D11VA hardware `AVFrame`.
///
/// FFmpeg D3D11VA stores frames as:
///   `frame->data[0]` = `ID3D11Texture2D*` (the texture)
///   `frame->data[1]` = array index cast to pointer (for array-texture decoders)
///
/// # Safety
///
/// `frame_ptr` must be a valid, non-null `*const AVFrame` whose `hw_frames_ctx`
/// references a live D3D11VA hw-frames context.  Call this only while the
/// `AVFrame` is still in scope (i.e., before `av_frame_unref`).
pub unsafe fn extract_shared_handle(
    frame_ptr: *const ffmpeg_sys_next::AVFrame,
) -> Option<D3d11SharedFrame> {
    if frame_ptr.is_null() {
        return None;
    }

    // data[0] = ID3D11Texture2D*  (raw COM pointer, not ref-counted here)
    // data[1] = array slice index (cast to *mut u8 by FFmpeg convention)
    let texture_raw = (*frame_ptr).data[0] as *mut std::ffi::c_void;
    let array_index = (*frame_ptr).data[1] as usize as u32;

    if texture_raw.is_null() {
        return None;
    }

    // Borrow the COM pointer — do NOT call AddRef/Release; FFmpeg owns this.
    // We use windows-rs `from_raw_borrowed` which creates a non-owning borrow.
    // Bind the cast to a named local first: MSVC's stricter NLL rules reject
    // the inline temporary `&(texture_raw as *mut _)` with E0716.
    let texture_ptr = texture_raw as *mut _;
    let texture: &ID3D11Texture2D = windows::core::from_raw_borrowed(&texture_ptr)?;

    // Get DXGI resource interface so we can create an NT shared handle.
    let resource: IDXGIResource1 = texture.cast().ok()?;

    // DXGI_SHARED_RESOURCE_READ = 0x80000000
    let nt_handle: HANDLE = resource
        .CreateSharedHandle(
            None,           // default security
            0x8000_0000u32, // DXGI_SHARED_RESOURCE_READ
            PCWSTR::null(), // no name
        )
        .ok()?;

    if nt_handle.is_invalid() {
        return None;
    }

    // Read the texture dimensions.
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    texture.GetDesc(&mut desc);

    Some(D3d11SharedFrame {
        nt_handle,
        array_index,
        width: desc.Width,
        height: desc.Height,
    })
}

// ---------------------------------------------------------------------------
// ImportedNv12Texture
// ---------------------------------------------------------------------------

/// Imported NV12 texture with its biplanar wgpu views, ready for the YUV shader.
pub struct ImportedNv12Texture {
    /// The wgpu texture wrapping the D3D11VA VRAM surface (no PCIe copy).
    /// Kept alive as long as the views are in use.
    #[allow(dead_code)]
    pub texture: wgpu::Texture,
    /// `TextureAspect::Plane0` — luma (Y), format-compatible with `R8Unorm`.
    pub y_view: wgpu::TextureView,
    /// `TextureAspect::Plane1` — chroma (UV), format-compatible with `Rg8Unorm`.
    pub uv_view: wgpu::TextureView,
}

// ---------------------------------------------------------------------------
// import_into_wgpu — instrumented (Phase 3.1)
// ---------------------------------------------------------------------------

/// Open a DXGI NT shared handle via the wgpu DX12 HAL and produce biplanar views.
///
/// Every call records a [`DxgiAttemptMetadata`] entry in the bounded ring.
/// The first structural failure is also captured as a sticky [`DxgiFirstFailureEvent`].
///
/// # Arguments
///
/// * `device` — the wgpu device (must use the DX12 backend on Windows).
/// * `shared` — handle produced by [`extract_shared_handle`]; this function takes
///   ownership and closes the NT handle regardless of success/failure.
///
/// # Returns
///
/// `Ok(ImportedNv12Texture)` on success, or `Err(DxgiFailureReason)` on failure.
/// The caller **must** fall back to the CPU upload path on error.
pub fn import_into_wgpu(
    device: &wgpu::Device,
    shared: D3d11SharedFrame,
) -> Result<ImportedNv12Texture, DxgiFailureReason> {
    use wgpu::hal::api::Dx12;

    let attempt_start = Instant::now();

    if !device
        .features()
        .contains(wgpu::Features::TEXTURE_FORMAT_NV12)
    {
        log::warn!("DXGI zero-copy import skipped: device does not support TEXTURE_FORMAT_NV12");
        let attempt_duration_ns = attempt_start.elapsed().as_nanos() as u64;
        record_attempt(DxgiAttemptMetadata {
            attempted_at: attempt_start,
            success: false,
            failure_reason: Some(DxgiFailureReason::UnsupportedFormat),
            hresult: None,
            has_keyed_mutex: false,
            attempt_duration_ns,
        });
        return Err(DxgiFailureReason::UnsupportedFormat);
    }

    let nt_handle = shared.nt_handle;
    let array_index = shared.array_index;
    let width = shared.width;
    let height = shared.height;

    // Error type carries: (reason, raw_hresult, has_keyed_mutex).
    type InnerErr = (DxgiFailureReason, Option<u32>, bool);

    // `shared` is dropped at end of scope — D3d11SharedFrame::drop closes nt_handle.
    let result: Result<ImportedNv12Texture, InnerErr> = unsafe {
        device.as_hal::<Dx12, _, Result<ImportedNv12Texture, InnerErr>>(|hal_device| {
            let hal_device = hal_device.ok_or((DxgiFailureReason::ImportFailed, None, false))?;

            // Get the raw ID3D12Device so we can open the DXGI shared handle.
            let d3d12_device: &ID3D12Device = hal_device.raw_device();

            // Open the D3D11 texture's DXGI handle as a D3D12 resource.
            // Preserve the raw HRESULT on failure — do not discard it.
            let mut d3d12_resource: Option<ID3D12Resource> = None;
            d3d12_device
                .OpenSharedHandle(nt_handle, &mut d3d12_resource)
                .map_err(|e| {
                    let (reason, hr) = classify_hresult(e.code().0 as u32);
                    (reason, Some(hr), false)
                })?;
            let d3d12_resource: ID3D12Resource =
                d3d12_resource.ok_or((DxgiFailureReason::InvalidTexture, None, false))?;

            // Probe keyed mutex: some D3D11VA decoders use it for cross-device sync.
            use windows::Win32::Graphics::Dxgi::IDXGIKeyedMutex;
            let has_keyed_mutex = d3d12_resource.cast::<IDXGIKeyedMutex>().is_ok();

            // Verify the format is NV12 as expected.
            let resource_desc: D3D12_RESOURCE_DESC = d3d12_resource.GetDesc();
            if resource_desc.Dimension != D3D12_RESOURCE_DIMENSION_TEXTURE2D
                || resource_desc.Format != DXGI_FORMAT_NV12
            {
                return Err((DxgiFailureReason::UnsupportedFormat, None, has_keyed_mutex));
            }

            // Invariant 1: Catch array_index out of bounds for the texture array.
            // D3D11VA decoders allocate multi-slice texture arrays (e.g. 16-32 slices).
            let array_size = resource_desc.DepthOrArraySize as u32;
            if array_index >= array_size {
                log::warn!(
                    "[dxgi_import] array_index {array_index} >= DepthOrArraySize {array_size}"
                );
                return Err((DxgiFailureReason::WrongArraySlice, None, has_keyed_mutex));
            }

            // Wrap the D3D12 resource as a wgpu HAL texture.
            // `texture_from_raw` is the wgpu 24.x DX12 HAL entry point.
            let hal_texture = <Dx12 as wgpu::hal::Api>::Device::texture_from_raw(
                d3d12_resource,
                wgpu::TextureFormat::NV12,
                wgpu::TextureDimension::D2,
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: array_size,
                },
                1,
                1,
            );

            // Promote to wgpu::Texture.
            let texture = device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("D3D11VA NV12 ZeroCopy"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: array_size,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::NV12,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
            );

            // Plane 0 = Y (luma), sampled as R8Unorm.
            let y_view = texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("NV12 Y plane"),
                format: Some(wgpu::TextureFormat::R8Unorm),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::Plane0,
                base_array_layer: array_index,
                array_layer_count: Some(1),
                ..Default::default()
            });

            // Plane 1 = UV (chroma, interleaved), sampled as Rg8Unorm.
            let uv_view = texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("NV12 UV plane"),
                format: Some(wgpu::TextureFormat::Rg8Unorm),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::Plane1,
                base_array_layer: array_index,
                array_layer_count: Some(1),
                ..Default::default()
            });

            Ok(ImportedNv12Texture {
                texture,
                y_view,
                uv_view,
            })
        })
    };

    // `shared` is dropped here — D3d11SharedFrame::drop closes nt_handle safely.
    let attempt_duration_ns = attempt_start.elapsed().as_nanos() as u64;

    match result {
        Ok(texture) => {
            record_attempt(DxgiAttemptMetadata {
                attempted_at: attempt_start,
                success: true,
                failure_reason: None,
                hresult: None,
                has_keyed_mutex: false,
                attempt_duration_ns,
            });
            Ok(texture)
        }
        Err((reason, hresult, has_keyed_mutex)) => {
            record_attempt(DxgiAttemptMetadata {
                attempted_at: attempt_start,
                success: false,
                failure_reason: Some(reason),
                hresult,
                has_keyed_mutex,
                attempt_duration_ns,
            });
            record_first_failure(DxgiFirstFailureEvent {
                observed_at: attempt_start,
                reason,
                hresult,
                has_keyed_mutex,
            });
            Err(reason)
        }
    }
}
