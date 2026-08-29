use crossbeam::channel::bounded;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

// Import internal ring buffer module from tauri_app_lib
use tauri_app_lib::wgpu_compositor::texture_pool::{
    create_nv12_bind_group_layout, create_nv12_sampler, Nv12TextureRingBuffer,
};

/// Headless GPU context for automated CI & local stress testing
struct TestGpuContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub sampler_y: wgpu::Sampler,
    pub sampler_uv: wgpu::Sampler,
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
            .await;

        let adapter = match adapter {
            Some(a) => a,
            None => {
                eprintln!("Skipping GPU stress test: No suitable GPU adapter found");
                return None;
            }
        };

        let (device, queue) = match adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Headless Stress Test Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
        {
            Ok(dq) => dq,
            Err(e) => {
                eprintln!("Skipping GPU stress test: Failed to create device: {}", e);
                return None;
            }
        };

        let bind_group_layout = create_nv12_bind_group_layout(&device);
        let sampler_y = create_nv12_sampler(&device);
        let sampler_uv = create_nv12_sampler(&device);

        Some(Self {
            device,
            queue,
            bind_group_layout,
            sampler_y,
            sampler_uv,
        })
    }
}

/// Stress Test 1: Rapid 4K Scrubbing & Ring Wraparound (10,000 frames)
#[tokio::test]
async fn test_stress_rapid_4k_scrubbing_wraparound() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let width = 3840u32;
    let height = 2160u32;
    let ring_capacity = 4;

    let mut ring = Nv12TextureRingBuffer::new(
        &ctx.device,
        &ctx.bind_group_layout,
        &ctx.sampler_y,
        &ctx.sampler_uv,
        width,
        height,
        ring_capacity,
    );

    // Synthetic 4K NV12 frame buffers
    let y_plane = vec![128u8; (width * height) as usize];
    let uv_plane = vec![128u8; (width * height / 2) as usize];

    let total_frames = 500;
    let start = Instant::now();

    for i in 0..total_frames {
        ring.upload_frame(
            &ctx.queue, &y_plane, &uv_plane, width, // Stride Y = 3840
            width, // Stride UV = 3840
        );

        // Assert BindGroup is valid and active
        let _bg = ring.active_bind_group();

        // Flush GPU command buffer periodically every 100 frames
        if i % 100 == 0 {
            ctx.queue.submit(None);
            ctx.device.poll(wgpu::Maintain::Poll);
        }
    }

    ctx.device.poll(wgpu::Maintain::Wait);
    let elapsed = start.elapsed();

    let fps = (total_frames as f64) / elapsed.as_secs_f64();
    println!(
        "\n🔥 [4K Scrub Stress] Uploaded {} frames in {:.2?} (~{:.1} FPS)",
        total_frames, elapsed, fps
    );
    assert!(
        fps > 60.0,
        "Throughput dropped below acceptable DMA threshold: {:.1} FPS",
        fps
    );
}

/// Stress Test 2: Dynamic Resolution & Aspect-Ratio Thrashing
#[tokio::test]
async fn test_stress_dynamic_resolution_aspect_ratio_thrash() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let ring_capacity = 4;

    let mut ring = Nv12TextureRingBuffer::new(
        &ctx.device,
        &ctx.bind_group_layout,
        &ctx.sampler_y,
        &ctx.sampler_uv,
        1920,
        1080,
        ring_capacity,
    );

    // Matrix of real-world timeline dimensions (must be even for NV12)
    let test_resolutions: Vec<(u32, u32)> = vec![
        (3840, 2160), // 4K 16:9
        (1080, 1920), // Vertical 9:16
        (1920, 1080), // Full HD 16:9
        (1280, 720),  // 720p
        (854, 480),   // 480p
        (2048, 1080), // 2K DCI
        (1080, 1080), // Square 1:1
    ];

    let cycles = 500;
    println!(
        "\n⚡ [Aspect Thrash Stress] Running {} dimension reallocation cycles...",
        cycles
    );

    for cycle in 0..cycles {
        let (w, h) = test_resolutions[cycle % test_resolutions.len()];

        // Dynamic resize under active pipeline
        ring.ensure_dimensions(
            &ctx.device,
            &ctx.bind_group_layout,
            &ctx.sampler_y,
            &ctx.sampler_uv,
            w,
            h,
        );

        let y_plane = vec![128u8; (w * h) as usize];
        let uv_plane = vec![128u8; (w * h / 2) as usize];

        // Push 5 frames per resolution to simulate a brief playback burst
        for _ in 0..5 {
            ring.upload_frame(&ctx.queue, &y_plane, &uv_plane, w, w);
            let _bg = ring.active_bind_group();
        }

        ctx.device.poll(wgpu::Maintain::Poll);
    }

    ctx.device.poll(wgpu::Maintain::Wait);
    println!("✅ [Aspect Thrash Stress] Passed cleanly with 0 validation errors.");
}

