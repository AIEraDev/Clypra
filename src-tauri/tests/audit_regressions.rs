use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use dashmap::DashMap;
use tokio::sync::Mutex;
use wgpu::util::DeviceExt;

use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, CompositeLayer, CropMargins, LayerTransform, MultiTrackCompositor,
};
use tauri_app_lib::wgpu_compositor::texture_pool::{
    create_nv12_bind_group_layout, create_nv12_render_pipeline, create_nv12_sampler,
    render_scrub_frame, Nv12TextureRingBuffer,
};
use tauri_app_lib::wgpu_compositor::yuv_ring_buffer::{
    create_yuv_hdr_bind_group_layout, create_yuv_hdr_render_pipeline, create_yuv_hdr_sampler,
    render_yuv_frame, ColorTransformUniforms, YuvPixelFormat, YuvTextureRingBuffer,
};

/// Headless GPU context helper
struct TestGpuContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl TestGpuContext {
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
                    label: Some("Regression Test GPU Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .ok()?;

        Some(Self { device, queue })
    }

    pub fn create_solid_rgba_texture(
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

// -----------------------------------------------------------------------------
// Regression 1: Odd-Width & Arbitrary Pitch Padding
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_regression_odd_width_and_arbitrary_stride_padding() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => {
            eprintln!("Skipping GPU test: no adapter found");
            return;
        }
    };

    let layout = create_nv12_bind_group_layout(&ctx.device);
    let sampler = create_nv12_sampler(&ctx.device);
    let pipeline = create_nv12_render_pipeline(
        &ctx.device,
        &layout,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );

    // Matrix of odd, non-standard, mobile, and cropped video resolutions
    let odd_resolutions = vec![
        (853u32, 480u32),   // 480p anamorphic odd width
        (1081u32, 1920u32), // 9:16 mobile odd width
        (720u32, 1281u32),  // Odd height
        (333u32, 333u32),   // Odd width and odd height square
        (1919u32, 1079u32), // Cropped 1080p
    ];

    for (width, height) in odd_resolutions {
        let mut ring = Nv12TextureRingBuffer::new(
            &ctx.device,
            &layout,
            &sampler,
            &sampler,
            width,
            height,
            2,
        );

        let uv_width = (width + 1) / 2;
        let uv_height = (height + 1) / 2;

        let y_plane = vec![128u8; (width * height) as usize];
        let uv_plane = vec![128u8; (uv_width * 2 * uv_height) as usize];

        // Ensure upload does not panic on odd widths
        ring.upload_frame(
            &ctx.queue,
            &y_plane,
            &uv_plane,
            width,
            uv_width * 2,
        );

        let target_texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Odd Dimension Target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        render_scrub_frame(
            &mut ring,
            &ctx.device,
            &ctx.queue,
            &pipeline,
            &target_view,
            &y_plane,
            &uv_plane,
            width,
            uv_width * 2,
        );

        ctx.device.poll(wgpu::Maintain::Wait);
    }
}

// -----------------------------------------------------------------------------
// Regression 2: YUV HDR Ring Buffer Odd Width & P010 10-bit Alignment
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_regression_yuv_hdr_odd_width_p010() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let layout = create_yuv_hdr_bind_group_layout(&ctx.device);
    let sampler = create_yuv_hdr_sampler(&ctx.device);
    let pipeline = create_yuv_hdr_render_pipeline(
        &ctx.device,
        &layout,
        wgpu::TextureFormat::Rgba8UnormSrgb,
    );

    let width = 853u32;
    let height = 480u32;
    let uv_width = (width + 1) / 2;
    let uv_height = (height + 1) / 2;

    let mut ring_nv12 = YuvTextureRingBuffer::new(
        &ctx.device,
        &layout,
        &sampler,
        &sampler,
        width,
        height,
        YuvPixelFormat::Nv12,
        2,
    );

    let y_nv12 = vec![128u8; (width * height) as usize];
    let uv_nv12 = vec![128u8; (uv_width * 2 * uv_height) as usize];
    let params = ColorTransformUniforms {
        color_space: 0,
        range: 0,
        tonemap_operator: 0,
        target_peak_nits: 100.0,
    };

    let target_texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("HDR Odd Target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

    render_yuv_frame(
        &mut ring_nv12,
        &ctx.device,
        &ctx.queue,
        &pipeline,
        &target_view,
        &y_nv12,
        &uv_nv12,
        width,
        uv_width * 2,
        &params,
    );

    ctx.device.poll(wgpu::Maintain::Wait);
}

