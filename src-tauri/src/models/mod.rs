pub mod overlay;
use serde::{Deserialize, Serialize};

/// Persisted sticker provenance shared by the frontend project serializer.
///
/// Projects currently store media assets and clips as JSON values so this
/// model is a schema reference for native consumers while remaining additive
/// and backward compatible with older project files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerRef {
    pub provider_id: String,
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision_id: Option<String>,
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<serde_json::Value>,
}

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
    pub creator_thumbnails: Option<serde_json::Value>,
    #[serde(default)]
    pub media_assets: Vec<serde_json::Value>,
    #[serde(default)]
    pub main_video_track_id: Option<String>,
}
