use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Per-stream metadata returned by ffprobe for a media file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaStreamInfo {
    pub index: u32,
    #[serde(rename = "type")]
    pub stream_type: String,
    pub codec: String,
    pub codec_long_name: Option<String>,
    pub duration: Option<f64>,
    pub time_base_num: Option<i64>,
    pub time_base_den: Option<i64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub channel_layout: Option<String>,
    pub bitrate: Option<u64>,
    pub language: Option<String>,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r_frame_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avg_frame_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pix_fmt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_transfer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_primaries: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_vfr: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_high_risk: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_factors: Option<Vec<String>>,
}

/// IPC request payload for an audio extraction or stream-copy job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExtractionRequest {
    pub source_asset_id: String,
    pub source_path: String,
    pub source_stream_index: u32,
    #[serde(default = "default_mode")]
    pub mode: String,
    pub output_codec: Option<String>,
    pub output_container: Option<String>,
}

fn default_mode() -> String {
    "auto".to_string()
}

/// Frontend-emitted event payload for in-progress job status updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJobUpdate {
    pub job_id: String,
    pub operation: String,
    pub state: String,
    pub progress: Option<f32>,
    pub resulting_asset_id: Option<String>,
    pub error_summary: Option<String>,
}

/// The asset produced by a completed extraction job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedMediaAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub media_type: String,
    pub duration: f64,
    pub size: u64,
    pub streams: Vec<MediaStreamInfo>,
    pub source_asset_id: String,
    pub source_stream_index: u32,
    pub extraction_method: String,
    pub operation_fingerprint: String,
}

/// Final state of a media job returned by `get_media_job_result`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJobResult {
    pub job_id: String,
    pub state: String,
    pub asset: Option<ExtractedMediaAsset>,
    pub error_summary: Option<String>,
}

/// Internal runtime record per active or completed job.
pub(super) struct JobRecord {
    pub(super) cancellation: CancellationToken,
    pub(super) result: Option<MediaJobResult>,
}
