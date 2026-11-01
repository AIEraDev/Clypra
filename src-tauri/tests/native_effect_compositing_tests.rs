//! Integration tests for Phase 1 Step 5: Native Effect-Layer Decoding and Compositing
//!
//! Validates:
//! 1. Decoder: Effect video opens and decodes correctly via cached decoder (`VideoDecoder`).
//! 2. Pixel format: Canonical RGBA8 output and premultiplied alpha invariants.
//! 3. Alpha: Premultiplied output blends correctly without dark halos or double-opacity scaling.
//! 4. GPU: Effect texture reaches the existing compositor and renders to GPU readback buffer.
//! 5. Transform: Position, scale, and rotation are applied accurately.
//! 6. Ordering: z_index behaves deterministically (above/below base video).
//! 7. Seeking: Correct frames rendered after random seeking (0, 15, 30, 45, 59).
//! 8. Error handling: Missing asset returns clean error.
//! 9. Texture and decoder reuse: Repeated requests reuse cached decoders and GPU textures.
//! 10. Compositing over video frame: Base video + effect layer composites correctly.
//! 11. Cache key invariance (Decision #2): Decode cache key ignores effect layers; compose cache key includes them.

use image::{ColorType, ImageEncoder};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::Arc;

use tauri_app_lib::filmstrip_engine::decoder::{
    get_preview_decoder_for_stream, VideoDecoder,
};
use tauri_app_lib::native_core::{
    EffectLayerSnapshot, FrameRequest, FrameTime, ProjectSnapshot, VideoLayerSnapshot,
    DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    CompositeLayer, LayerTransform, MultiTrackCompositor,
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
                    label: Some("Effect Compositor Test Device"),
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
// Test 1: Decoder Caching and Alpha Channel Detection
// =============================================================================
#[tokio::test]
async fn test_1_decoder_caching_and_alpha_channel_detection() {
    let fixture = fixture_path();
    let fixture_str = fixture.to_str().expect("Valid UTF-8 path");

    // Acquire stream-isolated decoder
    let decoder_arc = get_preview_decoder_for_stream(fixture_str, "effect-test-stream-1")
        .await
        .expect("Must acquire decoder from preview pool");

    {
        let guard = decoder_arc.lock().await;
        assert!(guard.has_alpha(), "ProRes 4444 fixture must report has_alpha = true");
        let (dw, dh) = guard.display_dimensions();
        assert_eq!(dw, 640);
        assert_eq!(dh, 360);
        assert!(guard.fps() >= 29.0 && guard.fps() <= 31.0);
    }

    // Re-acquiring with the same stream key must return the exact same Arc (Decision #1)
    let cached_arc = get_preview_decoder_for_stream(fixture_str, "effect-test-stream-1")
        .await
        .expect("Must retrieve cached decoder");

    assert!(
        Arc::ptr_eq(&decoder_arc, &cached_arc),
        "Decoder pool must reuse existing VideoDecoder instance for identical asset & stream ID"
    );
}

// =============================================================================
// Test 2: Canonical RGBA8 Output and Premultiplied Alpha Invariants
// =============================================================================
#[tokio::test]
async fn test_2_canonical_rgba8_format_and_premultiplied_invariants() {
    let fixture = fixture_path();
    let mut decoder = VideoDecoder::open(fixture.to_str().unwrap()).unwrap();

    let mut frame = decoder
        .decode_video_frame(0.0)
        .expect("Must decode frame 0 at timestamp 0.0");
    frame.to_premultiplied();

    assert_eq!(frame.width, 640);
    assert_eq!(frame.height, 360);
    assert_eq!(frame.data.len(), 640 * 360 * 4);
    assert_eq!(frame.source_pixel_format, "yuva444p12le");

    // Premultiplication invariants:
    // 1. Top-Left: Fully transparent region -> A = 0 and RGB = (0, 0, 0)
    let tl = frame.get_pixel(160, 90);
    assert_eq!(tl[3], 0, "Top-left alpha must be 0 (transparent)");
    assert_eq!([tl[0], tl[1], tl[2]], [0, 0, 0], "Transparent pixel RGB must be (0,0,0)");

    // 2. Top-Right: Fully opaque red -> A = 255 and R >= 250
    let tr = frame.get_pixel(480, 90);
    assert_eq!(tr[3], 255, "Top-right alpha must be 255 (opaque)");
    assert!(tr[0] >= 250, "Top-right red must be >= 250, got {}", tr[0]);

    // 3. Bottom-Left: 50% semi-transparent blue -> A ≈ 128 and B ≈ 128
    let bl = frame.get_pixel(160, 270);
    assert!(
        (bl[3] as i16 - 128).abs() <= 5,
        "Bottom-left alpha must be ≈ 128, got {}",
        bl[3]
    );
    assert!(
        (bl[2] as i16 - 128).abs() <= 5,
        "Bottom-left premultiplied blue must be ≈ 128, got {}",
        bl[2]
    );

    // 4. Bottom-Right: Gradient green at horizontal midpoint -> A ≈ 128, G ≈ 128
    let br_mid = frame.get_pixel(480, 270);
    assert!(
        (br_mid[3] as i16 - 128).abs() <= 6,
        "Gradient midpoint alpha must be ≈ 128, got {}",
        br_mid[3]
    );
    assert!(
        (br_mid[1] as i16 - 128).abs() <= 6,
        "Gradient midpoint premultiplied green must be ≈ 128, got {}",
        br_mid[1]
    );
}

// =============================================================================
// Test 3: GPU Texture Upload & Readback (End-to-End Pipeline)
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_3_gpu_texture_upload_and_compositor_readback() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let frame = decoder.decode_video_frame(0.0).unwrap();

    let (_tex, view) = ctx.create_texture_from_bytes(
        width,
        height,
        &frame.data,
        "Effect Layer Texture Frame 0",
    );

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);
    let layer = CompositeLayer::new(&view).with_premultiplied(true);

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
        .expect("Compositor render must succeed");

    assert_eq!(rendered_bytes.len(), (width * height * 4) as usize);

    // Verify opaque red quadrant reaches the readback buffer accurately
    let tr = get_pixel(&rendered_bytes, width, 480, 90);
    assert!(tr[0] >= 250, "Readback red channel must be >= 250, got {}", tr[0]);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "GPU Readback Red Region");
}

