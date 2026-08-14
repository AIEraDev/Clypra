use tauri_app_lib::wgpu_compositor::{NativeWgpuRenderer, TransitionPipeline, TransitionType, TransitionUniforms};

#[tokio::test]
async fn test_gpu_transition_pipeline_initialization_and_render() {
    let renderer = match NativeWgpuRenderer::new().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Skipping GPU transition test (no GPU adapter available): {}", e);
            return;
        }
    };

    let width = 640;
    let height = 360;
    let format = wgpu::TextureFormat::Rgba8Unorm;

    let pipeline = TransitionPipeline::new(&renderer.device, format);

    // Create 2 test textures: Texture A (Pure Red) and Texture B (Pure Blue)
    let texture_a = renderer.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Test Texture A (Red)"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    let texture_b = renderer.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Test Texture B (Blue)"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });

    let target_texture = renderer.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Target Texture"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });

    let red_data = vec![255u8, 0, 0, 255].repeat((width * height) as usize);
    let blue_data = vec![0u8, 0, 255, 255].repeat((width * height) as usize);

    renderer.queue.write_texture(
        wgpu::ImageCopyTexture {
            texture: &texture_a,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &red_data,
        wgpu::ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );

    renderer.queue.write_texture(
        wgpu::ImageCopyTexture {
            texture: &texture_b,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &blue_data,
        wgpu::ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );

    let view_a = texture_a.create_view(&wgpu::TextureViewDescriptor::default());
    let view_b = texture_b.create_view(&wgpu::TextureViewDescriptor::default());
    let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

    // Test each transition type at progress 0.5
    let transitions = [
        TransitionType::CrossDissolve,
        TransitionType::WipeLeft,
        TransitionType::WipeRight,
        TransitionType::WipeUp,
        TransitionType::WipeDown,
        TransitionType::WipeDiagonal,
        TransitionType::IrisWipe,
        TransitionType::ZoomBlur,
        TransitionType::SlidePush,
    ];

    for t_type in transitions {
        let uniforms = TransitionUniforms {
            progress: 0.5,
            transition_type: t_type as u32,
            feather: 0.1,
            intensity: 1.0,
            aspect_ratio: width as f32 / height as f32,
            _pad0: 0.0,
            _pad1: 0.0,
            _pad2: 0.0,
        };

        pipeline.render(
            &renderer.device,
            &renderer.queue,
            &view_a,
            &view_b,
            &target_view,
            &uniforms,
        );
    }
}
