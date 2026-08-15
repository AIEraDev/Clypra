use wgpu::util::DeviceExt;

use tauri_app_lib::wgpu_compositor::chroma_key::ChromaKeyUniforms;
use tauri_app_lib::wgpu_compositor::lut_parser::ParsedLut3D;
use tauri_app_lib::wgpu_compositor::lut_texture::GpuLut3D;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, ColorGradeUniforms, CompositeLayer, CropMargins, LayerTransform, MultiTrackCompositor,
};

/// Headless GPU context for CI & testing
struct HeadlessGpuContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl HeadlessGpuContext {
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
            .expect("Failed to find suitable GPU adapter");

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("MultiTrack Compositor Test Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("Failed to create test device");

        Self { device, queue }
    }

    /// Helper to allocate a solid color RGBA8 test texture
    pub fn create_solid_texture(
        &self,
        width: u32,
        height: u32,
        rgba: [u8; 4],
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let pixel_count = (width * height) as usize;
        let mut data = Vec::with_capacity(pixel_count * 4);
        for _ in 0..pixel_count {
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

/// Sample a single pixel at (x, y) from the raw RGBA frame buffer
fn get_pixel(bytes: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * width + x) * 4) as usize;
    [
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]
}

/// Helper to verify pixel colors with a tolerance margin (for floating point blending)
fn assert_pixel_near(actual: [u8; 4], expected: [u8; 4], tolerance: u8, context: &str) {
    for i in 0..4 {
        let diff = (actual[i] as i16 - expected[i] as i16).abs();
        assert!(
            diff <= tolerance as i16,
            "Pixel mismatch at {context} channel {i}: actual={}, expected={}, diff={}",
            actual[i],
            expected[i],
            diff
        );
    }
}

// -----------------------------------------------------------------------------
// Test 1: Z-Index Stacking Order
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_z_index_layer_sorting() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Create 3 solid color layers
    let (_t1, view_red) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);
    let (_t2, view_green) = ctx.create_solid_texture(width, height, [0, 255, 0, 255]);
    let (_t3, view_blue) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]);

    // Feed in reverse order: Blue (Z=30), Red (Z=10), Green (Z=20)
    // Compositor must sort back-to-front: Red (10) -> Green (20) -> Blue (30)
    let layers = vec![
        CompositeLayer {
            texture_view: &view_blue,
            lut: None,
            z_index: 30,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_red,
            lut: None,
            z_index: 10,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_green,
            lut: None,
            z_index: 20,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Center pixel should be solid Blue (highest Z-Index = 30)
    let sample = get_pixel(&output_bytes, width, width / 2, height / 2);
    assert_pixel_near(sample, [0, 0, 255, 255], 1, "Top layer Z-index validation");
}

// -----------------------------------------------------------------------------
// Test 2: Premultiplied Alpha & Opacity Blending
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_premultiplied_alpha_opacity_blend() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Bottom layer: Solid Blue [0, 0, 255, 255] (Z=0)
    // Top layer: Solid Red [255, 0, 0, 255] with 50% opacity (Z=1)
    let (_t_blue, view_blue) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]);
    let (_t_red, view_red) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_blue,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_red,
            lut: None,
            z_index: 1,
            opacity: 0.5, // 50% alpha over
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Expected: R = 255 * 0.5 = 128, G = 0, B = 255 * 0.5 = 128, A = 255
    let sample = get_pixel(&output_bytes, width, 128, 128);
    assert_pixel_near(sample, [128, 0, 128, 255], 3, "50% Opacity Alpha-Over blend");
}