// -----------------------------------------------------------------------------
// Regression 3: DashMap Concurrent LRU Eviction & Deadlock Freedom
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_regression_dashmap_lru_concurrency_no_deadlock() {
    struct MockEntry {
        _id: usize,
        last_accessed: Arc<Mutex<Instant>>,
    }


    let pool: Arc<DashMap<String, MockEntry>> = Arc::new(DashMap::new());
    let max_pool_size = 10;
    let total_tasks = 40;
    let ops_per_task = 50;
    let completed_ops = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();

    for task_id in 0..total_tasks {
        let pool_clone = Arc::clone(&pool);
        let completed_clone = Arc::clone(&completed_ops);

        handles.push(tokio::spawn(async move {
            for op in 0..ops_per_task {
                let key = format!("video_{}.mp4", (task_id + op) % 25);

                // Simulate get_decoder lookup
                if let Some(entry) = pool_clone.get_mut(&key) {
                    *entry.last_accessed.lock().await = Instant::now();
                    completed_clone.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                // Simulate LRU eviction check without holding DashMap iterator locks across await
                if pool_clone.len() >= max_pool_size {
                    let snapshot: Vec<(String, Arc<Mutex<Instant>>)> = pool_clone
                        .iter()
                        .map(|e| (e.key().clone(), e.value().last_accessed.clone()))
                        .collect();

                    let mut oldest_key: Option<String> = None;
                    let mut oldest_time = Instant::now();

                    for (k, mutex) in snapshot {
                        let t = *mutex.lock().await;
                        if oldest_key.is_none() || t < oldest_time {
                            oldest_key = Some(k);
                            oldest_time = t;
                        }
                    }

                    if let Some(k) = oldest_key {
                        pool_clone.remove(&k);
                    }
                }

                // Insert new entry
                pool_clone.insert(
                    key,
                    MockEntry {
                        _id: task_id,
                        last_accessed: Arc::new(Mutex::new(Instant::now())),
                    },

                );

                completed_clone.fetch_add(1, Ordering::Relaxed);
            }
        }));
    }

    // Await all tasks with a strict 5-second timeout. If a deadlock occurs, this will fail immediately.
    let join_all = async {
        for h in handles {
            h.await.unwrap();
        }
    };

    tokio::time::timeout(std::time::Duration::from_secs(5), join_all)
        .await
        .expect("DashMap concurrent LRU eviction DEADLOCKED!");

    let total = completed_ops.load(Ordering::SeqCst);
    assert_eq!(total, total_tasks * ops_per_task);
    assert!(pool.len() <= max_pool_size + total_tasks);
}

// -----------------------------------------------------------------------------
// Regression 4: Dynamic Uniform Multi-Layer Compositing
// -----------------------------------------------------------------------------
#[tokio::test]
#[ignore = "requires GPU hardware — run with cargo test -- --ignored"]
async fn test_regression_multi_track_layer_pooling() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let width = 512;
    let height = 512;

    let compositor = MultiTrackCompositor::new(&ctx.device, &ctx.queue, width, height);

    let (_t1, view1) = ctx.create_solid_rgba_texture(width, height, [255, 0, 0, 255]);
    let (_t2, view2) = ctx.create_solid_rgba_texture(width, height, [0, 255, 0, 255]);
    let (_t3, view3) = ctx.create_solid_rgba_texture(width, height, [0, 0, 255, 255]);

    let iterations = 100;
    for i in 0..iterations {
        let opacity = ((i % 10) as f32) / 10.0;
        let layers = vec![
            CompositeLayer {
                texture_view: &view1,
                lut: None,
                z_index: 0,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                transform: LayerTransform::default(),
                crop: CropMargins::default(),
                color_grade: Default::default(),
                chroma_key: Default::default(),
            },
            CompositeLayer {
                texture_view: &view2,
                lut: None,
                z_index: 1,
                opacity,
                blend_mode: BlendMode::Normal,
                transform: LayerTransform {
                    translate_x: 0.2,
                    translate_y: -0.2,
                    scale_x: 0.5,
                    scale_y: 0.5,
                    rotation_rad: 0.1,
                },
                crop: CropMargins {
                    left: 0.1,
                    top: 0.1,
                    right: 0.1,
                    bottom: 0.1,
                },
                color_grade: Default::default(),
                chroma_key: Default::default(),
            },
            CompositeLayer {
                texture_view: &view3,
                lut: None,
                z_index: 2,
                opacity: 0.5,
                blend_mode: BlendMode::Additive,
                transform: LayerTransform::default(),
                crop: CropMargins::default(),
                color_grade: Default::default(),
                chroma_key: Default::default(),
            },
        ];

        let res = compositor.render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers).await;
        assert!(res.is_ok(), "Multi-track render pass failed on iteration {}", i);
    }
}
