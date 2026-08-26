use super::contracts::{DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION};
use super::playback::frame_for_audio_position;
use super::{FrameTime, NativeCoreError, PlaybackClockStatus, PlaybackPlan, PlaybackState};

/// Deterministic playback state machine. It deliberately has no audio device
/// or UI dependency; the future cpal adapter supplies the authoritative clock.
#[derive(Debug, Clone)]
pub struct PlaybackSession {
    plan: PlaybackPlan,
    state: PlaybackState,
    playing: bool,
    anchor_clock: Option<FrameTime>,
    anchor_position: FrameTime,
    active_request_id: Option<String>,
    next_request_id: u64,
}

impl PlaybackSession {
    pub fn new(plan: PlaybackPlan) -> Result<Self, NativeCoreError> {
        validate_plan(&plan)?;
        let position = FrameTime::new(0, 0, DEFAULT_TIME_SCALE)?;
        Ok(Self {
            state: PlaybackState {
                contract_version: NATIVE_CORE_CONTRACT_VERSION,
                project_revision: plan.project_revision.clone(),
                audio_position_ticks: 0,
                presented_frame: if plan.duration_frames > 0 {
                    Some(0)
                } else {
                    None
                },
                dropped_frames: 0,
                buffering: false,
                clock_status: PlaybackClockStatus::Stopped,
            },
            plan,
            playing: false,
            anchor_clock: None,
            anchor_position: position,
            active_request_id: None,
            next_request_id: 0,
        })
    }

    pub fn state(&self) -> PlaybackState {
        self.state.clone()
    }

    pub fn plan(&self) -> &PlaybackPlan {
        &self.plan
    }

    pub fn play(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        validate_clock(clock)?;
        if self.plan.duration_frames == 0 {
            return Ok(self.state());
        }
        if self.state.audio_position_ticks >= duration_ticks(&self.plan)? {
            self.seek(0)?;
        }
        self.anchor_clock = Some(clock);
        self.anchor_position = position_from_ticks(self.state.audio_position_ticks)?;
        self.playing = true;
        self.state.clock_status = PlaybackClockStatus::MonotonicFallback;
        self.state.buffering = false;
        Ok(self.state())
    }

    pub fn pause(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        if self.playing {
            self.tick(clock)?;
        }
        self.playing = false;
        self.anchor_clock = None;
        self.state.clock_status = PlaybackClockStatus::Stopped;
        Ok(self.state())
    }

    pub fn seek(&mut self, frame_index: u64) -> Result<PlaybackState, NativeCoreError> {
        if self.plan.duration_frames == 0 {
            return Ok(self.state());
        }
        let frame = frame_index.min(self.plan.duration_frames - 1);
        let ticks = frame_ticks(frame, self.plan.frame_rate)?;
        self.anchor_position = FrameTime::new(frame, ticks, DEFAULT_TIME_SCALE)?;
        self.state.audio_position_ticks = ticks;
        self.state.presented_frame = Some(frame);
        self.state.buffering = false;
        self.active_request_id = None;
        Ok(self.state())
    }

    pub fn tick(&mut self, clock: FrameTime) -> Result<PlaybackState, NativeCoreError> {
        validate_clock(clock)?;
        if !self.playing {
            return Ok(self.state());
        }
        let anchor = self.anchor_clock.ok_or_else(|| {
            NativeCoreError::InvalidContract(
                "Playing session is missing its clock anchor".to_string(),
            )
        })?;
        let elapsed = clock.ticks.saturating_sub(anchor.ticks).max(0);
        let position_ticks = self.anchor_position.ticks.saturating_add(
            elapsed.saturating_mul(DEFAULT_TIME_SCALE as i64) / clock.timescale as i64,
        );
        let position = FrameTime::new(0, position_ticks, DEFAULT_TIME_SCALE)?;
        let frame = frame_for_audio_position(position, &self.plan)?;
        self.state.audio_position_ticks = position_ticks;
        self.state.presented_frame = Some(frame);
        if position_ticks >= duration_ticks(&self.plan)? {
            self.playing = false;
            self.anchor_clock = None;
            self.state.clock_status = PlaybackClockStatus::Stopped;
            self.state.audio_position_ticks = duration_ticks(&self.plan)?;
            self.state.presented_frame = Some(self.plan.duration_frames - 1);
        }
        Ok(self.state())
    }

