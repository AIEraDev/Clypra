use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasSpec {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStyle {
    #[serde(rename = "fillColor")]
    pub fill_color: Option<String>,
    #[serde(rename = "strokeColor")]
    pub stroke_color: Option<String>,
    #[serde(rename = "strokeWidth")]
    pub stroke_width: Option<f32>,
    #[serde(rename = "borderRadius")]
    pub border_radius: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    pub style: Option<NodeStyle>,
}

fn default_opacity() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedOverlayArtifact {
    #[serde(rename = "documentId")]
    pub document_id: String,
    pub revision: u64,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(rename = "publishedAt")]
    pub published_at: Option<String>,
    pub author: Option<String>,
    pub document: OverlayDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayDocument {
    pub id: Option<String>,
    pub canvas: CanvasSpec,
    pub nodes: Vec<OverlayNode>,
}

impl OverlayDocument {
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        // Try parsing full PublishedOverlayArtifact envelope first
        if let Ok(artifact) = serde_json::from_str::<PublishedOverlayArtifact>(json_str) {
            return Ok(artifact.document);
        }
        
        // Fallback to standalone OverlayDocument JSON
        serde_json::from_str(json_str).map_err(|e| format!("Failed to parse OverlayDocument JSON or PublishedOverlayArtifact: {}", e))
    }
}