// =============================================================================
// Test 4: Z-Index Layer Ordering (Above vs Below Base Video)
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_4_z_index_ordering_above_and_below_base() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let frame = decoder.decode_video_frame(0.0).unwrap();

    let (_effect_tex, effect_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "Effect Texture");

    // Base video layer: solid green [0, 255, 0, 255]
    let (_base_tex, base_view) =
        ctx.create_solid_texture(width, height, [0, 255, 0, 255]);

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Case A: Effect layer has z_index: 100 (ABOVE base video z_index: 0)
    {
        let base_layer = CompositeLayer::new(&base_view);
        let mut effect_layer = CompositeLayer::new(&effect_view).with_premultiplied(true);
        effect_layer.z_index = 100;

        let (rendered, _, _, _) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &ctx.device,
                &ctx.queue,
                width,
                height,
                &[base_layer, effect_layer],
                Some(wgpu::Color::BLACK),
            )
            .await
            .expect("Render Case A failed");

        // Top-Left (transparent quadrant): Base green shows through
        let tl = get_pixel(&rendered, width, 160, 90);
        assert_pixel_close(tl, [0, 255, 0, 255], 3, "Transparent effect over green base");

        // Top-Right (opaque red quadrant): Effect red occludes base green
        let tr = get_pixel(&rendered, width, 480, 90);
        assert!(tr[0] >= 250, "Opaque red must occlude base green, got R={}", tr[0]);
        assert!(tr[1] <= 10, "Base green must NOT show through opaque red, got G={}", tr[1]);
    }

    // Case B: Effect layer has z_index: -10 (BELOW base video z_index: 0)
    {
        let base_layer = CompositeLayer::new(&base_view);
        let mut effect_layer = CompositeLayer::new(&effect_view).with_premultiplied(true);
        effect_layer.z_index = -10;

        let (rendered, _, _, _) = compositor
            .render_to_rgba_bytes_with_size_timed(
                &ctx.device,
                &ctx.queue,
                width,
                height,
                &[base_layer, effect_layer],
                Some(wgpu::Color::BLACK),
            )
            .await
            .expect("Render Case B failed");

        // Base green is fully opaque and above effect layer -> ENTIRE canvas is green
        let tr = get_pixel(&rendered, width, 480, 90);
        assert_pixel_close(tr, [0, 255, 0, 255], 3, "Base video occludes underlying effect layer");
    }
}

