use super::types::PixelFormat;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Native GPU or system backend hosting a surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SurfaceBackend {
    /// Direct3D 12 (preferred Windows hardware backend, same-device zero-copy)
    D3D12,
    /// Direct3D 11 (Windows legacy/fallback hardware backend)
    D3D11,
    /// Apple Metal (macOS hardware backend)
    Metal,
    /// Vulkan (cross-platform / Linux)
    Vulkan,
    /// CPU system memory buffer (fallback when hardware decode is unavailable)
    Cpu,
}

/// Detailed ownership state for video surfaces across the media pipeline.
/// Governs when a surface is safe to write, read, present, and reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SurfaceOwner {
    /// Available in the hardware frame pool for allocation by the decoder
    Available,
    /// Currently being written by the hardware decoder
    DecoderOwned,
    /// Decoded and queued in the ready frame queue awaiting presentation
    ReadyQueue,
    /// Acquired by the renderer / compositor for drawing
    Renderer,
    /// Submitted to the GPU presentation queue; waiting for consumer fence
    GpuInFlight,
}

/// Direct3D 12 resource barrier states.
/// Explicit transitions ensure race-free execution and eliminate validation layer errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceState {
    /// Initial / Common state (D3D12_RESOURCE_STATE_COMMON)
    Common,
    /// Video decode read (reference picture)
    VideoDecodeRead,
    /// Video decode write (active decoding target)
    VideoDecodeWrite,
    /// Shader resource for GPU sampling (D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE)
    PixelShaderResource,
    /// Copy source for blitting / readback
    CopySource,
    /// Copy destination for uploading
    CopyDest,
    /// Presentation target (D3D12_RESOURCE_STATE_PRESENT)
    Present,
}

/// GPU fence abstraction wrapping a hardware synchronization primitive.
/// e.g. ID3D12Fence on Windows D3D12 or MTLSharedEvent on macOS Metal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GpuFence {
    pub fence_id: u64,
    pub raw_handle: usize,
}

impl GpuFence {
    pub fn new(fence_id: u64, raw_handle: usize) -> Self {
        Self {
            fence_id,
            raw_handle,
        }
    }
}

/// Dual producer / consumer synchronization state for backend-owned video surfaces.
/// Ensures the renderer waits for the decoder's producer fence,
/// and the decoder pool never reuses a surface until the GPU signals the consumer fence.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SurfaceSync {
    /// Producer fence signaled by decoder when frame write completes
    pub producer_fence: Option<GpuFence>,
    /// Consumer fence signaled by renderer/presenter when GPU sampling completes
    pub consumer_fence: Option<GpuFence>,
    /// Monotonic value signaled by producer (decoder)
    pub producer_value: u64,
    /// Monotonic value required from consumer before surface is safe for decoder reuse
    pub consumer_value: u64,
    /// Monotonic GPU fence value signalling write completion
    pub fence_value: u64,
    /// Flag indicating whether the surface is currently ready for reading
    pub is_ready: bool,
    /// Optional DirectX Keyed Mutex key for cross-API synchronization
    pub keyed_mutex_key: Option<u64>,
}

impl SurfaceSync {
    pub fn new_with_fences(
        producer_fence: Option<GpuFence>,
        consumer_fence: Option<GpuFence>,
        producer_value: u64,
        consumer_value: u64,
    ) -> Self {
        Self {
            producer_fence,
            consumer_fence,
            producer_value,
            consumer_value,
            fence_value: producer_value,
            is_ready: true,
            keyed_mutex_key: None,
        }
    }

    #[inline]
    pub fn is_safe_for_decoder_reuse(&self, current_gpu_consumer_val: u64) -> bool {
        current_gpu_consumer_val >= self.consumer_value
    }
}

/// Platform-specific native handle to a GPU or memory surface.
#[derive(Debug, Clone)]
pub enum SurfaceHandle {
    /// Direct3D 12 ID3D12Resource raw pointer address
    D3D12 { resource_ptr: usize },
    /// Direct3D 11 ID3D11Texture2D raw pointer address + optional DXGI shared NT handle
    D3D11 {
        texture_ptr: usize,
        shared_handle: Option<usize>,
    },
    /// Apple Metal MTLTexture object address
    Metal { texture_id: usize },
    /// CPU-accessible pixel buffer in system memory
    Cpu {
        buffer: Arc<Vec<u8>>,
        stride_y: usize,
        stride_uv: usize,
    },
}

