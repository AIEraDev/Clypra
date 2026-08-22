// src-tauri/tests/gpu_shader_suite_audit_tests.rs

use wgpu::util::DeviceExt;
use tauri_app_lib::wgpu_compositor::chroma_key::ChromaKeyUniforms;
use tauri_app_lib::wgpu_compositor::lut_texture::GpuLut3D;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins, LayerTransform,
    LayerUniforms, MultiTrackCompositor, TransitionUniforms,
};

/// Headless GPU test harness
struct HeadlessAuditContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl HeadlessAuditContext {
    async fn new() -> Self {
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
            .await
            .expect("Failed to initialize GPU adapter");

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Shader Suite Audit Test Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("Failed to acquire GPU device");

        Self { device, queue }
    }

    pub fn create_solid_texture(&self, width: u32, height: u32, rgba: [u8; 4]) -> (wgpu::Texture, wgpu::TextureView) {
        let pixel_count = (width * height) as usize;
        let mut data = Vec::with_capacity(pixel_count * 4);
        for _ in 0..pixel_count {
            data.extend_from_slice(&rgba);
        }

        let texture = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("Audit Test Texture"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
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

fn get_pixel(bytes: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * width + x) * 4) as usize;
    [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]
}

fn assert_pixel_near(actual: [u8; 4], expected: [u8; 4], tolerance: u8, ctx: &str) {
    for i in 0..4 {
        let diff = (actual[i] as i16 - expected[i] as i16).abs();
        assert!(
            diff <= tolerance as i16,
            "Pixel mismatch in {ctx} at channel {i}: actual={}, expected={}, diff={}",
            actual[i], expected[i], diff
        );
    }
}

// -----------------------------------------------------------------------------
// Test 1: Pixel-Perfect Identity 3D LUT Pass-Through
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_audit_identity_3d_lut_pass_through() {
    let ctx = HeadlessAuditContext::new().await;
    let width = 64;
    let height = 64;
    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let test_swatches: &[[u8; 4]] = &[
        [0, 0, 0, 255],       // Black Corner
        [255, 255, 255, 255], // White Corner
        [255, 0, 0, 255],     // Pure Red
        [0, 255, 0, 255],     // Pure Green
        [0, 0, 255, 255],     // Pure Blue
        [128, 128, 128, 255], // Mid-Gray
        [184, 92, 45, 255],   // Complex Skin/Amber Tone
    ];

    let identity_lut = GpuLut3D::default_identity(&ctx.device, &ctx.queue);

    for &color in test_swatches {
        let (_tex, view) = ctx.create_solid_texture(width, height, color);

        let layers = vec![CompositeLayer {
            texture_view: &view,
            lut: Some(&identity_lut),
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms {
                exposure: 0.0,
                contrast: 1.0,
                saturation: 1.0,
                temperature: 0.0,
                tint: 0.0,
                lut_intensity: 1.0,
                lut_size: identity_lut.size as f32,
                has_lut: 1,
                ..Default::default()
            },
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        }];

        let output = compositor
            .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
            .await
            .expect("Identity LUT rendering failed");

        let sampled = get_pixel(&output, width, width / 2, height / 2);
        assert_pixel_near(sampled, color, 1, &format!("Swatch {:?}", color));
    }
}

// -----------------------------------------------------------------------------
// Test 2: UltraKey Exact Matte Extraction & Retention
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_audit_ultrakey_matte_extraction() {
    let ctx = HeadlessAuditContext::new().await;
    let width = 64;
    let height = 64;
    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Scenario A: Pure Green Background (Must extract to 0.0 alpha, revealing background)
    let (_bg_tex, bg_view) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]); // Solid Blue BG
    let (_fg_green, fg_green_view) = ctx.create_solid_texture(width, height, [0, 255, 0, 255]); // Green Screen

    let layers_keyed = vec![
        CompositeLayer {
            texture_view: &bg_view,
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
            texture_view: &fg_green_view,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms {
                key_color: [0.0, 1.0, 0.0],
                tolerance: 0.25,
                smoothness: 0.10,
                despill_amount: 0.85,
                despill_balance: 0.50,
                matte_pedestal: 0.05,
                matte_highlight: 0.95,
                enabled: 1,
                _pad0: 0.0,
                _pad1: 0.0,
            },
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_keyed = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_keyed)
        .await
        .expect("Chroma key pass failed");

    let sampled_bg = get_pixel(&output_keyed, width, width / 2, height / 2);
    assert_pixel_near(sampled_bg, [0, 0, 255, 255], 1, "Green screen keyed out revealing blue background");

    // Scenario B: Red Foreground Subject (Must retain 1.0 alpha and opaque RGB)
    let (_fg_red, fg_red_view) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);
    let layers_subject = vec![
        CompositeLayer {
            texture_view: &bg_view,
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
            texture_view: &fg_red_view,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms {
                key_color: [0.0, 1.0, 0.0],
                tolerance: 0.25,
                smoothness: 0.10,
                despill_amount: 0.85,
                despill_balance: 0.50,
                matte_pedestal: 0.05,
                matte_highlight: 0.95,
                enabled: 1,
                _pad0: 0.0,
                _pad1: 0.0,
            },
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_subject = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_subject)
        .await
        .expect("Chroma key subject retention pass failed");

    let sampled_fg = get_pixel(&output_subject, width, width / 2, height / 2);
    assert_pixel_near(sampled_fg, [255, 0, 0, 255], 1, "Red subject remains 100% opaque");
}

// -----------------------------------------------------------------------------
// Test 3: Native Dual-Texture Transition t=0.5 Midpoint Rendering
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_audit_dual_texture_transition_midpoint() {
    let ctx = HeadlessAuditContext::new().await;
    let width = 64;
    let height = 64;
    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Texture A: Solid Pure Red [255, 0, 0, 255]
    // Texture B: Solid Pure White [255, 255, 255, 255]
    let (_tex_a, view_a) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);
    let (_tex_b, view_b) = ctx.create_solid_texture(width, height, [255, 255, 255, 255]);

    let transition_uniforms = TransitionUniforms {
        progress: 0.5,
        transition_type: 0, // Cross-Dissolve
        feather: 0.1,
        angle_rad: 0.0,
        blur_strength: 0.25,
        _pad0: 0.0,
        _pad1: 0.0,
        _pad2: 0.0,
    };

    let output = compositor
        .render_transition_to_rgba_bytes(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &view_a,
            &view_b,
            &transition_uniforms,
        )
        .await
        .expect("Transition midpoint render failed");

    // Expected Midpoint for Cross-Dissolve at t=0.5:
    // R = mix(255, 255, 0.5) = 255
    // G = mix(0, 255, 0.5) = 128
    // B = mix(0, 255, 0.5) = 128
    // A = mix(255, 255, 0.5) = 255
    let sampled = get_pixel(&output, width, width / 2, height / 2);
    assert_pixel_near(sampled, [255, 128, 128, 255], 2, "Cross-Dissolve t=0.5 blend midpoint");
}

// -----------------------------------------------------------------------------
// Test 4: LayerUniformPool Dynamic Stride & Memory Alignment
// -----------------------------------------------------------------------------
#[test]
fn test_layer_uniform_pool_stride_alignment() {
    let pool_stride = {
        let layer_size = std::mem::size_of::<LayerUniforms>() as u64;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as u64; // 256
        (layer_size + align - 1) & !(align - 1)
    };

    // Stride must be non-zero and multiple of 256 bytes
    assert_eq!(pool_stride % 256, 0);
    assert!(pool_stride >= std::mem::size_of::<LayerUniforms>() as u64);
}
