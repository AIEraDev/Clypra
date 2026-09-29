use super::super::types::{BlendMode, CanvasSpec, LayerTransform, MediaTime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type TrackId = String;
pub type ClipId = String;
pub type AssetId = String;

/// Track kind determining whether the track contributes visual, audio, or metadata layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    #[default]
    Video,
    Audio,
    Text,
    Adjustment,
}

/// A track in the native sequence timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub name: String,
    pub kind: TrackKind,
    pub z_index: i32,
    pub visible: bool,
    pub muted: bool,
    pub volume: f32,
}

impl Track {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        kind: TrackKind,
        z_index: i32,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind,
            z_index,
            visible: true,
            muted: false,
            volume: 1.0,
        }
    }
}

/// Maps timeline presentation time to source media time.
/// Supports constant speed, reverse, and variable playback rates.
///
/// source_time = source_start + (timeline_time - timeline_start) * playback_rate
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimeMapping {
    pub timeline_start: MediaTime,
    pub source_start: MediaTime,
    pub playback_rate: f64,
}

impl TimeMapping {
    pub fn new(timeline_start: MediaTime, source_start: MediaTime, playback_rate: f64) -> Self {
        Self {
            timeline_start,
            source_start,
            playback_rate: if playback_rate == 0.0 {
                1.0
            } else {
                playback_rate
            },
        }
    }

    #[inline]
    pub fn source_time_at(&self, timeline_time: MediaTime) -> MediaTime {
        let delta_micros = (timeline_time - self.timeline_start).as_micros();
        let mapped_delta = (delta_micros as f64 * self.playback_rate).round() as i64;
        self.source_start + MediaTime(mapped_delta)
    }
}

/// A media clip residing on a track in the sequence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: ClipId,
    pub track_id: TrackId,
    pub asset_id: AssetId,
    pub name: Option<String>,

    pub timeline_start: MediaTime,
    pub timeline_end: MediaTime,

    pub source_start: MediaTime,
    pub source_end: MediaTime,

    pub time_mapping: TimeMapping,
    pub transform: LayerTransform,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    pub z_index: i32,

    pub effects: Vec<serde_json::Value>,
    pub color_grade: Option<serde_json::Value>,
    pub body_effect: Option<serde_json::Value>,
}

impl Clip {
    #[inline]
    pub fn is_active_at(&self, time: MediaTime) -> bool {
        time >= self.timeline_start && time < self.timeline_end
    }

    #[inline]
    pub fn duration(&self) -> MediaTime {
        self.timeline_end - self.timeline_start
    }
}

/// Reference to a source media asset on disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaAssetRef {
    pub id: AssetId,
    pub file_path: String,
    pub preview_path: Option<String>,
    pub duration: MediaTime,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub is_missing: bool,
}

/// Project-wide canvas and color settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub canvas: CanvasSpec,
    pub clear_color: [f32; 4],
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            canvas: CanvasSpec::default(),
            clear_color: [0.0, 0.0, 0.0, 1.0],
        }
    }
}

/// Complete timeline sequence containing tracks and clips.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    pub duration: MediaTime,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
}

impl Sequence {
    pub fn calculate_duration(&self) -> MediaTime {
        self.clips
            .iter()
            .map(|c| c.timeline_end)
            .max()
            .unwrap_or(MediaTime::ZERO)
    }
}

/// Engine version identifier separating project document revisions from playback generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct EngineVersion {
    /// Monotonic revision incremented whenever the project state / document changes
    pub project_revision: u64,
    /// Monotonic generation incremented whenever a seek/scrub renders previous work obsolete
    pub playback_generation: u64,
}

/// Authoritative native project state owned strictly by the native engine.
/// React sends document mutations; the native engine maintains this state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectState {
    pub revision: u64,
    pub sequence: Sequence,
    pub assets: HashMap<AssetId, MediaAssetRef>,
    pub settings: ProjectSettings,
}

impl ProjectState {
    pub fn new(settings: ProjectSettings) -> Self {
        Self {
            revision: 0,
            sequence: Sequence::default(),
            assets: HashMap::new(),
            settings,
        }
    }

    pub fn get_track(&self, track_id: &str) -> Option<&Track> {
        self.sequence.tracks.iter().find(|t| t.id == track_id)
    }

    pub fn get_clip(&self, clip_id: &str) -> Option<&Clip> {
        self.sequence.clips.iter().find(|c| c.id == clip_id)
    }

    pub fn get_clip_mut(&mut self, clip_id: &str) -> Option<&mut Clip> {
        self.sequence.clips.iter_mut().find(|c| c.id == clip_id)
    }
}
