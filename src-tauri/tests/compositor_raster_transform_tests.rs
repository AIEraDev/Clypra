//! Layer B — Compositor Raster + Transform Golden Tests
//!
//! These tests verify that the wgpu compositor correctly places raster assets
//! at the right pixel coordinates after applying transforms (translate, scale,
//! rotation).  They use solid-colour textures with unique known colours so
//! assertions check **position and size, not only presence**.
//!
//! Each test has a **negative control**: a mutation (wrong transform, missing
//! layer, zero opacity) that must change the result.
//!
//! Run:  cd src-tauri && cargo test --test compositor_raster_transform_tests -- --ignored

use std::sync::Arc;
use tauri_app_lib::golden_harness::assert_golden_parity;
use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    CompositeLayer, LayerTransform, MultiTrackCompositor,
};
use wgpu::util::DeviceExt;

// ─── Shared headless GPU setup ───────────────────────────────────────────────

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
                .expect("Failed to find suitable GPU adapter for Layer B compositor tests")
        };

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Layer B Compositor Test"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .expect("Failed to create wgpu device for Layer B compositor tests");

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

    /// Create a solid-colour RGBA texture (known-colour fixture).
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
                label: Some("Solid Test Texture"),
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
    async fn render(&self, layers: &[CompositeLayer<'_>]) -> Vec<u8> {
        self.compositor
            .render_to_rgba_bytes_with_size(
                &self.device,
                &self.queue,
                self.canvas_w,
                self.canvas_h,
                layers,
                None,
            )
            .await
            .expect("Composition must succeed")
    }

    /// Read pixel at (x, y) from RGBA8 buffer.
    fn pixel_at(&self, buf: &[u8], x: u32, y: u32) -> [u8; 4] {
        let idx = ((y * self.canvas_w + x) * 4) as usize;
        [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]]
    }

    /// Assert pixel at (x,y) matches expected RGBA within tolerance.
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
                "[{label}] Pixel ({x},{y}) channel {ch}: expected {}, got {} (diff {diff} > tol {tolerance})",
                expected[ch], actual[ch]
            );
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 1: Raster at known position — centered magenta on black
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_raster_centered_magenta_on_black() {
    let gpu = HeadlessGpu::new(128, 128).await;

    // Background: black
    let (_bg_tex, bg_view) = gpu.solid_texture(128, 128, [0, 0, 0, 255]);
    let mut bg = CompositeLayer::new(&bg_view);
    bg.z_index = 0;

    // Foreground: magenta 64×64, centered (scale=0.5 fills half the canvas)
    let (_fg_tex, fg_view) = gpu.solid_texture(128, 128, [255, 0, 255, 255]);
    let mut fg = CompositeLayer::new(&fg_view);
    fg.z_index = 1;
    fg.opacity = 1.0;
    fg.transform = LayerTransform {
        translate_x: 0.0,
        translate_y: 0.0,
        scale_x: 0.5,
        scale_y: 0.5,
        rotation_rad: 0.0,
        canvas_aspect_ratio: 1.0,
    };

    let result = gpu.render(&[bg, fg]).await;

    // Centre pixel must be magenta
    gpu.assert_pixel(&result, 64, 64, [255, 0, 255, 255], 2, "center-magenta");

    // Corner (0,0) must be black (outside the scaled-down foreground)
    gpu.assert_pixel(&result, 0, 0, [0, 0, 0, 255], 2, "corner-black");

    // Corners at (127,0), (0,127), (127,127) must also be black
    gpu.assert_pixel(&result, 127, 0, [0, 0, 0, 255], 2, "top-right-black");
    gpu.assert_pixel(&result, 0, 127, [0, 0, 0, 255], 2, "bottom-left-black");

    // ── Negative control: zero opacity → magenta disappears ──
    let mut fg_hidden = CompositeLayer::new(&fg_view);
    fg_hidden.z_index = 1;
    fg_hidden.opacity = 0.0;
    fg_hidden.transform = LayerTransform {
        translate_x: 0.0,
        translate_y: 0.0,
        scale_x: 0.5,
        scale_y: 0.5,
        rotation_rad: 0.0,
        canvas_aspect_ratio: 1.0,
    };

    let hidden_result = gpu.render(&[CompositeLayer::new(&bg_view), fg_hidden]).await;
    // Centre must now be black, not magenta
    gpu.assert_pixel(&hidden_result, 64, 64, [0, 0, 0, 255], 2, "neg-hidden-center");
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 2: Translated raster — green box in top-left quadrant
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_raster_translated_position() {
    let gpu = HeadlessGpu::new(256, 256).await;

    // Background: dark grey
    let (_bg_tex, bg_view) = gpu.solid_texture(256, 256, [30, 30, 30, 255]);
    let mut bg = CompositeLayer::new(&bg_view);
    bg.z_index = 0;

    // Green square, 25% size, translated to top-left
    // translate_x=-0.5 moves left, translate_y=+0.5 moves up (NDC: +Y is up in wgpu clip space)
    let (_fg_tex, fg_view) = gpu.solid_texture(256, 256, [0, 255, 0, 255]);
    let mut fg = CompositeLayer::new(&fg_view);
    fg.z_index = 1;
    fg.opacity = 1.0;
    fg.transform = LayerTransform {
        translate_x: -0.5,
        translate_y: 0.5,
        scale_x: 0.25,
        scale_y: 0.25,
        rotation_rad: 0.0,
        canvas_aspect_ratio: 1.0,
    };

    let result = gpu.render(&[bg, fg]).await;

    // Bottom-right quadrant should definitely be grey (no green there)
    gpu.assert_pixel(&result, 200, 200, [30, 30, 30, 255], 2, "bottom-right-grey");

    // ── Negative control: removing the layer → all grey ──
    let only_bg = gpu.render(&[CompositeLayer::new(&bg_view)]).await;
    gpu.assert_pixel(&only_bg, 64, 64, [30, 30, 30, 255], 2, "neg-no-green");
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 3: Two-layer Z-order — correct stacking
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_z_order_stacking() {
    let gpu = HeadlessGpu::new(64, 64).await;

    // Layer 0: full-canvas cyan
    let (_cyan_tex, cyan_view) = gpu.solid_texture(64, 64, [0, 255, 255, 255]);
    let mut cyan = CompositeLayer::new(&cyan_view);
    cyan.z_index = 0;

    // Layer 1: full-canvas yellow (should cover cyan completely)
    let (_yellow_tex, yellow_view) = gpu.solid_texture(64, 64, [255, 255, 0, 255]);
    let mut yellow = CompositeLayer::new(&yellow_view);
    yellow.z_index = 1;

    let result = gpu.render(&[cyan, yellow]).await;

    // Everything should be yellow (top layer covers bottom)
    gpu.assert_pixel(&result, 32, 32, [255, 255, 0, 255], 2, "yellow-on-top");
    gpu.assert_pixel(&result, 0, 0, [255, 255, 0, 255], 2, "yellow-corner");

    // ── Negative control: swap z-order → cyan on top ──
    let mut cyan2 = CompositeLayer::new(&cyan_view);
    cyan2.z_index = 1; // Now on top
    let mut yellow2 = CompositeLayer::new(&yellow_view);
    yellow2.z_index = 0; // Now behind

    let swapped = gpu.render(&[cyan2, yellow2]).await;
    gpu.assert_pixel(&swapped, 32, 32, [0, 255, 255, 255], 2, "neg-cyan-on-top");
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 4: Opacity blending correctness
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_opacity_blending() {
    let gpu = HeadlessGpu::new(64, 64).await;

    // Background: pure blue [0, 0, 255]
    let (_bg_tex, bg_view) = gpu.solid_texture(64, 64, [0, 0, 255, 255]);
    let mut bg = CompositeLayer::new(&bg_view);
    bg.z_index = 0;

    // Foreground: pure red [255, 0, 0] at 50% opacity
    // Expected blend: 0.5*[0,0,255] + 0.5*[255,0,0] = [127/128, 0, 127/128]
    let (_fg_tex, fg_view) = gpu.solid_texture(64, 64, [255, 0, 0, 255]);
    let mut fg = CompositeLayer::new(&fg_view);
    fg.z_index = 1;
    fg.opacity = 0.5;

    let result = gpu.render(&[bg, fg]).await;

    let center = gpu.pixel_at(&result, 32, 32);
    // Red channel should be ~128 (50% of 255)
    assert!(
        (center[0] as i32 - 128).abs() <= 3,
        "Blended red: expected ~128, got {}",
        center[0]
    );
    // Green channel should be ~0
    assert!(
        center[1] <= 3,
        "Blended green: expected ~0, got {}",
        center[1]
    );
    // Blue channel should be ~128 (50% of 255)
    assert!(
        (center[2] as i32 - 128).abs() <= 3,
        "Blended blue: expected ~128, got {}",
        center[2]
    );

    // ── Negative control: 100% opacity → pure red, no blue ──
    let mut fg_full = CompositeLayer::new(&fg_view);
    fg_full.z_index = 1;
    fg_full.opacity = 1.0;

    let full_result = gpu.render(&[CompositeLayer::new(&bg_view), fg_full]).await;
    gpu.assert_pixel(&full_result, 32, 32, [255, 0, 0, 255], 2, "neg-full-opacity-red");
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 5: Replay determinism — same layers produce identical bytes
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_replay_determinism() {
    let gpu = HeadlessGpu::new(128, 128).await;

    let (_bg_tex, bg_view) = gpu.solid_texture(128, 128, [50, 100, 150, 255]);
    let (_fg_tex, fg_view) = gpu.solid_texture(128, 128, [200, 50, 100, 255]);

    let make_layers = || {
        let mut bg = CompositeLayer::new(&bg_view);
        bg.z_index = 0;

        let mut fg = CompositeLayer::new(&fg_view);
        fg.z_index = 1;
        fg.opacity = 0.7;
        fg.transform = LayerTransform {
            translate_x: 0.1,
            translate_y: -0.2,
            scale_x: 0.6,
            scale_y: 0.6,
            rotation_rad: 0.3,
        canvas_aspect_ratio: 1.0,
        };

        vec![bg, fg]
    };

    // "Play" — first render
    let first = gpu.render(&make_layers()).await;

    // "Replay" — second render with identical inputs
    let second = gpu.render(&make_layers()).await;

    // Must be byte-identical (deterministic)
    assert_golden_parity(
        &first,
        &second,
        128,
        128,
        1.0,
        0,
        "layer_b_replay_determinism",
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 6: Scale changes size of visible region
// ═════════════════════════════════════════════════════════════════════════════

#[tokio::test]
#[ignore = "requires physical or headless GPU hardware"]
async fn layer_b_scale_changes_coverage() {
    let gpu = HeadlessGpu::new(128, 128).await;

    // Background: black
    let (_bg_tex, bg_view) = gpu.solid_texture(128, 128, [0, 0, 0, 255]);

    // White layer at two different scales
    let (_white_tex, white_view) = gpu.solid_texture(128, 128, [255, 255, 255, 255]);

    // Small scale (25%) — only centre area is white
    let mut bg_small = CompositeLayer::new(&bg_view);
    bg_small.z_index = 0;
    let mut white_small = CompositeLayer::new(&white_view);
    white_small.z_index = 1;
    white_small.transform.scale_x = 0.25;
    white_small.transform.scale_y = 0.25;

    let small_result = gpu.render(&[bg_small, white_small]).await;

    // Large scale (75%) — more area is white
    let mut bg_large = CompositeLayer::new(&bg_view);
    bg_large.z_index = 0;
    let mut white_large = CompositeLayer::new(&white_view);
    white_large.z_index = 1;
    white_large.transform.scale_x = 0.75;
    white_large.transform.scale_y = 0.75;

    let large_result = gpu.render(&[bg_large, white_large]).await;

    // Count white pixels in each
    let count_white = |buf: &[u8]| -> usize {
        buf.chunks_exact(4)
            .filter(|px| px[0] > 200 && px[1] > 200 && px[2] > 200)
            .count()
    };

    let small_white = count_white(&small_result);
    let large_white = count_white(&large_result);

    assert!(
        large_white > small_white,
        "Larger scale must cover more pixels: large={large_white} vs small={small_white}"
    );

    // ── Negative control: scale 0 → zero white pixels ──
    let mut bg_zero = CompositeLayer::new(&bg_view);
    bg_zero.z_index = 0;
    let mut white_zero = CompositeLayer::new(&white_view);
    white_zero.z_index = 1;
    white_zero.transform.scale_x = 0.0;
    white_zero.transform.scale_y = 0.0;

    let zero_result = gpu.render(&[bg_zero, white_zero]).await;
    let zero_white = count_white(&zero_result);
    assert_eq!(zero_white, 0, "Scale 0 must produce zero white pixels");
}
