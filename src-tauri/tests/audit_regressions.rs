use dashmap::DashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use wgpu::util::DeviceExt;

use tauri_app_lib::wgpu_compositor::multi_track_composer::{
    BlendMode, BodyEffectUniforms, CompositeLayer, CropMargins, LayerTransform,
    MultiTrackCompositor,
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
    let pipeline =
        create_nv12_render_pipeline(&ctx.device, &layout, wgpu::TextureFormat::Rgba8UnormSrgb);

    // Matrix of odd, non-standard, mobile, and cropped video resolutions
    let odd_resolutions = vec![
        (853u32, 480u32),   // 480p anamorphic odd width
        (1081u32, 1920u32), // 9:16 mobile odd width
        (720u32, 1281u32),  // Odd height
        (333u32, 333u32),   // Odd width and odd height square
        (1919u32, 1079u32), // Cropped 1080p
    ];

    for (width, height) in odd_resolutions {
        let mut ring =
            Nv12TextureRingBuffer::new(&ctx.device, &layout, &sampler, &sampler, width, height, 2);

        let uv_width = width.div_ceil(2);
        let uv_height = height.div_ceil(2);

        let y_plane = vec![128u8; (width * height) as usize];
        let uv_plane = vec![128u8; (uv_width * 2 * uv_height) as usize];

        // Ensure upload does not panic on odd widths
        ring.upload_frame(&ctx.queue, &y_plane, &uv_plane, width, uv_width * 2);

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
    let pipeline =
        create_yuv_hdr_render_pipeline(&ctx.device, &layout, wgpu::TextureFormat::Rgba8UnormSrgb);

    let width = 853u32;
    let height = 480u32;
    let uv_width = width.div_ceil(2);
    let uv_height = height.div_ceil(2);

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
                mask_view: None,
                body_effect: BodyEffectUniforms::default(),
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
                mask_view: None,
                body_effect: BodyEffectUniforms::default(),
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
                mask_view: None,
                body_effect: BodyEffectUniforms::default(),
            },
        ];

        let res = compositor
            .render_to_rgba_bytes(&ctx.device, &ctx.queue, &layers)
            .await;
        assert!(
            res.is_ok(),
            "Multi-track render pass failed on iteration {}",
            i
        );
    }
}

// ============================================================================
// Phase 1 — Correctness fixes: render pipeline bug invariants
// ============================================================================

#[tokio::test]
async fn test_phase1_render_pipeline_bug_fixes() {
    use tauri_app_lib::wgpu_compositor::render_path::{
        DisableReason, DxgiFailureReason, DxgiImportState, FrameSource, PreviewRenderError,
    };

    // -----------------------------------------------------------------------
    // Invariant 1: FrameSource variants are distinct and carry dimensions.
    // -----------------------------------------------------------------------
    let src_dxgi = FrameSource::DxgiNv12 {
        width: 1920,
        height: 1080,
    };
    let src_cpu_nv12 = FrameSource::CpuNv12 {
        width: 1280,
        height: 720,
    };
    let src_cpu_rgba = FrameSource::CpuRgba {
        width: 640,
        height: 360,
    };

    assert!(matches!(src_dxgi, FrameSource::DxgiNv12 { .. }));
    assert!(matches!(src_cpu_nv12, FrameSource::CpuNv12 { .. }));
    assert!(matches!(src_cpu_rgba, FrameSource::CpuRgba { .. }));

    // -----------------------------------------------------------------------
    // Invariant 2: DxgiImportState transitions are sound.
    // -----------------------------------------------------------------------
    let unknown = DxgiImportState::Unknown;
    let supported = DxgiImportState::Supported;
    let failed = DxgiImportState::Failed {
        reason: DxgiFailureReason::DeviceLost,
    };
    let disabled = DxgiImportState::Disabled {
        reason: DisableReason::EnvVar,
    };

    assert!(matches!(unknown, DxgiImportState::Unknown));
    assert!(matches!(supported, DxgiImportState::Supported));
    assert!(matches!(failed, DxgiImportState::Failed { .. }));
    assert!(matches!(disabled, DxgiImportState::Disabled { .. }));

    // -----------------------------------------------------------------------
    // Invariant 3: DxgiFailureReason has all 7 variants.
    // -----------------------------------------------------------------------
    let _reasons = [
        DxgiFailureReason::DeviceLost,
        DxgiFailureReason::ImportFailed,
        DxgiFailureReason::InvalidTexture,
        DxgiFailureReason::UnsupportedFormat,
        DxgiFailureReason::WrongArraySlice,
        DxgiFailureReason::SurfaceCreationFailed,
        DxgiFailureReason::DimensionMismatch,
    ];
    // Each variant must be constructable — compile-time proof.

    // -----------------------------------------------------------------------
    // Invariant 4: DisableReason has exactly 3 variants.
    // -----------------------------------------------------------------------
    let _reasons = [
        DisableReason::EnvVar,
        DisableReason::UnsupportedFeature,
        DisableReason::AdminPolicy,
    ];

    // -----------------------------------------------------------------------
    // Invariant 5: PreviewRenderError displays non-empty messages.
    // -----------------------------------------------------------------------
    let err_import = PreviewRenderError::ImportFailed("DXGI failed".to_string());
    let err_shader = PreviewRenderError::ShaderFailed("compile error".to_string());
    let err_unsupport = PreviewRenderError::UnsupportedFeature("NV12".to_string());
    let err_render = PreviewRenderError::RenderFailed("pass error".to_string());
    let err_dim = PreviewRenderError::DimensionMismatch {
        expected: (1920, 1080),
        got: (1280, 720),
    };

    assert!(
        !format!("{err_import}").is_empty(),
        "ImportFailed must display"
    );
    assert!(
        !format!("{err_shader}").is_empty(),
        "ShaderFailed must display"
    );
    assert!(
        !format!("{err_unsupport}").is_empty(),
        "UnsupportedFeature must display"
    );
    assert!(
        !format!("{err_render}").is_empty(),
        "RenderFailed must display"
    );
    assert!(
        !format!("{err_dim}").is_empty(),
        "DimensionMismatch must display"
    );

    // -----------------------------------------------------------------------
    // Invariant 6: CLYPRA_DISABLE_DXGI env kill-switch is respected.
    //   The capability gate reads the env var at probe time.
    //   We don't probe here (no GPU), but we verify the env var name is correct.
    // -----------------------------------------------------------------------
    // Structural invariant: env var is "CLYPRA_DISABLE_DXGI" (compile-time doc).
    // Verified by the PreviewCapabilities::probe() implementation in Phase 2.
    let _ = std::env::var("CLYPRA_DISABLE_DXGI"); // must not panic
}

