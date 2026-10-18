use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClymatteStatus {
    pub exists: bool,
    pub path: Option<String>,
    pub frame_count: u32,
    pub width: u16,
    pub height: u16,
    pub fps_num: u32,
    pub fps_den: u32,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClymatteFrameInput {
    pub timestamp_us: u64,
    pub r8_data: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClymatteWriteRequest {
    pub clip_id: String,
    pub clip_hash: String,
    pub width: u16,
    pub height: u16,
    pub fps_num: u32,
    pub fps_den: u32,
    pub model_signature: Option<String>,
    pub frames: Vec<ClymatteFrameInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClymatteBakeRequest {
    pub clip_id: String,
    pub video_path: String,
    pub clip_hash: Option<String>,
    pub model_signature: Option<String>,
    pub start_secs: Option<f64>,
    pub end_secs: Option<f64>,
    pub fps: Option<f64>,
    pub width: Option<u16>,
    pub height: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClymatteProgressPayload {
    pub clip_id: String,
    pub progress: f32,
    pub elapsed_ms: u64,
    pub stage: String,
}
