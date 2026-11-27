//! Platform-neutral metadata for DXGI surface ownership hazards.
//!
//! The detector observes ownership at extraction and release boundaries. It
//! never blocks reuse, changes scheduling, or stores raw pointers. A session
//! seed makes the identity hash local to the current session, so the emitted
//! metadata cannot be used as a process- or machine-stable surface ID.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxgiHazardSnapshot {
    pub slice_reuse_in_flight: u64,
    pub handle_outstanding_max: u64,
    pub lookahead_depth_max: u64,
}

#[derive(Default)]
struct HazardDetector {
    outstanding: HashMap<(u64, u32), u64>,
    total_outstanding: u64,
    snapshot: DxgiHazardSnapshot,
}

static DETECTOR: OnceLock<Mutex<HazardDetector>> = OnceLock::new();
static SESSION_SEED: AtomicU64 = AtomicU64::new(1);

fn detector() -> &'static Mutex<HazardDetector> {
    DETECTOR.get_or_init(|| Mutex::new(HazardDetector::default()))
}

/// Hash a transient texture identity with the current session seed.
///
/// The caller passes the raw identity only for the duration of hashing; this
/// module never retains or serializes that pointer value.
pub fn hash_texture_identity(raw_identity: usize) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    SESSION_SEED.load(Ordering::Relaxed).hash(&mut hasher);
    raw_identity.hash(&mut hasher);
    hasher.finish()
}

/// Observe one newly owned `(texture identity hash, array index)` pair.
pub fn register_surface(identity_hash: u64, array_index: u32) {
    if let Ok(mut detector) = detector().lock() {
        let key = (identity_hash, array_index);
        if detector.outstanding.contains_key(&key) {
            detector.snapshot.slice_reuse_in_flight = detector
                .snapshot
                .slice_reuse_in_flight
                .saturating_add(1);
        }
        *detector.outstanding.entry(key).or_default() += 1;
        detector.total_outstanding = detector.total_outstanding.saturating_add(1);
        detector.snapshot.handle_outstanding_max = detector
            .snapshot
            .handle_outstanding_max
            .max(detector.total_outstanding);
    }
}

/// Observe release of one previously registered ownership unit.
pub fn release_surface(identity_hash: u64, array_index: u32) {
    if let Ok(mut detector) = detector().lock() {
        let key = (identity_hash, array_index);
        if let Some(count) = detector.outstanding.get_mut(&key) {
            *count -= 1;
            if *count == 0 {
                detector.outstanding.remove(&key);
            }
            detector.total_outstanding = detector.total_outstanding.saturating_sub(1);
        }
    }
}

/// Record the observed lookahead step without changing the lookahead policy.
pub fn record_lookahead_depth(depth: u64) {
    if let Ok(mut detector) = detector().lock() {
        detector.snapshot.lookahead_depth_max = detector.snapshot.lookahead_depth_max.max(depth);
    }
}

pub fn snapshot() -> DxgiHazardSnapshot {
    detector()
        .lock()
        .map(|detector| detector.snapshot)
        .unwrap_or_default()
}

/// Reset the detector and rotate the per-session identity seed.
pub fn reset() {
    if let Ok(mut detector) = detector().lock() {
        *detector = HazardDetector::default();
    }
    SESSION_SEED.fetch_add(1, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn shared_surface_ownership_releases_only_after_last_duplicate_drops() {
        reset();
        let identity = hash_texture_identity(0x5678);
        let ownership = Arc::new(register_surface(identity, 4));
        let duplicate = Arc::clone(&ownership);

        drop(duplicate);
        assert_eq!(outstanding_count(identity, 4), 1);

        drop(ownership);
        assert_eq!(outstanding_count(identity, 4), 0);
        reset();
    }

    #[test]
    fn detects_reuse_while_slice_is_still_outstanding_and_releases_cleanly() {
        reset();
        let identity = hash_texture_identity(0x1234);
        register_surface(identity, 3);
        register_surface(identity, 3);
        record_lookahead_depth(4);

        let during = snapshot();
        assert_eq!(during.slice_reuse_in_flight, 1);
        assert_eq!(during.handle_outstanding_max, 2);
        assert_eq!(during.lookahead_depth_max, 4);

        release_surface(identity, 3);
        release_surface(identity, 3);
        assert_eq!(snapshot().handle_outstanding_max, 2);
        reset();
        assert_eq!(snapshot(), DxgiHazardSnapshot::default());
    }
}
