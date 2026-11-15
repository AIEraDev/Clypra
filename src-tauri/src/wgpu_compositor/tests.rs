#[cfg(test)]
mod tests {
    use crate::wgpu_compositor::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_wgpu_nv12_shader_render() {
        let renderer = NativeWgpuRenderer::new().await;
        if let Ok(renderer) = renderer {
            let width = 64u32;
            let height = 64u32;

            // Synthetic Rec. 709 neutral gray in NV12: Y=128, U=128, V=128
            let y_plane = vec![128u8; (width * height) as usize];
            let uv_plane = vec![128u8; (width * height / 2) as usize];

            let rgba = renderer
                .render_nv12_frame(width, height, &y_plane, &uv_plane)
                .await;
            assert!(rgba.is_ok(), "NV12 rendering failed: {:?}", rgba.err());
            let bytes = rgba.unwrap();
            assert_eq!(bytes.len(), (width * height * 4) as usize);

            // Neutral gray check: R, G, B should be approximately equal and non-zero
            let r = bytes[0];
            let g = bytes[1];
            let b = bytes[2];
            let a = bytes[3];
            assert_eq!(a, 255, "Alpha channel must be 255");
            let diff_rg = (r as i32 - g as i32).abs();
            let diff_gb = (g as i32 - b as i32).abs();
            assert!(
                diff_rg <= 10 && diff_gb <= 10,
                "Color should be neutral gray, got R={} G={} B={}",
                r,
                g,
                b
            );
        }
    }

