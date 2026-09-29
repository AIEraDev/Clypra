#[cfg(test)]
mod tests {
    use crate::engine::diagnostic::HardwareRealityRunner;
    use crate::engine::hardware::adapter::{GpuAdapter, GraphicsBackend};
    use crate::engine::interop::D3D12SurfaceInterop;
    use crate::engine::presenter::{Presenter, RenderedFrame, WgpuPresenter};
    use crate::engine::scheduler::FrameDeadline;
    use crate::engine::surface::{
        GpuFence, ResourceState, SurfaceBackend, SurfaceHandle, SurfaceInterop, SurfaceOwner,
        SurfaceSync, VideoSurface,
    };
    use crate::engine::types::{MediaTime, PixelFormat};

    fn create_test_d3d12_surface(producer_val: u64, consumer_val: u64) -> VideoSurface {
        let sync = SurfaceSync {
            producer_fence: Some(GpuFence::new(1, 0x1111_2222)),
            consumer_fence: Some(GpuFence::new(2, 0x3333_4444)),
            producer_value: producer_val,
            consumer_value: consumer_val,
            fence_value: producer_val,
            is_ready: true,
            keyed_mutex_key: None,
        };
        VideoSurface::new(
            SurfaceBackend::D3D12,
            3840,
            2160,
            PixelFormat::P010,
            sync,
            SurfaceHandle::D3D12 {
                resource_ptr: 0x9876_5432,
            },
        )
    }

    #[test]
    fn test_phase_e1_surface_lifecycle_transitions() {
        let mut surface = create_test_d3d12_surface(10, 0);
        assert_eq!(surface.owner, SurfaceOwner::DecoderOwned);

        // 1. Decoder finish -> ReadyQueue
        assert!(surface.transition_owner(SurfaceOwner::ReadyQueue).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::ReadyQueue);

        // 2. ReadyQueue -> Renderer
        assert!(surface.transition_owner(SurfaceOwner::Renderer).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::Renderer);

        // 3. Renderer -> GpuInFlight
        assert!(surface.transition_owner(SurfaceOwner::GpuInFlight).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::GpuInFlight);

        // 4. GpuInFlight -> Available
        assert!(surface.transition_owner(SurfaceOwner::Available).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::Available);

        // 5. Available -> DecoderOwned (Reused for new frame)
        assert!(surface.transition_owner(SurfaceOwner::DecoderOwned).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::DecoderOwned);

        // Invalid direct transition: DecoderOwned cannot skip directly to Available without cancel/reset
        let mut invalid_surface = create_test_d3d12_surface(10, 0);
        assert!(invalid_surface
            .transition_owner(SurfaceOwner::Renderer)
            .is_err());
    }

    #[test]
    fn test_phase_e2_video_surface_lifetime_token_safety() {
        let mut surface = create_test_d3d12_surface(10, 50);
        surface.transition_owner(SurfaceOwner::ReadyQueue).unwrap();
        surface.transition_owner(SurfaceOwner::Renderer).unwrap();
        surface.transition_owner(SurfaceOwner::GpuInFlight).unwrap();

        // GPU has only completed consumer fence up to 40 -> NOT safe to reuse
        assert!(!surface.is_safe_to_reuse(40));

        // GPU completes consumer fence up to 50 -> Safe to reuse!
        assert!(surface.is_safe_to_reuse(50));
        assert!(surface.is_safe_to_reuse(60));
    }

    fn create_test_adapter(
        name: &str,
        vendor: crate::engine::hardware::GpuVendor,
        luid_val: u64,
        is_discrete: bool,
    ) -> GpuAdapter {
        GpuAdapter {
            id: format!("adapter-{name}"),
            vendor,
            name: name.to_string(),
            luid: Some(luid_val.to_le_bytes()),
            graphics_backend: GraphicsBackend::D3D12,
            is_discrete,
            video_decode: crate::engine::hardware::VideoDecodeCapabilities::default(),
        }
    }

    #[test]
    fn test_phase_e3_zero_copy_decoder_frames_no_double_pooling() {
        let adapter = create_test_adapter(
            "NVIDIA RTX 4080",
            crate::engine::hardware::GpuVendor::Nvidia,
            0x1000,
            true,
        );
        let interop = D3D12SurfaceInterop::new(&adapter);
        let surface = create_test_d3d12_surface(1, 0);

        let metrics = interop.verify_zero_copy_contract(&surface).unwrap();
        assert_eq!(metrics.cpu_readback_bytes, 0);
        assert_eq!(metrics.cpu_upload_bytes, 0);
        assert_eq!(metrics.cross_adapter_bytes, 0);
        assert_eq!(metrics.gpu_staging_copy_bytes, 0);
        assert!(metrics.zero_copy);
    }