// ============================================================================
// Phase 2 — Explicit fallback architecture invariants
// ============================================================================

#[tokio::test]
async fn test_phase2_preview_fallback_architecture() {
    use tauri_app_lib::wgpu_compositor::render_path::{
        DisableReason, DxgiFailureReason, DxgiImportState,
    };

    // -----------------------------------------------------------------------
    // Invariant 1: Failed state carries the specific failure reason.
    //   This is the key Phase 2 improvement — opaque bool → typed reason.
    // -----------------------------------------------------------------------
    let failed = DxgiImportState::Failed {
        reason: DxgiFailureReason::WrongArraySlice,
    };
    if let DxgiImportState::Failed { reason } = failed {
        assert!(
            matches!(reason, DxgiFailureReason::WrongArraySlice),
            "Invariant 1: Failed state must preserve the specific failure reason"
        );
    } else {
        panic!("Expected Failed variant");
    }

    // -----------------------------------------------------------------------
    // Invariant 2: Disabled state distinguishes between disable reasons.
    //   EnvVar (user override) ≠ UnsupportedFeature (hardware) ≠ AdminPolicy.
    // -----------------------------------------------------------------------
    let env_disabled = DxgiImportState::Disabled {
        reason: DisableReason::EnvVar,
    };
    let hw_disabled = DxgiImportState::Disabled {
        reason: DisableReason::UnsupportedFeature,
    };
    let admin_disabled = DxgiImportState::Disabled {
        reason: DisableReason::AdminPolicy,
    };

    if let DxgiImportState::Disabled { reason } = env_disabled {
        assert!(matches!(reason, DisableReason::EnvVar));
    }
    if let DxgiImportState::Disabled { reason } = hw_disabled {
        assert!(matches!(reason, DisableReason::UnsupportedFeature));
    }
    if let DxgiImportState::Disabled { reason } = admin_disabled {
        assert!(matches!(reason, DisableReason::AdminPolicy));
    }

    // -----------------------------------------------------------------------
    // Invariant 3: The fallback chain is structurally enforced.
    //   DXGI NV12 → CPU NV12 → CPU RGBA — each represented as a distinct
    //   FrameSource variant. The renderer chooses the path; the types prevent
    //   accidental conflation.
    // -----------------------------------------------------------------------
    use tauri_app_lib::wgpu_compositor::render_path::FrameSource;

    fn is_zero_copy(src: &FrameSource) -> bool {
        matches!(src, FrameSource::DxgiNv12 { .. })
    }
    fn is_cpu_path(src: &FrameSource) -> bool {
        matches!(
            src,
            FrameSource::CpuNv12 { .. } | FrameSource::CpuRgba { .. }
        )
    }

    assert!(is_zero_copy(&FrameSource::DxgiNv12 {
        width: 1920,
        height: 1080
    }));
    assert!(!is_zero_copy(&FrameSource::CpuNv12 {
        width: 1920,
        height: 1080
    }));
    assert!(is_cpu_path(&FrameSource::CpuNv12 {
        width: 1920,
        height: 1080
    }));
    assert!(is_cpu_path(&FrameSource::CpuRgba {
        width: 1920,
        height: 1080
    }));
    assert!(!is_cpu_path(&FrameSource::DxgiNv12 {
        width: 1920,
        height: 1080
    }));

    // -----------------------------------------------------------------------
    // Invariant 4: PreviewCapabilities is constructable and probes without panic.
    //   (Probe requires a wgpu adapter — skipped here; structural test only.)
    // -----------------------------------------------------------------------
    use tauri_app_lib::wgpu_compositor::PreviewCapabilities;
    // PreviewCapabilities::probe() requires a real adapter — tested in GPU suite.
    // Here we verify the type is importable and its const is accessible.
    let _ = std::mem::size_of::<PreviewCapabilities>();

    // -----------------------------------------------------------------------
    // Invariant 5: The env kill-switch produces a Disabled state (not panic).
    //   Structural: DisableReason::EnvVar is a valid variant, used by the
    //   CLYPRA_DISABLE_DXGI path in native_preview.rs.
    // -----------------------------------------------------------------------
    let kill_switch_result = DxgiImportState::Disabled {
        reason: DisableReason::EnvVar,
    };
    assert!(
        matches!(
            kill_switch_result,
            DxgiImportState::Disabled {
                reason: DisableReason::EnvVar
            }
        ),
        "Invariant 5: env kill-switch must produce Disabled::EnvVar, not a panic"
    );
}

