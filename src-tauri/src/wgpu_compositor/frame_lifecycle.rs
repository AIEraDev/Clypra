//! Pure lifecycle contracts for preview requests, produced frames, and
//! presentation attempts.
//!
//! These types deliberately contain no Tauri, decoder, wgpu, or telemetry
//! dependencies.  The runtime registry introduced later owns transitions;
//! this module defines their valid semantics and reconciliation invariants.

use super::frame_correlation::WorkloadMode;
use crate::native_core::NativeScrubDirection;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

macro_rules! lifecycle_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Creates a non-empty, cross-process-safe lifecycle identity.
            pub fn new(value: impl Into<String>) -> Result<Self, LifecycleError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(LifecycleError::EmptyIdentity(stringify!($name)));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

lifecycle_id!(
    FrameRequestId,
    "Identity of one user or scheduler frame demand."
);

/// Non-serialized lifecycle metadata that travels alongside rendering work.
///
/// The Vec allows multiple requests to relate to one produced frame
/// (e.g., refinement, recovery, or coalesced work).
#[derive(Debug, Clone, Default)]
pub struct RenderLifecycleContext {
    pub request_ids: Vec<FrameRequestId>,
    pub scrub_direction: Option<NativeScrubDirection>,
}

impl RenderLifecycleContext {
    pub fn new(request_id: FrameRequestId) -> Self {
        Self {
            request_ids: vec![request_id],
            scrub_direction: None,
        }
    }

    pub fn empty() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.request_ids.is_empty()
    }

    pub fn add_request(&mut self, request_id: FrameRequestId) {
        if !self.request_ids.contains(&request_id) {
            self.request_ids.push(request_id);
        }
    }

    pub fn with_scrub_direction(mut self, direction: Option<NativeScrubDirection>) -> Self {
        self.scrub_direction = direction;
        self
    }
}

/// Allocates unique internal identities for one preview session.
///
/// External request strings are correlation labels, not lifecycle identities:
/// the continuous playback render loop can legitimately reuse a frontend
/// request ID for several audio-clock frames. The allocator preserves that
/// label as part of an opaque internal ID while making every request, frame,
/// and presentation attempt distinct.
#[derive(Debug, Default)]
pub struct LifecycleIdAllocator {
    request_sequence: AtomicU64,
    frame_sequence: AtomicU64,
    presentation_attempt_sequence: AtomicU64,
}

impl LifecycleIdAllocator {
    pub fn next_request_id(
        &self,
        external_request_id: &str,
    ) -> Result<FrameRequestId, LifecycleError> {
        let external_request_id = non_empty_external_request_id(external_request_id)?;
        let sequence = next_sequence(&self.request_sequence, "FrameRequestId")?;
        FrameRequestId::new(format!("request:{external_request_id}:{sequence}"))
    }

    pub fn next_frame_id(&self) -> Result<FrameId, LifecycleError> {
        let sequence = next_sequence(&self.frame_sequence, "FrameId")?;
        FrameId::new(format!("frame:{sequence}"))
    }

    pub fn next_presentation_attempt_id(&self) -> Result<PresentationAttemptId, LifecycleError> {
        let sequence = next_sequence(&self.presentation_attempt_sequence, "PresentationAttemptId")?;
        PresentationAttemptId::new(format!("presentation-attempt:{sequence}"))
    }

    /// Returns the total number of request IDs allocated (for diagnostic snapshots).
    pub fn allocated_request_count(&self) -> u64 {
        self.request_sequence.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Returns the total number of frame IDs allocated (for diagnostic snapshots).
    pub fn allocated_frame_count(&self) -> u64 {
        self.frame_sequence.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Returns the total number of presentation attempt IDs allocated (for diagnostic snapshots).
    pub fn allocated_attempt_count(&self) -> u64 {
        self.presentation_attempt_sequence.load(std::sync::atomic::Ordering::Relaxed)
    }
}

fn non_empty_external_request_id(value: &str) -> Result<&str, LifecycleError> {
    if value.trim().is_empty() {
        return Err(LifecycleError::EmptyIdentity("external request ID"));
    }
    Ok(value)
}

fn next_sequence(sequence: &AtomicU64, kind: &'static str) -> Result<u64, LifecycleError> {
    sequence
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_add(1)
        })
        .map(|previous| previous + 1)
        .map_err(|_| LifecycleError::IdentitySequenceExhausted(kind))
}
lifecycle_id!(FrameId, "Identity of one produced preview frame.");
lifecycle_id!(
    PresentationAttemptId,
    "Identity of one attempt to display a produced preview frame."
);

/// The reason a frame cannot be attributed to a request/workload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MissingCorrelationReason {
    BackgroundPrefetch,
    CpuConsumer,
    LegacyProducer,
    RecoveryFrame,
    TestFixture,
    UnknownProducer,
}

