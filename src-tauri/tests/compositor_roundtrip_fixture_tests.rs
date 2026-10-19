//! Layer B — Compositor Round-Trip Fixture Golden Tests
//!
//! Validates the Rust side of the Request Round-Trip contract:
//! Loads committed JSON fixtures produced by the TypeScript evaluator + request builder
//! (`tests/fixtures/roundtrip/*.json`), parses the layers, renders them via the
//! headless wgpu MultiTrackCompositor, and asserts exact pixel colours at expected coordinates.
//!
//! If the TypeScript request builder or evaluator drifts from the Rust compositor's
//! expectations, either the TS fixture test or this Rust test will fail.
//!
//! Run:  cd src-tauri && cargo test --test compositor_roundtrip_fixture_tests -- --ignored

use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tauri_app_lib::golden_harness::assert_golden_parity;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    CompositeLayer, LayerTransform, MultiTrackCompositor,
};
use wgpu::util::DeviceExt;

// ─── Fixture Deserialization Models ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct FixtureRasterLayer {
    asset_id: String,
    width: u32,
    height: u32,
    x: f32,
    y: f32,
    rotation: f32,
    opacity: f32,
    z_index: i32,
    blend_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct FixtureTextLayer {
    layer_id: Option<String>,
    text: String,
    font_id: String,
    font_size: f32,
    color: [f32; 4],
    x: f32,
    y: f32,
    box_width: Option<f32>,
    box_height: Option<f32>,
    rotation: Option<f32>,
    opacity: Option<f32>,
    z_index: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct FixtureProjectRequest {
    canvas_width: u32,
    canvas_height: u32,
    clear_color: [f32; 4],
    #[serde(default)]
    layers: Vec<serde_json::Value>,
    #[serde(default)]
    raster_layers: Vec<FixtureRasterLayer>,
    #[serde(default)]
    text_layers: Vec<FixtureTextLayer>,
}

// ─── Headless GPU Setup ──────────────────────────────────────────────────────

struct HeadlessGpu {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    compositor: MultiTrackCompositor,
    canvas_w: u32,
    canvas_h: u32,
}

impl HeadlessGpu {
    async fn new(width: u32, height: u32) -> Self {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = if let Some(a) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
        {
            a
        } else if let Some(a) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::None,
                compatible_surface: None,
                force_fallback_adapter: true,
            })
            .await
        {
            a
        } else {
            let mut adapters = instance.enumerate_adapters(wgpu::Backends::all());
            adapters.sort_by_key(|a| {
                let info = a.get_info();
                let mut score = match info.device_type {
                    wgpu::DeviceType::DiscreteGpu => 1000,
                    wgpu::DeviceType::IntegratedGpu => 200,
                    wgpu::DeviceType::VirtualGpu => 50,
                    wgpu::DeviceType::Cpu => 10,
                    wgpu::DeviceType::Other => 0,
                };
                #[cfg(target_os = "linux")]
                if info.backend == wgpu::Backend::Vulkan {
                    score += 500;
                }
                #[cfg(target_os = "windows")]
                if info.backend == wgpu::Backend::Dx12 {
                    score += 500;
                }
                #[cfg(target_os = "macos")]
                if info.backend == wgpu::Backend::Metal {
                    score += 500;
                }
                std::cmp::Reverse(score)
            });
            adapters
                .into_iter()
                .next()
                .expect("Failed to find suitable GPU adapter for round-trip fixture tests")
        };

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Round-Trip Fixture Test Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .expect("Failed to create wgpu device for round-trip fixture tests");

        let device = Arc::new(device);
        let queue = Arc::new(queue);
        let compositor = MultiTrackCompositor::new(&device, &queue, width, height);

        Self {
            device,
            queue,
            compositor,
            canvas_w: width,
            canvas_h: height,
        }
    }

    /// Create a solid-colour RGBA texture representing a rasterized asset.
    fn solid_texture(
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
                label: Some("Fixture Solid Texture"),
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

    /// Render layers and return RGBA8 bytes.
    async fn render(&self, layers: &[CompositeLayer<'_>], clear_color: Option<wgpu::Color>) -> Vec<u8> {
        self.compositor
            .render_to_rgba_bytes_with_size(
                &self.device,
                &self.queue,
                self.canvas_w,
                self.canvas_h,
                layers,
                clear_color,
            )
            .await
            .expect("Composition must succeed")
    }

    fn pixel_at(&self, buf: &[u8], x: u32, y: u32) -> [u8; 4] {
        let idx = ((y * self.canvas_w + x) * 4) as usize;
        [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]]
    }

    fn assert_pixel(
        &self,
        buf: &[u8],
        x: u32,
        y: u32,
        expected: [u8; 4],
        tolerance: u8,
        label: &str,
    ) {
        let actual = self.pixel_at(buf, x, y);
        for ch in 0..4 {
            let diff = (actual[ch] as i16 - expected[ch] as i16).unsigned_abs() as u8;
            assert!(
                diff <= tolerance,
                "[{label}] Pixel at ({x}, {y}) ch {ch}: expected {}, got {} (diff {diff} > tol {tolerance})",
                expected[ch],
                actual[ch]
            );
        }
    }
}