// -----------------------------------------------------------------------------
// Test 3: Additive Blending Mode
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_additive_blend_mode() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Layer 1: Solid Red [200, 0, 0, 255]
    // Layer 2: Solid Green [0, 200, 0, 255] with Additive Blend
    let (_t1, view_red) = ctx.create_solid_texture(width, height, [200, 0, 0, 255]);
    let (_t2, view_green) = ctx.create_solid_texture(width, height, [0, 200, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_red,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_green,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Additive,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Expected: R = 200 + 0 = 200, G = 0 + 200 = 200, B = 0, A = 255
    let sample = get_pixel(&output_bytes, width, 128, 128);
    assert_pixel_near(sample, [200, 200, 0, 255], 2, "Additive blend mode accumulation");
}

// -----------------------------------------------------------------------------
// Test 4: Branch-Free Crop Margins [Left, Top, Right, Bottom]
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_crop_margins_clipping() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Base background: Solid Black [0, 0, 0, 255]
    // Top layer: Solid White [255, 255, 255, 255] cropped:
    // Left=0.5 (crops left half), Top=0.0, Right=0.0, Bottom=0.0
    let (_t_black, view_black) = ctx.create_solid_texture(width, height, [0, 0, 0, 255]);
    let (_t_white, view_white) = ctx.create_solid_texture(width, height, [255, 255, 255, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_black,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_white,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins {
                left: 0.5, // 50% left crop
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
            },
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Left side (x = 64) must be clipped (shows Black background)
    let left_sample = get_pixel(&output_bytes, width, 64, 128);
    assert_pixel_near(left_sample, [0, 0, 0, 255], 1, "Left side cropped out");

    // Right side (x = 200) must be visible (shows White foreground)
    let right_sample = get_pixel(&output_bytes, width, 200, 128);
    assert_pixel_near(right_sample, [255, 255, 255, 255], 1, "Right side visible inside crop");
}

// -----------------------------------------------------------------------------
// Test 5: 2D Affine Transform (Picture-in-Picture Quadrant Placement)
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_affine_transform_pip_placement() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Background: Solid Blue [0, 0, 255, 255]
    // Top layer: Solid Red [255, 0, 0, 255] scaled down to 50% (scale = 0.5)
    // Translated to bottom-right quadrant: (x = 0.5, y = -0.5 in NDC space)
    let (_t_blue, view_blue) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]);
    let (_t_red, view_red) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_blue,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_red,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform {
                translate_x: 0.5,
                translate_y: -0.5,
                scale_x: 0.5,
                scale_y: 0.5,
                rotation_rad: 0.0,
            },
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Top-Left Quadrant (x = 64, y = 64) -> Should remain Blue background
    let top_left = get_pixel(&output_bytes, width, 64, 64);
    assert_pixel_near(top_left, [0, 0, 255, 255], 1, "Top-left remains background");

    // Bottom-Right Quadrant (x = 192, y = 192) -> Should show Red PiP layer
    let bottom_right = get_pixel(&output_bytes, width, 192, 192);
    assert_pixel_near(bottom_right, [255, 0, 0, 255], 1, "Bottom-right shows scaled PiP layer");
}

// -----------------------------------------------------------------------------
// Test 6: 16-Layer High Track Density Stress & Stride Alignment
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_16_track_density_stress() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 1920;
    let height = 1080;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Create 16 distinct layers
    let mut textures = Vec::new();
    let mut layers = Vec::new();

    for i in 0..16 {
        let (_tex, view) = ctx.create_solid_texture(width, height, [i as u8 * 16, 100, 200, 255]);
        textures.push((_tex, view));
    }

    for (i, (_tex, view)) in textures.iter().enumerate() {
        layers.push(CompositeLayer {
            texture_view: view,
            lut: None,
            z_index: i as i32,
            opacity: 1.0 / 16.0, // Cumulative blend
            blend_mode: BlendMode::Additive,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        });
    }

    let start = std::time::Instant::now();
    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("16-track composite failed");

    let elapsed = start.elapsed();
    println!("\n🚀 Composited 16 simultaneous 1080p video tracks in {:.2?}", elapsed);

    assert_eq!(output_bytes.len(), (width * height * 4) as usize);
}

// -----------------------------------------------------------------------------
// Test 7: 3D LUT Identity Pass & Half-Texel Precision
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_lut_identity_and_half_texel_offset() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let test_colors = [
        [0u8, 0, 0, 255],
        [255, 255, 255, 255],
        [128, 64, 192, 255],
        [32, 200, 100, 255],
    ];

    let identity_lut = GpuLut3D::default_identity(&ctx.device, &ctx.queue);

    for expected_color in test_colors {
        let (_tex, view) = ctx.create_solid_texture(width, height, expected_color);

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
            },
            chroma_key: ChromaKeyUniforms::default(),
        }];

        let output = compositor
            .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
            .await
            .expect("Identity LUT pass failed");

        let sample = get_pixel(&output, width, width / 2, height / 2);
        assert_pixel_near(
            sample,
            expected_color,
            2,
            &format!("Identity LUT pass for {:?}", expected_color),
        );
    }
}

// -----------------------------------------------------------------------------
// Test 8: Exposure EV Math (+1.0 EV doubles intensity, -1.0 EV halves)
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_exposure_ev_adjustments() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let (_tex, view) = ctx.create_solid_texture(width, height, [100, 100, 100, 255]);

    // 1. +1.0 EV (Double intensity: 100 * 2 = 200)
    let layer_plus_1 = vec![CompositeLayer {
        texture_view: &view,
        lut: None,
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms {
            exposure: 1.0,
            ..Default::default()
        },
        chroma_key: ChromaKeyUniforms::default(),
    }];

    let out_plus = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layer_plus_1)
        .await
        .expect("Render +1.0 EV failed");

    let sample_plus = get_pixel(&out_plus, width, width / 2, height / 2);
    assert_pixel_near(sample_plus, [200, 200, 200, 255], 3, "+1.0 EV Exposure doubling");

    // 2. -1.0 EV (Half intensity: 100 / 2 = 50)
    let layer_minus_1 = vec![CompositeLayer {
        texture_view: &view,
        lut: None,
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms {
            exposure: -1.0,
            ..Default::default()
        },
        chroma_key: ChromaKeyUniforms::default(),
    }];

    let out_minus = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layer_minus_1)
        .await
        .expect("Render -1.0 EV failed");

    let sample_minus = get_pixel(&out_minus, width, width / 2, height / 2);
    assert_pixel_near(sample_minus, [50, 50, 50, 255], 3, "-1.0 EV Exposure halving");
}

