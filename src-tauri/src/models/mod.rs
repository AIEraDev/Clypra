use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaMetadata {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_alpha: Option<bool>,
}

// Alias for backward compatibility
pub type VideoMetadata = MediaMetadata;

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub modified_at: u64,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    #[serde(default)]
    pub canvas_width: Option<u32>,
    #[serde(default)]
    pub canvas_height: Option<u32>,
    #[serde(default)]
    pub frame_rate: Option<u32>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub canvas_background: Option<serde_json::Value>,
    #[serde(default)]
    pub tracks: Vec<serde_json::Value>,
    #[serde(default)]
    pub clips: Vec<serde_json::Value>,
    #[serde(default)]
    pub transitions: Vec<serde_json::Value>,
    #[serde(default)]
    pub gaps: Vec<serde_json::Value>,
    #[serde(default)]
    pub markers: Vec<serde_json::Value>,
    #[serde(default)]
    pub timeline_schema_version: Option<u32>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub media_assets: Vec<serde_json::Value>,
}