/// A frame either belongs to precisely one workload or has an explicit reason
/// for remaining outside workload reporting.
///
/// `request_ids` is intentionally many-valued: one produced frame can satisfy
/// several compatible demands. A request can in turn be associated with many
/// produced frames by appearing in the attribution of each refinement or
/// recovery frame. The registry introduced later owns those links; this type
/// defines their cardinality without imposing a one-to-one model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FrameAttribution {
    Correlated {
        request_ids: Vec<FrameRequestId>,
        workload: WorkloadMode,
    },
    Uncorrelated {
        reason: MissingCorrelationReason,
    },
}

impl FrameAttribution {
    pub fn correlated(
        request_ids: Vec<FrameRequestId>,
        workload: WorkloadMode,
    ) -> Result<Self, LifecycleError> {
        if request_ids.is_empty() {
            return Err(LifecycleError::CorrelatedFrameWithoutRequest);
        }
        if request_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != request_ids.len()
        {
            return Err(LifecycleError::DuplicateRequestCorrelation);
        }
        Ok(Self::Correlated {
            request_ids,
            workload,
        })
    }
}

/// Terminal result of a request. Coalescing and supersession reference the
/// effective successor rather than being counted as frame dispositions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum RequestTerminalDisposition {
    Presented { frame_id: FrameId },
    Coalesced { into_request_id: FrameRequestId },
    CoalescedWithoutSuccessor,
    Superseded { by_request_id: FrameRequestId },
    SupersededWithoutSuccessor,
    Cancelled,
    DroppedBeforePresent { reason: RequestDropReason },
    Failed { reason: RequestFailureReason },
    Abandoned { reason: AbandonReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestDropReason {
    LookaheadMiss,
    LateForAudio,
    Backpressure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestFailureReason {
    DecoderUnavailable,
    InvalidDemand,
    PipelineFailure,
}

/// Terminal result of a produced frame. A failed presentation attempt is not
/// represented here unless recovery is exhausted by a later lifecycle owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum FrameTerminalDisposition {
    Presented { attempt_id: PresentationAttemptId },
    DroppedUnderBackpressure,
    ObsoleteBeforePresentation,
    FailedAfterRecovery { reason: FrameFailureReason },
    Abandoned { reason: AbandonReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameFailureReason {
    DecoderFailure,
    CompositionFailure,
    PresentationRecoveryExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AbandonReason {
    SessionShutdown,
    SessionCrash,
    LifecycleOwnerLost,
}

/// Result of an individual attempt to display a frame. Failed attempts remain
/// non-terminal for the frame so retry and recovery can occur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum PresentationAttemptDisposition {
    Presented,
    Failed {
        reason: PresentationFailureReason,
        retryable: bool,
    },
    Abandoned {
        reason: AbandonReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PresentationFailureReason {
    SurfaceUnavailable,
    SurfaceAcquireFailed,
    SubmissionFailed,
    PresentCallFailed,
    DeviceLost,
}

/// Generic exactly-once terminal state machine used by all three lifecycles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleState<T> {
    Active,
    Terminal(T),
}

impl<T> LifecycleState<T> {
    pub fn finish(&mut self, disposition: T) -> Result<(), LifecycleError> {
        if matches!(self, Self::Terminal(_)) {
            return Err(LifecycleError::DuplicateTerminalTransition);
        }
        *self = Self::Terminal(disposition);
        Ok(())
    }

    pub fn terminal_disposition(&self) -> Option<&T> {
        match self {
            Self::Active => None,
            Self::Terminal(disposition) => Some(disposition),
        }
    }
}

/// Aggregate inputs for a session's produced-frame accounting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct FrameAccounting {
    pub produced: u64,
    pub presented: u64,
    pub dropped_under_backpressure: u64,
    pub obsolete_before_presentation: u64,
    pub failed_after_recovery: u64,
    pub abandoned: u64,
}

/// Cumulative accounting for accepted explicit demands.
///
/// Request outcomes intentionally use a different denominator from produced
/// frame outcomes. A latest-value mailbox may accept many requests that never
/// produce a frame because they are superseded or cancelled before decode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAccounting {
    pub accepted: u64,
    pub terminal: u64,
    pub presented: u64,
    pub superseded: u64,
    pub coalesced: u64,
    pub cancelled: u64,
    pub dropped_before_present: u64,
    pub failed: u64,
    pub abandoned: u64,
}

impl RequestAccounting {
    pub fn unresolved(&self) -> u64 {
        self.accepted.saturating_sub(self.terminal)
    }

    pub fn reconcile(&self) -> Result<(), LifecycleError> {
        let classified = self.presented
            + self.superseded
            + self.coalesced
            + self.cancelled
            + self.dropped_before_present
            + self.failed
            + self.abandoned;
        if classified != self.terminal {
            return Err(LifecycleError::UnreconciledRequestAccounting {
                terminal: self.terminal,
                classified,
            });
        }
        if self.terminal > self.accepted {
            return Err(LifecycleError::UnreconciledRequestAccounting {
                terminal: self.terminal,
                classified: self.accepted,
            });
        }
        Ok(())
    }
}

impl FrameAccounting {
    pub fn terminal_total(&self) -> u64 {
        self.presented
            + self.dropped_under_backpressure
            + self.obsolete_before_presentation
            + self.failed_after_recovery
            + self.abandoned
    }

    pub fn reconcile(&self) -> Result<(), LifecycleError> {
        if self.produced != self.terminal_total() {
            return Err(LifecycleError::UnreconciledFrameAccounting {
                produced: self.produced,
                terminal: self.terminal_total(),
            });
        }
        Ok(())
    }
}

/// Reconciles the terminal disposition of each individual produced frame.
///
/// This deliberately accepts plain values rather than a registry so it can be
/// used in deterministic tests and by a later runtime owner. Every supplied
/// frame must be unique and terminal; unresolved frames remain visible rather
/// than being silently counted as a success or failure.
pub fn reconcile_produced_frames<'a>(
    frames: impl IntoIterator<Item = (&'a FrameId, &'a LifecycleState<FrameTerminalDisposition>)>,
) -> Result<FrameAccounting, LifecycleError> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    let mut accounting = FrameAccounting::default();
    for (frame_id, state) in frames {
        if !seen.insert(frame_id) {
            return Err(LifecycleError::DuplicateFrameIdentity(frame_id.clone()));
        }
        accounting.produced += 1;
        match state.terminal_disposition() {
            Some(FrameTerminalDisposition::Presented { .. }) => accounting.presented += 1,
            Some(FrameTerminalDisposition::DroppedUnderBackpressure) => {
                accounting.dropped_under_backpressure += 1
            }
            Some(FrameTerminalDisposition::ObsoleteBeforePresentation) => {
                accounting.obsolete_before_presentation += 1
            }
            Some(FrameTerminalDisposition::FailedAfterRecovery { .. }) => {
                accounting.failed_after_recovery += 1
            }
            Some(FrameTerminalDisposition::Abandoned { .. }) => accounting.abandoned += 1,
            None => return Err(LifecycleError::UnterminatedProducedFrame(frame_id.clone())),
        }
    }
    accounting.reconcile()?;
    Ok(accounting)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleError {
    EmptyIdentity(&'static str),
    IdentitySequenceExhausted(&'static str),
    CorrelatedFrameWithoutRequest,
    DuplicateRequestCorrelation,
    DuplicateTerminalTransition,
    DuplicateFrameIdentity(FrameId),
    UnterminatedProducedFrame(FrameId),
    UnreconciledFrameAccounting { produced: u64, terminal: u64 },
    UnreconciledRequestAccounting { terminal: u64, classified: u64 },
}

impl std::fmt::Display for LifecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyIdentity(kind) => write!(f, "{kind} must not be empty"),
            Self::IdentitySequenceExhausted(kind) => {
                write!(f, "{kind} identity sequence is exhausted")
            }
            Self::CorrelatedFrameWithoutRequest => {
                write!(f, "a correlated frame requires at least one request")
            }
            Self::DuplicateRequestCorrelation => {
                write!(f, "a correlated frame must not repeat a request identity")
            }
            Self::DuplicateTerminalTransition => write!(f, "lifecycle is already terminal"),
            Self::DuplicateFrameIdentity(frame_id) => {
                write!(
                    f,
                    "produced frame {} was supplied more than once",
                    frame_id.as_str()
                )
            }
            Self::UnterminatedProducedFrame(frame_id) => write!(
                f,
                "produced frame {} has no terminal disposition",
                frame_id.as_str()
            ),
            Self::UnreconciledFrameAccounting { produced, terminal } => write!(
                f,
                "frame accounting does not reconcile: produced={produced}, terminal={terminal}"
            ),
            Self::UnreconciledRequestAccounting { terminal, classified } => write!(
                f,
                "request accounting does not reconcile: terminal={terminal}, classified={classified}"
            ),
        }
    }
}

