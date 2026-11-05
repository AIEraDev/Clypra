use image::{ColorType, ImageEncoder};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::time::Instant;
use tauri_app_lib::filmstrip_engine::decoder::VideoDecoder;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    CompositeLayer, MultiTrackCompositor,
};
use wgpu::util::DeviceExt;

/// Headless GPU context for alpha compositor testing
struct HeadlessGpuContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl HeadlessGpuContext {
    async fn new() -> Self {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
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
                    label: Some("Alpha Compositor Test Device"),
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

        self.create_texture_from_bytes(width, height, &data, "Solid Test Texture")
    }

    pub fn create_checkerboard_texture(
        &self,
        width: u32,
        height: u32,
        tile_size: u32,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let dark = ((x / tile_size) + (y / tile_size)) % 2 == 0;
                let c = if dark { 64u8 } else { 192u8 };
                data.extend_from_slice(&[c, c, c, 255]);
            }
        }

        self.create_texture_from_bytes(width, height, &data, "Checkerboard Test Texture")
    }

    pub fn create_texture_from_bytes(
        &self,
        width: u32,
        height: u32,
        data: &[u8],
        label: &str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some(label),
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
            data,
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/test-effect-fixture.mov")
}

fn validation_output_dir() -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/validation_output");
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn save_png(path: &PathBuf, width: u32, height: u32, data: &[u8]) {
    let file = File::create(path).unwrap();
    let w = BufWriter::new(file);
    let encoder = image::codecs::png::PngEncoder::new(w);
    encoder
        .write_image(data, width, height, ColorType::Rgba8.into())
        .unwrap();
}

fn get_pixel(bytes: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * width + x) * 4) as usize;
    [
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]
}

fn assert_pixel_close(actual: [u8; 4], expected: [u8; 4], tolerance: u8, name: &str) {
    for i in 0..4 {
        let diff = (actual[i] as i16 - expected[i] as i16).abs();
        assert!(
            diff <= tolerance as i16,
            "{} mismatch at channel {}: expected {}, got {} (diff {}, tol {})",
            name,
            i,
            expected[i],
            actual[i],
            diff,
            tolerance
        );
    }
}

// =============================================================================
// Test 1: Composite over Black Background
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_1_composite_over_black_background() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_fg_tex, fg_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Frame 0 (Premultiplied)");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let layer = CompositeLayer::new(&fg_view).with_premultiplied(true);

    // Render over black clear color [0.0, 0.0, 0.0, 1.0]
    let (rendered_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[layer],
            Some(wgpu::Color::BLACK),
        )
        .await
        .expect("Render to black failed");

    // 1. Top-Left: Transparent over Black -> Black [0, 0, 0, 255]
    let tl = get_pixel(&rendered_bytes, width, 160, 90);
    assert_pixel_close(tl, [0, 0, 0, 255], 3, "Transparent over Black");

    // 2. Top-Right: Opaque Red over Black -> Red [253, 0, 0, 255]
    let tr = get_pixel(&rendered_bytes, width, 480, 90);
    assert!(tr[0] >= 250, "Red channel must be >= 250, got {}", tr[0]);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "Opaque Red over Black");

    // 3. Bottom-Left: 50% Blue over Black -> Half Blue [0, 0, 127, 255]
    let bl = get_pixel(&rendered_bytes, width, 160, 270);
    assert_pixel_close(bl, [0, 0, 127, 255], 4, "50% Blue over Black");

    // 4. Bottom-Right: Gradient Green at center (50% alpha) over Black -> Half Green [0, 127, 0, 255]
    let br_center = get_pixel(&rendered_bytes, width, 480, 270);
    assert_pixel_close(br_center, [0, 127, 0, 255], 6, "Gradient Green at 50% over Black");

    // 5. Antialiased Diagonal Edge: sample pixel on diagonal in transparent quadrant (230, 90) -> White
    let diag_pixel = get_pixel(&rendered_bytes, width, 230, 90);
    assert!(
        diag_pixel[0] >= 240 && diag_pixel[1] >= 240 && diag_pixel[2] >= 240,
        "Diagonal line pixel in transparent quadrant must be white, got {:?}",
        diag_pixel
    );

    let out_png = validation_output_dir().join("compositor_over_black.png");
    save_png(&out_png, width, height, &rendered_bytes);
    println!("Saved: {}", out_png.display());
}