    #[test]
    fn test_phase_e5_d3d12_resource_barrier_state_transitions() {
        let adapter = create_test_adapter(
            "Intel UHD Graphics 770",
            crate::engine::hardware::GpuVendor::Intel,
            0x1000,
            false,
        );
        let interop = D3D12SurfaceInterop::new(&adapter);
        let mut surface = create_test_d3d12_surface(1, 0);

        // Initial decoder state is VideoDecodeWrite
        assert_eq!(surface.state, ResourceState::VideoDecodeWrite);

        // Transition barrier to PixelShaderResource for GPU shader sampling
        assert!(interop
            .transition_barrier(&mut surface, ResourceState::PixelShaderResource)
            .is_ok());
        assert_eq!(surface.state, ResourceState::PixelShaderResource);

        // Transition barrier to Common for decoder reuse
        assert!(interop
            .transition_barrier(&mut surface, ResourceState::Common)
            .is_ok());
        assert_eq!(surface.state, ResourceState::Common);

        // Invalid transition: Common cannot directly jump to Present without render
        assert!(interop
            .transition_barrier(&mut surface, ResourceState::Present)
            .is_err());
    }

    #[test]
    fn test_phase_e6_dual_producer_consumer_fences() {
        let adapter = create_test_adapter(
            "NVIDIA T1200 Laptop GPU",
            crate::engine::hardware::GpuVendor::Nvidia,
            0x2000,
            true,
        );
        let interop = D3D12SurfaceInterop::new(&adapter);
        let mut surface = create_test_d3d12_surface(107, 0);

        // Renderer acquires surface
        assert!(interop.acquire_for_render(&mut surface).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::Renderer);
        assert_eq!(surface.state, ResourceState::PixelShaderResource);

        // Presentation completes: release from render with consumer fence value 203
        assert!(interop.release_from_render(&mut surface, 203).is_ok());
        assert_eq!(surface.owner, SurfaceOwner::GpuInFlight);
        assert_eq!(surface.sync.consumer_value, 203);
        assert_eq!(surface.state, ResourceState::Common);

        // Decoder verifies safety before overwriting
        assert!(!surface.is_safe_to_reuse(202));
        assert!(surface.is_safe_to_reuse(203));
    }

    #[test]
    fn test_phase_e7_e8_single_swapchain_presenter() {
        let mut presenter = WgpuPresenter::new(3840, 2160);
        let target = presenter.acquire().unwrap();
        assert_eq!(target.width, 3840);
        assert_eq!(target.height, 2160);

        let surface = create_test_d3d12_surface(1, 0);
        let frame = RenderedFrame {
            surface,
            pts: MediaTime::from_micros(16_667),
            generation: 1,
        };

        let deadline =
            FrameDeadline::for_target(MediaTime::from_micros(16_667), MediaTime::ZERO, 60.0);
        let result = presenter.present(frame, deadline).unwrap();
        assert!(!result.dropped);
        assert!(result.vsync_aligned);
        assert_eq!(presenter.presented_count(), 1);
        assert_eq!(presenter.dropped_count(), 0);
    }

    #[test]
    fn test_phase_e0_e10_hardware_reality_diagnostic_telemetry() {
        let adapter = create_test_adapter(
            "NVIDIA T1200 Laptop GPU",
            crate::engine::hardware::GpuVendor::Nvidia,
            0x5000,
            true,
        );

        let report = HardwareRealityRunner::run_diagnostic(&adapter).unwrap();

        // Validate zero CPU readback and zero cross-adapter transfer
        assert_eq!(report.cpu_readback_bytes, 0);
        assert_eq!(report.cpu_upload_bytes, 0);
        assert_eq!(report.cross_adapter_bytes, 0);
        assert_eq!(report.gpu_staging_copy_bytes, 0);
        assert!(report.zero_copy);
        assert_eq!(report.hw_surface_format, "P010");
        assert_eq!(report.pool_ownership, "decoder-owned");

        let formatted = report.format_telemetry();
        assert!(formatted.contains("Adapter: NVIDIA T1200 Laptop GPU"));
        assert!(formatted.contains("Decoder ──────────────────────────────"));
        assert!(formatted.contains("Backend: D3D12VA"));
        assert!(formatted.contains("Codec: HEVC"));
        assert!(formatted.contains("Profile: Main10"));
        assert!(formatted.contains("HW Surface: P010"));
        assert!(formatted.contains("CPU readback: 0 B"));
        assert!(formatted.contains("CPU upload: 0 B"));
        assert!(formatted.contains("Cross-adapter: 0 B"));
        assert!(formatted.contains("GPU staging copy: 0 B"));
        assert!(formatted.contains("Decoder fence: 1"));
        assert!(formatted.contains("Renderer fence: 200"));
    }
}
