use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

struct CountingAllocator;

thread_local! {
    static TRACK_THIS_THREAD: Cell<bool> = const { Cell::new(false) };
    static THREAD_ALLOC_COUNT: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = TRACK_THIS_THREAD.try_with(|track| {
            if track.get() {
                let _ = THREAD_ALLOC_COUNT.try_with(|count| {
                    count.set(count.get() + 1);
                });
            }
        });
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

    // Warm up / pre-fault everything: TLS, clock elapsed, bucket calculation, and atomics
    let _ = metrics.clone();
    for i in 0..100 {
        let callback_ns = clock_epoch.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        let _ = output_latency_bucket(i as u64);
        metrics.min_us.fetch_min(100, Ordering::Relaxed);
        metrics.max_us.fetch_max(100, Ordering::Relaxed);
        metrics.sum_us.fetch_add(100, Ordering::Relaxed);
        metrics.count.fetch_add(1, Ordering::Relaxed);
        interval_ring[0].store(callback_ns, Ordering::Relaxed);
    }
    metrics.count.store(0, Ordering::Relaxed);
    metrics.sum_us.store(0, Ordering::Relaxed);

    // Warm up TLS on this thread before enabling tracking
    let _ = TRACK_THIS_THREAD.try_with(|t| t.set(false));
    let _ = THREAD_ALLOC_COUNT.try_with(|c| c.set(0));

    // Start tracking allocations on this thread
    let _ = TRACK_THIS_THREAD.try_with(|t| t.set(true));

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

    let _ = TRACK_THIS_THREAD.try_with(|t| t.set(false));
    let allocs = THREAD_ALLOC_COUNT.with(|c| c.get());

    assert_eq!(
        allocs, 0,
        "Audio callback telemetry allocated {allocs} times! Must be 0 for real-time safety."
    );
    assert_eq!(callback_count.load(Ordering::Relaxed), 10_000);
    assert_eq!(metrics.count.load(Ordering::Relaxed), 10_000);
    assert!(metrics.available.load(Ordering::Relaxed));
}