// =============================================================================
// Test 2: Composite over White Background
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_2_composite_over_white_background() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_fg_tex, fg_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Frame 0 (Premultiplied)");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let layer = CompositeLayer::new(&fg_view).with_premultiplied(true);

    // Render over white clear color [1.0, 1.0, 1.0, 1.0]
    let (rendered_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[layer],
            Some(wgpu::Color::WHITE),
        )
        .await
        .expect("Render to white failed");

    // 1. Top-Left: Transparent over White -> Pure White [255, 255, 255, 255]
    let tl = get_pixel(&rendered_bytes, width, 160, 90);
    assert_pixel_close(tl, [255, 255, 255, 255], 2, "Transparent over White");

    // 2. Top-Right: Opaque Red over White -> Pure Red [253, 0, 0, 255]
    let tr = get_pixel(&rendered_bytes, width, 480, 90);
    assert!(tr[0] >= 250, "Red channel must be >= 250, got {}", tr[0]);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "Opaque Red over White");

    // 3. Bottom-Left: 50% Blue over White -> Pastel Blue [128, 128, 255, 255]
    let bl = get_pixel(&rendered_bytes, width, 160, 270);
    assert_pixel_close(bl, [128, 128, 255, 255], 4, "50% Blue over White");

    // 4. Bottom-Right: Gradient Green at 50% over White -> Pastel Green [128, 255, 128, 255]
    let br_center = get_pixel(&rendered_bytes, width, 480, 270);
    assert_pixel_close(br_center, [128, 255, 128, 255], 6, "Gradient Green at 50% over White");

    let out_png = validation_output_dir().join("compositor_over_white.png");
    save_png(&out_png, width, height, &rendered_bytes);
    println!("Saved: {}", out_png.display());
}

// =============================================================================
// Test 3: Composite over Checkerboard Background
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_3_composite_over_checkerboard_background() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let (_cb_tex, cb_view) = ctx.create_checkerboard_texture(width, height, 32);

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_fg_tex, fg_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Frame 0 (Premultiplied)");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let bg_layer = CompositeLayer::new(&cb_view); // Z=0
    let mut fg_layer = CompositeLayer::new(&fg_view).with_premultiplied(true);
    fg_layer.z_index = 1;

    let (rendered_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[bg_layer, fg_layer],
            None,
        )
        .await
        .expect("Render to checkerboard failed");

    // 1. Top-Left: Transparent over Checkerboard -> Exact Checkerboard tiles visible
    // Dark tile at (16, 16): [64, 64, 64, 255]
    let dark_tile = get_pixel(&rendered_bytes, width, 16, 16);
    assert_pixel_close(dark_tile, [64, 64, 64, 255], 2, "Checkerboard Dark Tile");
    // Light tile at (48, 16): [192, 192, 192, 255]
    let light_tile = get_pixel(&rendered_bytes, width, 48, 16);
    assert_pixel_close(light_tile, [192, 192, 192, 255], 2, "Checkerboard Light Tile");

    // 2. Top-Right: Opaque Red covers both dark and light tiles completely
    let tr_dark = get_pixel(&rendered_bytes, width, 400, 16);
    let tr_light = get_pixel(&rendered_bytes, width, 432, 16);
    assert_pixel_close(tr_dark, [253, 0, 0, 255], 4, "Red over Dark Tile");
    assert_pixel_close(tr_light, [253, 0, 0, 255], 4, "Red over Light Tile");

    // 3. Bottom-Left: 50% Blue tints checkerboard
    // Dark tile: 64 * 0.5 = 32 R/G, 128 + 32 = 160 B
    let bl_dark = get_pixel(&rendered_bytes, width, 16, 200);
    assert_pixel_close(bl_dark, [32, 32, 160, 255], 4, "50% Blue over Dark Tile");
    // Light tile: 192 * 0.5 = 96 R/G, 128 + 96 = 224 B
    let bl_light = get_pixel(&rendered_bytes, width, 48, 200);
    assert_pixel_close(bl_light, [96, 96, 224, 255], 4, "50% Blue over Light Tile");

    let out_png = validation_output_dir().join("compositor_over_checkerboard.png");
    save_png(&out_png, width, height, &rendered_bytes);
    println!("Saved: {}", out_png.display());
}

