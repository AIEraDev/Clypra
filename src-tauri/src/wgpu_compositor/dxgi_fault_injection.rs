//! Platform-neutral synthetic DXGI observations for debug pipeline checks.
//!
//! This profile validates the telemetry path only. It does not emulate a
//! Windows adapter, decoder, resource handle, or GPU synchronization result.

use super::dxgi_counters::{DxgiCounters, KeyedMutexObservation, DXGI_COUNTERS};
use super::dxgi_hazards::{hash_texture_identity, record_lookahead_depth, register_surface};
use super::render_path::DxgiFailureReason;
use super::scoped_dxgi_latch::{ScopedDxgiFailureReason, StreamClass};

const SYNTHETIC_TEXTURE_IDENTITY: usize = 0x51_4E_54_48;

/// Record a bounded synthetic attempt profile into the supplied counters.
///
/// Keeping the counter target injectable makes the profile testable without
/// sharing the process-global session accumulator with other tests.
pub fn record_synthetic_attempts(counters: &DxgiCounters) {
    counters.record_attempt(
        false,
        Some(DxgiFailureReason::ImportFailed),
        Some(0x887A_0005),
        KeyedMutexObservation::Unprobed,
        800_000,
    );
    counters.record_attempt(
        false,
        Some(DxgiFailureReason::DeviceLost),
        Some(0x887A_0006),
        KeyedMutexObservation::Unprobed,
        5_000_000,
    );
    counters.record_attempt(true, None, None, KeyedMutexObservation::Present, 120_000);
    counters.record_cpu_fallback();
}

/// Inject synthetic observations into the real session accumulators.
///
/// The hazard sequence deliberately re-registers one identity/slice while it
/// is outstanding, then releases both observations. No scheduling or import
/// behavior is changed and no raw identity is retained by the detector.
pub fn inject_synthetic_dxgi_observations() {
    record_synthetic_attempts(&DXGI_COUNTERS);

    // When the scoped-latch experiment is armed, include one representative
    // stream-class event in the synthetic payload.  The debug command still
    // sets the legacy latch separately so macOS can expose the payload through
    // the same endpoint; flag-off behavior remains legacy-only.
    let p010_class = StreamClass::from_stream_metadata("hevc", "main 10", 10, "p010", 3_840, 2_160);
    let _ = crate::wgpu_compositor::adapter_selector::record_scoped_dxgi_failure(
        &p010_class,
        ScopedDxgiFailureReason::FormatUnsupportedP010,
    );

    let identity = hash_texture_identity(SYNTHETIC_TEXTURE_IDENTITY);
    let first = register_surface(identity, 1);
    let second = register_surface(identity, 1);
    record_lookahead_depth(3);
    drop(second);
    drop(first);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_profile_records_attempts_hresults_and_keyed_mutex_state() {
        let counters = DxgiCounters::new();
        record_synthetic_attempts(&counters);

        let snapshot = counters.snapshot();
        assert_eq!(snapshot.attempts, 3);
        assert_eq!(snapshot.successes, 1);
        assert_eq!(snapshot.cpu_fallbacks, 1);
        assert_eq!(snapshot.keyed_mutex_present, 1);
        assert_eq!(snapshot.keyed_mutex_absent, 0);
        assert_eq!(snapshot.keyed_mutex_unprobed, 2);
        assert_eq!(snapshot.hresult_histogram.len(), 2);
        assert_eq!(snapshot.hresult_overflow, 0);
    }
}