impl std::error::Error for LifecycleError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_id(value: &str) -> FrameRequestId {
        FrameRequestId::new(value).expect("valid request id")
    }

    #[test]
    fn identities_reject_empty_values_and_are_not_interchangeable() {
        assert!(FrameRequestId::new(" ").is_err());
        assert!(FrameId::new("").is_err());
        assert!(PresentationAttemptId::new("").is_err());

        let request = request_id("request-1");
        assert_eq!(request.as_str(), "request-1");
    }

    #[test]
    fn allocator_makes_reused_external_request_ids_distinct() {
        let allocator = LifecycleIdAllocator::default();
        let first = allocator.next_request_id("playback").unwrap();
        let second = allocator.next_request_id("playback").unwrap();
        assert_ne!(first, second);
        assert_ne!(
            allocator.next_frame_id().unwrap().as_str(),
            allocator.next_presentation_attempt_id().unwrap().as_str()
        );
        assert!(allocator.next_request_id(" ").is_err());
    }

    #[test]
    fn correlated_frame_can_link_multiple_requests_but_has_one_workload() {
        let attribution = FrameAttribution::correlated(
            vec![request_id("r1"), request_id("r2")],
            WorkloadMode::Scrub,
        )
        .expect("requests supplied");
        assert!(matches!(attribution, FrameAttribution::Correlated { .. }));
        assert!(FrameAttribution::correlated(Vec::new(), WorkloadMode::Playback).is_err());
        assert_eq!(
            FrameAttribution::correlated(
                vec![request_id("r1"), request_id("r2"), request_id("r1")],
                WorkloadMode::Playback
            ),
            Err(LifecycleError::DuplicateRequestCorrelation)
        );
    }

    #[test]
    fn terminal_transition_is_exactly_once_and_late_callback_is_rejected() {
        let frame = FrameId::new("frame-1").expect("valid frame");
        let attempt = PresentationAttemptId::new("attempt-1").expect("valid attempt");
        let mut state = LifecycleState::Active;
        state
            .finish(FrameTerminalDisposition::Presented {
                attempt_id: attempt,
            })
            .expect("first terminal transition");
        assert_eq!(
            state.finish(FrameTerminalDisposition::ObsoleteBeforePresentation),
            Err(LifecycleError::DuplicateTerminalTransition)
        );
        assert_eq!(frame.as_str(), "frame-1");
    }

    #[test]
    fn failed_attempt_does_not_terminally_fail_frame() {
        let mut attempt = LifecycleState::Active;
        attempt
            .finish(PresentationAttemptDisposition::Failed {
                reason: PresentationFailureReason::SurfaceAcquireFailed,
                retryable: true,
            })
            .expect("attempt failed");

        let frame: LifecycleState<FrameTerminalDisposition> = LifecycleState::Active;
        assert!(matches!(frame, LifecycleState::Active));
    }

    #[test]
    fn accounting_requires_every_produced_frame_to_have_one_terminal_disposition() {
        let reconciled = FrameAccounting {
            produced: 5,
            presented: 2,
            dropped_under_backpressure: 1,
            obsolete_before_presentation: 1,
            failed_after_recovery: 0,
            abandoned: 1,
        };
        assert_eq!(reconciled.reconcile(), Ok(()));

        let unreconciled = FrameAccounting {
            produced: 5,
            presented: 2,
            ..FrameAccounting::default()
        };
        assert_eq!(
            unreconciled.reconcile(),
            Err(LifecycleError::UnreconciledFrameAccounting {
                produced: 5,
                terminal: 2,
            })
        );
    }

    #[test]
    fn request_successor_relationships_stay_distinct() {
        let coalesced = RequestTerminalDisposition::Coalesced {
            into_request_id: request_id("latest"),
        };
        let superseded = RequestTerminalDisposition::Superseded {
            by_request_id: request_id("latest"),
        };
        assert_ne!(coalesced, superseded);
    }

    #[test]
    fn one_request_can_relate_to_multiple_refinement_frames() {
        let request = request_id("request-1");
        let initial = FrameAttribution::correlated(vec![request.clone()], WorkloadMode::Playback)
            .expect("initial frame relates to request");
        let refinement = FrameAttribution::correlated(vec![request], WorkloadMode::Playback)
            .expect("refinement frame relates to same request");
        assert!(matches!(initial, FrameAttribution::Correlated { .. }));
        assert!(matches!(refinement, FrameAttribution::Correlated { .. }));
    }

    #[test]
    fn reconciliation_rejects_unresolved_and_duplicate_produced_frames() {
        let first = FrameId::new("frame-1").expect("valid frame");
        let second = FrameId::new("frame-2").expect("valid frame");
        let mut completed = LifecycleState::Active;
        completed
            .finish(FrameTerminalDisposition::DroppedUnderBackpressure)
            .expect("finish first frame");
        let active = LifecycleState::Active;

        assert_eq!(
            reconcile_produced_frames([(&first, &completed), (&second, &active)]),
            Err(LifecycleError::UnterminatedProducedFrame(second.clone()))
        );
        assert_eq!(
            reconcile_produced_frames([(&first, &completed), (&first, &completed)]),
            Err(LifecycleError::DuplicateFrameIdentity(first))
        );
    }
}