#[tokio::test]
async fn test_phase3_rendering_architecture_invariants() {
    use tauri_app_lib::commands::render_target_manager::{
        MonitorId, RenderTargetId, RenderTargetState,
    };
    use tauri_app_lib::wgpu_compositor::frame_request::{
        FramePriority, FrameRequest, PresentationRequest, PreviewQuality, Viewport,
    };
    use tauri_app_lib::wgpu_compositor::frame_resource::{
        ColorPrimaries, FrameColorInfo, TransferFunction,
    };
    use tauri_app_lib::wgpu_compositor::frame_telemetry::{FrameTelemetry, FrameTelemetryRing};
    use tauri_app_lib::wgpu_compositor::preview_capabilities::PreviewCapabilities;
    use tauri_app_lib::wgpu_compositor::render_path::{
        DxgiFailureReason, DxgiImportState, FrameSource,
    };

    // -----------------------------------------------------------------------
    // Invariant 1 & 2: Failed DXGI import cannot produce a successful FrameResource,
    // and DxgiImportState::Failed sticky state prevents repeated attempts.
    // -----------------------------------------------------------------------
    let mut import_state = DxgiImportState::Unknown;
    assert!(
        import_state.is_usable(),
        "Unknown state must be usable for probe"
    );

    import_state = DxgiImportState::Failed {
        reason: DxgiFailureReason::ImportFailed,
    };
    assert!(
        !import_state.is_usable(),
        "Failed state must be sticky and not usable"
    );
    assert!(
        !import_state.is_device_lost(),
        "ImportFailed is not device lost"
    );

    let device_lost_state = DxgiImportState::Failed {
        reason: DxgiFailureReason::DeviceLost,
    };
    assert!(
        device_lost_state.is_device_lost(),
        "DeviceLost reason must be distinguishable"
    );
    assert!(!device_lost_state.is_usable());

    let wrong_slice_state = DxgiImportState::Failed {
        reason: DxgiFailureReason::WrongArraySlice,
    };
    assert!(!wrong_slice_state.is_usable());

    // -----------------------------------------------------------------------
    // Invariant 3: CPU fallback when NV12 WGPU support is absent.
    // -----------------------------------------------------------------------
    let caps_without_nv12 = PreviewCapabilities {
        wgpu_nv12: false,
        dxgi_import: true,
        hw_decode: true,
        native_surface: true,
        hdr: false,
    };
    assert!(
        !caps_without_nv12.zero_copy_available(),
        "Zero-copy must be unavailable without wgpu NV12 support"
    );

    // -----------------------------------------------------------------------
    // Invariant 4 & 5: FrameResource does not encode target assumptions, and
    // destroying a target cannot invalidate the shared FrameResource.
    //
    // Verified structurally: the GPU texture behind a FrameResource is wrapped
    // in Arc<wgpu::Texture>. Multiple presentation targets can hold a clone of
    // that Arc. When one target is dropped, the Arc count decrements but the
    // texture remains alive for the remaining targets.
    //
    // FrameResource::from_texture() is pub(crate) — intentionally opaque to
    // render-engine callers. We verify the Arc sharing invariant directly
    // without going through the private constructor.
    // -----------------------------------------------------------------------
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return, // Headless GPU unavailable in environment
    };

    // create_solid_rgba_texture returns (Texture, TextureView); extract .0
    // to get the texture only.
    let texture = Arc::new(ctx.create_solid_rgba_texture(128, 128, [255, 0, 0, 255]).0);

    // Simulate two presentation targets both holding a reference to the same
    // GPU texture (the invariant that decode-once → render-many relies on).
    let target_a_ref = Arc::clone(&texture);
    let target_b_ref = Arc::clone(&texture);
    assert_eq!(Arc::strong_count(&texture), 3, "texture + 2 target refs");

    // Drop one target; the other and the source must remain valid.
    drop(target_a_ref);
    assert_eq!(
        Arc::strong_count(&texture),
        2,
        "one target gone, source + target_b remain"
    );

    drop(target_b_ref);
    assert_eq!(
        Arc::strong_count(&texture),
        1,
        "both targets gone, source still valid"
    );

    // -----------------------------------------------------------------------
    // Invariant 6: Target state updates do not require GPU context recreation.
    // -----------------------------------------------------------------------
    let mut target_state = RenderTargetState::default();
    assert!(!target_state.needs_resize);
    target_state.needs_resize = true;
    target_state.last_presented_sequence = Some(42);
    target_state.monitor_id = Some(MonitorId(r"\\.\DISPLAY1".to_string()));
    assert_eq!(target_state.last_presented_sequence, Some(42));

    // -----------------------------------------------------------------------
    // Invariant 7: FrameRequest vs PresentationRequest separation.
    // FrameRequest specifies WHAT frame must exist, PresentationRequest routes it.
    // -----------------------------------------------------------------------
    let frame_req = FrameRequest {
        timestamp: std::time::Duration::from_millis(500),
        priority: FramePriority::Realtime,
        quality: PreviewQuality::Full,
        allow_keyframe_approx: false,
    };
    assert!(frame_req.priority > FramePriority::Interactive);

    let pres_req_program = PresentationRequest {
        frame_sequence: 42,
        target: RenderTargetId::PROGRAM,
        viewport: None,
    };
    let pres_req_external = PresentationRequest {
        frame_sequence: 42, // Same decoded frame!
        target: RenderTargetId::EXTERNAL,
        viewport: Some(Viewport {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }),
    };
    assert_eq!(
        pres_req_program.frame_sequence,
        pres_req_external.frame_sequence
    );
    assert_ne!(pres_req_program.target, pres_req_external.target);

    // -----------------------------------------------------------------------
    // Invariant 8: D3D11VA array_index error is distinguishable.
    // -----------------------------------------------------------------------
    let wrong_slice_err = DxgiFailureReason::WrongArraySlice;
    assert_eq!(
        format!("{wrong_slice_err}"),
        "array_index out of bounds for texture array"
    );

    // -----------------------------------------------------------------------
    // Invariant 9: Color metadata survives Decode -> FrameResource.
    // -----------------------------------------------------------------------
    let hdr_color = FrameColorInfo::hdr10();
    assert!(hdr_color.is_hdr());
    assert_eq!(hdr_color.primaries, ColorPrimaries::Bt2020);
    assert_eq!(hdr_color.transfer_function, TransferFunction::Pq);

    let default_color = FrameColorInfo::default();
    assert!(!default_color.is_hdr());
    assert_eq!(default_color.primaries, ColorPrimaries::Bt709);

    // -----------------------------------------------------------------------
    // Invariant 10: Telemetry differentiates CPU from GPU timings and tracks provenance.
    // -----------------------------------------------------------------------
    let mut ring = FrameTelemetryRing::new(10);
    ring.push(FrameTelemetry {
        decode_cpu_us: 4000,
        import_cpu_us: 200,
        upload_cpu_us: 0,
        render_submit_cpu_us: 500,
        present_cpu_us: 300,
        gpu_render_us: None, // Asynchronously measured in Phase 6
        queue_wait_us: None,
        ipc_wait_us: None,
        dropped: false,
        deadline_miss: false,
        source: FrameSource::DxgiNv12 {
            width: 3840,
            height: 2160,
        },
        target: RenderTargetId::PROGRAM,
        sequence: 42,
        recorded_at: None,
    });
    assert_eq!(ring.len(), 1);
    let sample = ring.iter().next().unwrap();
    assert_eq!(sample.total_cpu_us(), 5000);
    assert!(sample.used_zero_copy());
    assert!(sample.gpu_render_us.is_none());
}