// -----------------------------------------------------------------------------
// Test 9: Custom .cube Inversion LUT Color Transformation
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_cube_lut_color_inversion_and_intensity() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let cube_str = r#"
# Invert Color LUT
TITLE "Color Inverter"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

1.0 1.0 1.0
0.0 1.0 1.0
1.0 0.0 1.0
0.0 0.0 1.0
1.0 1.0 0.0
0.0 1.0 0.0
1.0 0.0 0.0
0.0 0.0 0.0
"#;

    let parsed = ParsedLut3D::parse_cube_str(cube_str).expect("Failed to parse inversion cube LUT");
    let gpu_lut = GpuLut3D::from_parsed(&ctx.device, &ctx.queue, &parsed);

    // Input: Solid Red [255, 0, 0, 255] -> Inverted should be Cyan [0, 255, 255, 255]
    let (_tex, view) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);

    // Test at 100% intensity
    let layers_full = vec![CompositeLayer {
        texture_view: &view,
        lut: Some(&gpu_lut),
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms {
            lut_intensity: 1.0,
            lut_size: 2.0,
            has_lut: 1,
            ..Default::default()
        },
        chroma_key: ChromaKeyUniforms::default(),
    }];

    let out_full = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_full)
        .await
        .expect("Full LUT render failed");

    let sample_full = get_pixel(&out_full, width, width / 2, height / 2);
    assert_pixel_near(sample_full, [0, 255, 255, 255], 3, "Inversion LUT 100% intensity (Red -> Cyan)");

    // Test at 50% intensity (Red [255, 0, 0] mix Cyan [0, 255, 255] = Gray [128, 128, 128])
    let layers_half = vec![CompositeLayer {
        texture_view: &view,
        lut: Some(&gpu_lut),
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms {
            lut_intensity: 0.5,
            lut_size: 2.0,
            has_lut: 1,
            ..Default::default()
        },
        chroma_key: ChromaKeyUniforms::default(),
    }];

    let out_half = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_half)
        .await
        .expect("Half LUT render failed");

    let sample_half = get_pixel(&out_half, width, width / 2, height / 2);
    assert_pixel_near(sample_half, [128, 128, 128, 255], 4, "Inversion LUT 50% intensity (Red + Cyan blend)");
}

// -----------------------------------------------------------------------------
// Test 10: Chroma Key (UltraKey) Green Screen Removal & Background Pass
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_chroma_key_green_screen_removal() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Bottom layer: Solid Blue background [0, 0, 255, 255] (Z=0)
    // Top layer: Solid Green foreground [0, 255, 0, 255] with Chroma Key enabled (Z=1)
    let (_t_blue, view_blue) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]);
    let (_t_green, view_green) = ctx.create_solid_texture(width, height, [0, 255, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_blue,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_green,
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
                smoothness: 0.15,
                despill_amount: 0.85,
                despill_balance: 0.5,
                matte_pedestal: 0.05,
                matte_highlight: 0.95,
                enabled: 1,
                _pad0: 0.0,
                _pad1: 0.0,
            },
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Chroma key green screen test failed");

    // Since the top green screen is keyed out, the bottom Blue background should show through completely
    let sample = get_pixel(&output_bytes, width, width / 2, height / 2);
    assert_pixel_near(sample, [0, 0, 255, 255], 2, "Green screen keyed out revealing Blue background");
}

// -----------------------------------------------------------------------------
// Test 11: Chroma Key Subject Retention (Red Foreground remains solid)
// -----------------------------------------------------------------------------
#[tokio::test]
async fn test_chroma_key_subject_retention() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Bottom layer: Solid Blue background [0, 0, 255, 255] (Z=0)
    // Top layer: Solid Red foreground subject [255, 0, 0, 255] with Chroma Key for Green enabled (Z=1)
    let (_t_blue, view_blue) = ctx.create_solid_texture(width, height, [0, 0, 255, 255]);
    let (_t_red, view_red) = ctx.create_solid_texture(width, height, [255, 0, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_blue,
            lut: None,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_red,
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
                smoothness: 0.15,
                despill_amount: 0.85,
                despill_balance: 0.5,
                matte_pedestal: 0.05,
                matte_highlight: 0.95,
                enabled: 1,
                _pad0: 0.0,
                _pad1: 0.0,
            },
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Chroma key subject retention test failed");

    // Red subject must remain 100% opaque
    let sample = get_pixel(&output_bytes, width, width / 2, height / 2);
    assert_pixel_near(sample, [255, 0, 0, 255], 2, "Red subject remains solid over blue background");
}
