//! Platform-neutral atomic counters for the Windows DXGI zero-copy video path.
//!
//! All counters are updated directly at the event site using lock-free atomics
//! — never derived by draining the bounded diagnostic ring. Because this module
//! has no Windows-specific dependencies (`cfg`-free), all counter logic and
//! unit tests run on macOS, Linux, and Windows.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::render_path::DxgiFailureReason;

/// Whether the DXGI import attempt actually probed for `IDXGIKeyedMutex`.
///
/// `Unprobed` is distinct from `Absent`: failures before the resource probe
/// must not be reported as evidence that a keyed mutex was missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyedMutexObservation {
    Present,
    Absent,
    Unprobed,
}

/// Maximum distinct HRESULT codes tracked individually before spilling to overflow.
pub const HRESULT_HISTOGRAM_SLOTS: usize = 16;

/// Sentinel bit in the slot key indicating an occupied HRESULT slot.
/// Storing `(1 << 32) | (hr as u64)` allows `0` to mean empty while still
/// supporting every `u32` value including `0x0000_0000`.
const HRESULT_OCCUPIED_BIT: u64 = 1u64 << 32;

/// Number of fixed import-duration histogram buckets.
pub const DURATION_BUCKET_COUNT: usize = 7;

/// Human-readable labels for each fixed import-duration histogram bucket.
pub const DURATION_BUCKET_LABELS: [&str; DURATION_BUCKET_COUNT] = [
    "<50us",
    "50-200us",
    "200-500us",
    "500us-1ms",
    "1-5ms",
    "5-16ms",
    ">=16ms",
];

/// Map an import duration in nanoseconds to its fixed histogram bucket index.
#[inline]
pub const fn duration_bucket_index(duration_ns: u64) -> usize {
    if duration_ns < 50_000 {
        0
    } else if duration_ns < 200_000 {
        1
    } else if duration_ns < 500_000 {
        2
    } else if duration_ns < 1_000_000 {
        3
    } else if duration_ns < 5_000_000 {
        4
    } else if duration_ns < 16_000_000 {
        5
    } else {
        6
    }
}

/// Lock-free slot in the bounded HRESULT histogram.
pub struct HresultSlot {
    /// `0` when empty; `(1 << 32) | (hresult as u64)` when occupied.
    key: AtomicU64,
    count: AtomicU64,
}

impl HresultSlot {
    const fn new() -> Self {
        Self {
            key: AtomicU64::new(0),
            count: AtomicU64::new(0),
        }
    }

    fn reset(&self) {
        self.key.store(0, Ordering::Relaxed);
        self.count.store(0, Ordering::Relaxed);
    }
}

/// Platform-neutral atomic counters for DXGI zero-copy import attempts.
pub struct DxgiCounters {
    attempts: AtomicU64,
    successes: AtomicU64,
    cpu_fallbacks: AtomicU64,
    failures_by_reason: [AtomicU64; DxgiFailureReason::COUNT],
    hresult_slots: [HresultSlot; HRESULT_HISTOGRAM_SLOTS],
    hresult_overflow: AtomicU64,
    duration_buckets: [AtomicU64; DURATION_BUCKET_COUNT],
    keyed_mutex_present: AtomicU64,
    keyed_mutex_absent: AtomicU64,
    keyed_mutex_unprobed: AtomicU64,
}

/// Global process-wide DXGI counters updated at every attempt / CPU fallback.
pub static DXGI_COUNTERS: DxgiCounters = DxgiCounters::new();

/// Serializable entry in the bounded HRESULT histogram.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HresultCount {
    pub hresult: String,
    pub count: u64,
}

/// Serializable failure-reason count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureReasonCount {
    pub reason: String,
    pub count: u64,
}

/// Serializable import-duration bucket count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationBucketCount {
    pub bucket: String,
    pub count: u64,
}

/// Point-in-time snapshot of [`DxgiCounters`] for telemetry emission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxgiCountersSnapshot {
    pub attempts: u64,
    pub successes: u64,
    pub cpu_fallbacks: u64,
    pub failures_by_reason: Vec<FailureReasonCount>,
    pub hresult_histogram: Vec<HresultCount>,
    pub hresult_overflow: u64,
    pub import_duration_histogram: Vec<DurationBucketCount>,
    pub keyed_mutex_present: u64,
    pub keyed_mutex_absent: u64,
    pub keyed_mutex_unprobed: u64,
}

