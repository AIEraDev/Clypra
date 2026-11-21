//! Zero-copy VideoToolbox → Metal → wgpu texture import for macOS / Apple Silicon.
//!
//! # Pipeline
//!
//! ```text
//! FFmpeg VideoToolbox decoder
//!   └─ AVFrame.data[3] = CVPixelBufferRef (IOSurface-backed in Unified Memory)
//!        │
//!        ▼ CVMetalTextureCacheCreateTextureFromImage (Plane 0: Y, R8Unorm)
//!        ▼ CVMetalTextureCacheCreateTextureFromImage (Plane 1: UV, Rg8Unorm)
//!        │
//!        ▼ CVMetalTextureGetTexture -> id<MTLTexture>
//!        │
//!        ▼ wgpu::hal::api::Metal::texture_from_raw
//!        │
//!        ▼ wgpu::Device::create_texture_from_hal
//!             ├─ y_view  (R8Unorm Y plane)
//!             └─ uv_view (Rg8Unorm UV plane)
//! ```
//!
//! The entire chain is zero-copy on macOS / Apple Silicon because the hardware decoder
//! writes directly into an IOSurface in Unified Memory, which is mapped directly into
//! Metal textures without PCIe roundtrips or CPU system-memory copying.
//!
//! # Fallback
//!
//! Every step returns `Option` / `Result`. On any failure, the caller falls back to
//! the standard CPU transfer path (`av_hwframe_transfer_data` + `queue.write_texture`).
//!
//! # Diagnostics
//!
//! Every import attempt is recorded in a bounded ring of [`MetalAttemptMetadata`] (capacity 300).
//! The first structural failure is captured in [`MetalFirstFailureEvent`].

#![cfg(target_os = "macos")]

use std::collections::VecDeque;
use std::sync::Mutex as StdMutex;
use std::time::Instant;

use foreign_types::ForeignType;

// ---------------------------------------------------------------------------
// CoreVideo / CoreFoundation FFI Types & Declarations
// ---------------------------------------------------------------------------

pub type CVPixelBufferRef = *mut std::ffi::c_void;
pub type CVMetalTextureCacheRef = *mut std::ffi::c_void;
pub type CVMetalTextureRef = *mut std::ffi::c_void;

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferRetain(buffer: CVPixelBufferRef) -> CVPixelBufferRef;
    fn CVPixelBufferRelease(buffer: CVPixelBufferRef);
    fn CVPixelBufferGetWidth(buffer: CVPixelBufferRef) -> usize;
    fn CVPixelBufferGetHeight(buffer: CVPixelBufferRef) -> usize;
    fn CVPixelBufferGetPixelFormatType(buffer: CVPixelBufferRef) -> u32;
    #[allow(dead_code)]
    fn CVPixelBufferIsPlanar(buffer: CVPixelBufferRef) -> u8;
    #[allow(dead_code)]
    fn CVPixelBufferGetPlaneCount(buffer: CVPixelBufferRef) -> usize;

    fn CVMetalTextureCacheCreate(
        allocator: *const std::ffi::c_void,
        cache_attributes: *const std::ffi::c_void,
        metal_device: *mut std::ffi::c_void,
        texture_attributes: *const std::ffi::c_void,
        out_cache: *mut CVMetalTextureCacheRef,
    ) -> i32;

    fn CVMetalTextureCacheCreateTextureFromImage(
        allocator: *const std::ffi::c_void,
        texture_cache: CVMetalTextureCacheRef,
        image_buffer: CVPixelBufferRef,
        texture_attributes: *const std::ffi::c_void,
        pixel_format: usize, // MTLPixelFormat
        width: usize,
        height: usize,
        plane_index: usize,
        out_texture: *mut CVMetalTextureRef,
    ) -> i32;

    fn CVMetalTextureGetTexture(image: CVMetalTextureRef) -> *mut std::ffi::c_void;
    fn CVMetalTextureCacheFlush(texture_cache: CVMetalTextureCacheRef, options: u64);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRetain(cf: *const std::ffi::c_void) -> *const std::ffi::c_void;
    fn CFRelease(cf: *const std::ffi::c_void);
}

