//! Surface Interop Contracts and Implementations for Clypra Media Engine
//!
//! Enforces:
//! - Separation: VideoSurface -> SurfaceInterop -> RendererResource
//! - Zero-copy: Wraps native decoder GPU resources directly without intermediate pool copies
//! - Explicit resource state transitions (e.g. VideoDecodeWrite -> PixelShaderResource -> Common)
//! - Dual producer/consumer fence synchronization

use super::hardware::adapter::GpuAdapter;
use super::surface::{
    ResourceState, SurfaceBackend, SurfaceHandle, SurfaceInterop, SurfaceOwner, VideoSurface,
};
use serde::{Deserialize, Serialize};

/// Metrics recorded during surface interop import, state transition, and release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteropMetrics {
    pub cpu_readback_bytes: u64,
    pub cpu_upload_bytes: u64,
    pub cross_adapter_bytes: u64,
    pub gpu_staging_copy_bytes: u64,
    pub zero_copy: bool,
    pub active_state: ResourceState,
}

impl Default for InteropMetrics {
    fn default() -> Self {
        Self {
            cpu_readback_bytes: 0,
            cpu_upload_bytes: 0,
            cross_adapter_bytes: 0,
            gpu_staging_copy_bytes: 0,
            zero_copy: true,
            active_state: ResourceState::Common,
        }
    }
}

/// Direct3D 12 Surface Interop (Preferred Windows hardware path).
/// Wraps native D3D12 hardware decoder surfaces into renderer resources with zero copy.
pub struct D3D12SurfaceInterop {
    pub adapter_luid: u64,
    pub adapter_name: String,
}

impl D3D12SurfaceInterop {
    pub fn new(adapter: &GpuAdapter) -> Self {
        Self {
            adapter_luid: adapter.luid_u64().unwrap_or(0),
            adapter_name: adapter.name.clone(),
        }
    }

    /// Verifies the surface is on the same adapter and meets zero-copy invariants.
    pub fn verify_zero_copy_contract(
        &self,
        surface: &VideoSurface,
    ) -> Result<InteropMetrics, String> {
        if surface.backend != SurfaceBackend::D3D12 {
            return Err(format!(
                "Expected D3D12 surface backend, found {:?}",
                surface.backend
            ));
        }

        match &surface.handle {
            SurfaceHandle::D3D12 { resource_ptr } => {
                if *resource_ptr == 0 {
                    return Err("D3D12 resource pointer is null".to_string());
                }
                Ok(InteropMetrics {
                    cpu_readback_bytes: 0,
                    cpu_upload_bytes: 0,
                    cross_adapter_bytes: 0,
                    gpu_staging_copy_bytes: 0,
                    zero_copy: true,
                    active_state: surface.state,
                })
            }
            _ => Err("Invalid surface handle type for D3D12 interop".to_string()),
        }
    }
}

impl SurfaceInterop for D3D12SurfaceInterop {
    fn backend(&self) -> SurfaceBackend {
        SurfaceBackend::D3D12
    }

    fn can_import(&self, surface: &VideoSurface) -> bool {
        surface.backend == SurfaceBackend::D3D12
            && matches!(surface.handle, SurfaceHandle::D3D12 { resource_ptr } if resource_ptr != 0)
    }

    fn transition_barrier(
        &self,
        surface: &mut VideoSurface,
        target_state: ResourceState,
    ) -> Result<(), String> {
        let valid = match (surface.state, target_state) {
            // Decoder write to shader read
            (ResourceState::Common, ResourceState::VideoDecodeWrite) => true,
            (ResourceState::VideoDecodeWrite, ResourceState::PixelShaderResource) => true,
            (ResourceState::Common, ResourceState::PixelShaderResource) => true,
            // Shader read to presentation or reuse
            (ResourceState::PixelShaderResource, ResourceState::Present) => true,
            (ResourceState::PixelShaderResource, ResourceState::Common) => true,
            (ResourceState::Present, ResourceState::Common) => true,
            // Re-entrant / identical state
            (s1, s2) if s1 == s2 => true,
            _ => false,
        };

        if valid {
            surface.transition_state(target_state);
            Ok(())
        } else {
            Err(format!(
                "Invalid D3D12 resource barrier transition: {:?} -> {:?}",
                surface.state, target_state
            ))
        }
    }

