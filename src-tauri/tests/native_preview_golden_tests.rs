use tauri_app_lib::preview_golden::{compare_rgba8, write_rgba8_png};
use tauri_app_lib::wgpu_compositor::chroma_key::ChromaKeyUniforms;
use tauri_app_lib::wgpu_compositor::{
    BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins, LayerTransform,
    MultiTrackCompositor,
};

struct HeadlessGpuContext {
    device: wgpu::Device,
    queue: wgpu::Queue,
}

impl HeadlessGpuContext {
    async fn new() -> Self {
        let backends = wgpu::Backends::all();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends,
            ..Default::default()
        });
        let allow_fallback = std::env::var_os("CLYPRA_ALLOW_FALLBACK_GPU").is_some();
        let adapters = instance.enumerate_adapters(backends);
        for adapter in &adapters {
            let info = adapter.get_info();
            println!(
                "native preview golden discovered adapter: name={} backend={:?} device_type={:?}",
                info.name, info.backend, info.device_type
            );
        }

        // Prefer the real platform adapter. The CI flag permits a software adapter when a
        // headless runner has no usable hardware; it must not force software on every runner.
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await;
        let adapter = match adapter {
            Some(adapter) => adapter,
            None if allow_fallback => instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::LowPower,
                    compatible_surface: None,
                    force_fallback_adapter: true,
                })
                .await
                .unwrap_or_else(|| {
                    panic!(
                        "Failed to find a suitable wgpu adapter (backends={backends:?}, fallback_allowed={allow_fallback}); install a platform GPU/software Vulkan adapter or set up the CI graphics dependencies"
                    )
                }),
            None => panic!(
                "Failed to find a suitable wgpu adapter (backends={backends:?}, fallback_allowed={allow_fallback}); install a platform GPU/software Vulkan adapter or set up the CI graphics dependencies"
            ),
        };
        let info = adapter.get_info();
        println!(
            "native preview golden selected adapter: name={} backend={:?} device_type={:?} fallback_allowed={}",
            info.name, info.backend, info.device_type, allow_fallback
        );
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Native Preview Golden Test Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("Failed to create golden test device");
        Self { device, queue }
    }

    fn solid_texture(&self, rgba: [u8; 4]) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Golden Solid Layer"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }
}

fn project_transform(x: f32, y: f32, width: f32, height: f32) -> LayerTransform {
    LayerTransform {
        translate_x: ((x + width * 0.5) / 64.0) * 2.0 - 1.0,
        translate_y: 1.0 - ((y + height * 0.5) / 36.0) * 2.0,
        scale_x: width / 64.0,
        scale_y: height / 36.0,
        rotation_rad: 0.0,
    }
}

fn pixel(frame: &[u8], width: usize, x: usize, y: usize) -> [u8; 4] {
    let offset = (y * width + x) * 4;
    frame[offset..offset + 4].try_into().unwrap()
}

#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test --test native_preview_golden_tests -- --ignored"]
async fn native_project_frame_matches_geometry_golden() {
    let ctx = HeadlessGpuContext::new().await;
    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, 64, 36);
    let (_background_texture, background_view) = ctx.solid_texture([0, 0, 0, 255]);
    let (_foreground_texture, foreground_view) = ctx.solid_texture([220, 40, 20, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &background_view,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
        CompositeLayer {
            texture_view: &foreground_view,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: project_transform(0.0, 0.0, 32.0, 18.0),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let actual = compositor
        .render_to_rgba_bytes_with_size(
            &ctx.device,
            &ctx.queue,
            64,
            36,
            &layers,
            Some(wgpu::Color::BLACK),
        )
        .await
        .expect("golden render should succeed");

    assert_eq!(pixel(&actual, 64, 8, 8), [220, 40, 20, 255]);
    assert_eq!(pixel(&actual, 64, 48, 8), [0, 0, 0, 255]);
    assert_eq!(pixel(&actual, 64, 8, 28), [0, 0, 0, 255]);

    let mut expected = vec![0u8; 64 * 36 * 4];
    for pixel in expected.chunks_exact_mut(4) {
        pixel.copy_from_slice(&[0, 0, 0, 255]);
    }
    for y in 0..18 {
        for x in 0..32 {
            let offset = (y * 64 + x) * 4;
            expected[offset..offset + 4].copy_from_slice(&[220, 40, 20, 255]);
        }
    }
    let diff = compare_rgba8(&actual, &expected, 3).expect("frames should have equal size");
    if !diff.is_within_tolerance(3) {
        if let Some(output_dir) = std::env::var_os("CLYPRA_GOLDEN_ARTIFACT_DIR") {
            let output_dir = std::path::Path::new(&output_dir);
            std::fs::create_dir_all(output_dir).expect("golden artifact directory should be writable");
            write_rgba8_png(&output_dir.join("native-project-actual.png"), 64, 36, &actual)
                .expect("actual golden frame should be capturable");
            write_rgba8_png(&output_dir.join("native-project-expected.png"), 64, 36, &expected)
                .expect("expected golden frame should be capturable");
        }
    }
    assert!(
        diff.is_within_tolerance(3),
        "golden mismatch: differing_pixels={} max_channel_error={} mean_channel_error={}",
        diff.differing_pixels,
        diff.max_channel_error,
        diff.mean_channel_error
    );
}