impl DxgiCounters {
    /// Create a zero-initialized [`DxgiCounters`] instance (usable in `static`).
    pub const fn new() -> Self {
        Self {
            attempts: AtomicU64::new(0),
            successes: AtomicU64::new(0),
            cpu_fallbacks: AtomicU64::new(0),
            failures_by_reason: [
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
            ],
            hresult_slots: [
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
                HresultSlot::new(),
            ],
            hresult_overflow: AtomicU64::new(0),
            duration_buckets: [
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
            ],
            keyed_mutex_present: AtomicU64::new(0),
            keyed_mutex_absent: AtomicU64::new(0),
            keyed_mutex_unprobed: AtomicU64::new(0),
        }
    }

    /// Record a single DXGI zero-copy import attempt at the event site.
    pub fn record_attempt(
        &self,
        success: bool,
        failure_reason: Option<DxgiFailureReason>,
        hresult: Option<u32>,
        keyed_mutex: KeyedMutexObservation,
        attempt_duration_ns: u64,
    ) {
        self.attempts.fetch_add(1, Ordering::Relaxed);
        if success {
            self.successes.fetch_add(1, Ordering::Relaxed);
        } else if let Some(reason) = failure_reason {
            self.failures_by_reason[reason.as_index()].fetch_add(1, Ordering::Relaxed);
        }

        if let Some(hr) = hresult {
            self.record_hresult(hr);
        }

        match keyed_mutex {
            KeyedMutexObservation::Present => {
                self.keyed_mutex_present.fetch_add(1, Ordering::Relaxed);
            }
            KeyedMutexObservation::Absent => {
                self.keyed_mutex_absent.fetch_add(1, Ordering::Relaxed);
            }
            KeyedMutexObservation::Unprobed => {
                self.keyed_mutex_unprobed.fetch_add(1, Ordering::Relaxed);
            }
        }

        let bucket = duration_bucket_index(attempt_duration_ns);
        self.duration_buckets[bucket].fetch_add(1, Ordering::Relaxed);
    }

    /// Record a CPU NV12 fallback on the Windows video path.
    pub fn record_cpu_fallback(&self) {
        self.cpu_fallbacks.fetch_add(1, Ordering::Relaxed);
    }

    fn record_hresult(&self, hresult: u32) {
        let target_key = HRESULT_OCCUPIED_BIT | (hresult as u64);
        for slot in &self.hresult_slots {
            let current = slot.key.load(Ordering::Acquire);
            if current == target_key {
                slot.count.fetch_add(1, Ordering::Relaxed);
                return;
            }
            if current == 0 {
                match slot
                    .key
                    .compare_exchange(0, target_key, Ordering::AcqRel, Ordering::Acquire)
                {
                    Ok(_) => {
                        slot.count.fetch_add(1, Ordering::Relaxed);
                        return;
                    }
                    Err(observed) if observed == target_key => {
                        slot.count.fetch_add(1, Ordering::Relaxed);
                        return;
                    }
                    Err(_) => {}
                }
            }
        }
        self.hresult_overflow.fetch_add(1, Ordering::Relaxed);
    }

