//! Frame correlation identifiers for end-to-end latency tracing.
//!
//! # Design
//!
//! A single user interaction (e.g. a scrub gesture) is called an **operation**.
//! An operation emits one or more **frame requests**; Clypra may coalesce several
//! requests into one presented frame, supersede earlier requests with later ones,
//! or cancel requests entirely.
//!
//! This module provides two separate correlation structs that capture both sides:
//!
//! - [`FrameRequestCorrelation`] — per-request identity; measured by the frontend.
//! - [`FrameOutputCorrelation`] — per-frame-output identity; measured by the Rust
//!   command layer and carried in [`FrameTelemetry`].
//!
//! A bounded [`FrameRequestOutcome`] enum links request IDs to the frame output (or
//! the reason a frame was not produced).
//!
//! # String IDs
//!
//! All IDs use `String` rather than a numeric type so they remain JS-safe (no 53-bit
//! integer overflow) and can be passed verbatim through the Tauri IPC boundary.
//! In practice they are decimal strings from monotonic `u64` counters.
//!
//! # WorkloadMode
//!
//! [`WorkloadMode`] must derive [`Hash`] because [`SessionTelemetry`] uses it as a
//! `HashMap` key for per-workload buckets.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// WorkloadMode
// ---------------------------------------------------------------------------

/// The workload type that produced or requested a frame.
///
/// Used as a `HashMap` key in `SessionTelemetry` workload buckets, so `Hash`
/// is required.  Deadline semantics are workload-specific — see the contract
/// for per-variant policies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkloadMode {
    /// Continuous playback at the clip frame rate.
    ///
    /// Deadline policy: `present_by` from `FrameDeadline`.
    Playback,
    /// User is interacting (e.g. parameter change) while the timeline is paused.
    ///
    /// Deadline policy: 200 ms.
    PausedInteraction,
    /// Seek with cold decoder state (keyframe distance > warm threshold).
    ///
    /// Deadline policy: 500 ms.
    SeekCold,
    /// Seek with warm decoder state (keyframe already decoded/cached).
    ///
    /// Deadline policy: 100 ms.
    SeekWarm,
    /// Rapid pointer or keyboard scrub.
    ///
    /// Deadline policy: 50 ms.
    Scrub,
    /// Single-frame step (← / →).
    ///
    /// Deadline policy: 100 ms.
    FrameStep,
}

// ---------------------------------------------------------------------------
// FrameRequestCorrelation
// ---------------------------------------------------------------------------

/// Per-request correlation identity emitted by the frontend at invoke time.
///
/// The frontend measures `frontend_request_to_response_us` using this ID to
/// correlate its JavaScript `performance.now()` timestamps.
///
/// Note: `request_id` is unique per IPC call; `operation_id` groups all
/// requests belonging to one logical user action (e.g. one scrub gesture).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRequestCorrelation {
    /// Groups all requests belonging to one logical user action.
    /// Decimal string; JS-safe.
    pub operation_id: String,
    /// Unique per IPC call.  Decimal string; JS-safe.
    pub request_id: String,
}

// ---------------------------------------------------------------------------
// FrameOutputCorrelation
// ---------------------------------------------------------------------------

/// Per-frame-output correlation identity carried in [`FrameTelemetry`].
///
/// Rust measures `command_entry_to_present_enqueue_us` using this ID.  The
/// `operation_id` links back to the originating [`FrameRequestCorrelation`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameOutputCorrelation {
    /// Groups all outputs belonging to one logical user action.
    /// Decimal string; JS-safe.
    pub operation_id: String,
    /// Monotonic frame sequence number for this output frame.
    /// Decimal string; JS-safe.
    pub frame_sequence: String,
    /// The workload type that produced this frame.
    pub workload: WorkloadMode,
}

// ---------------------------------------------------------------------------
// FrameRequestOutcome
// ---------------------------------------------------------------------------

/// Bounded outcome classification linking a request ID to its result.
///
/// Emitted alongside `FrameOutputCorrelation` to explain the relationship
/// between individual requests and the resulting (or missing) frame output.
///
/// # Scrub coalescing vs dropped frames
///
/// `CoalescedInto` distinguishes intentional scrub coalescing (Clypra
/// combined N requests into one frame) from `Dropped` (a frame was produced
/// but discarded under scheduler pressure).  These must NOT be conflated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum FrameRequestOutcome {
    /// A frame was presented for this request.
    Presented {
        /// The `frame_sequence` of the presented output frame.
        frame_sequence: String,
    },
    /// This request was merged into an existing in-flight frame.
    CoalescedInto {
        /// The `frame_sequence` of the frame that absorbed this request.
        frame_sequence: String,
    },
    /// A later request replaced this one before decoding began.
    Superseded,
    /// This request was cancelled (e.g. clip closed, session reset).
    Cancelled,
    /// A frame was produced but was discarded under scheduler backpressure.
    Dropped,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workload_mode_is_hashable() {
        use std::collections::HashMap;
        let mut map: HashMap<WorkloadMode, u64> = HashMap::new();
        map.insert(WorkloadMode::Playback, 1);
        map.insert(WorkloadMode::Scrub, 2);
        assert_eq!(map[&WorkloadMode::Playback], 1);
        assert_eq!(map[&WorkloadMode::Scrub], 2);
    }

    #[test]
    fn all_workload_modes_serialize_round_trip() {
        let modes = [
            WorkloadMode::Playback,
            WorkloadMode::PausedInteraction,
            WorkloadMode::SeekCold,
            WorkloadMode::SeekWarm,
            WorkloadMode::Scrub,
            WorkloadMode::FrameStep,
        ];
        for mode in &modes {
            let json = serde_json::to_string(mode).expect("serialize");
            let back: WorkloadMode = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(*mode, back);
        }
    }

    #[test]
    fn frame_request_outcome_coalesced_vs_dropped_are_distinct() {
        let coalesced = FrameRequestOutcome::CoalescedInto {
            frame_sequence: "42".to_string(),
        };
        let dropped = FrameRequestOutcome::Dropped;
        assert_ne!(coalesced, dropped);
    }

    #[test]
    fn frame_output_correlation_round_trips() {
        let corr = FrameOutputCorrelation {
            operation_id: "1001".to_string(),
            frame_sequence: "42".to_string(),
            workload: WorkloadMode::Scrub,
        };
        let json = serde_json::to_string(&corr).expect("serialize");
        let back: FrameOutputCorrelation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(corr, back);
    }
}
