use wgpu::util::DeviceExt;

use tauri_app_lib::wgpu_compositor::chroma_key::ChromaKeyUniforms;
use tauri_app_lib::wgpu_compositor::lut_parser::ParsedLut3D;
use tauri_app_lib::wgpu_compositor::lut_texture::GpuLut3D;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, BodyEffectUniforms, ColorGradeUniforms, CompositeLayer, CropMargins, LayerTransform,
    MultiTrackCompositor,
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

    /// Read raw RGBA bytes back from any 2D texture
    pub async fn read_texture_bytes(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Vec<u8> {
        let bytes_per_pixel = 4u32;
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer_size = (padded_bytes_per_row * height) as wgpu::BufferAddress;

        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Test Texture Readback Buffer"),
            size: output_buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Test Readback Copy Encoder"),
        });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        let buffer_slice = output_buffer.slice(..);
        let (tx, rx) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |res| {
            let _ = tx.send(res);
        });

        self.device.poll(wgpu::Maintain::Wait);
        rx.await.expect("Channel dropped").expect("Buffer map failed");

        let mapped = buffer_slice.get_mapped_range();
        let mut unpadded = Vec::with_capacity((width * height * bytes_per_pixel) as usize);

        for row in 0..height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + unpadded_bytes_per_row as usize;
            unpadded.extend_from_slice(&mapped[start..end]);
        }

        drop(mapped);
        output_buffer.unmap();
        unpadded
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
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Expected: R = 255 * 0.5 = 128, G = 0, B = 255 * 0.5 = 128, A = 255
    let sample = get_pixel(&output_bytes, width, 128, 128);
    assert_pixel_near(
        sample,
        [128, 0, 128, 255],
        3,
        "50% Opacity Alpha-Over blend",
    );
}

// -----------------------------------------------------------------------------
// Test 3: Additive Blending Mode
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Render pass failed");

    // Expected: R = 200 + 0 = 200, G = 0 + 200 = 200, B = 0, A = 255
    let sample = get_pixel(&output_bytes, width, 128, 128);
    assert_pixel_near(
        sample,
        [200, 200, 0, 255],
        2,
        "Additive blend mode accumulation",
    );
}

// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_multiply_blend_mode() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Layer 1: Solid White [255, 255, 255, 255]
    // Layer 2: Solid Red [200, 0, 0, 255] with Multiply Blend
    let (_t1, view_white) = ctx.create_solid_texture(width, height, [255, 255, 255, 255]);
    let (_t2, view_red) = ctx.create_solid_texture(width, height, [200, 0, 0, 255]);

    let layers = vec![
        CompositeLayer {
            texture_view: &view_white,
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
            texture_view: &view_red,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Multiply,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Multiply render pass failed");

    let sample = get_pixel(&output_bytes, width, 128, 128);
    assert_pixel_near(
        sample,
        [200, 0, 0, 255],
        3,
        "Multiply blend mode attenuation",
    );
}

// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_screen_blend_mode() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 256;
    let height = 256;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Layer 1: Solid Red [128, 0, 0, 255]
    // Layer 2: Solid Green [0, 128, 0, 255] with Screen Blend
    let (_t1, view_red) = ctx.create_solid_texture(width, height, [128, 0, 0, 255]);
    let (_t2, view_green) = ctx.create_solid_texture(width, height, [0, 128, 0, 255]);

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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
        CompositeLayer {
            texture_view: &view_green,
            lut: None,
            z_index: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Screen,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Screen render pass failed");

    let sample = get_pixel(&output_bytes, width, 128, 128);
    // Screen: 1 - (1 - 0.5)*(1 - 0) = 0.5 -> ~128 for Red, 128 for Green
    assert_pixel_near(
        sample,
        [128, 128, 0, 255],
        4,
        "Screen blend mode combination",
    );
}

// -----------------------------------------------------------------------------
// Test 4: Branch-Free Crop Margins [Left, Top, Right, Bottom]
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
    assert_pixel_near(
        right_sample,
        [255, 255, 255, 255],
        1,
        "Right side visible inside crop",
    );
}

// -----------------------------------------------------------------------------
// Test 5: 2D Affine Transform (Picture-in-Picture Quadrant Placement)
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
    assert_pixel_near(
        bottom_right,
        [255, 0, 0, 255],
        1,
        "Bottom-right shows scaled PiP layer",
    );
}