// FourCC codes for Apple VideoToolbox pixel formats
const K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_VIDEO_RANGE: u32 = 0x34323076; // '420v'
const K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_FULL_RANGE: u32 = 0x34323066; // '420f'
const K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_VIDEO_RANGE: u32 = 0x78343230; // 'x420'
const K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_FULL_RANGE: u32 = 0x78663230; // 'xf20'

// Metal pixel formats (MTLPixelFormat)
const MTL_PIXEL_FORMAT_R8_UNORM: usize = 10;
const MTL_PIXEL_FORMAT_RG8_UNORM: usize = 30;
const MTL_PIXEL_FORMAT_R16_UNORM: usize = 53;
const MTL_PIXEL_FORMAT_RG16_UNORM: usize = 65;

fn fourcc_string(value: u32) -> String {
    let bytes = value.to_be_bytes();
    if bytes.iter().all(|byte| byte.is_ascii_graphic()) {
        format!("'{}'", String::from_utf8_lossy(&bytes))
    } else {
        format!("0x{value:08x}")
    }
}

// ---------------------------------------------------------------------------
// Diagnostic structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MetalFailureReason {
    ImportFailed,
    InvalidPixelBuffer,
    UnsupportedFormat,
    CacheCreationFailed,
    TextureCreationFailed,
    DeviceLost,
}

#[derive(Debug, Clone)]
pub struct MetalAttemptMetadata {
    pub attempted_at: Instant,
    pub success: bool,
    pub failure_reason: Option<MetalFailureReason>,
    pub cv_status: Option<i32>,
    pub attempt_duration_ns: u64,
}

#[derive(Debug, Clone)]
pub struct MetalFirstFailureEvent {
    pub observed_at: Instant,
    pub reason: MetalFailureReason,
    pub cv_status: Option<i32>,
}

const ATTEMPT_RING_CAPACITY: usize = 300;

static ATTEMPT_RING: StdMutex<VecDeque<MetalAttemptMetadata>> = StdMutex::new(VecDeque::new());

static FIRST_FAILURE: StdMutex<Option<MetalFirstFailureEvent>> = StdMutex::new(None);

pub fn drain_attempt_log() -> Vec<MetalAttemptMetadata> {
    if let Ok(mut ring) = ATTEMPT_RING.lock() {
        ring.drain(..).collect()
    } else {
        Vec::new()
    }
}

pub fn first_failure_event() -> Option<MetalFirstFailureEvent> {
    FIRST_FAILURE.lock().ok()?.clone()
}

fn record_attempt(meta: MetalAttemptMetadata) {
    if let Ok(mut ring) = ATTEMPT_RING.lock() {
        if ring.len() >= ATTEMPT_RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(meta);
    }
}

fn record_first_failure(event: MetalFirstFailureEvent) {
    if let Ok(mut guard) = FIRST_FAILURE.lock() {
        if guard.is_none() {
            log::warn!(
                "[metal_import] First structural failure: {:?} (CVReturn: {:?})",
                event.reason,
                event.cv_status
            );
            *guard = Some(event);
        }
    }
}

// ---------------------------------------------------------------------------
// MetalSharedFrame — CVPixelBuffer wrapper from VideoToolbox
// ---------------------------------------------------------------------------

pub struct MetalSharedFrame {
    pub pixel_buffer: CVPixelBufferRef,
    pub width: u32,
    pub height: u32,
}

/// Plane precision exposed by VideoToolbox's IOSurface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetalPixelFormat {
    Nv12,
    P010,
}

// CoreVideo retains/releases are thread-safe for CVPixelBuffer objects. The
// lease carries only that retained opaque handle, so it may cross the decoder
// and presenter threads while the GPU import owns its Metal textures.
unsafe impl Send for MetalSharedFrame {}
unsafe impl Sync for MetalSharedFrame {}

impl MetalSharedFrame {
    /// Return the actual CoreVideo surface format (for example `420f` or
    /// `x420`) without exposing the backing pointer in telemetry.
    pub fn pixel_format_fourcc(&self) -> String {
        if self.pixel_buffer.is_null() {
            return "none".to_string();
        }
        fourcc_string(unsafe { CVPixelBufferGetPixelFormatType(self.pixel_buffer) })
    }

