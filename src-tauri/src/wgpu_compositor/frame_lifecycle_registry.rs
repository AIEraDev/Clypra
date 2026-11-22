//! Ephemeral ownership of request, produced-frame, and presentation-attempt
//! lifecycles.
//!
//! This registry deliberately has no synchronization primitive or runtime
//! dependency. Its caller owns the registry and provides synchronization at
//! the pipeline boundary that already establishes lifecycle ownership. That
//! keeps the contract deterministic and prevents a second global scheduler
//! from being introduced into preview rendering.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use super::frame_lifecycle::{
    reconcile_produced_frames, AbandonReason, FrameAccounting, FrameAttribution, FrameId,
    FrameRequestId, FrameTerminalDisposition, LifecycleError, LifecycleIdAllocator, LifecycleState,
    PresentationAttemptDisposition, PresentationAttemptId, RequestAccounting,
    RequestTerminalDisposition,
};
use serde::Serialize;

#[derive(Debug, Default)]
pub struct FrameLifecycleRegistry {
    ids: LifecycleIdAllocator,
    requests: HashMap<FrameRequestId, LifecycleState<RequestTerminalDisposition>>,
    frames: HashMap<FrameId, RegisteredFrame>,
    attempts: HashMap<PresentationAttemptId, RegisteredPresentationAttempt>,
    terminal_history: VecDeque<TerminalRecord>,
    retention: TerminalHistoryRetentionPolicy,
    cumulative_frame_accounting: FrameAccounting,
    cumulative_request_accounting: RequestAccounting,
}

/// Bounded terminal history policy for one native render session. Active
/// lifecycles are never evicted; identity allocation remains monotonic after
/// historical records leave the registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalHistoryRetentionPolicy {
    pub max_terminal_records: usize,
    pub max_age: Duration,
}

impl Default for TerminalHistoryRetentionPolicy {
    fn default() -> Self {
        Self {
            max_terminal_records: 4_096,
            max_age: Duration::from_secs(5 * 60),
        }
    }
}

#[derive(Debug, Clone)]
enum TerminalRecordKind {
    Request(FrameRequestId),
    Frame(FrameId),
    Attempt(PresentationAttemptId),
}

#[derive(Debug, Clone)]
struct TerminalRecord {
    completed_at: Instant,
    kind: TerminalRecordKind,
}

/// Diagnostic snapshot of registry retention for audit and performance analysis.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySnapshot {
    pub requests_active: usize,
    pub requests_terminal: usize,
    pub requests_total: usize,
    pub frames_active: usize,
    pub frames_terminal: usize,
    pub frames_total: usize,
    pub attempts_active: usize,
    pub attempts_terminal: usize,
    pub attempts_total: usize,
    pub allocated_request_ids: u64,
    pub allocated_frame_ids: u64,
    pub allocated_attempt_ids: u64,
    pub cumulative_frame_accounting: FrameAccounting,
    /// Explicit request outcomes use accepted request IDs as their denominator.
    /// This must never be merged with produced-frame accounting.
    pub request_accounting: RequestAccounting,
    /// Explicit request outcomes use request IDs as their denominator. They
    /// must never be merged with produced-frame accounting.
    pub request_presented: u64,
    pub request_superseded: u64,
    pub request_cancelled: u64,
}

#[derive(Debug)]
struct RegisteredFrame {
    attribution: FrameAttribution,
    state: LifecycleState<FrameTerminalDisposition>,
}

#[derive(Debug)]
struct RegisteredPresentationAttempt {
    frame_id: FrameId,
    state: LifecycleState<PresentationAttemptDisposition>,
}

impl FrameLifecycleRegistry {
    /// Allocates and registers a new internal request identity. The external
    /// request ID is a correlation label and may recur across playback ticks.
    pub fn begin_request(
        &mut self,
        external_request_id: &str,
    ) -> Result<FrameRequestId, RegistryError> {
        let id = self.ids.next_request_id(external_request_id)?;
        self.register_request(id.clone())?;
        Ok(id)
    }

    pub fn register_request(&mut self, id: FrameRequestId) -> Result<(), RegistryError> {
        if self.requests.contains_key(&id) {
            return Err(RegistryError::DuplicateRequest(id));
        }
        self.requests.insert(id, LifecycleState::Active);
        self.cumulative_request_accounting.accepted += 1;
        Ok(())
    }