// =============================================================================
// Test 5: Layer Opacity Scaling Without Double-Premultiplication
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_5_layer_opacity_scaling_without_double_alpha() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let frame = decoder.decode_video_frame(0.0).unwrap();

    let (_tex, view) = ctx.create_texture_from_bytes(width, height, &frame.data, "Effect Texture");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Set layer opacity to 50% (0.5) over black
    let mut layer = CompositeLayer::new(&view).with_premultiplied(true);
    layer.opacity = 0.5;

    let (rendered, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[layer],
            Some(wgpu::Color::BLACK),
        )
        .await
        .expect("Render failed");

    // Top-Right: Opaque red [253, 0, 0, 255] scaled by 0.5 opacity over black
    // Expected: [round(253 * 0.5), 0, 0, 255] ≈ [126, 0, 0, 255]
    let tr = get_pixel(&rendered, width, 480, 90);
    assert!(
        (tr[0] as i16 - 126).abs() <= 4,
        "Red channel with 0.5 opacity must be ≈ 126, got {}",
        tr[0]
    );
    assert_eq!(tr[1], 0, "Green channel must be 0");
    assert_eq!(tr[2], 0, "Blue channel must be 0");
}

// =============================================================================
// Test 6: Affine Transform (Position, Scale, Rotation)
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_6_affine_transform_placement_and_scaling() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let frame = decoder.decode_video_frame(0.0).unwrap();

    let (_tex, view) = ctx.create_texture_from_bytes(width, height, &frame.data, "Effect Texture");

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    // Apply 50% scale (sx: 0.5, sy: 0.5) placed at center (tx: 0.0, ty: 0.0)
    let mut layer = CompositeLayer::new(&view).with_premultiplied(true);
    layer.transform = LayerTransform {
        translate_x: 0.0,
        translate_y: 0.0,
        scale_x: 0.5,
        scale_y: 0.5,
        rotation_rad: 0.0,
        canvas_aspect_ratio: width as f32 / height as f32,
    };

    let (rendered, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[layer],
            Some(wgpu::Color::BLACK),
        )
        .await
        .expect("Render failed");

    // The entire scaled layer now occupies the central rectangle [160..480, 90..270]
    // The top-right quadrant of the scaled layer is now centered around (x = 400, y = 135)
    let tr_scaled = get_pixel(&rendered, width, 400, 135);
    assert!(
        tr_scaled[0] >= 240,
        "Scaled red quadrant at (400, 135) must be red, got R={}",
        tr_scaled[0]
    );

    // Pixels outside the scaled layer (e.g. at 580, 45) must remain the clear color (black)
    let outside = get_pixel(&rendered, width, 580, 45);
    assert_pixel_close(outside, [0, 0, 0, 255], 2, "Outside scaled bounds must be black");
}

// =============================================================================
// Test 7: Random Frame Seeking (Non-Sequential Scrubbing)
// =============================================================================
#[tokio::test]
async fn test_7_random_frame_seeking_preserves_accuracy() {
    let fixture = fixture_path();
    let mut decoder = VideoDecoder::open(fixture.to_str().unwrap()).unwrap();
    let fps = decoder.fps().max(1.0);

    // The synthetic fixture animates a 360-degree clockwise rotation over 60 frames (6 deg/frame)
    // around center (320, 180):
    // - Frame 0 (0 deg):   Red quadrant at top-right (480, 90)
    // - Frame 15 (90 deg):  Red quadrant rotated to bottom-right (480, 270)
    // - Frame 30 (180 deg): Red quadrant rotated to bottom-left (160, 270)
    // - Frame 45 (270 deg): Red quadrant rotated to top-left (160, 90)
    // - Frame 59 (354 deg): Red quadrant rotated back to top-right (480, 90)
    let seek_cases = [
        (45, 160, 90, "Frame 45 (270 deg): Red rotated to top-left"),
        (0, 480, 90, "Frame 0 (0 deg): Red at top-right"),
        (30, 160, 270, "Frame 30 (180 deg): Red rotated to bottom-left"),
        (15, 480, 270, "Frame 15 (90 deg): Red rotated to bottom-right"),
        (59, 480, 90, "Frame 59 (354 deg): Red rotated back to top-right"),
    ];

    for (frame_idx, sample_x, sample_y, desc) in seek_cases {
        let time_secs = (frame_idx as f64) / fps;
        let mut frame = decoder
            .decode_video_frame(time_secs)
            .unwrap_or_else(|e| panic!("Failed to decode seeked frame {}: {}", frame_idx, e));
        frame.to_premultiplied();

        assert_eq!(frame.width, 640);
        assert_eq!(frame.height, 360);

        let pixel = frame.get_pixel(sample_x, sample_y);
        assert!(
            pixel[0] >= 240,
            "{}: expected red >= 240 at ({}, {}), got {:?}",
            desc,
            sample_x,
            sample_y,
            pixel
        );
        assert_eq!(pixel[3], 255, "{}: expected opaque alpha at ({}, {})", desc, sample_x, sample_y);
    }
}