    /// Read a consistent-per-counter snapshot for telemetry or tests.
    pub fn snapshot(&self) -> DxgiCountersSnapshot {
        let failures_by_reason = DxgiFailureReason::ALL
            .iter()
            .filter_map(|&reason| {
                let count = self.failures_by_reason[reason.as_index()].load(Ordering::Relaxed);
                if count > 0 {
                    Some(FailureReasonCount {
                        reason: reason.wire_name().to_string(),
                        count,
                    })
                } else {
                    None
                }
            })
            .collect();

        let mut hresult_histogram = Vec::new();
        for slot in &self.hresult_slots {
            let key = slot.key.load(Ordering::Acquire);
            if (key & HRESULT_OCCUPIED_BIT) != 0 {
                let count = slot.count.load(Ordering::Relaxed);
                if count > 0 {
                    let hr = (key & 0xFFFF_FFFF) as u32;
                    hresult_histogram.push(HresultCount {
                        hresult: format!("0x{hr:08X}"),
                        count,
                    });
                }
            }
        }
        hresult_histogram.sort_by(|a, b| {
            b.count
                .cmp(&a.count)
                .then_with(|| a.hresult.cmp(&b.hresult))
        });

        let import_duration_histogram = DURATION_BUCKET_LABELS
            .iter()
            .enumerate()
            .map(|(idx, &label)| DurationBucketCount {
                bucket: label.to_string(),
                count: self.duration_buckets[idx].load(Ordering::Relaxed),
            })
            .collect();

        DxgiCountersSnapshot {
            attempts: self.attempts.load(Ordering::Relaxed),
            successes: self.successes.load(Ordering::Relaxed),
            cpu_fallbacks: self.cpu_fallbacks.load(Ordering::Relaxed),
            failures_by_reason,
            hresult_histogram,
            hresult_overflow: self.hresult_overflow.load(Ordering::Relaxed),
            import_duration_histogram,
            keyed_mutex_present: self.keyed_mutex_present.load(Ordering::Relaxed),
            keyed_mutex_absent: self.keyed_mutex_absent.load(Ordering::Relaxed),
            keyed_mutex_unprobed: self.keyed_mutex_unprobed.load(Ordering::Relaxed),
        }
    }

    /// Reset all counters to zero (for unit tests and session boundaries).
    pub fn reset(&self) {
        self.attempts.store(0, Ordering::Relaxed);
        self.successes.store(0, Ordering::Relaxed);
        self.cpu_fallbacks.store(0, Ordering::Relaxed);
        for c in &self.failures_by_reason {
            c.store(0, Ordering::Relaxed);
        }
        for slot in &self.hresult_slots {
            slot.reset();
        }
        self.hresult_overflow.store(0, Ordering::Relaxed);
        for b in &self.duration_buckets {
            b.store(0, Ordering::Relaxed);
        }
        self.keyed_mutex_present.store(0, Ordering::Relaxed);
        self.keyed_mutex_absent.store(0, Ordering::Relaxed);
        self.keyed_mutex_unprobed.store(0, Ordering::Relaxed);
    }
}

impl Default for DxgiCounters {
    fn default() -> Self {
        Self::new()
    }
}