// -----------------------------------------------------------------------------
// Test 6: 24-Layer High Track Density Stress & Stride Alignment
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_24_track_density_stress() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 1920;
    let height = 1080;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Exercise the product acceptance target (20+ simultaneous tracks) at
    // full HD. Keep the test GPU-only: this validates the real WGPU renderer,
    // not a CPU approximation.
    let mut textures = Vec::new();
    let mut layers = Vec::new();

    for i in 0..24 {
        let (_tex, view) = ctx.create_solid_texture(width, height, [i as u8 * 10, 100, 200, 255]);
        textures.push((_tex, view));
    }

    for (i, (_tex, view)) in textures.iter().enumerate() {
        layers.push(CompositeLayer {
            texture_view: view,
            lut: None,
            z_index: i as i32,
            opacity: 1.0 / 24.0, // Cumulative blend
            blend_mode: BlendMode::Additive,
            transform: LayerTransform::default(),
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        });
    }

    let start = std::time::Instant::now();
    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("24-track composite failed");

    let elapsed = start.elapsed();
    println!(
        "\n🚀 Composited 24 simultaneous 1080p video tracks in {:.2?}",
        elapsed
    );

    assert_eq!(output_bytes.len(), (width * height * 4) as usize);
}

// -----------------------------------------------------------------------------
// Test 7: 3D LUT Identity Pass & Half-Texel Precision
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
                ..Default::default()
            },
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
        mask_view: None,
        body_effect: BodyEffectUniforms::default(),
    }];

    let out_plus = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layer_plus_1)
        .await
        .expect("Render +1.0 EV failed");

    let sample_plus = get_pixel(&out_plus, width, width / 2, height / 2);
    assert_pixel_near(
        sample_plus,
        [200, 200, 200, 255],
        3,
        "+1.0 EV Exposure doubling",
    );

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
        mask_view: None,
        body_effect: BodyEffectUniforms::default(),
    }];

    let out_minus = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layer_minus_1)
        .await
        .expect("Render -1.0 EV failed");

    let sample_minus = get_pixel(&out_minus, width, width / 2, height / 2);
    assert_pixel_near(
        sample_minus,
        [50, 50, 50, 255],
        3,
        "-1.0 EV Exposure halving",
    );
}

// -----------------------------------------------------------------------------
// Test 9: Native body mask bind group and glow node
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_body_glow_mask_binding() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 64;
    let height = 64;
    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);
    let (_source_texture, source_view) =
        ctx.create_solid_texture(width, height, [100, 100, 100, 255]);
    let (_mask_texture, mask_view) = ctx.create_solid_texture(width, height, [255, 255, 255, 255]);

    let layers = vec![CompositeLayer {
        texture_view: &source_view,
        lut: None,
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms::default(),
        chroma_key: ChromaKeyUniforms::default(),
        mask_view: Some(&mask_view),
        body_effect: BodyEffectUniforms {
            color: [1.0, 0.0, 0.0, 0.0],
            params: [2.0, 0.5, 2.0, 0.0],
        },
    }];

    let output = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Body mask glow render failed");
    let sample = get_pixel(&output, width, width / 2, height / 2);
    assert!(
        sample[0] > sample[1],
        "body glow should add the configured red channel"
    );

    let particle_layers = vec![CompositeLayer {
        texture_view: &source_view,
        lut: None,
        z_index: 0,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        transform: LayerTransform::default(),
        crop: CropMargins::default(),
        color_grade: ColorGradeUniforms::default(),
        chroma_key: ChromaKeyUniforms::default(),
        mask_view: Some(&mask_view),
        body_effect: BodyEffectUniforms {
            color: [1.0, 0.5, 0.0, 0.0],
            params: [3.0, 1.0, 40.0, 1.0],
        },
    }];
    let particle_output = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &particle_layers)
        .await
        .expect("Body particle render failed");
    assert!(
        particle_output
            .chunks_exact(4)
            .any(|pixel| pixel[0] > pixel[1] && pixel[1] > 100),
        "body particles should add a visible configured orange particle"
    );
}

// -----------------------------------------------------------------------------
// Test 10: Custom .cube Inversion LUT Color Transformation
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
        mask_view: None,
        body_effect: BodyEffectUniforms::default(),
    }];

    let out_full = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_full)
        .await
        .expect("Full LUT render failed");

    let sample_full = get_pixel(&out_full, width, width / 2, height / 2);
    assert_pixel_near(
        sample_full,
        [0, 255, 255, 255],
        3,
        "Inversion LUT 100% intensity (Red -> Cyan)",
    );

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
        mask_view: None,
        body_effect: BodyEffectUniforms::default(),
    }];

    let out_half = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers_half)
        .await
        .expect("Half LUT render failed");

    let sample_half = get_pixel(&out_half, width, width / 2, height / 2);
    assert_pixel_near(
        sample_half,
        [128, 128, 128, 255],
        4,
        "Inversion LUT 50% intensity (Red + Cyan blend)",
    );
}

// -----------------------------------------------------------------------------
// Test 10: Chroma Key (UltraKey) Green Screen Removal & Background Pass
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Chroma key green screen test failed");

    // Since the top green screen is keyed out, the bottom Blue background should show through completely
    let sample = get_pixel(&output_bytes, width, width / 2, height / 2);
    assert_pixel_near(
        sample,
        [0, 0, 255, 255],
        2,
        "Green screen keyed out revealing Blue background",
    );
}