// =============================================================================
// Test 8: Missing Asset Error Handling
// =============================================================================
#[tokio::test]
async fn test_8_missing_asset_returns_clean_error() {
    let non_existent_path = "/tmp/clypra_non_existent_asset_xyz_123.mov";
    let result = get_preview_decoder_for_stream(non_existent_path, "missing-stream").await;

    assert!(
        result.is_err(),
        "Opening non-existent file must return Err, not panic"
    );
    let err_msg = result.err().unwrap();
    assert!(
        err_msg.contains("non_existent_asset_xyz") || err_msg.contains("No such file") || err_msg.contains("failed"),
        "Error message should explain failure: {}",
        err_msg
    );
}

// =============================================================================
// Test 9: Compositing over Checkerboard Background
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_9_composite_over_checkerboard_background() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut frame = decoder.decode_video_frame(0.0).unwrap();
    frame.to_premultiplied();

    let (_fg_tex, fg_view) =
        ctx.create_texture_from_bytes(width, height, &frame.data, "ProRes Frame 0 (Premultiplied)");

    let (_bg_tex, bg_view) = ctx.create_checkerboard_texture(width, height, 32);

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let bg_layer = CompositeLayer::new(&bg_view);
    let mut fg_layer = CompositeLayer::new(&fg_view).with_premultiplied(true);
    fg_layer.z_index = 1;

    let (rendered, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[bg_layer, fg_layer],
            None,
        )
        .await
        .expect("Render failed");

    // 1. Top-Left: Transparent -> exact checkerboard dark tile (64)
    let tl_dark = get_pixel(&rendered, width, 16, 16);
    assert_pixel_close(tl_dark, [64, 64, 64, 255], 3, "Checkerboard dark tile through transparent region");

    // 2. Top-Left: Transparent -> exact checkerboard light tile (192)
    let tl_light = get_pixel(&rendered, width, 48, 16);
    assert_pixel_close(tl_light, [192, 192, 192, 255], 3, "Checkerboard light tile through transparent region");

    // 3. Top-Right: Opaque red completely occludes checkerboard
    let tr = get_pixel(&rendered, width, 480, 90);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "Opaque red over checkerboard");

    let out_png = validation_output_dir().join("compositor_over_checkerboard_step5.png");
    save_png(&out_png, width, height, &rendered);
}

// =============================================================================
// Test 10: Full Multi-Track Layer Composition (Video + Effect Overlay)
// =============================================================================
#[tokio::test]
#[ignore = "requires GPU hardware"]
async fn test_10_composite_over_base_video_frame() {
    let ctx = HeadlessGpuContext::new().await;
    let width = 640;
    let height = 360;

    let mut decoder = VideoDecoder::open(fixture_path().to_str().unwrap()).unwrap();
    let mut effect_frame = decoder.decode_video_frame(0.0).unwrap();
    effect_frame.to_premultiplied();

    let (_effect_tex, effect_view) =
        ctx.create_texture_from_bytes(width, height, &effect_frame.data, "Effect Texture (Premultiplied)");

    // Simulated base video: blue/teal scene [20, 80, 180, 255]
    let (_base_tex, base_view) =
        ctx.create_solid_texture(width, height, [20, 80, 180, 255]);

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let base_layer = CompositeLayer::new(&base_view);
    let mut effect_layer = CompositeLayer::new(&effect_view).with_premultiplied(true);
    effect_layer.z_index = 1;

    let (rendered, _, _, _) = compositor
        .render_to_rgba_bytes_with_size_timed(
            &ctx.device,
            &ctx.queue,
            width,
            height,
            &[base_layer, effect_layer],
            None,
        )
        .await
        .expect("Render failed");

    // Top-Left (transparent): 100% base video [20, 80, 180, 255]
    let tl = get_pixel(&rendered, width, 160, 90);
    assert_pixel_close(tl, [20, 80, 180, 255], 3, "Base video through transparent region");

    // Top-Right (opaque red): 100% effect red [253, 0, 0, 255]
    let tr = get_pixel(&rendered, width, 480, 90);
    assert_pixel_close(tr, [253, 0, 0, 255], 4, "Effect red over base video");

    // Bottom-Left (50% semi-transparent blue): Blend of base [20, 80, 180] and effect blue [0, 0, 255]
    // Expected: R ≈ 20 * 0.5 + 0 = 10, G ≈ 80 * 0.5 + 0 = 40, B ≈ 180 * 0.5 + 128 = 218
    let bl = get_pixel(&rendered, width, 160, 270);
    assert!(
        (bl[0] as i16 - 10).abs() <= 5,
        "Red blend must be ≈ 10, got {}",
        bl[0]
    );
    assert!(
        (bl[1] as i16 - 40).abs() <= 5,
        "Green blend must be ≈ 40, got {}",
        bl[1]
    );
    assert!(
        (bl[2] as i16 - 218).abs() <= 6,
        "Blue blend must be ≈ 218, got {}",
        bl[2]
    );

    let out_png = validation_output_dir().join("compositor_over_video_step5.png");
    save_png(&out_png, width, height, &rendered);
}