    /// Registers a produced frame and validates every explicit request link.
    /// Uncorrelated frames remain valid only when their attribution carries an
    /// explicit missing-correlation reason.
    pub fn register_frame(
        &mut self,
        id: FrameId,
        attribution: FrameAttribution,
    ) -> Result<(), RegistryError> {
        if self.frames.contains_key(&id) {
            return Err(RegistryError::DuplicateFrame(id));
        }
        if let FrameAttribution::Correlated { request_ids, .. } = &attribution {
            for request_id in request_ids {
                self.require_request(request_id)?;
            }
        }
        self.frames.insert(
            id,
            RegisteredFrame {
                attribution,
                state: LifecycleState::Active,
            },
        );
        self.cumulative_frame_accounting.produced += 1;
        Ok(())
    }

    /// Allocates and registers one produced-frame identity.
    pub fn begin_frame(&mut self, attribution: FrameAttribution) -> Result<FrameId, RegistryError> {
        let id = self.ids.next_frame_id()?;
        self.register_frame(id.clone(), attribution)?;
        Ok(id)
    }

    /// Registers an individual display attempt for exactly one produced frame.
    pub fn register_presentation_attempt(
        &mut self,
        id: PresentationAttemptId,
        frame_id: FrameId,
    ) -> Result<(), RegistryError> {
        if self.attempts.contains_key(&id) {
            return Err(RegistryError::DuplicatePresentationAttempt(id));
        }
        let frame = self.require_frame(&frame_id)?;
        if !matches!(frame.state, LifecycleState::Active) {
            return Err(RegistryError::PresentationAttemptForTerminalFrame(frame_id));
        }
        self.attempts.insert(
            id,
            RegisteredPresentationAttempt {
                frame_id,
                state: LifecycleState::Active,
            },
        );
        Ok(())
    }

    /// Allocates and registers one presentation attempt for an active frame.
    pub fn begin_presentation_attempt(
        &mut self,
        frame_id: FrameId,
    ) -> Result<PresentationAttemptId, RegistryError> {
        let id = self.ids.next_presentation_attempt_id()?;
        self.register_presentation_attempt(id.clone(), frame_id)?;
        Ok(id)
    }

    pub fn finish_presentation_attempt(
        &mut self,
        id: &PresentationAttemptId,
        disposition: PresentationAttemptDisposition,
    ) -> Result<(), RegistryError> {
        self.require_attempt_mut(id)?.state.finish(disposition)?;
        self.terminal_history.push_back(TerminalRecord {
            completed_at: Instant::now(),
            kind: TerminalRecordKind::Attempt(id.clone()),
        });
        Ok(())
    }

    /// Finishes a frame only after the identified attempt has actually
    /// presented. Failed attempts remain independent terminal lifecycles and
    /// do not alter the frame's state.
    pub fn finish_frame(
        &mut self,
        id: &FrameId,
        disposition: FrameTerminalDisposition,
    ) -> Result<(), RegistryError> {
        if let FrameTerminalDisposition::Presented { attempt_id } = &disposition {
            let attempt = self.require_attempt(attempt_id)?;
            if attempt.frame_id != *id {
                return Err(RegistryError::AttemptBelongsToDifferentFrame {
                    attempt_id: attempt_id.clone(),
                    frame_id: id.clone(),
                });
            }
            if !matches!(
                attempt.state.terminal_disposition(),
                Some(PresentationAttemptDisposition::Presented)
            ) {
                return Err(RegistryError::FramePresentedBeforeAttempt(
                    attempt_id.clone(),
                ));
            }
        }
        self.require_frame_mut(id)?.state.finish(disposition.clone())?;
        self.record_frame_terminal(&disposition);
        self.terminal_history.push_back(TerminalRecord {
            completed_at: Instant::now(),
            kind: TerminalRecordKind::Frame(id.clone()),
        });
        Ok(())
    }

    /// Finishes a request after validating its successor or qualifying frame.
    pub fn finish_request(
        &mut self,
        id: &FrameRequestId,
        disposition: RequestTerminalDisposition,
    ) -> Result<(), RegistryError> {
        match &disposition {
            RequestTerminalDisposition::Presented { frame_id } => {
                let frame = self.require_frame(frame_id)?;
                let FrameAttribution::Correlated { request_ids, .. } = &frame.attribution else {
                    return Err(RegistryError::FrameDoesNotCorrelateToRequest {
                        frame_id: frame_id.clone(),
                        request_id: id.clone(),
                    });
                };
                if !request_ids.iter().any(|request_id| request_id == id) {
                    return Err(RegistryError::FrameDoesNotCorrelateToRequest {
                        frame_id: frame_id.clone(),
                        request_id: id.clone(),
                    });
                }
                if !matches!(
                    frame.state.terminal_disposition(),
                    Some(FrameTerminalDisposition::Presented { .. })
                ) {
                    return Err(RegistryError::RequestPresentedBeforeFrame(frame_id.clone()));
                }
            }
            RequestTerminalDisposition::Coalesced { into_request_id }
            | RequestTerminalDisposition::Superseded {
                by_request_id: into_request_id,
            } => {
                if id == into_request_id {
                    return Err(RegistryError::RequestCannotSucceedItself(id.clone()));
                }
                self.require_request(into_request_id)?;
            }
            RequestTerminalDisposition::CoalescedWithoutSuccessor
            | RequestTerminalDisposition::SupersededWithoutSuccessor => {}
            RequestTerminalDisposition::Cancelled
            | RequestTerminalDisposition::DroppedBeforePresent { .. }
            | RequestTerminalDisposition::Failed { .. }
            | RequestTerminalDisposition::Abandoned { .. } => {}
        }
        self.require_request_mut(id)?.finish(disposition.clone())?;
        self.record_request_terminal(&disposition);
        self.terminal_history.push_back(TerminalRecord {
            completed_at: Instant::now(),
            kind: TerminalRecordKind::Request(id.clone()),
        });
        Ok(())
    }

