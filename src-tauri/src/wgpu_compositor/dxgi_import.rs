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

#![cfg(target_os = "windows")]

use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Texture2D, D3D11_TEXTURE2D_DESC,
};
use windows::Win32::Graphics::Direct3D12::{
    ID3D12Device, ID3D12Resource, D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Dxgi::IDXGIResource1;
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12;
use windows::core::{ComInterface, PCWSTR};

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
    let texture: &ID3D11Texture2D =
        windows::core::from_raw_borrowed(&(texture_raw as *mut _))?;

    // Get DXGI resource interface so we can create an NT shared handle.
    let resource: IDXGIResource1 = texture.cast().ok()?;

    // DXGI_SHARED_RESOURCE_READ = 0x80000000
    let mut nt_handle = HANDLE::default();
    resource
        .CreateSharedHandle(
            None,           // default security
            0x8000_0000u32, // DXGI_SHARED_RESOURCE_READ
            PCWSTR::null(), // no name
            &mut nt_handle,
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

/// Open a DXGI NT shared handle via the wgpu DX12 HAL and produce biplanar views.
///
/// # Arguments
///
/// * `device` — the wgpu device (must use the DX12 backend on Windows).
/// * `shared` — handle produced by `extract_shared_handle`; this function takes
///              ownership and will close it regardless of success/failure.
///
/// # Returns
///
/// `Some(ImportedNv12Texture)` on success, `None` if the device is not DX12 or
/// the handle cannot be opened.  The caller **must** fall back to the CPU upload
/// path on `None`.
pub fn import_into_wgpu(device: &wgpu::Device, shared: D3d11SharedFrame) -> Option<ImportedNv12Texture> {
    use wgpu::hal::api::Dx12;

    let nt_handle = shared.nt_handle;
    let width = shared.width;
    let height = shared.height;

    // SAFETY: We close nt_handle in all branches (success and failure).
    let result = unsafe {
        device.as_hal::<Dx12, _, Option<ImportedNv12Texture>>(|hal_device| {
            let hal_device = hal_device?;

            // Get the raw ID3D12Device so we can open the DXGI shared handle.
            let d3d12_device: &ID3D12Device = hal_device.raw_device().as_ref();

            // Open the D3D11 texture's DXGI handle as a D3D12 resource.
            let d3d12_resource: ID3D12Resource = d3d12_device
                .OpenSharedHandle(nt_handle)
                .ok()?;

            // Verify the format is NV12 as expected.
            let resource_desc: D3D12_RESOURCE_DESC = d3d12_resource.GetDesc();
            if resource_desc.Dimension != D3D12_RESOURCE_DIMENSION_TEXTURE2D
                || resource_desc.Format != DXGI_FORMAT_NV12
            {
                return None;
            }

            // Wrap the D3D12 resource as a wgpu HAL texture.
            // `create_texture_from_raw` is the wgpu 24.x DX12 HAL entry point.
            let hal_texture = <Dx12 as wgpu::hal::Api>::Device::texture_from_raw(
                d3d12_resource,
                &wgpu::hal::TextureDescriptor {
                    label: Some("D3D11VA NV12 ZeroCopy"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    // NV12 is the closest match; wgpu DX12 backend maps this
                    // to DXGI_FORMAT_NV12 under the hood.
                    format: wgpu::TextureFormat::NV12,
                    usage: wgpu::TextureUses::RESOURCE,
                    memory_flags: wgpu::hal::MemoryFlags::empty(),
                    view_formats: vec![],
                },
            );

            // Promote to wgpu::Texture.
            let texture = device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("D3D11VA NV12 ZeroCopy"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
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
                ..Default::default()
            });

            // Plane 1 = UV (chroma, interleaved), sampled as Rg8Unorm.
            let uv_view = texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("NV12 UV plane"),
                format: Some(wgpu::TextureFormat::Rg8Unorm),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::Plane1,
                ..Default::default()
            });

            Some(ImportedNv12Texture {
                texture,
                y_view,
                uv_view,
            })
        })
    };

    // `shared` is dropped here, calling D3d11SharedFrame::drop which closes nt_handle safely.
    result.flatten()
}