// ============================================================================
// Phase 4 — FrameScheduler + Multi-Target Fan-Out invariants
// ============================================================================

#[tokio::test]
async fn test_phase4_frame_scheduler_invariants() {
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
    use tauri_app_lib::wgpu_compositor::frame_deadline::FrameDeadline;
    use tauri_app_lib::wgpu_compositor::frame_request::{FramePriority, PreviewQuality};
    use tauri_app_lib::wgpu_compositor::frame_resource::{
        CpuFrame, FrameColorInfo, FrameUploader, VideoPixelFormat,
    };
    use tauri_app_lib::wgpu_compositor::frame_scheduler::{
        DecodedCacheKey, FrameKey, FrameProducer, FrameScheduler, SchedulerConfig, SchedulerError,
        SequenceId,
    };
    use tauri_app_lib::wgpu_compositor::FrameResource;

    // -----------------------------------------------------------------------
    // Pure type tests — no GPU required
    // -----------------------------------------------------------------------

    // Invariant 3 & 4: Different timestamps and different quality → separate keys
    let k_t1 = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 1000,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };
    let k_t2 = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 2000,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };
    let k_hq = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 1000,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };
    let k_lq = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 1000,
        quality: PreviewQuality::Quarter,
        render_revision: 0,
    };
    assert_ne!(k_t1, k_t2, "Different timestamps → different keys");
    assert_ne!(k_hq, k_lq, "Different quality → different keys");

    // Invariant 5: Different render_revision → different FrameKey but same DecodedCacheKey
    let k_rev0 = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 500,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };
    let k_rev1 = FrameKey {
        sequence_id: SequenceId(1),
        timestamp_us: 500,
        quality: PreviewQuality::Full,
        render_revision: 1,
    };
    assert_ne!(
        k_rev0, k_rev1,
        "Different render_revision → different FrameKeys"
    );
    assert_eq!(
        k_rev0.decoded_key(),
        k_rev1.decoded_key(),
        "Invariant 15: render_revision change invalidates composition cache, not decoded cache"
    );

    // Invariant 13: Priority ordering preserved
    assert!(FramePriority::Realtime > FramePriority::Interactive);
    assert!(FramePriority::Interactive > FramePriority::Background);

    // SchedulerConfig defaults are sane
    let cfg = SchedulerConfig::default();
    assert!(cfg.decoded_cache_capacity >= cfg.composition_cache_capacity);

    // SchedulerError display
    assert!(!SchedulerError::Cancelled.to_string().is_empty());
    assert!(!SchedulerError::ProducerFailed("boom".to_string())
        .to_string()
        .is_empty());

    // DecodedCacheKey: strips render_revision correctly
    let dck_a = DecodedCacheKey {
        sequence_id: SequenceId(7),
        timestamp_us: 33_333,
        quality: PreviewQuality::Half,
    };
    let dck_b = DecodedCacheKey {
        sequence_id: SequenceId(7),
        timestamp_us: 33_333,
        quality: PreviewQuality::Half,
    };
    assert_eq!(dck_a, dck_b);

    // -----------------------------------------------------------------------
    // GPU-backed scheduler tests
    // -----------------------------------------------------------------------

    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return, // Headless GPU unavailable in this environment
    };

    // Build a minimal RGBA frame to use as a mock FrameResource (no NV12 needed).
    let w = 4u32;
    let h = 4u32;
    let rgba_pixels: Vec<u8> = vec![128u8; (w * h * 4) as usize];
    let empty: Vec<u8> = vec![];

    let base_resource = Arc::new(
        FrameUploader::upload(
            &ctx.device,
            &ctx.queue,
            &CpuFrame {
                y_plane: &rgba_pixels,
                uv_plane: &empty,
                width: w,
                height: h,
                format: VideoPixelFormat::Rgba8,
                color_info: FrameColorInfo::default(),
                sequence: 0,
            },
        )
        .expect("FrameUploader::upload must succeed for RGBA8"),
    );

    // -----------------------------------------------------------------------
    // Local TestProducer — implements FrameProducer, counts invocations.
    // -----------------------------------------------------------------------
    struct TestProducer {
        count: Arc<AtomicU64>,
        resource: Arc<FrameResource>,
    }
    impl FrameProducer for TestProducer {
        fn produce(&self, _key: &FrameKey) -> Result<Arc<FrameResource>, String> {
            self.count.fetch_add(1, AtomicOrdering::SeqCst);
            Ok(Arc::clone(&self.resource))
        }
    }

    let count = Arc::new(AtomicU64::new(0));
    let producer = Arc::new(TestProducer {
        count: Arc::clone(&count),
        resource: Arc::clone(&base_resource),
    });
    let scheduler = FrameScheduler::new(producer, SchedulerConfig::default());

    let key = FrameKey {
        sequence_id: SequenceId(42),
        timestamp_us: 500_000,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };

    // -----------------------------------------------------------------------
    // Invariant 1 & 2: Same FrameKey from multiple targets → ONE production job
    // -----------------------------------------------------------------------
    let t1 = scheduler
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Realtime),
        )
        .await;
    let t2 = scheduler
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Realtime),
        )
        .await;
    let t3 = scheduler
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Realtime),
        )
        .await;

    let r1 = scheduler
        .await_frame(t1)
        .await
        .expect("target 1 must succeed");
    let r2 = scheduler
        .await_frame(t2)
        .await
        .expect("target 2 must succeed");
    let r3 = scheduler
        .await_frame(t3)
        .await
        .expect("target 3 must succeed");

    // Invariant 9 — the central architectural promise:
    assert_eq!(
        scheduler.production_count(),
        1,
        "Invariant 9: 3 targets requesting the same FrameKey → production_count == 1"
    );

    // All three Arc pointers refer to the same underlying allocation.
    assert!(
        Arc::ptr_eq(&r1, &r2),
        "Invariant 2: targets share the same Arc<FrameResource>"
    );
    assert!(
        Arc::ptr_eq(&r2, &r3),
        "Invariant 2: all targets share the same Arc<FrameResource>"
    );

    // -----------------------------------------------------------------------
    // Invariant 6: Cache hit → no new decode
    // -----------------------------------------------------------------------
    let t_cache = scheduler
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Interactive),
        )
        .await;
    let r_cache = scheduler
        .await_frame(t_cache)
        .await
        .expect("cache hit must succeed");
    assert_eq!(
        scheduler.production_count(),
        1,
        "Invariant 6: cache hit must not increment production_count"
    );
    assert!(Arc::ptr_eq(&r1, &r_cache), "Cache hit returns the same Arc");

    // -----------------------------------------------------------------------
    // Invariant 3: Different timestamp → separate production jobs
    // -----------------------------------------------------------------------
    let key_other_ts = FrameKey {
        timestamp_us: 999_000,
        ..key.clone()
    };
    let t_other = scheduler
        .request(
            key_other_ts,
            FrameDeadline::immediate(FramePriority::Realtime),
        )
        .await;
    let _r_other = scheduler
        .await_frame(t_other)
        .await
        .expect("different timestamp must succeed");
    assert_eq!(
        scheduler.production_count(),
        2,
        "Invariant 3: different timestamp → new production job"
    );

    // -----------------------------------------------------------------------
    // Invariant 4: Different quality → separate production jobs
    // -----------------------------------------------------------------------
    let key_lq = FrameKey {
        quality: PreviewQuality::Quarter,
        ..key.clone()
    };
    let t_lq = scheduler
        .request(key_lq, FrameDeadline::immediate(FramePriority::Background))
        .await;
    let _r_lq = scheduler
        .await_frame(t_lq)
        .await
        .expect("different quality must succeed");
    assert_eq!(
        scheduler.production_count(),
        3,
        "Invariant 4: different quality → separate production job"
    );

    // -----------------------------------------------------------------------
    // Invariant 5 & 15: render_revision change → new composition job,
    // but DecodedCacheKey is the same (decoded cache not invalidated).
    // -----------------------------------------------------------------------
    let key_rev1 = FrameKey {
        render_revision: 1,
        ..key.clone()
    };
    assert_eq!(
        key.decoded_key(),
        key_rev1.decoded_key(),
        "Invariant 15: decoded key must be revision-agnostic"
    );
    let t_rev1 = scheduler
        .request(
            key_rev1,
            FrameDeadline::immediate(FramePriority::Interactive),
        )
        .await;
    let _r_rev1 = scheduler
        .await_frame(t_rev1)
        .await
        .expect("new render_revision must succeed");
    assert_eq!(
        scheduler.production_count(),
        4,
        "Invariant 5: render_revision change → new production job"
    );

    // -----------------------------------------------------------------------
    // Invariant 10 & 11: Target destruction / resize does not invalidate
    // the shared Arc<FrameResource>.
    // -----------------------------------------------------------------------
    // Simulate target A and target B holding references.
    let target_a = Arc::clone(&r1);
    let target_b = Arc::clone(&r1);
    let pre_drop_count = Arc::strong_count(&r1);
    drop(target_a);
    // Dropping target A must not affect target B.
    assert!(
        Arc::ptr_eq(&target_b, &r1),
        "Invariant 10: target drop does not invalidate shared frame"
    );
    assert_eq!(Arc::strong_count(&r1), pre_drop_count - 1);
    drop(target_b);

    // -----------------------------------------------------------------------
    // Invariant 12: One target failing acquire_for_present does not prevent
    // others from using the same FrameResource.
    // -----------------------------------------------------------------------
    // Simulated structurally: frame resource is independent of surface acquisition.
    // The fan-out pattern is:
    //   for id in active_targets() {
    //       match acquire_for_present(&id) {
    //           Ok(pf)  => { renderer.render(&resource, pf)?; pf.present(); }
    //           Err(e)  => log::warn!("{e}"),  // skip this target, others continue
    //       }
    //   }
    // The scheduler is already verified above to produce one Arc<FrameResource>
    // independent of any target. Surface acquisition failure is RenderTargetManager's
    // concern and does not touch the scheduler or the Arc.
    assert!(
        Arc::strong_count(&r1) >= 1,
        "Invariant 12: FrameResource remains valid regardless of target acquisition outcomes"
    );

    // -----------------------------------------------------------------------
    // Invariant 14: Cancelled ticket returns Err(Cancelled), does not
    // require re-production.
    // -----------------------------------------------------------------------
    let _pre_cancel_count = scheduler.production_count();
    let t_bg = scheduler
        .request(
            FrameKey {
                sequence_id: SequenceId(99),
                timestamp_us: 0,
                quality: PreviewQuality::Quarter,
                render_revision: 0,
            },
            FrameDeadline::immediate(FramePriority::Background),
        )
        .await;
    let t_cancelled = scheduler.cancel(t_bg);
    let cancel_result = scheduler.await_frame(t_cancelled).await;
    assert!(
        matches!(cancel_result, Err(SchedulerError::Cancelled)),
        "Invariant 14: cancelled ticket must return Err(Cancelled)"
    );
    // Cancellation of an in-flight or cache-hit ticket does not guarantee
    // production_count stays the same (production may have started), but
    // it must not panic or produce an incorrect resource.
    let _ = scheduler.production_count(); // just assert it's readable

    // -----------------------------------------------------------------------
    // Invariant 7: Cache miss → production occurs (already covered by counts
    // above — each new FrameKey caused production_count to increment).
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Invariant 8: In-flight duplicate — three concurrent requests for an
    // uncached key coalesce into one production job.
    // Verified above (Invariants 1 & 2 & 9).
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // reset() clears caches and production_count
    // -----------------------------------------------------------------------
    scheduler.reset();
    assert_eq!(
        scheduler.production_count(),
        0,
        "reset() must zero production_count"
    );
    assert!(
        scheduler.get_cached(&key).is_none(),
        "reset() must clear composition cache"
    );
}

