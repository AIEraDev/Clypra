use super::types::{BlendMode, CanvasSpec, LayerTransform, LayerVisibility, MediaTime};
use serde::{Deserialize, Serialize};

/// Immutable evaluation contract specifying all visual and audio elements
/// required to produce a complete timeline output at time T.
/// Agnostic of decoder sources, cache hits, or hardware backends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPlan {
    /// Monotonic seek/scrub generation ID
    pub generation: u64,
    /// Monotonic project revision from the authoritative native project state
    pub project_revision: u64,
    /// Timeline presentation timestamp
    pub time: MediaTime,
    /// Canvas output specifications (width, height, FPS)
    pub canvas: CanvasSpec,
    /// Clear / background color in linear RGBA [0.0, 1.0]
    pub clear_color: [f32; 4],
    /// Visual layers sorted by stacking order
    pub layers: Vec<RenderLayer>,
    /// Accompanying audio plan for playback or export
    pub audio: AudioPlan,
}

impl RenderPlan {
    /// Creates an empty scene (timeline gap). This is a completely valid scene
    /// that renders the canvas background color with zero errors or fallback events.
    pub fn empty(
        generation: u64,
        project_revision: u64,
        time: MediaTime,
        canvas: CanvasSpec,
        clear_color: [f32; 4],
    ) -> Self {
        Self {
            generation,
            project_revision,
            time,
            canvas,
            clear_color,
            layers: Vec::new(),
            audio: AudioPlan::default(),
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.layers.is_empty()
    }
}

/// A single visual layer in a RenderPlan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderLayer {
    pub layer_id: String,
    pub clip_id: String,
    pub asset_id: String,
    pub source_time: MediaTime,
    pub transform: LayerTransform,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    pub z_index: i32,
    pub visibility: LayerVisibility,
    pub color_grade: Option<serde_json::Value>,
    pub body_effect: Option<serde_json::Value>,
    pub effects: Vec<serde_json::Value>,
}

impl RenderLayer {
    pub fn video(
        layer_id: impl Into<String>,
        clip_id: impl Into<String>,
        asset_id: impl Into<String>,
        source_time: MediaTime,
    ) -> Self {
        Self {
            layer_id: layer_id.into(),
            clip_id: clip_id.into(),
            asset_id: asset_id.into(),
            source_time,
            transform: LayerTransform::default(),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            z_index: 0,
            visibility: LayerVisibility::Visible,
            color_grade: None,
            body_effect: None,
            effects: Vec::new(),
        }
    }
}

/// Audio rendering plan accompanying the visual plan at time T.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AudioPlan {
    pub tracks: Vec<AudioTrackPlan>,
    pub master_gain: f32,
}

/// Audio track mixing specification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioTrackPlan {
    pub track_id: String,
    pub asset_id: String,
    pub source_time: MediaTime,
    pub gain: f32,
    pub pan: f32,
    pub is_muted: bool,
}
