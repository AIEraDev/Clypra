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
}