    pub fn duplicate(&self) -> Option<Self> {
        if self.pixel_buffer.is_null() {
            return None;
        }
        unsafe {
            let retained = CVPixelBufferRetain(self.pixel_buffer);
            if !retained.is_null() {
                Some(Self {
                    pixel_buffer: retained,
                    width: self.width,
                    height: self.height,
                })
            } else {
                None
            }
        }
    }
}

impl Drop for MetalSharedFrame {
    fn drop(&mut self) {
        if !self.pixel_buffer.is_null() {
            unsafe {
                CVPixelBufferRelease(self.pixel_buffer);
            }
            self.pixel_buffer = std::ptr::null_mut();
        }
    }
}

/// Extract a `CVPixelBufferRef` from an FFmpeg VideoToolbox hardware `AVFrame`.
///
/// In FFmpeg, VideoToolbox hardware frames store `CVPixelBufferRef` in `data[3]`.
///
/// # Safety
///
/// `frame_ptr` must be a valid, non-null `*const AVFrame` decoded with the VideoToolbox hwaccel.
pub unsafe fn extract_shared_frame(
    frame_ptr: *const ffmpeg_sys_next::AVFrame,
) -> Option<MetalSharedFrame> {
    if frame_ptr.is_null() {
        return None;
    }

    // VideoToolbox stores the CVPixelBuffer in data[3]
    let pixel_buffer = (*frame_ptr).data[3] as CVPixelBufferRef;
    if pixel_buffer.is_null() {
        return None;
    }

    let format_type = CVPixelBufferGetPixelFormatType(pixel_buffer);
    if !matches!(
        format_type,
        K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_VIDEO_RANGE
            | K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_FULL_RANGE
            | K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_VIDEO_RANGE
            | K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_FULL_RANGE
    ) {
        log::debug!(
            "[metal_import] Unsupported CVPixelBuffer format: 0x{:08X}",
            format_type
        );
        return None;
    }

    let width = CVPixelBufferGetWidth(pixel_buffer) as u32;
    let height = CVPixelBufferGetHeight(pixel_buffer) as u32;
    if width == 0 || height == 0 {
        return None;
    }

    // Retain pixel buffer so MetalSharedFrame owns a strong reference
    let retained = CVPixelBufferRetain(pixel_buffer);
    if retained.is_null() {
        return None;
    }

    Some(MetalSharedFrame {
        pixel_buffer: retained,
        width,
        height,
    })
}

// ---------------------------------------------------------------------------
// ImportedMetalNv12Texture — zero-copy NV12 views for wgpu compositor
// ---------------------------------------------------------------------------

pub struct ImportedMetalNv12Texture {
    #[allow(dead_code)]
    pub y_texture: wgpu::Texture,
    #[allow(dead_code)]
    pub uv_texture: wgpu::Texture,
    pub y_view: wgpu::TextureView,
    pub uv_view: wgpu::TextureView,
    pub format: MetalPixelFormat,
}

// ---------------------------------------------------------------------------
// Thread-safe CVMetalTextureCache cache per Metal device pointer
// ---------------------------------------------------------------------------

struct DeviceTextureCache {
    device_ptr: usize,
    cache_ref: CVMetalTextureCacheRef,
}

unsafe impl Send for DeviceTextureCache {}
unsafe impl Sync for DeviceTextureCache {}

static CACHED_TEXTURE_CACHE: StdMutex<Option<DeviceTextureCache>> = StdMutex::new(None);

fn texture_formats(
    format: MetalPixelFormat,
) -> (usize, usize, wgpu::TextureFormat, wgpu::TextureFormat) {
    match format {
        MetalPixelFormat::Nv12 => (
            MTL_PIXEL_FORMAT_R8_UNORM,
            MTL_PIXEL_FORMAT_RG8_UNORM,
            wgpu::TextureFormat::R8Unorm,
            wgpu::TextureFormat::Rg8Unorm,
        ),
        MetalPixelFormat::P010 => (
            MTL_PIXEL_FORMAT_R16_UNORM,
            MTL_PIXEL_FORMAT_RG16_UNORM,
            wgpu::TextureFormat::R16Unorm,
            wgpu::TextureFormat::Rg16Unorm,
        ),
    }
}

