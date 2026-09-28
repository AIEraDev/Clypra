//! Render Graph Nodes, Resources, and Pass Definitions
//!
//! Formulates rendering operations as a Directed Acyclic Graph (DAG) of passes.
//! Separates source ingestion, color grading, transforms, effects, composition,
//! overlays, and final presentation into isolated, inspectable nodes.

use super::super::types::{BlendMode, CanvasSpec, LayerTransform, MediaTime};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Unique identifier for a node in the Render Graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u32);

/// Unique identifier for a transient or persistent resource in the Render Graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ResourceId(pub u32);

/// Content-addressed cache key for DAG branch reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeCacheKey(pub u64);

impl NodeCacheKey {
    pub fn new(hash: u64) -> Self {
        Self(hash)
    }

    pub fn compute<H: Hash>(val: &H) -> Self {
        let mut hasher = DefaultHasher::new();
        val.hash(&mut hasher);
        Self(hasher.finish())
    }

    pub fn combine(self, other: NodeCacheKey) -> Self {
        let mut hasher = DefaultHasher::new();
        self.0.hash(&mut hasher);
        other.0.hash(&mut hasher);
        Self(hasher.finish())
    }
}

/// Reason why a node was culled from the execution schedule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CullReason {
    /// Layer visibility set to Hidden
    LayerHidden,
    /// Layer opacity is zero with no visual side effects
    ZeroOpacity,
    /// Layer is completely occluded by an opaque layer in front
    Occluded,
    /// Output resource is not referenced by any active downstream pass
    Unreferenced,
}

/// Category / type of render pass in the DAG.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PassKind {
    /// Clears the canvas buffer with background color
    Clear { color: [f32; 4] },
    /// Ingests a decoded source video surface
    Source {
        asset_id: String,
        clip_id: String,
        source_time: MediaTime,
    },
    /// Color grading adjustments (LUT, lift/gamma/gain, exposure, contrast, saturation, white balance)
    ColorGrade { params: ColorGradeParams },
    /// Geometric transform, opacity, crop, and layer effects (blur, masks)
    TransformEffect {
        transform: LayerTransform,
        opacity: f32,
        effects: Vec<EffectSpec>,
    },
    /// Composites an input layer onto an accumulator or background target
    Composite {
        blend_mode: BlendMode,
        opacity: f32,
        z_index: i32,
    },
    /// Text, subtitle captions, vectors, and graphic overlays
    Overlay {
        overlay_type: OverlayType,
        content_hash: u64,
    },
    /// Prepares final frame for presentation swapchain
    Output { canvas: CanvasSpec },
}

/// Color grading parameters for a pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColorGradeParams {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub lift: f32,
    pub lut_id: Option<String>,
}

impl Default for ColorGradeParams {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            brightness: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            temperature: 0.0,
            tint: 0.0,
            lift: 0.0,
            lut_id: None,
        }
    }
}

impl Hash for ColorGradeParams {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.exposure.to_bits().hash(state);
        self.brightness.to_bits().hash(state);
        self.contrast.to_bits().hash(state);
        self.saturation.to_bits().hash(state);
        self.temperature.to_bits().hash(state);
        self.tint.to_bits().hash(state);
        self.lift.to_bits().hash(state);
        self.lut_id.hash(state);
    }
}

impl ColorGradeParams {
    pub fn is_identity(&self) -> bool {
        self.exposure == 0.0
            && self.brightness == 0.0
            && self.contrast == 1.0
            && self.saturation == 1.0
            && self.temperature == 0.0
            && self.tint == 0.0
            && self.lift == 0.0
            && self.lut_id.is_none()
    }
}

/// Effect specification applied to a layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EffectSpec {
    pub effect_id: String,
    pub effect_type: String,
    pub params: serde_json::Value,
}

impl Hash for EffectSpec {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.effect_id.hash(state);
        self.effect_type.hash(state);
        self.params.to_string().hash(state);
    }
}

/// Overlay pass type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OverlayType {
    Text,
    Subtitle,
    Watermark,
    VectorShape,
}

/// Node in the Render Graph representing a discrete GPU or compute pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPassNode {
    pub id: NodeId,
    pub name: String,
    pub kind: PassKind,
    pub inputs: Vec<ResourceId>,
    pub outputs: Vec<ResourceId>,
    pub cache_key: Option<NodeCacheKey>,
    pub culled: bool,
    pub cull_reason: Option<CullReason>,
}

impl RenderPassNode {
    pub fn new(
        id: NodeId,
        name: impl Into<String>,
        kind: PassKind,
        inputs: Vec<ResourceId>,
        outputs: Vec<ResourceId>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            kind,
            inputs,
            outputs,
            cache_key: None,
            culled: false,
            cull_reason: None,
        }
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        !self.culled
    }

    #[inline]
    pub fn cull(&mut self, reason: CullReason) {
        self.culled = true;
        self.cull_reason = Some(reason);
    }
}