// =============================================================================
// Test 4: Composite over Existing Video Frame
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_4_composite_over_existing_video_frame() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    // Simulate base video frame: Warm Sunset Amber [200, 140, 40, 255]
    let (_base_video_tex, base_video_view) =
        ctx.create_solid_texture(width, height, [200, 140, 40, 255]);

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_anim_tex, anim_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Animation Overlay");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let base_layer = CompositeLayer::new(&base_video_view); // Z=0
    let mut anim_layer = CompositeLayer::new(&anim_view).with_premultiplied(true);
    anim_layer.z_index = 1;

    let (rendered_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[base_layer, anim_layer],
            None,
        )
        .await
        .expect("Render over video frame failed");

    // 1. Where animation is transparent -> Base video untouched [200, 140, 40, 255]
    let tl = get_pixel(&rendered_bytes, width, 160, 90);
    assert_pixel_close(tl, [200, 140, 40, 255], 2, "Base Video in Transparent Area");

    // 2. Where animation is opaque red -> 100% Red [253, 0, 0, 255]
    let tr = get_pixel(&rendered_bytes, width, 480, 90);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "Animation Opaque Red over Video");

    // 3. Where animation is 50% blue -> Blend:
    // R = 200 * 0.5 = 100
    // G = 140 * 0.5 = 70
    // B = 128 + 40 * 0.5 = 148
    let bl = get_pixel(&rendered_bytes, width, 160, 270);
    assert_pixel_close(bl, [100, 70, 148, 255], 4, "50% Blue Blend over Base Video");

    let out_png = validation_output_dir().join("compositor_over_video_frame.png");
    save_png(&out_png, width, height, &rendered_bytes);
    println!("Saved: {}", out_png.display());
}

// =============================================================================
// Test 5: Premultiplied vs Straight Alpha Contract Parity
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_5_premultiplied_vs_straight_alpha_contract_parity() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    // 1. Frame in straight alpha
    let straight_frame = decoder.decode_video_frame(0.0).unwrap();
    // 2. Frame converted to premultiplied alpha
    let mut premult_frame = straight_frame.clone();
    premult_frame.to_premultiplied();

    let (_straight_tex, straight_view) = ctx.create_texture_from_bytes(
        width,
        height,
        &straight_frame.data,
        "Straight Texture",
    );
    let (_premult_tex, premult_view) = ctx.create_texture_from_bytes(
        width,
        height,
        &premult_frame.data,
        "Premultiplied Texture",
    );

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Render straight with is_premultiplied = false over White
    let straight_layer = CompositeLayer::new(&straight_view); // is_premultiplied = false
    let (straight_out, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[straight_layer],
            Some(wgpu::Color::WHITE),
        )
        .await
        .expect("Render straight failed");

    // Render premultiplied with is_premultiplied = true over White
    let premult_layer = CompositeLayer::new(&premult_view).with_premultiplied(true);
    let (premult_out, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[premult_layer],
            Some(wgpu::Color::WHITE),
        )
        .await
        .expect("Render premult failed");

    // Both paths must produce identical results within 1 LSB rounding!
    let mut max_diff = 0i16;
    for y in (0..height).step_by(10) {
        for x in (0..width).step_by(10) {
            let p1 = get_pixel(&straight_out, width, x, y);
            let p2 = get_pixel(&premult_out, width, x, y);
            for c in 0..4 {
                let diff = (p1[c] as i16 - p2[c] as i16).abs();
                if diff > max_diff {
                    max_diff = diff;
                }
            }
        }
    }

    println!("Max difference between Straight and Premultiplied paths: {} LSB", max_diff);
    assert!(
        max_diff <= 2,
        "Straight and Premultiplied rendering paths must match within 2 LSB (got {})",
        max_diff
    );
}