    /// Converts every still-active lifecycle into an explicit abandoned
    /// disposition. This is intended for session shutdown or ownership loss;
    /// it never reclassifies already-terminal values.
    pub fn abandon_active(&mut self, reason: AbandonReason) {
        for state in self.requests.values_mut() {
            if matches!(state, LifecycleState::Active)
                && state
                    .finish(RequestTerminalDisposition::Abandoned { reason })
                    .is_ok()
            {
                self.cumulative_request_accounting.terminal += 1;
                self.cumulative_request_accounting.abandoned += 1;
            }
        }
        let mut abandoned_frames = 0;
        for frame in self.frames.values_mut() {
            if matches!(frame.state, LifecycleState::Active) {
                let _ = frame
                    .state
                    .finish(FrameTerminalDisposition::Abandoned { reason });
                abandoned_frames += 1;
            }
        }
        self.cumulative_frame_accounting.abandoned += abandoned_frames;
        for attempt in self.attempts.values_mut() {
            if matches!(attempt.state, LifecycleState::Active) {
                let _ = attempt
                    .state
                    .finish(PresentationAttemptDisposition::Abandoned { reason });
            }
        }
    }

    pub fn request_state(
        &self,
        id: &FrameRequestId,
    ) -> Result<&LifecycleState<RequestTerminalDisposition>, RegistryError> {
        self.require_request(id)
    }

    pub fn frame_state(
        &self,
        id: &FrameId,
    ) -> Result<&LifecycleState<FrameTerminalDisposition>, RegistryError> {
        Ok(&self.require_frame(id)?.state)
    }

    pub fn presentation_attempt_state(
        &self,
        id: &PresentationAttemptId,
    ) -> Result<&LifecycleState<PresentationAttemptDisposition>, RegistryError> {
        Ok(&self.require_attempt(id)?.state)
    }

    pub fn frame_attribution(&self, id: &FrameId) -> Result<&FrameAttribution, RegistryError> {
        Ok(&self.require_frame(id)?.attribution)
    }

    /// A request can map to zero, one, or many produced frames.
    pub fn frames_for_request(&self, id: &FrameRequestId) -> Result<Vec<&FrameId>, RegistryError> {
        self.require_request(id)?;
        Ok(self
            .frames
            .iter()
            .filter_map(|(frame_id, frame)| match &frame.attribution {
                FrameAttribution::Correlated { request_ids, .. }
                    if request_ids.iter().any(|request_id| request_id == id) =>
                {
                    Some(frame_id)
                }
                FrameAttribution::Correlated { .. } | FrameAttribution::Uncorrelated { .. } => None,
            })
            .collect())
    }

    pub fn frame_accounting(&self) -> Result<FrameAccounting, RegistryError> {
        Ok(reconcile_produced_frames(
            self.frames
                .iter()
                .map(|(frame_id, frame)| (frame_id, &frame.state)),
        )?)
    }

    /// Session-wide counters survive terminal-history eviction. They are
    /// intentionally separate from `frame_accounting`, which reconciles only
    /// records currently retained by the registry.
    pub fn cumulative_frame_accounting(&self) -> FrameAccounting {
        self.cumulative_frame_accounting
    }

    pub fn set_terminal_history_retention(&mut self, retention: TerminalHistoryRetentionPolicy) {
        self.retention = retention;
    }

