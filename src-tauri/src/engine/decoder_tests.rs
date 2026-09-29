#[cfg(test)]
mod tests {
    use crate::engine::decoder::*;
    use crate::engine::hardware::adapter::*;
    use crate::engine::surface::SurfaceBackend;
    use crate::engine::types::*;

    #[test]
    fn test_phase_d1_exact_codec_probing() {
        let cap = DecodeCapability {
            codec: CodecType::Hevc,
            profile: CodecProfile::Main10,
            bit_depth: 10,
            chroma: ChromaSubsampling::Yuv420,
            max_width: 8192,
            max_height: 8192,
            max_fps: 120.0,
            output_formats: vec![PixelFormat::P010],
            is_hardware: true,
        };

        // 4K 60fps 10-bit HEVC P010 matches
        assert!(cap.matches(
            CodecType::Hevc,
            CodecProfile::Main10,
            10,
            ChromaSubsampling::Yuv420,
            3840,
            2160,
            60.0,
            PixelFormat::P010,
        ));

        // Incompatible format (e.g. asking for 8-bit NV12 when only P010 is exposed)
        assert!(!cap.matches(
            CodecType::Hevc,
            CodecProfile::Main10,
            10,
            ChromaSubsampling::Yuv420,
            3840,
            2160,
            60.0,
            PixelFormat::Nv12,
        ));

        // Exceeding max FPS (e.g. 240 fps)
        assert!(!cap.matches(
            CodecType::Hevc,
            CodecProfile::Main10,
            10,
            ChromaSubsampling::Yuv420,
            3840,
            2160,
            240.0,
            PixelFormat::P010,
        ));
    }

    #[test]
    fn test_phase_d2_playback_device_topology_matching() {
        let mut registry = AdapterRegistry::new();

        let intel_igpu = GpuAdapter::new(
            "gpu-intel",
            GpuVendor::Intel,
            "Intel(R) UHD Graphics",
            Some([1, 0, 0, 0, 0, 0, 0, 0]),
            GraphicsBackend::D3D12,
            false,
            VideoDecodeCapabilities::new(vec![DecodeCapability {
                codec: CodecType::Hevc,
                profile: CodecProfile::Main10,
                bit_depth: 10,
                chroma: ChromaSubsampling::Yuv420,
                max_width: 4096,
                max_height: 4096,
                max_fps: 60.0,
                output_formats: vec![PixelFormat::P010],
                is_hardware: true,
            }]),
        );

        let nvidia_dgpu = GpuAdapter::new(
            "gpu-nvidia",
            GpuVendor::Nvidia,
            "NVIDIA RTX A2000 Laptop GPU",
            Some([2, 0, 0, 0, 0, 0, 0, 0]),
            GraphicsBackend::D3D12,
            true,
            VideoDecodeCapabilities::new(vec![DecodeCapability {
                codec: CodecType::Hevc,
                profile: CodecProfile::Main10,
                bit_depth: 10,
                chroma: ChromaSubsampling::Yuv420,
                max_width: 8192,
                max_height: 8192,
                max_fps: 120.0,
                output_formats: vec![PixelFormat::P010],
                is_hardware: true,
            }]),
        );

        registry.register(intel_igpu.clone());
        registry.register(nvidia_dgpu.clone());

        // Device selection selects the discrete GPU and binds decode & render to the same adapter
        let device = registry
            .select_optimal_playback_device()
            .expect("Optimal device");
        assert_eq!(device.render_adapter.id, "gpu-nvidia");
        assert_eq!(device.decode_adapter.id, "gpu-nvidia");
        assert!(device.is_same_device());
        assert!(!device.cross_adapter_copy);

        // Hybrid separation test
        let hybrid = PlaybackDevice::hybrid(nvidia_dgpu, intel_igpu);
        assert!(!hybrid.is_same_device());
        assert!(hybrid.cross_adapter_copy);
    }

    #[test]
    fn test_phase_d6_dynamic_surface_pool_capacity() {
        let hevc_stream = StreamProfile::hevc_4k_10bit_60fps();
        let pool = DecoderSurfacePool::new(&hevc_stream, SurfaceBackend::D3D12);

        // Capacity: 16 reference frames + 4 pipeline + 2 in-flight + 4 prefetch = 26
        assert_eq!(pool.capacity, 26);
        assert_eq!(pool.width, 3840);
        assert_eq!(pool.height, 2160);
    }