fn get_or_create_texture_cache(
    metal_device_ptr: *mut std::ffi::c_void,
) -> Result<CVMetalTextureCacheRef, i32> {
    let mut guard = CACHED_TEXTURE_CACHE.lock().map_err(|_| -1)?;

    let dev_usize = metal_device_ptr as usize;
    if let Some(ref entry) = *guard {
        if entry.device_ptr == dev_usize && !entry.cache_ref.is_null() {
            return Ok(entry.cache_ref);
        }
    }

    // Clean up old cache if device changed
    if let Some(entry) = guard.take() {
        if !entry.cache_ref.is_null() {
            unsafe { CFRelease(entry.cache_ref as *const _) };
        }
    }

    let mut new_cache: CVMetalTextureCacheRef = std::ptr::null_mut();
    let status = unsafe {
        CVMetalTextureCacheCreate(
            std::ptr::null(),
            std::ptr::null(),
            metal_device_ptr,
            std::ptr::null(),
            &mut new_cache,
        )
    };

    if status != 0 || new_cache.is_null() {
        return Err(status);
    }

    *guard = Some(DeviceTextureCache {
        device_ptr: dev_usize,
        cache_ref: new_cache,
    });

    Ok(new_cache)
}

// ---------------------------------------------------------------------------
// import_into_wgpu
// ---------------------------------------------------------------------------

