mod executor;
mod job_commands;
mod models;
mod probe;

#[cfg(test)]
mod tests;

use models::JobRecord;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// Global job registry shared across executor and job_commands.
static MEDIA_JOBS: Lazy<Arc<Mutex<HashMap<String, JobRecord>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub use job_commands::{cancel_media_job, get_media_job_result, start_audio_extraction};
pub use models::{
    AudioExtractionRequest, ExtractedMediaAsset, MediaJobResult, MediaJobUpdate, MediaStreamInfo,
};
pub use probe::probe_media_streams;