    pub fn issue_frame_request(&mut self, frame_index: u64) -> String {
        self.next_request_id = self.next_request_id.saturating_add(1);
        let id = format!(
            "{}:{}:{}",
            self.plan.project_revision, self.next_request_id, frame_index
        );
        self.active_request_id = Some(id.clone());
        id
    }

    pub fn is_current_response(
        &self,
        request_id: &str,
        project_revision: &str,
        frame_index: u64,
    ) -> bool {
        self.plan.project_revision == project_revision
            && self.active_request_id.as_deref() == Some(request_id)
            && self.state.presented_frame == Some(frame_index)
    }
}

fn validate_plan(plan: &PlaybackPlan) -> Result<(), NativeCoreError> {
    if plan.contract_version == 0 || plan.frame_rate == 0 || plan.project_revision.trim().is_empty()
    {
        return Err(NativeCoreError::InvalidContract(
            "PlaybackPlan requires contract version, project revision, and frame rate".to_string(),
        ));
    }
    Ok(())
}

fn validate_clock(clock: FrameTime) -> Result<(), NativeCoreError> {
    if clock.timescale == 0 || clock.ticks < 0 {
        return Err(NativeCoreError::InvalidContract(
            "Playback clock must use a non-negative integral timestamp".to_string(),
        ));
    }
    Ok(())
}

fn frame_ticks(frame: u64, frame_rate: u32) -> Result<i64, NativeCoreError> {
    let ticks = (frame as u128).saturating_mul(DEFAULT_TIME_SCALE as u128) / frame_rate as u128;
    i64::try_from(ticks).map_err(|_| {
        NativeCoreError::InvalidContract(
            "Playback duration exceeds supported time range".to_string(),
        )
    })
}

fn duration_ticks(plan: &PlaybackPlan) -> Result<i64, NativeCoreError> {
    frame_ticks(plan.duration_frames, plan.frame_rate)
}

fn position_from_ticks(ticks: i64) -> Result<FrameTime, NativeCoreError> {
    FrameTime::new(0, ticks.max(0), DEFAULT_TIME_SCALE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NATIVE_CORE_CONTRACT_VERSION;

    fn plan() -> PlaybackPlan {
        PlaybackPlan {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            project_revision: "project:1".to_string(),
            frame_rate: 30,
            duration_frames: 30,
            audio_track_count: 0,
        }
    }

    #[test]
    fn playback_stops_at_end_and_next_play_restarts() {
        let mut session = PlaybackSession::new(plan()).unwrap();
        session
            .play(FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap())
            .unwrap();
        let end = session
            .tick(FrameTime::new(0, 1_000_000, DEFAULT_TIME_SCALE).unwrap())
            .unwrap();
        assert_eq!(end.clock_status, PlaybackClockStatus::Stopped);
        assert_eq!(end.presented_frame, Some(29));

        session
            .play(FrameTime::new(0, 2_000_000, DEFAULT_TIME_SCALE).unwrap())
            .unwrap();
        assert_eq!(session.state().presented_frame, Some(0));
        assert_eq!(
            session.state().clock_status,
            PlaybackClockStatus::MonotonicFallback
        );
    }

    #[test]
    fn seek_invalidates_previous_frame_request() {
        let mut session = PlaybackSession::new(plan()).unwrap();
        session.seek(3).unwrap();
        let request_id = session.issue_frame_request(3);
        assert!(session.is_current_response(&request_id, "project:1", 3));
        session.seek(4).unwrap();
        assert!(!session.is_current_response(&request_id, "project:1", 3));
    }
}
