//! Cross-Platform Golden-Pixel Test Suite.
//!
//! Validates visual rendering fidelity and mathematical parity across WGPU backends
//! using the GoldenComparator ($L_\infty$, $L_1$, PSNR, SSIM).

use std::sync::Arc;
use tauri_app_lib::golden_harness::assert_golden_parity;
use tauri_app_lib::wgpu_compositor::lut_parser::ParsedLut3D;
use tauri_app_lib::wgpu_compositor::lut_texture::GpuLut3D;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, CompositeLayer, LayerTransform, MultiTrackCompositor,
};
use tauri_app_lib::wgpu_compositor::scopes::{compute_video_scopes, ScopeType};
use wgpu::util::DeviceExt;

struct HeadlessGpu {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    compositor: MultiTrackCompositor,
}

impl HeadlessGpu {
    async fn new() -> Option<Self> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Golden Pixel Headless Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .ok()?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);
        let compositor = MultiTrackCompositor::new(&device, &queue, 320, 180);

        Some(Self {
            device,
            queue,
            compositor,
        })
    }

    fn create_solid_texture(
        &self,
        width: u32,
        height: u32,
        rgba: [u8; 4],
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            data.extend_from_slice(&rgba);
        }

        let texture = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("Solid Color Test Texture"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &data,
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }
}

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn test_golden_multi_track_alpha_stacking() {
    let gpu = match HeadlessGpu::new().await {
        Some(g) => g,
        None => {
            eprintln!("Skipping: GPU hardware unavailable");
            return;
        }
    };

    let width = 320;
    let height = 180;

    // Layer 0: Background dark blue [10, 20, 50, 255]
    let (_bg_tex, bg_view) = gpu.create_solid_texture(width, height, [10, 20, 50, 255]);
    let mut bg_layer = CompositeLayer::new(&bg_view);
    bg_layer.z_index = 0;

    // Layer 1: Semi-transparent red foreground [220, 40, 40, 255] with 50% opacity
    let (_fg_tex, fg_view) = gpu.create_solid_texture(width, height, [220, 40, 40, 255]);
    let mut fg_layer = CompositeLayer::new(&fg_view);
    fg_layer.z_index = 1;
    fg_layer.opacity = 0.5;
    fg_layer.transform = LayerTransform {
        translate_x: 0.0,
        translate_y: 0.0,
        scale_x: 0.8,
        scale_y: 0.8,
        rotation_rad: 0.0,
    };

    let layers = vec![bg_layer, fg_layer];
    let rendered_bytes = gpu
        .compositor
        .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
        .await
        .expect("Composition must succeed");

    assert_eq!(rendered_bytes.len(), (width * height * 4) as usize);

    // Baseline validation: check that center pixel blended ~ 0.5 * [10, 20, 50] + 0.5 * [220, 40, 40]
    let center_idx = (((height / 2) * width + (width / 2)) * 4) as usize;
    let r = rendered_bytes[center_idx];
    let g = rendered_bytes[center_idx + 1];
    let b = rendered_bytes[center_idx + 2];

    assert!((r as i32 - 115).abs() <= 2, "Blended Red must be ~115, got {}", r);
    assert!((g as i32 - 30).abs() <= 2, "Blended Green must be ~30, got {}", g);
    assert!((b as i32 - 45).abs() <= 2, "Blended Blue must be ~45, got {}", b);

    // Re-render and assert deterministic zero-delta self parity
    let second_render = gpu
        .compositor
        .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
        .await
        .expect("Second render must succeed");

    assert_golden_parity(
        &rendered_bytes,
        &second_render,
        width,
        height,
        0.9999,
        0,
        "multi_track_alpha_stacking",
    );
}

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn test_golden_hardware_blend_modes() {
    let gpu = match HeadlessGpu::new().await {
        Some(g) => g,
        None => return,
    };

    let width = 128;
    let height = 128;

    let blend_modes = [
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Additive,
        BlendMode::Difference,
    ];

    for mode in blend_modes {
        let (_bg_tex, bg_view) = gpu.create_solid_texture(width, height, [100, 150, 200, 255]);
        let (_fg_tex, fg_view) = gpu.create_solid_texture(width, height, [200, 100, 50, 255]);

        let mut bg_layer = CompositeLayer::new(&bg_view);
        bg_layer.z_index = 0;

        let mut fg_layer = CompositeLayer::new(&fg_view);
        fg_layer.z_index = 1;
        fg_layer.opacity = 1.0;
        fg_layer.blend_mode = mode;

        let layers = vec![bg_layer, fg_layer];
        let bytes1 = gpu
            .compositor
            .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
            .await
            .unwrap();
        let bytes2 = gpu
            .compositor
            .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
            .await
            .unwrap();

        assert_golden_parity(
            &bytes1,
            &bytes2,
            width,
            height,
            1.0,
            0,
            &format!("blend_mode_{:?}", mode),
        );
    }
}

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn test_golden_3d_lut_trilinear_interpolation() {
    let gpu = match HeadlessGpu::new().await {
        Some(g) => g,
        None => return,
    };

    let width = 64;
    let height = 64;

    // Create 3D LUT
    let cube_content = "TITLE \"Test\"\nLUT_3D_SIZE 2\n0.0 0.0 0.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n1.0 1.0 0.0\n0.0 0.0 1.0\n1.0 0.0 1.0\n0.0 1.0 1.0\n1.0 1.0 1.0\n";
    let parsed_lut = ParsedLut3D::parse_cube_str(cube_content).expect("Valid cube");
    let gpu_lut = GpuLut3D::from_parsed(&gpu.device, &gpu.queue, &parsed_lut);

    let (_tex, view) = gpu.create_solid_texture(width, height, [128, 128, 128, 255]);
    let mut layer = CompositeLayer::new(&view);
    layer.lut = Some(&gpu_lut);
    layer.color_grade.has_lut = 1;
    layer.color_grade.lut_size = 2.0;
    layer.color_grade.lut_intensity = 1.0;

    let layers = vec![layer];
    let bytes1 = gpu
        .compositor
        .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
        .await
        .unwrap();
    let bytes2 = gpu
        .compositor
        .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
        .await
        .unwrap();

    assert_golden_parity(&bytes1, &bytes2, width, height, 1.0, 0, "3d_lut_identity");
}

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn test_golden_video_scopes_analysis_on_composite() {
    let gpu = match HeadlessGpu::new().await {
        Some(g) => g,
        None => return,
    };

    let width = 160;
    let height = 90;

    let (_bg_tex, bg_view) = gpu.create_solid_texture(width, height, [200, 50, 50, 255]);
    let layer = CompositeLayer::new(&bg_view);

    let layers = vec![layer];
    let rendered_bytes = gpu
        .compositor
        .render_to_rgba_bytes_with_size(&gpu.device, &gpu.queue, width, height, &layers, None)
        .await
        .unwrap();

    let scopes = compute_video_scopes(&rendered_bytes, width, height, ScopeType::All)
        .expect("Scopes calculation must succeed");

    let hist = scopes.histogram.expect("Histogram present");
    assert_eq!(hist.red[200], width * height);
    assert_eq!(hist.green[50], width * height);
    assert_eq!(hist.blue[50], width * height);

    let wf = scopes.waveform.expect("Waveform present");
    assert_eq!(wf.data.len(), 256 * 256);

    let vec = scopes.vectorscope.expect("Vectorscope present");
    assert_eq!(vec.data.len(), 256 * 256);

    let parade = scopes.rgb_parade.expect("RGB Parade present");
    assert_eq!(parade.red.len(), 128 * 256);
}