// =============================================================================
// Test 6: Intermediate Render Target Alpha Preservation
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_6_intermediate_render_target_alpha_preservation() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_fg_tex, fg_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Frame 0 (Premultiplied)");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Pass 1: Render onto a transparent intermediate target (clear_color: [0,0,0,0])
    let layer = CompositeLayer::new(&fg_view).with_premultiplied(true);
    let (pass1_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[layer],
            Some(wgpu::Color::TRANSPARENT),
        )
        .await
        .expect("Pass 1 failed");

    // Verify Pass 1 preserved the alpha channel in the intermediate target:
    let tl = get_pixel(&pass1_bytes, width, 160, 90);
    assert_eq!(tl[3], 0, "Top-left intermediate alpha must be 0");
    let tr = get_pixel(&pass1_bytes, width, 480, 90);
    assert_eq!(tr[3], 255, "Top-right intermediate alpha must be 255");
    let bl = get_pixel(&pass1_bytes, width, 160, 270);
    assert_pixel_close(bl, [0, 0, 128, 128], 3, "Bottom-left intermediate must be premultiplied blue");

    // Pass 2: Use the intermediate target as an input layer over White
    let (_inter_tex, inter_view) =
        ctx.create_texture_from_bytes(width, height, &pass1_bytes, "Intermediate Render Target");

    let pass2_layer = CompositeLayer::new(&inter_view).with_premultiplied(true);
    let (pass2_bytes, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[pass2_layer],
            Some(wgpu::Color::WHITE),
        )
        .await
        .expect("Pass 2 failed");

    // Over white: 50% blue intermediate renders as pastel blue [128, 128, 255, 255]
    let bl_pass2 = get_pixel(&pass2_bytes, width, 160, 270);
    assert_pixel_close(bl_pass2, [128, 128, 255, 255], 4, "Pass 2 50% Blue over White");
}

// =============================================================================
// Test 7: Resource Handling & Texture Reuse
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_7_resource_handling_and_texture_reuse() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Allocate single reusable GPU texture
    let reusable_texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Reusable Video Layer Texture"),
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
    });
    let reusable_view = reusable_texture.create_view(&wgpu::TextureViewDescriptor::default());

    let target_texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Target Texture"),
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
    let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();

    // Stream 10 frames through the SAME reusable GPU texture
    for f in 0..10 {
        let ts = (f as f64) / 30.0;
        let mut frame = decoder.decode_video_frame(ts).unwrap();
        frame.to_premultiplied();

        // Write directly to GPU texture without reallocation
        ctx.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &reusable_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame.data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        let layer = CompositeLayer::new(&reusable_view).with_premultiplied(true);
        let _ = compositor.composite_layers(
            &ctx.device,
            &ctx.queue,
            &target_view,
            &[layer],
            Some(wgpu::Color::BLACK),
        );
    }
}