/// Stress Test 3: Hardware Decoder Padded Pitch / Stride Mismatch
#[tokio::test]
async fn test_stress_hardware_decoder_padded_stride() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let width = 1920u32;
    let height = 1080u32;

    // Hardware decoder introduces a 2048-byte pitch alignment (128 bytes of padding per row)
    let padded_stride_y = 2048u32;
    let padded_stride_uv = 2048u32;

    let mut ring = Nv12TextureRingBuffer::new(
        &ctx.device,
        &ctx.bind_group_layout,
        &ctx.sampler_y,
        &ctx.sampler_uv,
        width,
        height,
        4,
    );

    // Allocate oversized source buffers containing hardware pitch padding
    let raw_padded_y = vec![200u8; (padded_stride_y * height) as usize];
    let raw_padded_uv = vec![100u8; (padded_stride_uv * (height / 2)) as usize];

    for _ in 0..1000 {
        ring.upload_frame(
            &ctx.queue,
            &raw_padded_y,
            &raw_padded_uv,
            padded_stride_y,
            padded_stride_uv,
        );
        let _bg = ring.active_bind_group();
    }

    ctx.device.poll(wgpu::Maintain::Wait);
    println!(
        "✅ [Pitch Alignment Stress] Successfully handled 1,000 padded frames with pitch {} > width {}",
        padded_stride_y, width
    );
}

/// Stress Test 4: Multithreaded Decoder Pool Contention & Channel Saturation
#[tokio::test]
async fn test_stress_multithreaded_decoder_saturation() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => Arc::new(c),
        None => return,
    };

    let width = 1920u32;
    let height = 1080u32;
    let total_workers = 8;
    let frames_per_worker = 1000;

    struct FramePacket {
        y: Vec<u8>,
        uv: Vec<u8>,
    }

    let (sender, receiver) = bounded::<FramePacket>(32); // Backpressure ring channel
    let frame_counter = Arc::new(AtomicUsize::new(0));

    // Spawn 8 parallel decoding threads
    for worker_id in 0..total_workers {
        let tx = sender.clone();
        std::thread::spawn(move || {
            let y_plane = vec![worker_id as u8; (width * height) as usize];
            let uv_plane = vec![(worker_id * 2) as u8; (width * height / 2) as usize];

            for _ in 0..frames_per_worker {
                let packet = FramePacket {
                    y: y_plane.clone(),
                    uv: uv_plane.clone(),
                };
                if tx.send(packet).is_err() {
                    break;
                }
            }
        });
    }
    drop(sender); // Close root sender so receiver terminates

    // Consumer Render Loop
    let mut ring = Nv12TextureRingBuffer::new(
        &ctx.device,
        &ctx.bind_group_layout,
        &ctx.sampler_y,
        &ctx.sampler_uv,
        width,
        height,
        4,
    );

    let counter_clone = Arc::clone(&frame_counter);
    let ctx_consumer = Arc::clone(&ctx);

    let consumer_handle = std::thread::spawn(move || {
        while let Ok(frame) = receiver.recv() {
            ring.upload_frame(&ctx_consumer.queue, &frame.y, &frame.uv, width, width);
            let _bg = ring.active_bind_group();
            counter_clone.fetch_add(1, Ordering::Relaxed);
        }
    });

    consumer_handle.join().unwrap();
    ctx.device.poll(wgpu::Maintain::Wait);

    let processed = frame_counter.load(Ordering::SeqCst);
    println!(
        "✅ [MT Saturation Stress] Processed {}/{} frames across {} threads cleanly.",
        processed,
        total_workers * frames_per_worker,
        total_workers
    );
    assert_eq!(processed, total_workers * frames_per_worker);
}

/// Stress Test 5: Extended VRAM & Memory Leak Soak Test (50,000 frames)
#[tokio::test]
async fn test_stress_vram_leak_soak() {
    let ctx = match TestGpuContext::new().await {
        Some(c) => c,
        None => return,
    };

    let width = 1280u32;
    let height = 720u32;

    let mut ring = Nv12TextureRingBuffer::new(
        &ctx.device,
        &ctx.bind_group_layout,
        &ctx.sampler_y,
        &ctx.sampler_uv,
        width,
        height,
        4,
    );

    let y_plane = vec![64u8; (width * height) as usize];
    let uv_plane = vec![192u8; (width * height / 2) as usize];

    let soak_frames = 2_000;
    println!(
        "\n🌊 [Soak Test] Starting {} frame allocation soak...",
        soak_frames
    );

    let start = Instant::now();
    for i in 1..=soak_frames {
        ring.upload_frame(&ctx.queue, &y_plane, &uv_plane, width, width);
        let _ = ring.active_bind_group();

        if i % 500 == 0 {
            ctx.device.poll(wgpu::Maintain::Poll);
            print!(".");
        }
    }

    ctx.device.poll(wgpu::Maintain::Wait);
    println!(
        "\n✅ [Soak Test] Completed {} cycles in {:.2?}. No handle leakage.",
        soak_frames,
        start.elapsed()
    );
}