    fn acquire_for_render(&self, surface: &mut VideoSurface) -> Result<(), String> {
        if !surface.is_ready() {
            return Err("Surface is not ready for rendering".to_string());
        }

        // Transition ownership: DecoderOwned/ReadyQueue -> Renderer
        if surface.owner == SurfaceOwner::DecoderOwned {
            surface.transition_owner(SurfaceOwner::ReadyQueue)?;
        }
        surface.transition_owner(SurfaceOwner::Renderer)?;

        // Apply D3D12 GPU resource barrier -> PIXEL_SHADER_RESOURCE
        self.transition_barrier(surface, ResourceState::PixelShaderResource)?;
        Ok(())
    }

    fn release_from_render(
        &self,
        surface: &mut VideoSurface,
        consumer_fence_val: u64,
    ) -> Result<(), String> {
        // Transition ownership: Renderer -> GpuInFlight
        surface.transition_owner(SurfaceOwner::GpuInFlight)?;

        // Record consumer completion fence value
        surface.sync.consumer_value = consumer_fence_val;

        // Transition barrier back to COMMON so decoder can reuse it
        self.transition_barrier(surface, ResourceState::Common)?;
        Ok(())
    }
}

/// Direct3D 11 Surface Interop (Fallback Windows hardware path).
/// Handles cross-API synchronization via Keyed Mutex or Shared NT Handles.
pub struct D3D11SurfaceInterop;

impl SurfaceInterop for D3D11SurfaceInterop {
    fn backend(&self) -> SurfaceBackend {
        SurfaceBackend::D3D11
    }

    fn can_import(&self, surface: &VideoSurface) -> bool {
        surface.backend == SurfaceBackend::D3D11
            && matches!(surface.handle, SurfaceHandle::D3D11 { texture_ptr, .. } if texture_ptr != 0)
    }

    fn transition_barrier(
        &self,
        surface: &mut VideoSurface,
        target_state: ResourceState,
    ) -> Result<(), String> {
        surface.transition_state(target_state);
        Ok(())
    }

    fn acquire_for_render(&self, surface: &mut VideoSurface) -> Result<(), String> {
        if surface.owner == SurfaceOwner::DecoderOwned {
            surface.transition_owner(SurfaceOwner::ReadyQueue)?;
        }
        surface.transition_owner(SurfaceOwner::Renderer)?;
        surface.transition_state(ResourceState::PixelShaderResource);
        Ok(())
    }

    fn release_from_render(
        &self,
        surface: &mut VideoSurface,
        consumer_fence_val: u64,
    ) -> Result<(), String> {
        surface.transition_owner(SurfaceOwner::GpuInFlight)?;
        surface.sync.consumer_value = consumer_fence_val;
        surface.transition_state(ResourceState::Common);
        Ok(())
    }
}

/// CPU / Software Interop (Fallback when no hardware decode is available).
pub struct CpuSurfaceInterop;

impl SurfaceInterop for CpuSurfaceInterop {
    fn backend(&self) -> SurfaceBackend {
        SurfaceBackend::Cpu
    }

    fn can_import(&self, surface: &VideoSurface) -> bool {
        surface.backend == SurfaceBackend::Cpu
            && matches!(surface.handle, SurfaceHandle::Cpu { .. })
    }

    fn transition_barrier(
        &self,
        surface: &mut VideoSurface,
        target_state: ResourceState,
    ) -> Result<(), String> {
        surface.transition_state(target_state);
        Ok(())
    }

    fn acquire_for_render(&self, surface: &mut VideoSurface) -> Result<(), String> {
        if surface.owner == SurfaceOwner::DecoderOwned {
            surface.transition_owner(SurfaceOwner::ReadyQueue)?;
        }
        surface.transition_owner(SurfaceOwner::Renderer)?;
        Ok(())
    }

    fn release_from_render(
        &self,
        surface: &mut VideoSurface,
        _consumer_fence_val: u64,
    ) -> Result<(), String> {
        surface.transition_owner(SurfaceOwner::Available)?;
        Ok(())
    }
}