// =============================================================================
// Test 8: Performance Benchmark (640x360 & 1920x1080)
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_8_compositor_performance_benchmark_640x360_and_1080p() {
    let ctx = HeadlessGpuContext::new().await;
    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();

    let n_frames = 30;

    println!("\n========================================================");
    println!("=== Step 3: Full-Pipeline Compositor Performance Benchmark ===");
    println!("========================================================");

    // -------------------------------------------------------------------------
    // Benchmark A: Native 640x360 Pipeline
    // -------------------------------------------------------------------------
    let w_360 = 640;
    let h_360 = 360;
    let compositor_360 = MultiTrackCompositor::new(&ctx.device, &ctx.queue, w_360, h_360);

    let tex_360 = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Bench 360 Texture"),
        size: wgpu::Extent3d {
            width: w_360,
            height: h_360,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view_360 = tex_360.create_view(&wgpu::TextureViewDescriptor::default());

    let mut total_decode_us = 0u128;
    let mut total_premul_us = 0u128;
    let mut total_upload_us = 0u128;
    let mut total_gpu_compose_us = 0u128;
    let mut total_readback_us = 0u128;

    for f in 0..n_frames {
        let ts = (f as f64) / 30.0;

        // 1. CPU Decode
        let t0 = Instant::now();
        let mut frame = decoder.decode_video_frame(ts).unwrap();
        total_decode_us += t0.elapsed().as_micros();

        // 2. RGBA Premultiplication
        let t1 = Instant::now();
        frame.to_premultiplied();
        total_premul_us += t1.elapsed().as_micros();

        // 3. CPU-to-GPU Texture Upload
        let t2 = Instant::now();
        ctx.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &tex_360,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame.data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w_360 * 4),
                rows_per_image: Some(h_360),
            },
            wgpu::Extent3d {
                width: w_360,
                height: h_360,
                depth_or_array_layers: 1,
            },
        );
        total_upload_us += t2.elapsed().as_micros();

        // 4. GPU Composition + Readback
        let layer = CompositeLayer::new(&view_360).with_premultiplied(true);
        let (_, comp_us, rb_us, _) = compositor_360
            .render_to_rgba_bytes_with_size_timed(
                &ctx.device,
                &ctx.queue,
                w_360,
                h_360,
                &[layer],
                Some(wgpu::Color::BLACK),
            )
            .await
            .unwrap();

        total_gpu_compose_us += comp_us as u128;
        total_readback_us += rb_us as u128;
    }

    let avg_dec_ms = (total_decode_us as f64) / (n_frames as f64 * 1000.0);
    let avg_pre_ms = (total_premul_us as f64) / (n_frames as f64 * 1000.0);
    let avg_upl_ms = (total_upload_us as f64) / (n_frames as f64 * 1000.0);
    let avg_cmp_ms = (total_gpu_compose_us as f64) / (n_frames as f64 * 1000.0);
    let avg_rb_ms = (total_readback_us as f64) / (n_frames as f64 * 1000.0);
    let total_pip_ms = avg_dec_ms + avg_pre_ms + avg_upl_ms + avg_cmp_ms + avg_rb_ms;

    println!("\n--- [640x360 Native Resolution Breakdown] ---");
    println!("  1. CPU Decode:                {:.2} ms/frame", avg_dec_ms);
    println!("  2. RGBA Premultiplication:     {:.4} ms/frame", avg_pre_ms);
    println!("  3. CPU->GPU Texture Upload:    {:.4} ms/frame", avg_upl_ms);
    println!("  4. GPU Compose (CPU submit):   {:.4} ms/frame", avg_cmp_ms);
    println!("  5. GPU Execute + Readback:     {:.2} ms/frame", avg_rb_ms);
    println!("  Total Frame Pipeline Latency:  {:.2} ms/frame", total_pip_ms);
    println!("  Real-time Throughput (30fps):  {:.1}x real-time (budget: 33.33 ms)", 33.333 / total_pip_ms);

    // -------------------------------------------------------------------------
    // Benchmark B: 1920x1080 Canvas Scaling Pipeline (Native 360p texture scaled on GPU)
    // -------------------------------------------------------------------------
    let w_1080 = 1920;
    let h_1080 = 1080;
    let compositor_1080 = MultiTrackCompositor::new(&ctx.device, &ctx.queue, w_1080, h_1080);

    let n_1080 = 10;
    let mut total_gpu_1080_compose_us = 0u128;
    let mut total_gpu_1080_rb_us = 0u128;

    for _ in 0..n_1080 {
        let layer = CompositeLayer::new(&view_360).with_premultiplied(true);
        let (_, comp_us, rb_us, _) = compositor_1080
            .render_to_rgba_bytes_with_size_timed(
                &ctx.device,
                &ctx.queue,
                w_1080,
                h_1080,
                &[layer],
                Some(wgpu::Color::BLACK),
            )
            .await
            .unwrap();

        total_gpu_1080_compose_us += comp_us as u128;
        total_gpu_1080_rb_us += rb_us as u128;
    }

    let avg_1080_cmp_ms = (total_gpu_1080_compose_us as f64) / (n_1080 as f64 * 1000.0);
    let avg_1080_rb_ms = (total_gpu_1080_rb_us as f64) / (n_1080 as f64 * 1000.0);
    let total_1080_ms = avg_dec_ms + avg_pre_ms + avg_upl_ms + avg_1080_cmp_ms + avg_1080_rb_ms;

    println!("\n--- [1920x1080 Canvas Viewport Breakdown (GPU Scaled)] ---");
    println!("  1. CPU Decode (Native 360p):   {:.2} ms/frame", avg_dec_ms);
    println!("  2. RGBA Premultiplication:     {:.4} ms/frame", avg_pre_ms);
    println!("  3. CPU->GPU Texture Upload:    {:.4} ms/frame", avg_upl_ms);
    println!("  4. GPU Compose (CPU submit):   {:.4} ms/frame", avg_1080_cmp_ms);
    println!("  5. GPU Scale & Raster (1080p): {:.2} ms/frame", avg_1080_rb_ms);
    println!("  Total 1080p Pipeline Latency:  {:.2} ms/frame", total_1080_ms);
    println!("  Real-time Throughput (30fps):  {:.1}x real-time (budget: 33.33 ms)", 33.333 / total_1080_ms);
    println!("========================================================\n");

    assert!(total_pip_ms < 33.333, "640x360 pipeline must be real-time");
    assert!(total_1080_ms < 33.333, "1920x1080 GPU-scaled pipeline must be real-time");
}