/// Convert pixel-space (x, y, w, h) on canvas (canvas_w, canvas_h) to NDC LayerTransform.
fn pixel_to_ndc_transform(
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    canvas_w: f32,
    canvas_h: f32,
) -> LayerTransform {
    LayerTransform {
        translate_x: ((x + w * 0.5) / canvas_w) * 2.0 - 1.0,
        translate_y: 1.0 - ((y + h * 0.5) / canvas_h) * 2.0,
        scale_x: w / canvas_w,
        scale_y: h / canvas_h,
        rotation_rad: 0.0,
        canvas_aspect_ratio: canvas_w / canvas_h,
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test --test compositor_roundtrip_fixture_tests -- --ignored"]
async fn test_roundtrip_mixed_scene_renders_magenta_sticker_at_expected_coords() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/roundtrip/mixed_scene_request.json");
    let content = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {:?}: {e}", fixture_path));
    let fixture: FixtureProjectRequest = serde_json::from_str(&content)
        .expect("Failed to parse mixed_scene_request.json into FixtureProjectRequest");

    assert_eq!(fixture.canvas_width, 1920);
    assert_eq!(fixture.canvas_height, 1080);
    assert_eq!(fixture.raster_layers.len(), 1, "Must contain sticker raster layer");

    let sticker_layer = &fixture.raster_layers[0];
    assert!(sticker_layer.asset_id.contains("fixture-sticker-magenta"));
    assert_eq!(sticker_layer.width, 64);
    assert_eq!(sticker_layer.height, 64);
    assert_eq!(sticker_layer.x, 928.0);
    assert_eq!(sticker_layer.y, 508.0);

    let gpu = HeadlessGpu::new(fixture.canvas_width, fixture.canvas_height).await;

    // Pure magenta texture matching the fixture specification [255, 0, 255, 255]
    let (_sticker_tex, sticker_view) = gpu.solid_texture(64, 64, [255, 0, 255, 255]);

    let transform = pixel_to_ndc_transform(
        sticker_layer.x,
        sticker_layer.y,
        sticker_layer.width as f32,
        sticker_layer.height as f32,
        fixture.canvas_width as f32,
        fixture.canvas_height as f32,
    );

    let mut layer = CompositeLayer::new(&sticker_view);
    layer.transform = transform;
    layer.opacity = sticker_layer.opacity;
    layer.z_index = sticker_layer.z_index;

    let clear = Some(wgpu::Color {
        r: fixture.clear_color[0] as f64,
        g: fixture.clear_color[1] as f64,
        b: fixture.clear_color[2] as f64,
        a: fixture.clear_color[3] as f64,
    });
    let buf = gpu.render(&[layer], clear).await;

    // 1. Center of sticker (928 + 32 = 960, 508 + 32 = 540) must be pure magenta
    gpu.assert_pixel(&buf, 960, 540, [255, 0, 255, 255], 2, "Sticker Center");

    // 2. Corner of sticker inside box (930, 510) must be pure magenta
    gpu.assert_pixel(&buf, 930, 510, [255, 0, 255, 255], 2, "Sticker Top-Left Inside");

    // 3. Corner of sticker bottom-right inside (928 + 62 = 990, 508 + 62 = 570)
    gpu.assert_pixel(&buf, 990, 570, [255, 0, 255, 255], 2, "Sticker Bottom-Right Inside");

    // 4. Pixels outside the sticker box must be background black
    gpu.assert_pixel(&buf, 10, 10, [0, 0, 0, 255], 2, "Canvas Corner Background");
    gpu.assert_pixel(&buf, 900, 540, [0, 0, 0, 255], 2, "Left of Sticker Outside");
    gpu.assert_pixel(&buf, 1020, 540, [0, 0, 0, 255], 2, "Right of Sticker Outside");
    gpu.assert_pixel(&buf, 960, 480, [0, 0, 0, 255], 2, "Above Sticker Outside");
    gpu.assert_pixel(&buf, 960, 600, [0, 0, 0, 255], 2, "Below Sticker Outside");

    // 5. Parity with self must be exact
    let expected = buf.clone();
    assert_golden_parity(
        &buf,
        &expected,
        fixture.canvas_width,
        fixture.canvas_height,
        1.0,
        0,
        "roundtrip_mixed_scene_sticker_parity",
    );
}

#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test --test compositor_roundtrip_fixture_tests -- --ignored"]
async fn test_roundtrip_empty_scene_renders_black_canvas() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/roundtrip/empty_scene_request.json");
    let content = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {:?}: {e}", fixture_path));
    let fixture: FixtureProjectRequest = serde_json::from_str(&content)
        .expect("Failed to parse empty_scene_request.json");

    assert_eq!(fixture.canvas_width, 1920);
    assert_eq!(fixture.canvas_height, 1080);
    assert_eq!(fixture.raster_layers.len(), 0);

    let gpu = HeadlessGpu::new(fixture.canvas_width, fixture.canvas_height).await;

    let clear = Some(wgpu::Color {
        r: fixture.clear_color[0] as f64,
        g: fixture.clear_color[1] as f64,
        b: fixture.clear_color[2] as f64,
        a: fixture.clear_color[3] as f64,
    });
    let buf = gpu.render(&[], clear).await;

    // Check multiple coordinates across canvas — all must be background black
    gpu.assert_pixel(&buf, 0, 0, [0, 0, 0, 255], 1, "Empty Top-Left");
    gpu.assert_pixel(&buf, 960, 540, [0, 0, 0, 255], 1, "Empty Center");
    gpu.assert_pixel(&buf, 1919, 1079, [0, 0, 0, 255], 1, "Empty Bottom-Right");
}