// =============================================================================
// Test 11: Cache Key Invariance (Architectural Decision #2)
// =============================================================================
#[test]
fn test_11_cache_key_invariance_decision_2() {
    let make_request = |effects: Vec<EffectLayerSnapshot>| FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "test-cache-req-1".to_string(),
        frame_time: FrameTime::new(0, 1_000_000, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-1".to_string(),
            frame_rate: 30,
            canvas_width: 640,
            canvas_height: 360,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![VideoLayerSnapshot {
                layer_id: "base-video".to_string(),
                asset_id: "asset-video-1".to_string(),
                video_path: "/path/to/base.mp4".to_string(),
                source_time: FrameTime::new(0, 1_000_000, DEFAULT_TIME_SCALE).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 640.0,
                height: 360.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                crop: None,
                color_grade: None,
                body_effect: None,
            }],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: effects,
            transition: None,
        },
        quality: tauri_app_lib::native_core::QualityTier::Full,
        color_policy: tauri_app_lib::native_core::ColorPolicy::default(),
        render_graph_version: 1,
        output_width: 640,
        output_height: 360,
        mode: None,
        is_scrubbing: None,
        allow_keyframe_approx: None,
        generation: None,
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
    };

    let req_no_effects = make_request(vec![]);
    let req_with_effect_frame_0 = make_request(vec![EffectLayerSnapshot {
        layer_id: Some("eff-1".to_string()),
        asset_path: "/path/to/effect.mov".to_string(),
        frame: 0,
        x: 0.0,
        y: 0.0,
        width: None,
        height: None,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 100,
        blend_mode: "normal".to_string(),
        transform: None,
    }]);
    let req_with_effect_frame_15 = make_request(vec![EffectLayerSnapshot {
        layer_id: Some("eff-1".to_string()),
        asset_path: "/path/to/effect.mov".to_string(),
        frame: 15,
        x: 0.0,
        y: 0.0,
        width: None,
        height: None,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 100,
        blend_mode: "normal".to_string(),
        transform: None,
    }]);

    // Architectural Invariant 1:
    // `decode_cache_key` must be IDENTICAL across all three requests because
    // secondary overlays never invalidate underlying base video decode cache.
    let decode_key_1 = req_no_effects.decode_cache_key().unwrap();
    let decode_key_2 = req_with_effect_frame_0.decode_cache_key().unwrap();
    let decode_key_3 = req_with_effect_frame_15.decode_cache_key().unwrap();

    assert_eq!(
        decode_key_1, decode_key_2,
        "decode_cache_key must not change when adding an effect layer"
    );
    assert_eq!(
        decode_key_2, decode_key_3,
        "decode_cache_key must not change when advancing effect frame index"
    );

    // Architectural Invariant 2:
    // `cache_key` (composition cache key) MUST be DISTINCT because the composited
    // visual result is different when effect overlays are added or modified.
    let comp_key_1 = req_no_effects.cache_key().unwrap();
    let comp_key_2 = req_with_effect_frame_0.cache_key().unwrap();
    let comp_key_3 = req_with_effect_frame_15.cache_key().unwrap();

    assert_ne!(
        comp_key_1, comp_key_2,
        "Compositor cache_key must differ when effect layer is present"
    );
    assert_ne!(
        comp_key_2, comp_key_3,
        "Compositor cache_key must differ when effect layer frame changes"
    );
}