    /// Evicts only terminal records that exceed either the configured age or
    /// count bound. Unknown IDs from late callbacks remain rejected; no record
    /// is recreated after eviction.
    pub fn prune_terminal_history(&mut self, now: Instant) {
        while self.terminal_history.front().is_some_and(|record| {
            now.saturating_duration_since(record.completed_at) >= self.retention.max_age
                || self.terminal_history.len() > self.retention.max_terminal_records
        }) {
            let Some(record) = self.terminal_history.pop_front() else {
                break;
            };
            match record.kind {
                TerminalRecordKind::Request(id) => {
                    if matches!(self.requests.get(&id), Some(LifecycleState::Terminal(_))) {
                        self.requests.remove(&id);
                    }
                }
                TerminalRecordKind::Frame(id) => {
                    if matches!(self.frames.get(&id), Some(RegisteredFrame { state: LifecycleState::Terminal(_), .. })) {
                        self.frames.remove(&id);
                    }
                }
                TerminalRecordKind::Attempt(id) => {
                    if matches!(self.attempts.get(&id), Some(RegisteredPresentationAttempt { state: LifecycleState::Terminal(_), .. })) {
                        self.attempts.remove(&id);
                    }
                }
            }
        }
    }

    /// Captures a diagnostic snapshot of registry retention for audit and performance analysis.
    /// This is a lightweight operation that counts active vs terminal entries without deep inspection.
    pub fn diagnostic_snapshot(&self) -> RegistrySnapshot {
        let mut requests_active = 0;
        let mut requests_terminal = 0;
        let mut request_presented = 0;
        let mut request_superseded = 0;
        let mut request_cancelled = 0;
        for state in self.requests.values() {
            match state {
                LifecycleState::Active => requests_active += 1,
                LifecycleState::Terminal(disposition) => {
                    requests_terminal += 1;
                    match disposition {
                        RequestTerminalDisposition::Presented { .. } => request_presented += 1,
                        RequestTerminalDisposition::Superseded { .. } => request_superseded += 1,
                        RequestTerminalDisposition::Cancelled => request_cancelled += 1,
                        RequestTerminalDisposition::Coalesced { .. }
                        | RequestTerminalDisposition::CoalescedWithoutSuccessor
                        | RequestTerminalDisposition::DroppedBeforePresent { .. }
                        | RequestTerminalDisposition::Failed { .. }
                        | RequestTerminalDisposition::Abandoned { .. } => {}
                        RequestTerminalDisposition::SupersededWithoutSuccessor => {
                            request_superseded += 1
                        }
                    }
                }
            }
        }

        let mut frames_active = 0;
        let mut frames_terminal = 0;
        for frame in self.frames.values() {
            match frame.state {
                LifecycleState::Active => frames_active += 1,
                LifecycleState::Terminal(_) => frames_terminal += 1,
            }
        }

        let mut attempts_active = 0;
        let mut attempts_terminal = 0;
        for attempt in self.attempts.values() {
            match attempt.state {
                LifecycleState::Active => attempts_active += 1,
                LifecycleState::Terminal(_) => attempts_terminal += 1,
            }
        }

        RegistrySnapshot {
            requests_active,
            requests_terminal,
            requests_total: self.requests.len(),
            frames_active,
            frames_terminal,
            frames_total: self.frames.len(),
            attempts_active,
            attempts_terminal,
            attempts_total: self.attempts.len(),
            allocated_request_ids: self.ids.allocated_request_count(),
            allocated_frame_ids: self.ids.allocated_frame_count(),
            allocated_attempt_ids: self.ids.allocated_attempt_count(),
            cumulative_frame_accounting: self.cumulative_frame_accounting,
            request_accounting: self.cumulative_request_accounting,
            request_presented,
            request_superseded,
            request_cancelled,
        }
    }

    fn require_request(
        &self,
        id: &FrameRequestId,
    ) -> Result<&LifecycleState<RequestTerminalDisposition>, RegistryError> {
        self.requests
            .get(id)
            .ok_or_else(|| RegistryError::UnknownRequest(id.clone()))
    }

    /// Find the active lifecycle allocated for a unique external operation ID.
    /// Exact interactive demands use a fresh operation ID, while continuous
    /// playback ticks intentionally never register here.
    pub fn active_request_for_external_id(
        &self,
        external_request_id: &str,
    ) -> Option<FrameRequestId> {
        let prefix = format!("request:{external_request_id}:");
        self.requests.iter().find_map(|(id, state)| {
            (id.as_str().starts_with(&prefix) && matches!(state, LifecycleState::Active))
                .then(|| id.clone())
        })
    }