/// Pure helper used by `dxgi_import::import_into_wgpu` on success so the
/// computed keyed-mutex observation is carried through instead of hard-coded.
#[inline]
pub const fn success_record_keyed_mutex_observation(
    imported_has_keyed_mutex: bool,
) -> KeyedMutexObservation {
    if imported_has_keyed_mutex {
        KeyedMutexObservation::Present
    } else {
        KeyedMutexObservation::Absent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_attempts_successes_fallbacks_and_keyed_mutex_counts() {
        let counters = DxgiCounters::new();

        counters.record_attempt(
            true,
            None,
            None,
            success_record_keyed_mutex_observation(true),
            25_000,
        );
        counters.record_attempt(
            true,
            None,
            None,
            success_record_keyed_mutex_observation(false),
            100_000,
        );
        counters.record_attempt(
            false,
            Some(DxgiFailureReason::DeviceLost),
            Some(0x887A_0005),
            KeyedMutexObservation::Unprobed,
            300_000,
        );
        counters.record_cpu_fallback();
        counters.record_cpu_fallback();

        let snap = counters.snapshot();
        assert_eq!(snap.attempts, 3);
        assert_eq!(snap.successes, 2);
        assert_eq!(snap.cpu_fallbacks, 2);
        assert_eq!(snap.keyed_mutex_present, 1);
        assert_eq!(snap.keyed_mutex_absent, 1);
        assert_eq!(snap.keyed_mutex_unprobed, 1);
        assert_eq!(
            snap.failures_by_reason,
            vec![FailureReasonCount {
                reason: "device_lost".to_string(),
                count: 1,
            }]
        );
        assert_eq!(
            snap.hresult_histogram,
            vec![HresultCount {
                hresult: "0x887A0005".to_string(),
                count: 1,
            }]
        );
        assert_eq!(snap.hresult_overflow, 0);
    }

    #[test]
    fn success_record_preserves_computed_keyed_mutex_value() {
        // Negative control: if success_record_keyed_mutex_observation returned
        // `Absent` for every value
        // unconditionally (like the old hard-coded `has_keyed_mutex: false`),
        // `keyed_mutex_present` would be 0 and this test would fail.
        let counters = DxgiCounters::new();
        counters.record_attempt(
            true,
            None,
            None,
            success_record_keyed_mutex_observation(true),
            10_000,
        );

        let snap = counters.snapshot();
        assert_eq!(snap.keyed_mutex_present, 1);
        assert_eq!(snap.keyed_mutex_absent, 0);
    }

    #[test]
    fn hresult_histogram_bounds_at_16_and_spills_to_overflow() {
        let counters = DxgiCounters::new();

        // Insert 16 distinct HRESULTs (including 0x0000_0000).
        for i in 0..HRESULT_HISTOGRAM_SLOTS {
            let hr = if i == 0 { 0 } else { 0x887A_0000 + i as u32 };
            counters.record_attempt(
                false,
                Some(DxgiFailureReason::ImportFailed),
                Some(hr),
                KeyedMutexObservation::Unprobed,
                10_000,
            );
        }
        // Increment an existing slot again — must not spill to overflow.
        counters.record_attempt(
            false,
            Some(DxgiFailureReason::ImportFailed),
            Some(0x887A_0001),
            KeyedMutexObservation::Unprobed,
            10_000,
        );
        // Insert a 17th and 18th distinct HRESULT — must spill to overflow.
        counters.record_attempt(
            false,
            Some(DxgiFailureReason::ImportFailed),
            Some(0x8007_0005),
            KeyedMutexObservation::Unprobed,
            10_000,
        );
        counters.record_attempt(
            false,
            Some(DxgiFailureReason::ImportFailed),
            Some(0x8007_0057),
            KeyedMutexObservation::Unprobed,
            10_000,
        );

        let snap = counters.snapshot();
        assert_eq!(snap.hresult_histogram.len(), HRESULT_HISTOGRAM_SLOTS);
        assert_eq!(snap.hresult_overflow, 2);
        assert_eq!(snap.hresult_histogram[0].hresult, "0x887A0001");
        assert_eq!(snap.hresult_histogram[0].count, 2);
    }

    #[test]
    fn duration_histogram_maps_all_seven_buckets() {
        let counters = DxgiCounters::new();
        let samples_ns = [
            10_000,     // <50us
            75_000,     // 50-200us
            350_000,    // 200-500us
            750_000,    // 500us-1ms
            2_500_000,  // 1-5ms
            10_000_000, // 5-16ms
            25_000_000, // >=16ms
        ];
        for ns in samples_ns {
            counters.record_attempt(true, None, None, KeyedMutexObservation::Absent, ns);
        }

        let snap = counters.snapshot();
        for (idx, bucket) in snap.import_duration_histogram.iter().enumerate() {
            assert_eq!(bucket.bucket, DURATION_BUCKET_LABELS[idx]);
            assert_eq!(
                bucket.count, 1,
                "bucket {} should have count 1",
                bucket.bucket
            );
        }
    }

    #[test]
    fn concurrent_updates_are_lossless() {
        use std::sync::Arc;
        let counters = Arc::new(DxgiCounters::new());
        let mut handles = Vec::new();
        for t in 0..4u32 {
            let c = Arc::clone(&counters);
            handles.push(std::thread::spawn(move || {
                for i in 0..250u32 {
                    c.record_attempt(
                        i % 2 == 0,
                        Some(DxgiFailureReason::ImportFailed),
                        Some(0x887A_0000 + (t % 4)),
                        if t % 2 == 0 {
                            KeyedMutexObservation::Present
                        } else {
                            KeyedMutexObservation::Absent
                        },
                        100_000,
                    );
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let snap = counters.snapshot();
        assert_eq!(snap.attempts, 1000);
        assert_eq!(snap.successes, 500);
        assert_eq!(snap.keyed_mutex_present, 500);
        assert_eq!(snap.keyed_mutex_absent, 500);
        assert_eq!(snap.keyed_mutex_unprobed, 0);
        assert_eq!(snap.hresult_overflow, 0);
    }
}