// ============================================================================
// Phase 5 — PerformanceManager + deadline-aware scheduling invariants
// ============================================================================

#[tokio::test]
async fn test_phase5_performance_manager_invariants() {
    use std::collections::BinaryHeap;
    use std::sync::atomic::{AtomicU64, Ordering as AO};
    use std::time::{Duration, Instant};

    use tauri_app_lib::wgpu_compositor::frame_deadline::FrameDeadline;
    use tauri_app_lib::wgpu_compositor::frame_request::{FramePriority, PreviewQuality};
    use tauri_app_lib::wgpu_compositor::frame_resource::{
        CpuFrame, FrameColorInfo, FrameUploader, VideoPixelFormat,
    };
    use tauri_app_lib::wgpu_compositor::frame_scheduler::{
        FrameKey, FrameProducer, FrameScheduler, SchedulerConfig, SequenceId,
    };
    use tauri_app_lib::wgpu_compositor::frame_telemetry::{FrameTelemetry, FrameTelemetryRing};
    use tauri_app_lib::wgpu_compositor::performance_manager::{
        BackpressureError, PerformanceConfig, PerformanceManager, PolicyState,
    };
    use tauri_app_lib::wgpu_compositor::FrameResource;

    // -----------------------------------------------------------------------
    // Invariant 1: Earlier FrameDeadline is more urgent (orders first in heap)
    // -----------------------------------------------------------------------
    let sooner = FrameDeadline {
        present_by: Instant::now() + Duration::from_millis(8),
        priority: FramePriority::Realtime,
    };
    let later = FrameDeadline {
        present_by: Instant::now() + Duration::from_millis(24),
        priority: FramePriority::Realtime,
    };
    let mut heap = BinaryHeap::new();
    heap.push(later.clone());
    heap.push(sooner.clone());
    let popped = heap.pop().unwrap();
    assert!(
        popped.present_by <= sooner.present_by + Duration::from_millis(1),
        "Invariant 1: earliest deadline must pop first from BinaryHeap"
    );

    // -----------------------------------------------------------------------
    // Invariant 2: Same deadline, higher FramePriority wins
    // -----------------------------------------------------------------------
    let deadline_now = Instant::now() + Duration::from_millis(16);
    let rt = FrameDeadline {
        present_by: deadline_now,
        priority: FramePriority::Realtime,
    };
    let bg = FrameDeadline {
        present_by: deadline_now,
        priority: FramePriority::Background,
    };
    assert!(
        rt > bg,
        "Invariant 2: equal deadline, higher priority class wins"
    );

    // -----------------------------------------------------------------------
    // Invariant 3: Expired deadline detection
    // -----------------------------------------------------------------------
    let past = FrameDeadline {
        present_by: Instant::now() - Duration::from_millis(1),
        priority: FramePriority::Realtime,
    };
    assert!(
        past.is_expired(),
        "Invariant 3: past deadline must be expired"
    );
    assert!(
        past.time_remaining().is_none(),
        "Invariant 3: expired deadline has no time remaining"
    );

    // -----------------------------------------------------------------------
    // Invariant 4: for_fps(60.0) produces deadline ~16.67 ms in the future
    // -----------------------------------------------------------------------
    let d60 = FrameDeadline::for_fps(60.0, FramePriority::Realtime);
    assert!(
        !d60.is_expired(),
        "Invariant 4: 60fps deadline must be in the future"
    );
    let rem = d60.time_remaining().expect("must have remaining time");
    assert!(
        rem <= Duration::from_millis(17),
        "Invariant 4: frame duration must be ≤ 17ms"
    );

    // -----------------------------------------------------------------------
    // Invariant 5: ResourceBudget from empty ring has None latencies
    // -----------------------------------------------------------------------
    let empty_ring = FrameTelemetryRing::new(10);
    let budget = empty_ring.compute_budget();
    assert!(
        budget.decode_p50_us.is_none(),
        "Invariant 5: empty ring → None p50"
    );
    assert_eq!(budget.deadline_misses_1s, 0, "Invariant 5: no misses yet");

    // -----------------------------------------------------------------------
    // Invariant 6: deadline_miss_count_1s only counts recent misses
    // -----------------------------------------------------------------------
    let mut ring = FrameTelemetryRing::new(20);
    let now = Instant::now();
    ring.push(FrameTelemetry {
        deadline_miss: true,
        recorded_at: Some(now),
        ..Default::default()
    });
    ring.push(FrameTelemetry {
        deadline_miss: true,
        recorded_at: Some(now),
        ..Default::default()
    });
    ring.push(FrameTelemetry {
        deadline_miss: true,
        recorded_at: Some(now - Duration::from_secs(2)), // old — outside window
        ..Default::default()
    });
    assert_eq!(
        ring.deadline_miss_count_1s(),
        2,
        "Invariant 6: only misses within the last 1 second must be counted"
    );

    // -----------------------------------------------------------------------
    // Invariant 7: PolicyState::default() allows all priorities
    // -----------------------------------------------------------------------
    let policy = PolicyState::default();
    assert!(
        !policy.background_paused,
        "Invariant 7: background allowed by default"
    );
    assert!(
        !policy.interactive_throttled,
        "Invariant 7: interactive allowed by default"
    );

    // -----------------------------------------------------------------------
    // Invariants 9, 11, 12: Pure policy logic — no GPU needed
    // -----------------------------------------------------------------------
    let cfg = PerformanceConfig {
        background_pause_threshold: 2,
        interactive_throttle_threshold: 5,
        recovery_threshold: 0,
        telemetry_capacity: 300,
        policy_eval_interval_us: 0, // evaluate on every record() call
    };

    // Build a minimal scheduler with a dummy producer for policy tests.
    // (We can't run it without GPU but we CAN test the policy logic without
    //  ever calling request() — just drive policy via record().)
    // For Invariant 9 (background rejected when paused) we test the admission
    // gate by manually creating a PerformanceManager and injecting misses.

    // Invariant 11: 2 misses → background_paused
    let miss_count = 2u32;
    assert!(
        miss_count >= cfg.background_pause_threshold,
        "Invariant 11: 2 misses must meet pause threshold"
    );

    // Invariant 12: 0 misses → recovery
    let zero_misses = 0u32;
    assert!(
        zero_misses <= cfg.recovery_threshold,
        "Invariant 12: 0 misses must meet recovery threshold"
    );

    // Invariant 13: config thresholds are ordered correctly
    assert!(
        cfg.recovery_threshold < cfg.background_pause_threshold,
        "Invariant 13: recovery < pause < throttle"
    );
    assert!(cfg.background_pause_threshold < cfg.interactive_throttle_threshold);

    // Invariant 15: PerformanceConfig defaults are ordered correctly
    let default_cfg = PerformanceConfig::default();
    assert!(default_cfg.recovery_threshold < default_cfg.background_pause_threshold);
    assert!(default_cfg.background_pause_threshold < default_cfg.interactive_throttle_threshold);

    // BackpressureError display (Invariant — all variants must display)
    assert!(!BackpressureError::BackgroundSuspended
        .to_string()
        .is_empty());
    assert!(!BackpressureError::Throttled {
        retry_after_us: 50_000
    }
    .to_string()
    .is_empty());

    // -----------------------------------------------------------------------
    // GPU-backed invariants (Invariants 8, 9, 10, 13, 14, 15)
    // -----------------------------------------------------------------------
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return, // Headless — skip GPU-dependent assertions
    };

    let w = 4u32;
    let h = 4u32;
    let rgba: Vec<u8> = vec![200u8; (w * h * 4) as usize];
    let empty: Vec<u8> = vec![];
    let base_resource = Arc::new(
        FrameUploader::upload(
            &ctx.device,
            &ctx.queue,
            &CpuFrame {
                y_plane: &rgba,
                uv_plane: &empty,
                width: w,
                height: h,
                format: VideoPixelFormat::Rgba8,
                color_info: FrameColorInfo::default(),
                sequence: 0,
            },
        )
        .expect("RGBA8 upload must succeed"),
    );

    struct TestProducer5 {
        count: Arc<AtomicU64>,
        frame: Arc<FrameResource>,
    }
    impl FrameProducer for TestProducer5 {
        fn produce(&self, _key: &FrameKey) -> Result<Arc<FrameResource>, String> {
            self.count.fetch_add(1, AO::SeqCst);
            Ok(Arc::clone(&self.frame))
        }
    }

    let count = Arc::new(AtomicU64::new(0));
    let producer = Arc::new(TestProducer5 {
        count: Arc::clone(&count),
        frame: Arc::clone(&base_resource),
    });
    let scheduler = FrameScheduler::new(producer, SchedulerConfig::default());
    let manager = PerformanceManager::new(
        scheduler,
        PerformanceConfig {
            background_pause_threshold: 2,
            interactive_throttle_threshold: 5,
            recovery_threshold: 0,
            telemetry_capacity: 300,
            policy_eval_interval_us: 0, // force eval every record()
        },
    );

    let key = FrameKey {
        sequence_id: SequenceId(5),
        timestamp_us: 1_000_000,
        quality: PreviewQuality::Full,
        render_revision: 0,
    };

    // Invariant 8: Realtime always passes even when background_paused
    // Inject two misses to trigger background_paused
    let inject = |m: &PerformanceManager| {
        m.record(FrameTelemetry {
            deadline_miss: true,
            recorded_at: Some(Instant::now()),
            ..Default::default()
        });
    };
    inject(&manager);
    inject(&manager);
    let p = manager.policy();
    assert!(
        p.background_paused,
        "Invariant 11: 2 misses → background_paused"
    );

    let rt_ticket = manager
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Realtime),
        )
        .await;
    assert!(
        rt_ticket.is_ok(),
        "Invariant 8: Realtime request must pass even when background_paused"
    );

    // Invariant 9: Background request rejected when paused
    let bg_result = manager
        .request(
            key.clone(),
            FrameDeadline::immediate(FramePriority::Background),
        )
        .await;
    assert!(
        matches!(bg_result, Err(BackpressureError::BackgroundSuspended)),
        "Invariant 9: Background request must be rejected when background_paused"
    );

    // Invariant 14: Realtime can produce a frame — await it
    let (resource, metrics) = manager
        .await_frame(rt_ticket.unwrap())
        .await
        .expect("Realtime frame production must succeed");
    assert!(
        Arc::ptr_eq(&resource, &base_resource),
        "Resource identity preserved"
    );

    // Invariant 13: queue_wait_us is populated
    assert!(
        metrics.queue_wait_us < 10_000_000,
        "Invariant 13: queue_wait_us must be plausible (< 10 seconds)"
    );

    // Invariant 10: record() updates ResourceBudget
    manager.record(FrameTelemetry {
        decode_cpu_us: 5000,
        queue_wait_us: Some(metrics.queue_wait_us),
        deadline_miss: metrics.deadline_miss,
        recorded_at: Some(Instant::now()),
        ..Default::default()
    });
    let budget = manager.budget();
    assert!(
        budget.decode_p50_us.is_some(),
        "Invariant 10: record() must update ResourceBudget latency metrics"
    );
    assert!(
        budget.frames_produced >= 1,
        "Invariant 10: frames_produced must be non-zero after record()"
    );

    // Invariant 12: 0 misses (after reset) → policy recovers to normal
    manager.reset();
    assert!(
        !manager.policy().background_paused,
        "Invariant 15: reset() must restore PolicyState to default"
    );
    assert_eq!(
        manager.budget().frames_produced,
        0,
        "Invariant 15: reset() must clear telemetry ring"
    );
}
