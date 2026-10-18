use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

pub const MAX_FFMPEG_RSS_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub static EXPORT_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTimelineClipPlan {
    pub path: String,
    pub trim_in: f64,
    pub duration: f64,
    pub frame_count: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub volume: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTimelineExportPlan {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub codec: String,
    pub preset: String,
    pub crf: u32,
    pub pixel_format: String,
    pub total_duration: f64,
    pub clips: Vec<NativeTimelineClipPlan>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportCompletion {
    pub total_frames: u32,
    pub total_time_ms: u64,
    pub peak_rss_bytes: u64,
}

pub struct NativeExportJob {
    pub cancellation: CancellationToken,
    pub result: Arc<Mutex<Option<Result<NativeExportCompletion, String>>>>,
    pub completed: Arc<Notify>,
}

pub static NATIVE_EXPORT_JOBS: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, NativeExportJob>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub fn acquire_export_slot() -> Result<(), String> {
    EXPORT_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| "Another export is already running".to_string())
}

pub fn release_export_slot() {
    EXPORT_ACTIVE.store(false, Ordering::Release);
}

pub fn number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{:.0}", value)
    } else {
        format!("{:.6}", value)
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

pub fn target_bitrate(plan: &NativeTimelineExportPlan) -> u64 {
    let pixels = u64::from(plan.width) * u64::from(plan.height);
    let base = if plan.codec == "h265" {
        35_000_000u64
    } else {
        50_000_000u64
    };
    ((base * pixels) / (3840 * 2160)).max(4_000_000)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HwAccelType {
    VideoToolbox,
    Nvenc,
    Qsv,
    Amf,
    Vaapi,
    Software,
}

#[derive(Debug, Clone)]
pub struct SelectedEncoder {
    pub codec_name: String,
    pub hw_type: HwAccelType,
    pub hwaccel_flag: Option<String>,
}

pub fn validate_plan(plan: &NativeTimelineExportPlan) -> Result<(), String> {
    if plan.width == 0 || plan.height == 0 || plan.width > 7680 || plan.height > 4320 {
        return Err(format!(
            "Invalid native export dimensions: {}x{}",
            plan.width, plan.height
        ));
    }
    if !plan.frame_rate.is_finite() || plan.frame_rate <= 0.0 || plan.frame_rate > 240.0 {
        return Err(format!(
            "Invalid native export frame rate: {}",
            plan.frame_rate
        ));
    }
    if !plan.total_duration.is_finite() || plan.total_duration <= 0.0 {
        return Err("Native export duration must be positive".into());
    }
    if plan.clips.is_empty() {
        return Err("Native export requires at least one clip".into());
    }
    if !matches!(plan.codec.as_str(), "h264" | "h265" | "prores") {
        return Err(format!("Unsupported native export codec: {}", plan.codec));
    }
    for clip in &plan.clips {
        if clip.path.is_empty()
            || !clip.trim_in.is_finite()
            || clip.trim_in < 0.0
            || !clip.duration.is_finite()
            || clip.duration <= 0.0
            || clip.frame_count == 0
            || clip.width == 0
            || clip.height == 0
        {
            return Err(format!("Invalid native export clip: {}", clip.path));
        }
    }
    let planned_frames: u32 = plan.clips.iter().map(|clip| clip.frame_count).sum();
    let total_frames = (plan.total_duration * plan.frame_rate).round() as u32;
    if planned_frames != total_frames {
        return Err(format!(
            "Native export clips total {} frames but export requires {} frames",
            planned_frames, total_frames
        ));
    }
    Ok(())
}