    fn record_frame_terminal(&mut self, disposition: &FrameTerminalDisposition) {
        match disposition {
            FrameTerminalDisposition::Presented { .. } => self.cumulative_frame_accounting.presented += 1,
            FrameTerminalDisposition::DroppedUnderBackpressure => self.cumulative_frame_accounting.dropped_under_backpressure += 1,
            FrameTerminalDisposition::ObsoleteBeforePresentation => self.cumulative_frame_accounting.obsolete_before_presentation += 1,
            FrameTerminalDisposition::FailedAfterRecovery { .. } => self.cumulative_frame_accounting.failed_after_recovery += 1,
            FrameTerminalDisposition::Abandoned { .. } => self.cumulative_frame_accounting.abandoned += 1,
        }
    }

    fn record_request_terminal(&mut self, disposition: &RequestTerminalDisposition) {
        self.cumulative_request_accounting.terminal += 1;
        match disposition {
            RequestTerminalDisposition::Presented { .. } => {
                self.cumulative_request_accounting.presented += 1
            }
            RequestTerminalDisposition::Coalesced { .. } => {
                self.cumulative_request_accounting.coalesced += 1
            }
            RequestTerminalDisposition::CoalescedWithoutSuccessor => {
                self.cumulative_request_accounting.coalesced += 1
            }
            RequestTerminalDisposition::Superseded { .. } => {
                self.cumulative_request_accounting.superseded += 1
            }
            RequestTerminalDisposition::SupersededWithoutSuccessor => {
                self.cumulative_request_accounting.superseded += 1
            }
            RequestTerminalDisposition::Cancelled => {
                self.cumulative_request_accounting.cancelled += 1
            }
            RequestTerminalDisposition::DroppedBeforePresent { .. } => {
                self.cumulative_request_accounting.dropped_before_present += 1
            }
            RequestTerminalDisposition::Failed { .. } => {
                self.cumulative_request_accounting.failed += 1
            }
            RequestTerminalDisposition::Abandoned { .. } => {
                self.cumulative_request_accounting.abandoned += 1
            }
        }
    }

    fn require_request_mut(
        &mut self,
        id: &FrameRequestId,
    ) -> Result<&mut LifecycleState<RequestTerminalDisposition>, RegistryError> {
        self.requests
            .get_mut(id)
            .ok_or_else(|| RegistryError::UnknownRequest(id.clone()))
    }

    fn require_frame(&self, id: &FrameId) -> Result<&RegisteredFrame, RegistryError> {
        self.frames
            .get(id)
            .ok_or_else(|| RegistryError::UnknownFrame(id.clone()))
    }

    fn require_frame_mut(&mut self, id: &FrameId) -> Result<&mut RegisteredFrame, RegistryError> {
        self.frames
            .get_mut(id)
            .ok_or_else(|| RegistryError::UnknownFrame(id.clone()))
    }

    fn require_attempt(
        &self,
        id: &PresentationAttemptId,
    ) -> Result<&RegisteredPresentationAttempt, RegistryError> {
        self.attempts
            .get(id)
            .ok_or_else(|| RegistryError::UnknownPresentationAttempt(id.clone()))
    }