    #[test]
    fn test_phase_d8_generation_cancellation() {
        let stream = StreamProfile::hevc_4k_10bit_60fps();
        let backend = D3D12VADecoderBackend;
        let mut session = backend
            .create(&DecoderRequest {
                stream,
                adapter_id: "test-adapter".to_string(),
                usage: DecodeUsage::RealtimePlayback,
            })
            .expect("Create D3D12VA session");

        // Submit packet for generation 100
        let packet_100 = EncodedPacket {
            data: vec![0x00, 0x00, 0x00, 0x01],
            pts: MediaTime::ZERO,
            dts: MediaTime::ZERO,
            is_keyframe: true,
            generation: 100,
        };
        session.submit(packet_100).expect("Submit packet 100");

        // Seek increments generation to 101
        session.cancel_generation(101);

        // Stale packet from generation 100 is rejected immediately
        let stale_packet = EncodedPacket {
            data: vec![0x00, 0x00, 0x00, 0x01],
            pts: MediaTime::from_micros(16_667),
            dts: MediaTime::from_micros(16_667),
            is_keyframe: false,
            generation: 100,
        };
        let submit_err = session.submit(stale_packet);
        assert_eq!(submit_err, Err(DecoderError::GenerationCancelled(100)));
    }

    /// PHASE D VERTICAL SLICE ACCEPTANCE TEST:
    /// 4K60 HEVC Main10 -> D3D12VA -> D3D12 GPU Surface -> VideoSurface
    /// Proves:
    /// - zero_copy = true
    /// - cpu_readback_bytes = 0
    /// - cpu_upload_bytes = 0
    /// - cross_adapter_bytes = 0
    #[test]
    fn test_phase_d_vertical_slice_4k60_hevc_10bit() {
        let stream = StreamProfile::hevc_4k_10bit_60fps();
        let planner = DecoderPlanner::new();

        let request = DecoderRequest {
            stream: stream.clone(),
            adapter_id: "d3d12-adapter".to_string(),
            usage: DecodeUsage::RealtimePlayback,
        };

        // 1. Data-driven planner selects D3D12VA for 4K 10-bit HEVC
        let selected_backend = planner.select_backend(&request).expect("Select backend");
        assert_eq!(selected_backend.name(), "D3D12VA");
        assert_eq!(selected_backend.surface_backend(), SurfaceBackend::D3D12);

        // 2. Open decode session
        let mut session = planner.open_session(&request).expect("Open session");
        assert_eq!(session.stream_info().codec, CodecType::Hevc);
        assert_eq!(session.stream_info().bit_depth, 10);
        assert_eq!(session.stream_info().pixel_format, PixelFormat::P010);

        // 3. Perform keyframe-aware seek to 10.0s
        let seek_target = SeekTarget::new(
            MediaTime::from_secs_f64(10.0),
            MediaTime::from_secs_f64(8.0), // Preceding keyframe
        );
        session.seek(seek_target, 501).expect("Seek");

        // 4. Submit encoded packet at target timestamp
        let packet = EncodedPacket {
            data: vec![0; 4096],
            pts: MediaTime::from_secs_f64(10.0),
            dts: MediaTime::from_secs_f64(10.0),
            is_keyframe: true,
            generation: 501,
        };
        session.submit(packet).expect("Submit packet");

        // 5. Receive decoded frame backed by a native D3D12 VideoSurface
        let frame_opt = session.receive().expect("Receive frame");
        let frame = frame_opt.expect("Expected frame");

        assert_eq!(frame.pts, MediaTime::from_secs_f64(10.0));
        assert_eq!(frame.generation, 501);
        assert_eq!(frame.surface.backend, SurfaceBackend::D3D12);
        assert_eq!(frame.surface.width, 3840);
        assert_eq!(frame.surface.height, 2160);
        assert_eq!(frame.surface.format, PixelFormat::P010);
        assert!(frame.surface.is_hardware());
        assert!(frame.surface.is_ready());

        // 6. Verify zero CPU readback telemetry invariants mathematically
        let telemetry = session.telemetry();
        assert_eq!(telemetry.decoder_backend, "D3D12VA");
        assert!(telemetry.is_hardware);
        assert!(telemetry.zero_copy);
        assert_eq!(
            telemetry.cpu_readback_bytes, 0,
            "Zero CPU readback invariant violated!"
        );
        assert_eq!(
            telemetry.cpu_upload_bytes, 0,
            "Zero CPU upload invariant violated!"
        );
        assert_eq!(
            telemetry.cross_adapter_bytes, 0,
            "Zero cross-adapter copy invariant violated!"
        );
        assert_eq!(telemetry.surface_copy_count, 0);
    }
}
