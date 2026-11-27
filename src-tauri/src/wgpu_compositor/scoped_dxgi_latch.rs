//! Scoped policy for DXGI zero-copy eligibility.
//!
//! This module deliberately contains no Windows or wgpu APIs.  The policy is
//! exercised on every platform so the failure scopes, breaker window, and
//! re-probe backoff can be tested without a DXGI device.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};

pub const FRAME_FAILURE_THRESHOLD: usize = 5;
pub const FRAME_FAILURE_WINDOW_MS: u64 = 2_000;
pub const INITIAL_PROBE_BACKOFF_MS: u64 = 60_000;
pub const MAX_PROBE_BACKOFF_MS: u64 = 600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LatchScope {
    Device,
    StreamClass,
    Frame,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopedDxgiFailureReason {
    DeviceLost,
    AdapterMismatch,
    Nv12UnavailableAtConstruction,
    NonD3d11Surface,
    FormatUnsupportedP010,
    ImportFailed,
    DecodeFailed,
    Cancellation,
}

/// Pure failure-scope classification.  Cancellation is intentionally not a
/// failure scope because a superseded request must not affect future frames.
pub const fn scope_for(reason: ScopedDxgiFailureReason) -> Option<LatchScope> {
    match reason {
        ScopedDxgiFailureReason::DeviceLost
        | ScopedDxgiFailureReason::AdapterMismatch
        | ScopedDxgiFailureReason::Nv12UnavailableAtConstruction => Some(LatchScope::Device),
        ScopedDxgiFailureReason::NonD3d11Surface
        | ScopedDxgiFailureReason::FormatUnsupportedP010 => Some(LatchScope::StreamClass),
        ScopedDxgiFailureReason::ImportFailed | ScopedDxgiFailureReason::DecodeFailed => {
            Some(LatchScope::Frame)
        }
        ScopedDxgiFailureReason::Cancellation => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SizeBucket {
    UpTo1080p,
    UpTo4K,
    Above4K,
}

impl SizeBucket {
    pub const fn from_dimensions(width: u32, height: u32) -> Self {
        let pixels = (width as u64).saturating_mul(height as u64);
        if pixels <= 1_920u64 * 1_080 {
            Self::UpTo1080p
        } else if pixels <= 3_840u64 * 2_160 {
            Self::UpTo4K
        } else {
            Self::Above4K
        }
    }
}

/// Low-cardinality stream identity used by the scoped latch.
///
/// Callers must provide normalized codec/profile/chroma names.  This type
/// contains no source path or other per-file identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamClass {
    pub codec: String,
    pub profile: String,
    pub bit_depth: u8,
    pub chroma_format: String,
    pub size_bucket: SizeBucket,
}

impl StreamClass {
    pub fn new(
        codec: impl Into<String>,
        profile: impl Into<String>,
        bit_depth: u8,
        chroma_format: impl Into<String>,
        size_bucket: SizeBucket,
    ) -> Self {
        Self {
            codec: codec.into(),
            profile: profile.into(),
            bit_depth,
            chroma_format: chroma_format.into(),
            size_bucket,
        }
    }

    pub fn from_stream_metadata(
        codec: impl Into<String>,
        profile: impl Into<String>,
        bit_depth: u8,
        pixel_format: &str,
        width: u32,
        height: u32,
    ) -> Self {
        Self::new(
            codec,
            profile,
            bit_depth,
            chroma_format_for_pixel_format(pixel_format),
            SizeBucket::from_dimensions(width, height),
        )
    }
}

fn chroma_format_for_pixel_format(pixel_format: &str) -> String {
    let format = pixel_format.to_ascii_lowercase();
    if format.contains("444") {
        "4:4:4".to_string()
    } else if format.contains("422") {
        "4:2:2".to_string()
    } else if format.contains("420") || format.contains("nv12") || format.contains("p010") {
        "4:2:0".to_string()
    } else {
        "unknown".to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatchEvent {
    pub scope: LatchScope,
    pub class: Option<StreamClass>,
    pub reason: ScopedDxgiFailureReasonName,
    pub at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedDxgiFailureReasonName {
    DeviceLost,
    AdapterMismatch,
    Nv12UnavailableAtConstruction,
    NonD3d11Surface,
    FormatUnsupportedP010,
    ImportFailed,
    DecodeFailed,
    Cancellation,
}

impl From<ScopedDxgiFailureReason> for ScopedDxgiFailureReasonName {
    fn from(value: ScopedDxgiFailureReason) -> Self {
        match value {
            ScopedDxgiFailureReason::DeviceLost => Self::DeviceLost,
            ScopedDxgiFailureReason::AdapterMismatch => Self::AdapterMismatch,
            ScopedDxgiFailureReason::Nv12UnavailableAtConstruction => {
                Self::Nv12UnavailableAtConstruction
            }
            ScopedDxgiFailureReason::NonD3d11Surface => Self::NonD3d11Surface,
            ScopedDxgiFailureReason::FormatUnsupportedP010 => Self::FormatUnsupportedP010,
            ScopedDxgiFailureReason::ImportFailed => Self::ImportFailed,
            ScopedDxgiFailureReason::DecodeFailed => Self::DecodeFailed,
            ScopedDxgiFailureReason::Cancellation => Self::Cancellation,
        }
    }
}

pub trait MonotonicClock: Send + Sync {
    fn now_ms(&self) -> u64;
}

#[derive(Debug)]
pub struct ProcessMonotonicClock {
    started: Instant,
}

impl ProcessMonotonicClock {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl Default for ProcessMonotonicClock {
    fn default() -> Self {
        Self::new()
    }
}

impl MonotonicClock for ProcessMonotonicClock {
    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedDxgiSnapshot {
    pub device_latched: bool,
    pub latched_classes: Vec<StreamClass>,
    pub breaker_promotions: u64,
    pub probes_attempted: u64,
    pub probes_succeeded: u64,
    pub events: Vec<LatchEvent>,
}

#[derive(Debug)]
struct LatchEntry {
    latched: bool,
    frame_failures_ms: VecDeque<u64>,
    backoff_ms: u64,
    next_probe_at_ms: Option<u64>,
    probe_in_flight: bool,
}

impl Default for LatchEntry {
    fn default() -> Self {
        Self {
            latched: false,
            frame_failures_ms: VecDeque::new(),
            backoff_ms: INITIAL_PROBE_BACKOFF_MS,
            next_probe_at_ms: None,
            probe_in_flight: false,
        }
    }
}

/// Platform-neutral scoped DXGI policy state.
pub struct ScopedDxgiLatch {
    enabled: bool,
    legacy_enabled: bool,
    device_latched: bool,
    classes: DashMap<StreamClass, LatchEntry>,
    breaker_promotions: u64,
    probes_attempted: u64,
    probes_succeeded: u64,
    events: Vec<LatchEvent>,
    clock: Arc<dyn MonotonicClock>,
}

impl std::fmt::Debug for ScopedDxgiLatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScopedDxgiLatch")
            .field("enabled", &self.enabled)
            .field("legacy_enabled", &self.legacy_enabled)
            .field("device_latched", &self.device_latched)
            .field("classes", &self.classes.len())
            .field("breaker_promotions", &self.breaker_promotions)
            .field("probes_attempted", &self.probes_attempted)
            .field("probes_succeeded", &self.probes_succeeded)
            .finish()
    }
}

impl ScopedDxgiLatch {
    pub fn new(enabled: bool, legacy_enabled: bool) -> Self {
        Self::with_clock(
            enabled,
            legacy_enabled,
            Arc::new(ProcessMonotonicClock::new()),
        )
    }

    pub fn with_clock(enabled: bool, legacy_enabled: bool, clock: Arc<dyn MonotonicClock>) -> Self {
        Self {
            enabled,
            legacy_enabled,
            device_latched: false,
            classes: DashMap::new(),
            breaker_promotions: 0,
            probes_attempted: 0,
            probes_succeeded: 0,
            events: Vec::new(),
            clock,
        }
    }

    pub fn is_enabled_for(&mut self, class: &StreamClass) -> bool {
        if !self.enabled {
            return self.legacy_enabled;
        }
        if self.device_latched {
            return false;
        }

        let now_ms = self.clock.now_ms();
        let mut entry = self.classes.entry(class.clone()).or_default();
        if !entry.latched {
            return true;
        }
        if entry.probe_in_flight || entry.next_probe_at_ms.is_none_or(|at| now_ms < at) {
            return false;
        }

        entry.probe_in_flight = true;
        self.probes_attempted = self.probes_attempted.saturating_add(1);
        true
    }

    pub fn record_failure(
        &mut self,
        class: &StreamClass,
        reason: ScopedDxgiFailureReason,
    ) -> Option<LatchEvent> {
        if !self.enabled {
            return None;
        }
        let scope = scope_for(reason)?;
        let now_ms = self.clock.now_ms();
        let event = LatchEvent {
            scope,
            class: (scope != LatchScope::Device).then(|| class.clone()),
            reason: reason.into(),
            at_ms: now_ms,
        };

        match scope {
            LatchScope::Device => self.device_latched = true,
            LatchScope::StreamClass => {
                let mut entry = self.classes.entry(class.clone()).or_default();
                if entry.probe_in_flight {
                    entry.probe_in_flight = false;
                    entry.backoff_ms = entry
                        .backoff_ms
                        .saturating_mul(2)
                        .min(MAX_PROBE_BACKOFF_MS);
                    entry.next_probe_at_ms = Some(now_ms.saturating_add(entry.backoff_ms));
                } else {
                    entry.backoff_ms = INITIAL_PROBE_BACKOFF_MS;
                    entry.next_probe_at_ms = Some(now_ms.saturating_add(entry.backoff_ms));
                }
                entry.latched = true;
            }
            LatchScope::Frame => {
                let mut entry = self.classes.entry(class.clone()).or_default();
                while entry.frame_failures_ms.front().is_some_and(|failure| {
                    now_ms.saturating_sub(*failure) > FRAME_FAILURE_WINDOW_MS
                }) {
                    entry.frame_failures_ms.pop_front();
                }
                entry.frame_failures_ms.push_back(now_ms);
                if entry.probe_in_flight {
                    entry.probe_in_flight = false;
                    entry.backoff_ms = entry
                        .backoff_ms
                        .saturating_mul(2)
                        .min(MAX_PROBE_BACKOFF_MS);
                    entry.next_probe_at_ms = Some(now_ms.saturating_add(entry.backoff_ms));
                } else if entry.frame_failures_ms.len() >= FRAME_FAILURE_THRESHOLD
                    && !entry.latched
                {
                    entry.latched = true;
                    entry.backoff_ms = INITIAL_PROBE_BACKOFF_MS;
                    entry.next_probe_at_ms = Some(now_ms.saturating_add(entry.backoff_ms));
                    self.breaker_promotions = self.breaker_promotions.saturating_add(1);
                }
            }
        }

        self.events.push(event.clone());
        Some(event)
    }

    pub fn record_probe_success(&mut self, class: &StreamClass) -> bool {
        if !self.enabled {
            return false;
        }
        let Some(mut entry) = self.classes.get_mut(class) else {
            return false;
        };
        if !entry.probe_in_flight {
            return false;
        }
        entry.latched = false;
        entry.frame_failures_ms.clear();
        entry.backoff_ms = INITIAL_PROBE_BACKOFF_MS;
        entry.next_probe_at_ms = None;
        entry.probe_in_flight = false;
        self.probes_succeeded = self.probes_succeeded.saturating_add(1);
        true
    }

    pub fn record_probe_failure(&mut self, class: &StreamClass) -> bool {
        if !self.enabled {
            return false;
        }
        let now_ms = self.clock.now_ms();
        let Some(mut entry) = self.classes.get_mut(class) else {
            return false;
        };
        if !entry.probe_in_flight {
            return false;
        }
        entry.probe_in_flight = false;
        entry.backoff_ms = entry.backoff_ms.saturating_mul(2).min(MAX_PROBE_BACKOFF_MS);
        entry.next_probe_at_ms = Some(now_ms.saturating_add(entry.backoff_ms));
        true
    }

    pub fn reset_stream_classes(&mut self) {
        self.classes.clear();
        self.breaker_promotions = 0;
        self.probes_attempted = 0;
        self.probes_succeeded = 0;
        self.events.clear();
    }

    pub fn reset_all(&mut self) {
        self.reset_stream_classes();
        self.device_latched = false;
    }

    pub fn snapshot(&self) -> ScopedDxgiSnapshot {
        let mut latched_classes = self
            .classes
            .iter()
            .filter(|entry| entry.value().latched)
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        latched_classes.sort_by(|left, right| {
            (
                &left.codec,
                &left.profile,
                left.bit_depth,
                &left.chroma_format,
            )
                .cmp(&(
                    &right.codec,
                    &right.profile,
                    right.bit_depth,
                    &right.chroma_format,
                ))
        });
        ScopedDxgiSnapshot {
            device_latched: self.device_latched,
            latched_classes,
            breaker_promotions: self.breaker_promotions,
            probes_attempted: self.probes_attempted,
            probes_succeeded: self.probes_succeeded,
            events: self.events.clone(),
        }
    }

    pub fn device_latched(&self) -> bool {
        self.device_latched
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestClock(AtomicU64);

    impl TestClock {
        fn new() -> Arc<Self> {
            Arc::new(Self(AtomicU64::new(0)))
        }

        fn set(&self, value: u64) {
            self.0.store(value, Ordering::Relaxed);
        }
    }

    impl MonotonicClock for TestClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::Relaxed)
        }
    }

    fn class(codec: &str, bit_depth: u8) -> StreamClass {
        StreamClass::new(codec, "main", bit_depth, "4:2:0", SizeBucket::UpTo1080p)
    }

    #[test]
    fn scope_mapping_is_explicit_and_cancellation_is_not_a_failure() {
        assert_eq!(
            scope_for(ScopedDxgiFailureReason::DeviceLost),
            Some(LatchScope::Device)
        );
        assert_eq!(
            scope_for(ScopedDxgiFailureReason::NonD3d11Surface),
            Some(LatchScope::StreamClass)
        );
        assert_eq!(
            scope_for(ScopedDxgiFailureReason::ImportFailed),
            Some(LatchScope::Frame)
        );
        assert_eq!(scope_for(ScopedDxgiFailureReason::Cancellation), None);
    }

    #[test]
    fn stream_class_failures_do_not_cross_latch_classes() {
        let clock = TestClock::new();
        let mut latch = ScopedDxgiLatch::with_clock(true, true, clock);
        let h264 = class("h264", 8);
        let hevc = class("hevc", 8);

        latch.record_failure(&h264, ScopedDxgiFailureReason::NonD3d11Surface);

        assert!(!latch.is_enabled_for(&h264));
        assert!(latch.is_enabled_for(&hevc));
    }

    #[test]
    fn p010_failure_does_not_latch_h264_8_bit() {
        let clock = TestClock::new();
        let mut latch = ScopedDxgiLatch::with_clock(true, true, clock);
        let p010 = class("hevc", 10);
        let h264 = class("h264", 8);

        latch.record_failure(&p010, ScopedDxgiFailureReason::FormatUnsupportedP010);

        assert!(!latch.is_enabled_for(&p010));
        assert!(latch.is_enabled_for(&h264));
    }

    #[test]
    fn device_failure_latches_all_classes() {
        let clock = TestClock::new();
        let mut latch = ScopedDxgiLatch::with_clock(true, true, clock);
        let h264 = class("h264", 8);
        let hevc = class("hevc", 10);

        latch.record_failure(&h264, ScopedDxgiFailureReason::DeviceLost);

        assert!(!latch.is_enabled_for(&h264));
        assert!(!latch.is_enabled_for(&hevc));
        assert!(latch.snapshot().device_latched);
    }

    #[test]
    fn breaker_requires_five_failures_in_the_sliding_window() {
        let clock = TestClock::new();
        let mut latch =
            ScopedDxgiLatch::with_clock(true, true, Arc::clone(&clock) as Arc<dyn MonotonicClock>);
        let h264 = class("h264", 8);

        for at in [0, 400, 800, 1_200] {
            clock.set(at);
            latch.record_failure(&h264, ScopedDxgiFailureReason::ImportFailed);
        }
        clock.set(1_600);
        assert!(latch.is_enabled_for(&h264));
        latch.record_failure(&h264, ScopedDxgiFailureReason::ImportFailed);
        assert!(!latch.is_enabled_for(&h264));
        assert_eq!(latch.snapshot().breaker_promotions, 1);
    }

    #[test]
    fn success_does_not_clear_failures_inside_the_window() {
        let clock = TestClock::new();
        let mut latch =
            ScopedDxgiLatch::with_clock(true, true, Arc::clone(&clock) as Arc<dyn MonotonicClock>);
        let h264 = class("h264", 8);

        for at in [0, 300, 600, 900] {
            clock.set(at);
            latch.record_failure(&h264, ScopedDxgiFailureReason::ImportFailed);
        }
        clock.set(1_000);
        assert!(latch.is_enabled_for(&h264));
        clock.set(1_100);
        latch.record_probe_success(&h264);
        assert!(latch.is_enabled_for(&h264));
        assert_eq!(latch.snapshot().breaker_promotions, 0);
    }

    #[test]
    fn failures_outside_the_window_do_not_promote() {
        let clock = TestClock::new();
        let mut latch =
            ScopedDxgiLatch::with_clock(true, true, Arc::clone(&clock) as Arc<dyn MonotonicClock>);
        let h264 = class("h264", 8);

        for at in [0, 2_100, 4_200, 6_300, 8_400] {
            clock.set(at);
            latch.record_failure(&h264, ScopedDxgiFailureReason::ImportFailed);
            assert!(latch.is_enabled_for(&h264));
        }
        assert_eq!(latch.snapshot().breaker_promotions, 0);
    }

    #[test]
    fn probe_backoff_doubles_and_caps_and_success_clears() {
        let clock = TestClock::new();
        let mut latch =
            ScopedDxgiLatch::with_clock(true, true, Arc::clone(&clock) as Arc<dyn MonotonicClock>);
        let h264 = class("h264", 8);
        latch.record_failure(&h264, ScopedDxgiFailureReason::NonD3d11Surface);

        clock.set(INITIAL_PROBE_BACKOFF_MS - 1);
        assert!(!latch.is_enabled_for(&h264));
        clock.set(INITIAL_PROBE_BACKOFF_MS);
        assert!(latch.is_enabled_for(&h264));
        assert!(latch.record_probe_failure(&h264));
        assert!(!latch.is_enabled_for(&h264));

        clock.set(INITIAL_PROBE_BACKOFF_MS * 3);
        assert!(latch.is_enabled_for(&h264));
        assert!(latch.record_probe_failure(&h264));
        assert_eq!(latch.snapshot().probes_attempted, 2);

        clock.set(INITIAL_PROBE_BACKOFF_MS * 3 + MAX_PROBE_BACKOFF_MS);
        assert!(latch.is_enabled_for(&h264));
        assert!(latch.record_probe_success(&h264));
        assert!(latch.is_enabled_for(&h264));
        assert_eq!(latch.snapshot().probes_succeeded, 1);
    }

    #[test]
    fn cancellation_never_counts_or_latches() {
        let clock = TestClock::new();
        let mut latch = ScopedDxgiLatch::with_clock(true, true, clock);
        let h264 = class("h264", 8);

        for _ in 0..10 {
            assert!(latch
                .record_failure(&h264, ScopedDxgiFailureReason::Cancellation)
                .is_none());
        }
        assert!(latch.is_enabled_for(&h264));
        assert!(latch.snapshot().events.is_empty());
    }

    #[test]
    fn flag_off_preserves_legacy_result_and_ignores_scoped_failures() {
        let clock = TestClock::new();
        let h264 = class("h264", 8);
        let mut legacy_enabled =
            ScopedDxgiLatch::with_clock(false, true, Arc::clone(&clock) as Arc<dyn MonotonicClock>);
        legacy_enabled.record_failure(&h264, ScopedDxgiFailureReason::DeviceLost);
        assert!(legacy_enabled.is_enabled_for(&h264));

        let mut legacy_disabled = ScopedDxgiLatch::with_clock(false, false, clock);
        assert!(!legacy_disabled.is_enabled_for(&h264));
    }

    #[test]
    fn reset_clears_classes_but_preserves_device_latch() {
        let clock = TestClock::new();
        let mut latch = ScopedDxgiLatch::with_clock(true, true, clock);
        let h264 = class("h264", 8);
        latch.record_failure(&h264, ScopedDxgiFailureReason::NonD3d11Surface);
        latch.record_failure(&h264, ScopedDxgiFailureReason::DeviceLost);

        latch.reset_stream_classes();

        assert!(latch.snapshot().latched_classes.is_empty());
        assert!(latch.snapshot().events.is_empty());
        assert!(latch.snapshot().device_latched);
        assert!(!latch.is_enabled_for(&h264));
    }
}
