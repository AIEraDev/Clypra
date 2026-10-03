use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

struct CountingAllocator;

static ALLOC_COUNT: AtomicUsize = AtomicUsize::new(0);
static TRACK_ALLOC: AtomicBool = AtomicBool::new(false);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if TRACK_ALLOC.load(Ordering::SeqCst) {
            ALLOC_COUNT.fetch_add(1, Ordering::SeqCst);
        }
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static A: CountingAllocator = CountingAllocator;

#[test]
fn test_audio_callback_telemetry_zero_allocations() {
    use tauri_app_lib::native_audio::{
        output_latency_bucket, OutputLatencyMetrics, INTERVAL_RING_SIZE,
    };

    let metrics = OutputLatencyMetrics::new();
    let callback_count = Arc::new(AtomicU64::new(0));
    let last_callback_ns = Arc::new(AtomicU64::new(0));
    let interval_ring: Arc<[AtomicU64; INTERVAL_RING_SIZE]> =
        Arc::new(std::array::from_fn(|_| AtomicU64::new(0)));
    let interval_cursor = Arc::new(AtomicU64::new(0));
    let clock_epoch = Instant::now();

    // Warm up / pre-fault everything
    let _ = metrics.clone();

    // Start tracking allocations
    TRACK_ALLOC.store(true, Ordering::SeqCst);
    ALLOC_COUNT.store(0, Ordering::SeqCst);

    for i in 0..10_000 {
        callback_count.fetch_add(1, Ordering::Relaxed);

        let callback_ns = clock_epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        let callback_ns = callback_ns.max(1);

        let prev_ns = last_callback_ns.load(Ordering::Relaxed);
        if prev_ns != 0 {
            let spacing_us = callback_ns.saturating_sub(prev_ns) / 1_000;
            let cursor = interval_cursor.fetch_add(1, Ordering::Relaxed);
            let slot = (cursor as usize) % INTERVAL_RING_SIZE;
            interval_ring[slot].store(spacing_us, Ordering::Relaxed);
        }
        last_callback_ns.store(callback_ns, Ordering::Relaxed);

        // Latency simulation (varying from 500 us to 600,000 us across the 10,000 iterations)
        let us = ((i * 61) % 600_000) as u64;
        let bucket = output_latency_bucket(us);
        metrics.histogram[bucket].fetch_add(1, Ordering::Relaxed);
        metrics.last_us.store(us, Ordering::Relaxed);
        metrics.min_us.fetch_min(us, Ordering::Relaxed);
        metrics.max_us.fetch_max(us, Ordering::Relaxed);
        metrics.sum_us.fetch_add(us, Ordering::Relaxed);
        metrics.count.fetch_add(1, Ordering::Relaxed);
        if !metrics.available.load(Ordering::Relaxed) {
            metrics.available.store(true, Ordering::Relaxed);
        }
    }

    TRACK_ALLOC.store(false, Ordering::SeqCst);
    let allocs = ALLOC_COUNT.load(Ordering::SeqCst);

    assert_eq!(
        allocs, 0,
        "Audio callback telemetry allocated {allocs} times! Must be 0 for real-time safety."
    );
    assert_eq!(callback_count.load(Ordering::Relaxed), 10_000);
    assert_eq!(metrics.count.load(Ordering::Relaxed), 10_000);
    assert!(metrics.available.load(Ordering::Relaxed));
}
