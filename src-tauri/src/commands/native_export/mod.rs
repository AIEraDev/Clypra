pub mod builder;
pub mod commands;
pub mod encoder;
pub mod executor;
pub mod models;

#[cfg(test)]
mod tests;

pub use builder::{build_concat_args, build_mux_args, build_segment_args, ffconcat_path};
pub use commands::{
    cancel_native_timeline_export, finalize_native_timeline_export, start_native_timeline_export,
};
pub use encoder::{detect_best_encoder, software_fallback_encoder};
pub use executor::{probe_has_audio, process_rss_bytes, run_ffmpeg, run_native_export};
pub use models::{
    acquire_export_slot, release_export_slot, target_bitrate, validate_plan, HwAccelType,
    NativeExportCompletion, NativeExportJob, NativeTimelineClipPlan, NativeTimelineExportPlan,
    SelectedEncoder, EXPORT_ACTIVE, MAX_FFMPEG_RSS_BYTES, NATIVE_EXPORT_JOBS,
};
