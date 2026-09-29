use super::super::types::{BlendMode, LayerTransform, MediaTime};
use super::model::{Clip, ClipId, MediaAssetRef, ProjectState, Track, TrackId};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Error returned when a project mutation fails or conflicts with current state.
#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
pub enum ProjectError {
    RevisionConflict { expected: u64, actual: u64 },
    ClipNotFound(ClipId),
    TrackNotFound(TrackId),
    InvalidTimeRange,
    ExecutionFailed(String),
}

impl fmt::Display for ProjectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProjectError::RevisionConflict { expected, actual } => write!(
                f,
                "Revision conflict: command base revision {expected} does not match current state {actual}"
            ),
            ProjectError::ClipNotFound(id) => write!(f, "Clip with ID '{id}' not found"),
            ProjectError::TrackNotFound(id) => write!(f, "Track with ID '{id}' not found"),
            ProjectError::InvalidTimeRange => {
                write!(f, "Invalid time range: start time must be less than end time")
            }
            ProjectError::ExecutionFailed(msg) => write!(f, "Command execution failed: {msg}"),
        }
    }
}

impl std::error::Error for ProjectError {}

/// Transactional mutations sent by the UI to mutate the authoritative project document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProjectCommand {
    AddTrack(Track),
    RemoveTrack {
        track_id: TrackId,
    },
    SetTrackVisibility {
        track_id: TrackId,
        visible: bool,
    },
    SetTrackMuted {
        track_id: TrackId,
        muted: bool,
    },
    AddClip(Clip),
    RemoveClip {
        clip_id: ClipId,
    },
    MoveClip {
        clip_id: ClipId,
        new_track_id: Option<TrackId>,
        new_timeline_start: MediaTime,
    },
    TrimClip {
        clip_id: ClipId,
        new_timeline_start: MediaTime,
        new_timeline_end: MediaTime,
        new_source_start: MediaTime,
        new_source_end: MediaTime,
    },
    SetTransform {
        clip_id: ClipId,
        transform: LayerTransform,
    },
    SetOpacity {
        clip_id: ClipId,
        opacity: f32,
    },
    SetBlendMode {
        clip_id: ClipId,
        blend_mode: BlendMode,
    },
    SetEffects {
        clip_id: ClipId,
        effects: Vec<serde_json::Value>,
    },
    RegisterAsset(MediaAssetRef),
    Batch(Vec<ProjectCommand>),
}

/// Envelope carrying a command alongside the optimistic base revision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandEnvelope {
    /// Expected current revision of the project state
    pub base_revision: u64,
    /// Mutation command to apply
    pub command: ProjectCommand,
}

impl CommandEnvelope {
    pub fn new(base_revision: u64, command: ProjectCommand) -> Self {
        Self {
            base_revision,
            command,
        }
    }
}

impl ProjectState {
    /// Applies a transactional command envelope with optimistic revision validation.
    ///
    /// Invariant:
    /// If envelope.base_revision != self.revision, the mutation is rejected with
    /// ProjectError::RevisionConflict, preventing silent race-condition state corruptions.
    pub fn apply(&mut self, envelope: CommandEnvelope) -> Result<u64, ProjectError> {
        if envelope.base_revision != self.revision {
            return Err(ProjectError::RevisionConflict {
                expected: envelope.base_revision,
                actual: self.revision,
            });
        }

        self.execute_command(envelope.command)?;
        self.revision += 1;
        self.sequence.duration = self.sequence.calculate_duration();
        Ok(self.revision)
    }

    /// Internal command executor without revision increment (supports Batch operations).
    fn execute_command(&mut self, command: ProjectCommand) -> Result<(), ProjectError> {
        match command {
            ProjectCommand::AddTrack(track) => {
                self.sequence.tracks.retain(|t| t.id != track.id);
                self.sequence.tracks.push(track);
            }
            ProjectCommand::RemoveTrack { track_id } => {
                self.sequence.tracks.retain(|t| t.id != track_id);
                self.sequence.clips.retain(|c| c.track_id != track_id);
            }
            ProjectCommand::SetTrackVisibility { track_id, visible } => {
                let track = self
                    .sequence
                    .tracks
                    .iter_mut()
                    .find(|t| t.id == track_id)
                    .ok_or(ProjectError::TrackNotFound(track_id))?;
                track.visible = visible;
            }
            ProjectCommand::SetTrackMuted { track_id, muted } => {
                let track = self
                    .sequence
                    .tracks
                    .iter_mut()
                    .find(|t| t.id == track_id)
                    .ok_or(ProjectError::TrackNotFound(track_id))?;
                track.muted = muted;
            }
            ProjectCommand::AddClip(clip) => {
                if clip.timeline_start >= clip.timeline_end {
                    return Err(ProjectError::InvalidTimeRange);
                }
                self.sequence.clips.retain(|c| c.id != clip.id);
                self.sequence.clips.push(clip);
            }
            ProjectCommand::RemoveClip { clip_id } => {
                self.sequence.clips.retain(|c| c.id != clip_id);
            }
            ProjectCommand::MoveClip {
                clip_id,
                new_track_id,
                new_timeline_start,
            } => {
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                let duration = clip.duration();
                clip.timeline_start = new_timeline_start;
                clip.timeline_end = new_timeline_start + duration;
                clip.time_mapping.timeline_start = new_timeline_start;
                if let Some(track_id) = new_track_id {
                    clip.track_id = track_id;
                }
            }
            ProjectCommand::TrimClip {
                clip_id,
                new_timeline_start,
                new_timeline_end,
                new_source_start,
                new_source_end,
            } => {
                if new_timeline_start >= new_timeline_end || new_source_start >= new_source_end {
                    return Err(ProjectError::InvalidTimeRange);
                }
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                clip.timeline_start = new_timeline_start;
                clip.timeline_end = new_timeline_end;
                clip.source_start = new_source_start;
                clip.source_end = new_source_end;
                clip.time_mapping.timeline_start = new_timeline_start;
                clip.time_mapping.source_start = new_source_start;
            }
            ProjectCommand::SetTransform { clip_id, transform } => {
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                clip.transform = transform;
            }
            ProjectCommand::SetOpacity { clip_id, opacity } => {
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                clip.opacity = opacity.clamp(0.0, 1.0);
            }
            ProjectCommand::SetBlendMode {
                clip_id,
                blend_mode,
            } => {
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                clip.blend_mode = blend_mode;
            }
            ProjectCommand::SetEffects { clip_id, effects } => {
                let clip = self
                    .sequence
                    .clips
                    .iter_mut()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| ProjectError::ClipNotFound(clip_id.clone()))?;
                clip.effects = effects;
            }
            ProjectCommand::RegisterAsset(asset) => {
                self.assets.insert(asset.id.clone(), asset);
            }
            ProjectCommand::Batch(commands) => {
                for sub_cmd in commands {
                    self.execute_command(sub_cmd)?;
                }
            }
        }
        Ok(())
    }
}
