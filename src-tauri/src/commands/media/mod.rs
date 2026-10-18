pub mod asset;
pub mod path;
pub mod probe;
pub mod transcribe;
pub mod waveform;

#[cfg(test)]
mod tests;

pub use asset::{
    can_stream_copy_video, extract_audio_artwork, extract_audio_track,
    get_or_create_preview_video, is_browser_playable_audio, is_browser_playable_video,
    probe_audio_codec, probe_video_codec, extract_poster_frame,
};
pub use path::normalize_file_path;
#[allow(deprecated)]
pub use probe::{
    decode_image_rgba, decode_image_rgba_bytes, get_media_metadata, get_video_metadata,
    get_video_render_metadata,
};
pub use transcribe::transcribe_audio_local;
pub use waveform::{extract_waveform_data, WaveformBucket};