// -----------------------------------------------------------------------------
// Test 11: Chroma Key Subject Retention (Red Foreground remains solid)
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
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
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    let output_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Chroma key subject retention test failed");

    // Red subject must remain 100% opaque
    let sample = get_pixel(&output_bytes, width, width / 2, height / 2);
    assert_pixel_near(
        sample,
        [255, 0, 0, 255],
        2,
        "Red subject remains solid over blue background",
    );
}

// -----------------------------------------------------------------------------
// Test 15: Burned-in Caption Preview vs Export Pixel Parity
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_burned_in_caption_preview_vs_export_pixel_parity() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // 1. Background video layer (dark teal background simulating video footage)
    let (_bg_tex, bg_view) = ctx.create_solid_texture(width, height, [20, 35, 45, 255]);

    // 2. Caption layer texture (white text on transparent background, simulating rendered text glyphs)
    let caption_w = 320;
    let caption_h = 48;
    let mut caption_data = Vec::with_capacity((caption_w * caption_h * 4) as usize);
    for y in 0..caption_h {
        for x in 0..caption_w {
            // Emulate text glyphs: bright white inside margin, alpha falloff at edge
            if x >= 10 && x < caption_w - 10 && y >= 8 && y < caption_h - 8 {
                caption_data.extend_from_slice(&[255, 255, 255, 240]);
            } else {
                caption_data.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    use wgpu::util::DeviceExt;
    let caption_tex = ctx.device.create_texture_with_data(
        &ctx.queue,
        &wgpu::TextureDescriptor {
            label: Some("Burned-in Caption Texture"),
            size: wgpu::Extent3d {
                width: caption_w,
                height: caption_h,
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
        &caption_data,
    );
    let caption_view = caption_tex.create_view(&wgpu::TextureViewDescriptor::default());

    // Caption transform: lower-third centered placement
    // x = (640 - 320)/2 = 160, y = 360 - 48 - 32 = 280
    let caption_transform = LayerTransform {
        translate_x: 0.0,
        translate_y: -0.5,
        scale_x: 0.5,
        scale_y: 0.2,
        rotation_rad: 0.0,
    };

    let layers = vec![
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
            texture_view: &caption_view,
            lut: None,
            z_index: 10,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            transform: caption_transform,
            crop: CropMargins::default(),
            color_grade: ColorGradeUniforms::default(),
            chroma_key: ChromaKeyUniforms::default(),
            mask_view: None,
            body_effect: BodyEffectUniforms::default(),
        },
    ];

    // --- Path A: Native Preview Surface Path ---
    // Composites directly into an output surface texture target
    let preview_target = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Preview Target Surface Texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let preview_target_view = preview_target.create_view(&wgpu::TextureViewDescriptor::default());

    compositor
        .composite_layers(&ctx.device, &ctx.queue, &preview_target_view, &layers, None)
        .expect("Preview composite_layers failed");

    // Read back Path A from preview texture
    let preview_bytes = ctx.read_texture_bytes(&preview_target, width, height).await;

    // --- Path B: Native Export Readback Buffer Path ---
    let export_bytes = compositor
        .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
        .await
        .expect("Export render_to_rgba_bytes failed");

    // --- Parity Comparison ---
    assert_eq!(
        preview_bytes.len(),
        export_bytes.len(),
        "Buffer lengths must match"
    );

    let mut max_diff: i16 = 0;
    let mut caption_pixels_detected: usize = 0;

    for y in 0..height {
        for x in 0..width {
            let p_preview = get_pixel(&preview_bytes, width, x, y);
            let p_export = get_pixel(&export_bytes, width, x, y);

            for c in 0..4 {
                let diff = (p_preview[c] as i16 - p_export[c] as i16).abs();
                if diff > max_diff {
                    max_diff = diff;
                }
            }

            // In the caption text area: x in [200, 440], y in [250, 290]
            if x >= 200 && x < 440 && y >= 250 && y < 290 {
                if p_export != [20, 35, 45, 255] {
                    caption_pixels_detected += 1;
                }
            }
        }
    }

    let center_caption_pixel = get_pixel(&export_bytes, width, width / 2, 270);
    assert_ne!(
        center_caption_pixel,
        [20, 35, 45, 255],
        "Center of burned-in caption must be rendered over background (got background color)"
    );

    println!(
        "Verified {} caption pixels detected in bounding box. Maximum pixel delta between Preview and Export = {}",
        caption_pixels_detected, max_diff
    );
    assert!(caption_pixels_detected > 1000, "Must detect substantial caption pixels");

    assert_eq!(
        max_diff, 0,
        "Burned-in caption preview and export must have ZERO pixel difference (got max diff {})",
        max_diff
    );
}