    fn require_attempt_mut(
        &mut self,
        id: &PresentationAttemptId,
    ) -> Result<&mut RegisteredPresentationAttempt, RegistryError> {
        self.attempts
            .get_mut(id)
            .ok_or_else(|| RegistryError::UnknownPresentationAttempt(id.clone()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    DuplicateRequest(FrameRequestId),
    DuplicateFrame(FrameId),
    DuplicatePresentationAttempt(PresentationAttemptId),
    UnknownRequest(FrameRequestId),
    UnknownFrame(FrameId),
    UnknownPresentationAttempt(PresentationAttemptId),
    RequestCannotSucceedItself(FrameRequestId),
    AttemptBelongsToDifferentFrame {
        attempt_id: PresentationAttemptId,
        frame_id: FrameId,
    },
    FramePresentedBeforeAttempt(PresentationAttemptId),
    RequestPresentedBeforeFrame(FrameId),
    PresentationAttemptForTerminalFrame(FrameId),
    FrameDoesNotCorrelateToRequest {
        frame_id: FrameId,
        request_id: FrameRequestId,
    },
    Lifecycle(LifecycleError),
}

impl From<LifecycleError> for RegistryError {
    fn from(value: LifecycleError) -> Self {
        Self::Lifecycle(value)
    }
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateRequest(id) => {
                write!(f, "request {} is already registered", id.as_str())
            }
            Self::DuplicateFrame(id) => write!(f, "frame {} is already registered", id.as_str()),
            Self::DuplicatePresentationAttempt(id) => {
                write!(
                    f,
                    "presentation attempt {} is already registered",
                    id.as_str()
                )
            }
            Self::UnknownRequest(id) => write!(f, "request {} is not registered", id.as_str()),
            Self::UnknownFrame(id) => write!(f, "frame {} is not registered", id.as_str()),
            Self::UnknownPresentationAttempt(id) => {
                write!(f, "presentation attempt {} is not registered", id.as_str())
            }
            Self::RequestCannotSucceedItself(id) => {
                write!(
                    f,
                    "request {} cannot name itself as its successor",
                    id.as_str()
                )
            }
            Self::AttemptBelongsToDifferentFrame {
                attempt_id,
                frame_id,
            } => write!(
                f,
                "presentation attempt {} does not belong to frame {}",
                attempt_id.as_str(),
                frame_id.as_str()
            ),
            Self::FramePresentedBeforeAttempt(id) => write!(
                f,
                "frame cannot be presented before attempt {} presents",
                id.as_str()
            ),
            Self::RequestPresentedBeforeFrame(id) => write!(
                f,
                "request cannot be presented before frame {} presents",
                id.as_str()
            ),
            Self::PresentationAttemptForTerminalFrame(id) => write!(
                f,
                "presentation attempt cannot be registered for terminal frame {}",
                id.as_str()
            ),
            Self::FrameDoesNotCorrelateToRequest {
                frame_id,
                request_id,
            } => write!(
                f,
                "frame {} does not correlate to request {}",
                frame_id.as_str(),
                request_id.as_str()
            ),
            Self::Lifecycle(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for RegistryError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wgpu_compositor::{
        MissingCorrelationReason, PresentationFailureReason, RequestDropReason, WorkloadMode,
    };

    fn request(value: &str) -> FrameRequestId {
        FrameRequestId::new(value).expect("valid request id")
    }

    fn frame(value: &str) -> FrameId {
        FrameId::new(value).expect("valid frame id")
    }

    fn attempt(value: &str) -> PresentationAttemptId {
        PresentationAttemptId::new(value).expect("valid attempt id")
    }

    #[test]
    fn presented_request_requires_presented_attempt_and_frame() {
        let request_id = request("request-1");
        let frame_id = frame("frame-1");
        let attempt_id = attempt("attempt-1");
        let mut registry = FrameLifecycleRegistry::default();
        registry.register_request(request_id.clone()).unwrap();
        registry
            .register_frame(
                frame_id.clone(),
                FrameAttribution::correlated(vec![request_id.clone()], WorkloadMode::Playback)
                    .unwrap(),
            )
            .unwrap();
        registry
            .register_presentation_attempt(attempt_id.clone(), frame_id.clone())
            .unwrap();

        assert_eq!(
            registry.finish_frame(
                &frame_id,
                FrameTerminalDisposition::Presented {
                    attempt_id: attempt_id.clone()
                }
            ),
            Err(RegistryError::FramePresentedBeforeAttempt(
                attempt_id.clone()
            ))
        );
        assert_eq!(
            registry.finish_request(
                &request_id,
                RequestTerminalDisposition::Presented {
                    frame_id: frame_id.clone()
                }
            ),
            Err(RegistryError::RequestPresentedBeforeFrame(frame_id.clone()))
        );

        registry
            .finish_presentation_attempt(&attempt_id, PresentationAttemptDisposition::Presented)
            .unwrap();
        registry
            .finish_frame(
                &frame_id,
                FrameTerminalDisposition::Presented {
                    attempt_id: attempt_id.clone(),
                },
            )
            .unwrap();
        registry
            .finish_request(
                &request_id,
                RequestTerminalDisposition::Presented { frame_id },
            )
            .unwrap();
    }

    #[test]
    fn registry_allocates_unique_internal_ids_for_reused_external_request_ids() {
        let mut registry = FrameLifecycleRegistry::default();
        let first = registry.begin_request("playback").unwrap();
        let second = registry.begin_request("playback").unwrap();
        assert_ne!(first, second);

        let frame = registry
            .begin_frame(FrameAttribution::correlated(vec![first], WorkloadMode::Playback).unwrap())
            .unwrap();
        let attempt = registry.begin_presentation_attempt(frame).unwrap();
        assert!(attempt.as_str().starts_with("presentation-attempt:"));
    }

    #[test]
    fn request_accounting_keeps_terminal_outcomes_in_separate_denominators() {
        let superseded = request("superseded");
        let successor = request("successor");
        let dropped = request("dropped");
        let cancelled = request("cancelled");
        let failed = request("failed");
        let mut registry = FrameLifecycleRegistry::default();
        for id in [&superseded, &successor, &dropped, &cancelled, &failed] {
            registry.register_request(id.clone()).unwrap();
        }

        registry
            .finish_request(
                &superseded,
                RequestTerminalDisposition::Superseded {
                    by_request_id: successor.clone(),
                },
            )
            .unwrap();
        registry
            .finish_request(
                &successor,
                RequestTerminalDisposition::DroppedBeforePresent {
                    reason: RequestDropReason::LookaheadMiss,
                },
            )
            .unwrap();
        registry
            .finish_request(&cancelled, RequestTerminalDisposition::Cancelled)
            .unwrap();
        registry
            .finish_request(
                &failed,
                RequestTerminalDisposition::Failed {
                    reason: crate::wgpu_compositor::RequestFailureReason::PipelineFailure,
                },
            )
            .unwrap();

        let accounting = registry.diagnostic_snapshot().request_accounting;
        assert_eq!(accounting.accepted, 5);
        assert_eq!(accounting.terminal, 4);
        assert_eq!(accounting.superseded, 1);
        assert_eq!(accounting.dropped_before_present, 1);
        assert_eq!(accounting.cancelled, 1);
        assert_eq!(accounting.failed, 1);
        assert_eq!(accounting.unresolved(), 1);
        assert_eq!(accounting.reconcile(), Ok(()));
    }

    #[test]
    fn failed_attempt_allows_recovery_attempt_to_present_the_same_frame() {
        let frame_id = frame("frame-1");
        let failed_attempt = attempt("attempt-1");
        let recovery_attempt = attempt("attempt-2");
        let mut registry = FrameLifecycleRegistry::default();
        registry
            .register_frame(
                frame_id.clone(),
                FrameAttribution::Uncorrelated {
                    reason: MissingCorrelationReason::RecoveryFrame,
                },
            )
            .unwrap();
        registry
            .register_presentation_attempt(failed_attempt.clone(), frame_id.clone())
            .unwrap();
        registry
            .finish_presentation_attempt(
                &failed_attempt,
                PresentationAttemptDisposition::Failed {
                    reason: PresentationFailureReason::SurfaceAcquireFailed,
                    retryable: true,
                },
            )
            .unwrap();
        assert!(matches!(
            registry.frame_state(&frame_id).unwrap(),
            LifecycleState::Active
        ));

        registry
            .register_presentation_attempt(recovery_attempt.clone(), frame_id.clone())
            .unwrap();
        registry
            .finish_presentation_attempt(
                &recovery_attempt,
                PresentationAttemptDisposition::Presented,
            )
            .unwrap();
        registry
            .finish_frame(
                &frame_id,
                FrameTerminalDisposition::Presented {
                    attempt_id: recovery_attempt,
                },
            )
            .unwrap();
        assert_eq!(registry.frame_accounting().unwrap().presented, 1);
    }

    #[test]
    fn cardinality_and_successor_relationships_are_preserved() {
        let first = request("request-1");
        let second = request("request-2");
        let third = request("request-3");
        let first_frame = frame("frame-1");
        let refinement = frame("frame-2");
        let mut registry = FrameLifecycleRegistry::default();
        for id in [&first, &second, &third] {
            registry.register_request(id.clone()).unwrap();
        }
        registry
            .register_frame(
                first_frame.clone(),
                FrameAttribution::correlated(
                    vec![first.clone(), second.clone()],
                    WorkloadMode::Scrub,
                )
                .unwrap(),
            )
            .unwrap();
        registry
            .register_frame(
                refinement.clone(),
                FrameAttribution::correlated(vec![first.clone()], WorkloadMode::Scrub).unwrap(),
            )
            .unwrap();
        assert_eq!(registry.frames_for_request(&first).unwrap().len(), 2);
        assert_eq!(registry.frames_for_request(&second).unwrap().len(), 1);

        registry
            .finish_request(
                &third,
                RequestTerminalDisposition::Coalesced {
                    into_request_id: first.clone(),
                },
            )
            .unwrap();
        assert_eq!(
            registry.finish_request(
                &second,
                RequestTerminalDisposition::Superseded {
                    by_request_id: second.clone(),
                }
            ),
            Err(RegistryError::RequestCannotSucceedItself(second))
        );
    }

    #[test]
    fn duplicate_registration_and_late_terminal_callbacks_are_rejected() {
        let request_id = request("request-1");
        let frame_id = frame("frame-1");
        let mut registry = FrameLifecycleRegistry::default();
        registry.register_request(request_id.clone()).unwrap();
        assert_eq!(
            registry.register_request(request_id.clone()),
            Err(RegistryError::DuplicateRequest(request_id.clone()))
        );
        registry
            .register_frame(
                frame_id.clone(),
                FrameAttribution::Uncorrelated {
                    reason: MissingCorrelationReason::CpuConsumer,
                },
            )
            .unwrap();
        registry
            .finish_frame(
                &frame_id,
                FrameTerminalDisposition::DroppedUnderBackpressure,
            )
            .unwrap();
        assert_eq!(
            registry.finish_frame(
                &frame_id,
                FrameTerminalDisposition::ObsoleteBeforePresentation
            ),
            Err(RegistryError::Lifecycle(
                LifecycleError::DuplicateTerminalTransition
            ))
        );
    }

    #[test]
    fn terminal_history_retention_evicts_only_terminal_records_and_preserves_counters() {
        let mut registry = FrameLifecycleRegistry::default();
        registry.set_terminal_history_retention(TerminalHistoryRetentionPolicy {
            max_terminal_records: 1,
            max_age: Duration::from_secs(60),
        });

        let first = registry
            .begin_frame(FrameAttribution::Uncorrelated {
                reason: MissingCorrelationReason::UnknownProducer,
            })
            .unwrap();
        registry
            .finish_frame(&first, FrameTerminalDisposition::DroppedUnderBackpressure)
            .unwrap();
        let active = registry
            .begin_frame(FrameAttribution::Uncorrelated {
                reason: MissingCorrelationReason::UnknownProducer,
            })
            .unwrap();
        let second = registry
            .begin_frame(FrameAttribution::Uncorrelated {
                reason: MissingCorrelationReason::UnknownProducer,
            })
            .unwrap();
        registry
            .finish_frame(&second, FrameTerminalDisposition::ObsoleteBeforePresentation)
            .unwrap();

        registry.prune_terminal_history(Instant::now());

        assert!(matches!(registry.frame_state(&active), Ok(LifecycleState::Active)));
        assert!(matches!(registry.frame_state(&first), Err(RegistryError::UnknownFrame(_))));
        assert!(matches!(registry.frame_state(&second), Ok(LifecycleState::Terminal(_))));
        let accounting = registry.cumulative_frame_accounting();
        assert_eq!(accounting.produced, 3);
        assert_eq!(accounting.dropped_under_backpressure, 1);
        assert_eq!(accounting.obsolete_before_presentation, 1);
    }

    #[test]
    fn shutdown_abandons_all_unresolved_lifecycles_and_reconciles_frames() {
        let request_id = request("request-1");
        let frame_id = frame("frame-1");
        let attempt_id = attempt("attempt-1");
        let mut registry = FrameLifecycleRegistry::default();
        registry.register_request(request_id).unwrap();
        registry
            .register_frame(
                frame_id.clone(),
                FrameAttribution::Uncorrelated {
                    reason: MissingCorrelationReason::UnknownProducer,
                },
            )
            .unwrap();
        registry
            .register_presentation_attempt(attempt_id.clone(), frame_id.clone())
            .unwrap();

        registry.abandon_active(AbandonReason::SessionShutdown);
        assert!(matches!(
            registry.presentation_attempt_state(&attempt_id).unwrap(),
            LifecycleState::Terminal(PresentationAttemptDisposition::Abandoned { .. })
        ));
        assert!(matches!(
            registry.frame_state(&frame_id).unwrap(),
            LifecycleState::Terminal(FrameTerminalDisposition::Abandoned { .. })
        ));
        assert_eq!(registry.frame_accounting().unwrap().abandoned, 1);
    }

    #[test]
    fn request_cannot_claim_an_unrelated_frame_or_create_late_attempts() {
        let request_id = request("request-1");
        let unrelated_request = request("request-2");
        let frame_id = frame("frame-1");
        let attempt_id = attempt("attempt-1");
        let late_attempt = attempt("attempt-2");
        let mut registry = FrameLifecycleRegistry::default();
        registry.register_request(request_id.clone()).unwrap();
        registry
            .register_request(unrelated_request.clone())
            .unwrap();
        registry
            .register_frame(
                frame_id.clone(),
                FrameAttribution::correlated(vec![unrelated_request], WorkloadMode::Playback)
                    .unwrap(),
            )
            .unwrap();
        registry
            .register_presentation_attempt(attempt_id.clone(), frame_id.clone())
            .unwrap();
        registry
            .finish_presentation_attempt(&attempt_id, PresentationAttemptDisposition::Presented)
            .unwrap();
        registry
            .finish_frame(
                &frame_id,
                FrameTerminalDisposition::Presented { attempt_id },
            )
            .unwrap();

        assert_eq!(
            registry.finish_request(
                &request_id,
                RequestTerminalDisposition::Presented {
                    frame_id: frame_id.clone(),
                }
            ),
            Err(RegistryError::FrameDoesNotCorrelateToRequest {
                frame_id: frame_id.clone(),
                request_id,
            })
        );
        assert_eq!(
            registry.register_presentation_attempt(late_attempt, frame_id.clone()),
            Err(RegistryError::PresentationAttemptForTerminalFrame(frame_id))
        );
    }
}