/// Import a `MetalSharedFrame` into wgpu as zero-copy biplanar NV12 texture views.
///
/// Returns `Ok(ImportedMetalNv12Texture)` on success, or `Err(MetalFailureReason)` on failure.
/// The caller must fall back to the CPU upload path on error.
pub fn import_into_wgpu(
    device: &wgpu::Device,
    shared: MetalSharedFrame,
) -> Result<ImportedMetalNv12Texture, MetalFailureReason> {
    use wgpu::hal::api::Metal;

    let attempt_start = Instant::now();

    let pixel_buffer = shared.pixel_buffer;
    let width = shared.width;
    let height = shared.height;

    if pixel_buffer.is_null() {
        return Err(MetalFailureReason::InvalidPixelBuffer);
    }

    let pixel_format = unsafe { CVPixelBufferGetPixelFormatType(pixel_buffer) };
    let format = match pixel_format {
        K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_VIDEO_RANGE
        | K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_8_BI_PLANAR_FULL_RANGE => MetalPixelFormat::Nv12,
        K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_VIDEO_RANGE
        | K_CV_PIXEL_FORMAT_TYPE_420_YP_CB_CR_10_BI_PLANAR_FULL_RANGE => MetalPixelFormat::P010,
        _ => return Err(MetalFailureReason::UnsupportedFormat),
    };
    let (y_mtl_format, uv_mtl_format, y_wgpu_format, uv_wgpu_format) = texture_formats(format);

    let result = unsafe {
        device.as_hal::<Metal, _, Result<ImportedMetalNv12Texture, (MetalFailureReason, Option<i32>)>>(|hal_device| {
            let hal_device = hal_device.ok_or((MetalFailureReason::ImportFailed, None))?;

            // Retrieve raw MTLDevice from wgpu HAL
            let raw_device_guard = hal_device.raw_device().lock();
            let metal_device_ptr: *mut std::ffi::c_void = raw_device_guard.as_ptr() as *mut _;
            drop(raw_device_guard);

            // Get or create CVMetalTextureCache
            let texture_cache = get_or_create_texture_cache(metal_device_ptr).map_err(|status| {
                (MetalFailureReason::CacheCreationFailed, Some(status))
            })?;

            // 1. Create Metal texture for Plane 0 (Y - Luma, R8Unorm)
            let mut y_cv_texture: CVMetalTextureRef = std::ptr::null_mut();
            let status_y = CVMetalTextureCacheCreateTextureFromImage(
                std::ptr::null(),
                texture_cache,
                pixel_buffer,
                std::ptr::null(),
                y_mtl_format,
                width as usize,
                height as usize,
                0,
                &mut y_cv_texture,
            );
            if status_y != 0 || y_cv_texture.is_null() {
                return Err((MetalFailureReason::TextureCreationFailed, Some(status_y)));
            }

            // 2. Create Metal texture for Plane 1 (UV - Chroma, Rg8Unorm)
            let mut uv_cv_texture: CVMetalTextureRef = std::ptr::null_mut();
            let status_uv = CVMetalTextureCacheCreateTextureFromImage(
                std::ptr::null(),
                texture_cache,
                pixel_buffer,
                std::ptr::null(),
                uv_mtl_format,
                (width / 2) as usize,
                (height / 2) as usize,
                1,
                &mut uv_cv_texture,
            );
            if status_uv != 0 || uv_cv_texture.is_null() {
                CFRelease(y_cv_texture as *const _);
                return Err((MetalFailureReason::TextureCreationFailed, Some(status_uv)));
            }

            // Extract native id<MTLTexture>
            let y_mtl_ptr = CVMetalTextureGetTexture(y_cv_texture);
            let uv_mtl_ptr = CVMetalTextureGetTexture(uv_cv_texture);

            if y_mtl_ptr.is_null() || uv_mtl_ptr.is_null() {
                CFRelease(y_cv_texture as *const _);
                CFRelease(uv_cv_texture as *const _);
                return Err((MetalFailureReason::InvalidPixelBuffer, None));
            }

            // Retain raw Metal textures for the life of the wgpu texture wrapper
            CFRetain(y_mtl_ptr as *const _);
            CFRetain(uv_mtl_ptr as *const _);

            let y_metal_tex = metal::Texture::from_ptr(y_mtl_ptr as *mut _);
            let uv_metal_tex = metal::Texture::from_ptr(uv_mtl_ptr as *mut _);

            // Release CoreVideo CVMetalTexture wrappers (the underlying MTLTexture is retained)
            CFRelease(y_cv_texture as *const _);
            CFRelease(uv_cv_texture as *const _);
            CVMetalTextureCacheFlush(texture_cache, 0);

            // Wrap Y texture into wgpu HAL
            let hal_y = <Metal as wgpu::hal::Api>::Device::texture_from_raw(
                y_metal_tex,
                y_wgpu_format,
                metal::MTLTextureType::D2,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
            );

            // Wrap UV texture into wgpu HAL
            let hal_uv = <Metal as wgpu::hal::Api>::Device::texture_from_raw(
                uv_metal_tex,
                uv_wgpu_format,
                metal::MTLTextureType::D2,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width: width / 2,
                    height: height / 2,
                    depth: 1,
                },
            );

            // Promote HAL textures to full wgpu::Texture
            let y_texture = device.create_texture_from_hal::<Metal>(
                hal_y,
                &wgpu::TextureDescriptor {
                    label: Some("VideoToolbox Y Plane (Metal ZeroCopy)"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: y_wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
            );

            let uv_texture = device.create_texture_from_hal::<Metal>(
                hal_uv,
                &wgpu::TextureDescriptor {
                    label: Some("VideoToolbox UV Plane (Metal ZeroCopy)"),
                    size: wgpu::Extent3d {
                        width: width / 2,
                        height: height / 2,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: uv_wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
            );

            let y_view = y_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("VideoToolbox Y View"),
                format: Some(y_wgpu_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::All,
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: 0,
                array_layer_count: Some(1),
                ..Default::default()
            });

            let uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("VideoToolbox UV View"),
                format: Some(uv_wgpu_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::All,
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: 0,
                array_layer_count: Some(1),
                ..Default::default()
            });

            Ok(ImportedMetalNv12Texture {
                y_texture,
                uv_texture,
                y_view,
                uv_view,
                format,
            })
        })
    };

    let attempt_duration_ns = attempt_start.elapsed().as_nanos() as u64;
    match result {
        Ok(imported) => {
            record_attempt(MetalAttemptMetadata {
                attempted_at: attempt_start,
                success: true,
                failure_reason: None,
                cv_status: None,
                attempt_duration_ns,
            });
            Ok(imported)
        }
        Err((reason, status)) => {
            record_attempt(MetalAttemptMetadata {
                attempted_at: attempt_start,
                success: false,
                failure_reason: Some(reason),
                cv_status: status,
                attempt_duration_ns,
            });
            record_first_failure(MetalFirstFailureEvent {
                observed_at: attempt_start,
                reason,
                cv_status: status,
            });
            Err(reason)
        }
    }
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_and_video_range_fourccs_are_renderable_formats() {
        assert_eq!(fourcc_string(0x34323076), "'420v'");
        assert_eq!(fourcc_string(0x34323066), "'420f'");
        assert_eq!(fourcc_string(0x78343230), "'x420'");
        assert_eq!(fourcc_string(0x78663230), "'xf20'");
    }

    #[test]
    fn test_metal_shared_frame_null_guard() {
        let frame = MetalSharedFrame {
            pixel_buffer: std::ptr::null_mut(),
            width: 1920,
            height: 1080,
        };
        assert!(frame.duplicate().is_none());
        unsafe {
            assert!(extract_shared_frame(std::ptr::null()).is_none());
        }
    }

    #[test]
    fn test_metal_diagnostic_ring() {
        let meta = MetalAttemptMetadata {
            attempted_at: Instant::now(),
            success: false,
            failure_reason: Some(MetalFailureReason::CacheCreationFailed),
            cv_status: Some(-6661),
            attempt_duration_ns: 1500,
        };
        record_attempt(meta);

        let records = drain_attempt_log();
        assert!(!records.is_empty());
        let last = records.last().unwrap();
        assert!(!last.success);
        assert_eq!(
            last.failure_reason,
            Some(MetalFailureReason::CacheCreationFailed)
        );
        assert_eq!(last.cv_status, Some(-6661));
    }

    #[test]
    fn test_metal_failure_reasons_serde() {
        let reason = MetalFailureReason::TextureCreationFailed;
        let serialized = serde_json::to_string(&reason).expect("serialize");
        let deserialized: MetalFailureReason =
            serde_json::from_str(&serialized).expect("deserialize");
        assert_eq!(reason, deserialized);
    }

    #[test]
    fn texture_views_match_imported_plane_precision() {
        let (_, _, y_nv12, uv_nv12) = texture_formats(MetalPixelFormat::Nv12);
        assert_eq!(y_nv12, wgpu::TextureFormat::R8Unorm);
        assert_eq!(uv_nv12, wgpu::TextureFormat::Rg8Unorm);

        let (_, _, y_p010, uv_p010) = texture_formats(MetalPixelFormat::P010);
        assert_eq!(y_p010, wgpu::TextureFormat::R16Unorm);
        assert_eq!(uv_p010, wgpu::TextureFormat::Rg16Unorm);
    }

    /// Reproduces the native preview validation boundary with a real Metal
    /// wgpu device. This is intentionally ignored in CI because headless
    /// runners may not expose a Metal adapter; run it locally with:
    ///
    /// `cargo test --manifest-path src-tauri/Cargo.toml metal_import --lib -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "requires a local macOS Metal adapter"]
    async fn headless_texture_views_accept_nv12_and_p010_formats() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let Some(adapter) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
        else {
            eprintln!("SKIP: no graphics adapter available");
            return;
        };

        let adapter_info = adapter.get_info();
        if adapter_info.backend != wgpu::Backend::Metal {
            eprintln!(
                "SKIP: selected backend is {:?}, expected Metal",
                adapter_info.backend
            );
            return;
        }

        let available_features = adapter.features();
        if !available_features.contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM) {
            eprintln!("SKIP: Metal adapter lacks TEXTURE_FORMAT_16BIT_NORM");
            return;
        }

        let (device, _queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Metal import validation device"),
                    required_features: wgpu::Features::TEXTURE_FORMAT_16BIT_NORM,
                    required_limits: adapter.limits(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("Metal device creation should succeed");

        for format in [MetalPixelFormat::Nv12, MetalPixelFormat::P010] {
            let (_, _, y_format, uv_format) = texture_formats(format);
            let y_texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("headless VideoToolbox Y plane"),
                size: wgpu::Extent3d {
                    width: 64,
                    height: 64,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: y_format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let uv_texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("headless VideoToolbox UV plane"),
                size: wgpu::Extent3d {
                    width: 32,
                    height: 32,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: uv_format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });

            // These descriptors intentionally mirror import_into_wgpu. The
            // P010 case catches the old R16/Rg16 texture -> R8/Rg8 view bug.
            let _y_view = y_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("headless VideoToolbox Y view"),
                format: Some(y_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::All,
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: 0,
                array_layer_count: Some(1),
                ..Default::default()
            });
            let _uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("headless VideoToolbox UV view"),
                format: Some(uv_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                aspect: wgpu::TextureAspect::All,
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: 0,
                array_layer_count: Some(1),
                ..Default::default()
            });
        }
    }
}