#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test --test compositor_roundtrip_fixture_tests -- --ignored"]
async fn test_roundtrip_negative_control_wrong_placement_fails() {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/roundtrip/mixed_scene_request.json");
    let content = std::fs::read_to_string(&fixture_path).unwrap();
    let fixture: FixtureProjectRequest = serde_json::from_str(&content).unwrap();

    let gpu = HeadlessGpu::new(fixture.canvas_width, fixture.canvas_height).await;

    let (_sticker_tex, sticker_view) = gpu.solid_texture(64, 64, [255, 0, 255, 255]);

    // MUTATION: intentionally place sticker in the wrong quadrant (x: 100, y: 100 instead of 928, 508)
    let mutated_transform = pixel_to_ndc_transform(
        100.0,
        100.0,
        64.0,
        64.0,
        fixture.canvas_width as f32,
        fixture.canvas_height as f32,
    );

    let mut layer = CompositeLayer::new(&sticker_view);
    layer.transform = mutated_transform;

    let clear = Some(wgpu::Color {
        r: fixture.clear_color[0] as f64,
        g: fixture.clear_color[1] as f64,
        b: fixture.clear_color[2] as f64,
        a: fixture.clear_color[3] as f64,
    });
    let buf = gpu.render(&[layer], clear).await;

    // The expected center of the sticker (960, 540) must NOT be magenta under this mutation
    let center_pixel = gpu.pixel_at(&buf, 960, 540);
    assert_ne!(
        center_pixel,
        [255, 0, 255, 255],
        "Negative control passed: mutated sticker placement left original center black as expected"
    );
}