/// First-class native engine surface object.
/// Encapsulates GPU resource lifetime, dimensions, format, state, and synchronization.
#[derive(Debug, Clone)]
pub struct VideoSurface {
    pub backend: SurfaceBackend,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub state: ResourceState,
    pub owner: SurfaceOwner,
    pub sync: SurfaceSync,
    pub handle: SurfaceHandle,
}

impl VideoSurface {
    pub fn new(
        backend: SurfaceBackend,
        width: u32,
        height: u32,
        format: PixelFormat,
        sync: SurfaceSync,
        handle: SurfaceHandle,
    ) -> Self {
        let (state, owner) = match backend {
            SurfaceBackend::Cpu => (ResourceState::Common, SurfaceOwner::DecoderOwned),
            _ => (ResourceState::VideoDecodeWrite, SurfaceOwner::DecoderOwned),
        };
        Self {
            backend,
            width,
            height,
            format,
            state,
            owner,
            sync,
            handle,
        }
    }

    #[inline]
    pub fn is_hardware(&self) -> bool {
        self.backend != SurfaceBackend::Cpu
    }

    #[inline]
    pub fn is_ready(&self) -> bool {
        self.sync.is_ready
    }

    /// Transitions ownership token across the lifecycle:
    /// Available -> DecoderOwned -> ReadyQueue -> Renderer -> GpuInFlight -> Available
    pub fn transition_owner(&mut self, next_owner: SurfaceOwner) -> Result<(), String> {
        let valid = match (self.owner, next_owner) {
            (SurfaceOwner::Available, SurfaceOwner::DecoderOwned) => true,
            (SurfaceOwner::DecoderOwned, SurfaceOwner::ReadyQueue) => true,
            (SurfaceOwner::ReadyQueue, SurfaceOwner::Renderer) => true,
            (SurfaceOwner::Renderer, SurfaceOwner::GpuInFlight) => true,
            (SurfaceOwner::GpuInFlight, SurfaceOwner::Available) => true,
            // Allow reset to available on flush/cancel
            (_, SurfaceOwner::Available) => true,
            _ => false,
        };

        if valid {
            self.owner = next_owner;
            Ok(())
        } else {
            Err(format!(
                "Invalid surface ownership transition from {:?} to {:?}",
                self.owner, next_owner
            ))
        }
    }

    /// Transitions GPU resource state (e.g. VideoDecodeWrite -> PixelShaderResource).
    #[inline]
    pub fn transition_state(&mut self, next_state: ResourceState) {
        self.state = next_state;
    }

    /// Checks if this surface is completely safe to be reused by the decoder for new frame write.
    #[inline]
    pub fn is_safe_to_reuse(&self, current_gpu_consumer_val: u64) -> bool {
        self.owner == SurfaceOwner::Available
            || (self.owner == SurfaceOwner::GpuInFlight
                && self
                    .sync
                    .is_safe_for_decoder_reuse(current_gpu_consumer_val))
    }
}

/// RAII lease token tracking that a surface is checked out for rendering.
#[derive(Debug)]
pub struct SurfaceLifetimeToken {
    pub surface_id: u64,
    pub owner: SurfaceOwner,
}

impl SurfaceLifetimeToken {
    pub fn new(surface_id: u64, owner: SurfaceOwner) -> Self {
        Self { surface_id, owner }
    }
}

/// Abstraction for bridging decoder surfaces into the active renderer.
/// Each backend implements its optimal zero-copy or sharing strategy.
pub trait SurfaceInterop: Send + Sync {
    /// Interop backend identifier
    fn backend(&self) -> SurfaceBackend;

    /// Verifies if a given surface can be zero-copy consumed by this interop layer
    fn can_import(&self, surface: &VideoSurface) -> bool;

    /// Transitions GPU resource barrier state (e.g. VideoDecodeWrite -> PixelShaderResource)
    fn transition_barrier(
        &self,
        surface: &mut VideoSurface,
        target_state: ResourceState,
    ) -> Result<(), String>;

    /// Acquires synchronization on the surface before rendering
    fn acquire_for_render(&self, surface: &mut VideoSurface) -> Result<(), String>;

    /// Releases synchronization on the surface after presentation completes
    fn release_from_render(
        &self,
        surface: &mut VideoSurface,
        consumer_fence_val: u64,
    ) -> Result<(), String>;
}