    #[tokio::test]
    async fn test_wgpu_metadata_driven_nv12_shader_render() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!(
                    "Skipping metadata-driven YUV test (no GPU adapter): {}",
                    error
                );
                return;
            }
        };

        let width = 64u32;
        let height = 64u32;
        let y_plane = vec![128u8; (width * height) as usize];
        let uv_plane = vec![128u8; (width.div_ceil(2) * height.div_ceil(2) * 2) as usize];
        let params = ColorTransformUniforms {
            color_space: 0,
            range: 0,
            tonemap_operator: 0,
            target_peak_nits: 100.0,
        };

        let rgba = renderer
            .render_nv12_frame_with_color(width, height, &y_plane, &uv_plane, &params)
            .await
            .expect("metadata-driven NV12 rendering failed");

        assert_eq!(rgba.len(), (width * height * 4) as usize);
        let r = rgba[0];
        let g = rgba[1];
        let b = rgba[2];
        assert_eq!(rgba[3], 255, "Alpha channel must be opaque");
        assert!((r as i32 - g as i32).abs() <= 10);
        assert!((g as i32 - b as i32).abs() <= 10);
    }

    #[tokio::test]
    async fn test_native_preview_session_scales_source_to_output() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!(
                    "Skipping native preview session test (no GPU adapter): {}",
                    error
                );
                return;
            }
        };

        let nv12_supported = renderer
            .device
            .features()
            .contains(wgpu::Features::TEXTURE_FORMAT_NV12);
        let capabilities = PreviewCapabilities::probe(&renderer.adapter, &renderer.device);
        let gpu = Arc::new(GpuContext {
            instance: renderer.instance.clone(),
            adapter: renderer.adapter,
            info: renderer.gpu_info,
            capabilities,
            device: renderer.device,
            queue: renderer.queue,
            nv12_supported,
            dxgi_adapter_index: None,
        });
        let mut session = NativePreviewSession::new(gpu);
        let source_width = 64u32;
        let source_height = 64u32;
        let output_width = 32u32;
        let output_height = 16u32;
        let y_plane = vec![128u8; (source_width * source_height) as usize];
        let uv_plane =
            vec![128u8; (source_width.div_ceil(2) * source_height.div_ceil(2) * 2) as usize];

        let rgba = session
            .render_nv12_frame(
                source_width,
                source_height,
                output_width,
                output_height,
                &y_plane,
                &uv_plane,
                &ColorTransformUniforms::default(),
            )
            .await
            .expect("scaled native preview render failed");

        assert_eq!(rgba.len(), (output_width * output_height * 4) as usize);
        assert_eq!(rgba[3], 255);
    }

    #[tokio::test]
    async fn test_nv12_full_quad_coverage() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!(
                    "Skipping NV12 full quad coverage test (no GPU adapter): {}",
                    error
                );
                return;
            }
        };

        let width = 64u32;
        let height = 64u32;
        // Rec. 709 neutral gray: Y=128, U=128, V=128
        let y_plane = vec![128u8; (width * height) as usize];
        let uv_plane = vec![128u8; (width * height / 2) as usize];

        let rgba = renderer
            .render_nv12_frame(width, height, &y_plane, &uv_plane)
            .await
            .expect("NV12 rendering must succeed");

        assert_eq!(rgba.len(), (width * height * 4) as usize);

        // Check top-left corner (first triangle)
        let tl_r = rgba[0];
        let tl_g = rgba[1];
        let tl_b = rgba[2];
        let tl_a = rgba[3];
        assert_eq!(tl_a, 255, "Top-left alpha must be 255");
        assert!(
            tl_r > 0 && tl_g > 0 && tl_b > 0,
            "Top-left must not be black"
        );

        // Check bottom-right corner (second triangle, which failed when draw(0..3) was used)
        let br_offset = ((width * height - 1) * 4) as usize;
        let br_r = rgba[br_offset];
        let br_g = rgba[br_offset + 1];
        let br_b = rgba[br_offset + 2];
        let br_a = rgba[br_offset + 3];
        assert_eq!(
            br_a, 255,
            "Bottom-right alpha must be 255 (full quad coverage)"
        );
        assert!(
            br_r > 0 && br_g > 0 && br_b > 0,
            "Bottom-right corner must be shaded (second triangle of fullscreen quad)"
        );
    }

    #[tokio::test]
    async fn test_pixel_hevc_frame_composition() {
        let video_path =
            "/Users/AIEraDev/Documents/clypra-testing-assets/PXL_20260722_122750919.mp4";
        if !std::path::Path::new(video_path).exists() {
            println!("Video asset not found, skipping");
            return;
        }

        let mut decoder = crate::filmstrip_engine::decoder::VideoDecoder::open_hardware(video_path)
            .expect("open decoder");
        let (y_plane, uv_plane, width, height, color) = decoder
            .decode_frame_raw_nv12_with_options(
                0.0,
                crate::filmstrip_engine::decoder::DecodeFrameOptions::default(),
                || false,
            )
            .expect("decode frame");

        println!(
            "Decoded: width={}, height={}, color={:?}, y_len={}, uv_len={}",
            width,
            height,
            color,
            y_plane.len(),
            uv_plane.len()
        );

        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!("No GPU adapter: {}", error);
                return;
            }
        };

        let nv12_supported = renderer
            .device
            .features()
            .contains(wgpu::Features::TEXTURE_FORMAT_NV12);
        let capabilities = PreviewCapabilities::probe(&renderer.adapter, &renderer.device);
        let gpu = Arc::new(GpuContext {
            instance: renderer.instance.clone(),
            adapter: renderer.adapter,
            info: renderer.gpu_info,
            capabilities,
            device: renderer.device,
            queue: renderer.queue,
            nv12_supported,
            dxgi_adapter_index: None,
        });

        let mut session = NativePreviewSession::new(gpu.clone());
        let params = ColorTransformUniforms {
            color_space: 0,
            range: if color.range == "full" { 1 } else { 0 },
            tonemap_operator: 0,
            target_peak_nits: 100.0,
        };

        let texture = session
            .render_nv12_frame_to_texture(
                "test-layer",
                width,
                height,
                width,
                height,
                &y_plane,
                &uv_plane,
                &params,
            )
            .expect("nv12 to texture");

        println!(
            "Texture created: width={}, height={}",
            texture.width(),
            texture.height()
        );

        let output_w = 960u32;
        let output_h = 540u32;
        let compositor = session.get_or_create_compositor(
            output_w,
            output_h,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let layer = CompositeLayer {
            texture_view: &view,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: crate::wgpu_compositor::BlendMode::Normal,
            transform: LayerTransform {
                translate_x: 0.0,
                translate_y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_rad: 0.0,
                canvas_aspect_ratio: 1.0,
            },
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            is_premultiplied: false,
        };

        let (rgba, compose_us, readback_us, map_wait_us) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &gpu.device,
                &gpu.queue,
                output_w,
                output_h,
                &[layer],
                Some(wgpu::Color {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                }),
            )
            .await
            .expect("render_to_rgba_bytes");

        println!(
            "Composited RGBA: bytes={}, compose_us={}, readback_us={}, map_wait_us={}",
            rgba.len(),
            compose_us,
            readback_us,
            map_wait_us
        );

        let mut non_black_count = 0usize;
        let mut min_rgb = [255u8; 3];
        let mut max_rgb = [0u8; 3];
        for chunk in rgba.chunks_exact(4) {
            let (r, g, b) = (chunk[0], chunk[1], chunk[2]);
            if r > 0 || g > 0 || b > 0 {
                non_black_count += 1;
                min_rgb[0] = min_rgb[0].min(r);
                min_rgb[1] = min_rgb[1].min(g);
                min_rgb[2] = min_rgb[2].min(b);
                max_rgb[0] = max_rgb[0].max(r);
                max_rgb[1] = max_rgb[1].max(g);
                max_rgb[2] = max_rgb[2].max(b);
            }
        }

        let total_pixels = (output_w * output_h) as usize;
        println!(
            "Pixels: total={}, non_black={}, min_rgb={:?}, max_rgb={:?}",
            total_pixels, non_black_count, min_rgb, max_rgb
        );
        println!("First 16 RGBA pixels: {:?}", &rgba[..64]);
        println!(
            "Middle RGBA pixels (row 270): {:?}",
            &rgba[(270 * 960 + 480) * 4..(270 * 960 + 484) * 4]
        );
    }

    #[tokio::test]
    async fn test_staging_ring_bounded_allocation_and_buffer_reuse() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!("No GPU adapter: {}", error);
                return;
            }
        };

        let mut ring = crate::wgpu_compositor::multi_track_composer::StagingRing::<2>::new();
        assert_eq!(ring.allocation_count(), 0);
        assert_eq!(ring.reuse_count(), 0);

        // Preallocate 2 buffers of 1024 bytes each
        ring.preallocate(&renderer.device, 1024, "Test Ring");
        assert_eq!(ring.allocation_count(), 2);
        assert_eq!(ring.reuse_count(), 0);

        // Acquire slot 0 (reuse)
        let _buf0 = ring.acquire(&renderer.device, 512, "Test Acquire");
        assert_eq!(ring.allocation_count(), 2);
        assert_eq!(ring.reuse_count(), 1);

        // Acquire slot 1 (reuse)
        let _buf1 = ring.acquire(&renderer.device, 1024, "Test Acquire");
        assert_eq!(ring.allocation_count(), 2);
        assert_eq!(ring.reuse_count(), 2);

        // Acquire slot 0 again (reuse)
        let _buf2 = ring.acquire(&renderer.device, 256, "Test Acquire");
        assert_eq!(ring.allocation_count(), 2);
        assert_eq!(ring.reuse_count(), 3);

        // When requesting larger size (2048), slot 1 is reallocated to 2048
        let _buf3 = ring.acquire(&renderer.device, 2048, "Test Acquire");
        assert_eq!(ring.allocation_count(), 3);
        assert_eq!(ring.reuse_count(), 3);

        // Next acquire hits slot 0, which still had capacity 1024, so it is also resized to 2048
        let _buf4 = ring.acquire(&renderer.device, 2048, "Test Acquire");
        assert_eq!(ring.allocation_count(), 4);
        assert_eq!(ring.reuse_count(), 3);

        // Both slots in the ring now have capacity 2048; subsequent requests continue to reuse
        let _buf5 = ring.acquire(&renderer.device, 2048, "Test Acquire");
        assert_eq!(ring.allocation_count(), 4);
        assert_eq!(ring.reuse_count(), 4);

        let _buf6 = ring.acquire(&renderer.device, 1024, "Test Acquire");
        assert_eq!(ring.allocation_count(), 4);
        assert_eq!(ring.reuse_count(), 5);
    }

    #[tokio::test]
    async fn test_multi_track_compositor_staging_ring_readback_reuse() {
        let renderer = match NativeWgpuRenderer::new().await {
            Ok(renderer) => renderer,
            Err(error) => {
                eprintln!("No GPU adapter: {}", error);
                return;
            }
        };

        let capabilities = PreviewCapabilities::probe(&renderer.adapter, &renderer.device);
        let gpu = Arc::new(GpuContext {
            instance: renderer.instance.clone(),
            adapter: renderer.adapter,
            info: renderer.gpu_info,
            capabilities,
            device: renderer.device,
            queue: renderer.queue,
            nv12_supported: false,
            dxgi_adapter_index: None,
        });

        let mut session = NativePreviewSession::new(gpu.clone());
        let w = 320u32;
        let h = 180u32;
        let compositor = session.get_or_create_compositor(
            w,
            h,
            wgpu::TextureFormat::Rgba8UnormSrgb,
        );

        // On creation, staging_ring was preallocated with 2 buffers
        let (alloc_init, reuse_init) = compositor.staging_ring_stats();
        assert_eq!(alloc_init, 2, "Staging ring should preallocate 2 buffers");
        assert_eq!(reuse_init, 0, "No reuses initially");

        // Render Frame 1
        let (rgba1, _, _, _) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &gpu.device,
                &gpu.queue,
                w,
                h,
                &[],
                Some(wgpu::Color { r: 0.0, g: 0.0, b: 1.0, a: 1.0 }),
            )
            .await
            .expect("frame 1");
        assert_eq!(rgba1.len(), (w * h * 4) as usize);

        let (alloc_f1, reuse_f1) = compositor.staging_ring_stats();
        assert_eq!(alloc_f1, 2, "Allocation count remains bounded at 2");
        assert_eq!(reuse_f1, 1, "First frame reuses preallocated buffer in slot 0");

        // Render Frame 2
        let (rgba2, _, _, _) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &gpu.device,
                &gpu.queue,
                w,
                h,
                &[],
                Some(wgpu::Color { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }),
            )
            .await
            .expect("frame 2");
        assert_eq!(rgba2.len(), (w * h * 4) as usize);

        let (alloc_f2, reuse_f2) = compositor.staging_ring_stats();
        assert_eq!(alloc_f2, 2, "Allocation count remains bounded at 2");
        assert_eq!(reuse_f2, 2, "Second frame reuses preallocated buffer in slot 1");

        // Render Frame 3
        let (rgba3, _, _, _) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &gpu.device,
                &gpu.queue,
                w,
                h,
                &[],
                Some(wgpu::Color { r: 0.0, g: 1.0, b: 0.0, a: 1.0 }),
            )
            .await
            .expect("frame 3");
        assert_eq!(rgba3.len(), (w * h * 4) as usize);

        let (alloc_f3, reuse_f3) = compositor.staging_ring_stats();
        assert_eq!(alloc_f3, 2, "Zero new allocations during continuous rendering");
        assert_eq!(reuse_f3, 3, "Third frame reuses buffer in slot 0");
    }
}
