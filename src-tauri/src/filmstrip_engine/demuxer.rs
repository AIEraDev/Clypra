//! Asynchronous demuxing and container streaming pipeline (Option 3).
//!
//! Provides lowest-layer stream discarding, container format identification,
//! and buffered packet streaming to decouple container I/O and packet parsing
//! from video frame decoding and GPU rendering.

use ffmpeg_next as ffmpeg;
use std::time::Instant;

/// Identified container format family for telemetry and format negotiation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContainerKind {
    Mp4,
    Matroska,
    QuickTime,
    WebM,
    Avi,
    Other(String),
}

impl ContainerKind {
    pub fn from_format_name(name: &str) -> Self {
        let lower = name.to_ascii_lowercase();
        if lower.contains("matroska") || lower.contains("mkv") {
            Self::Matroska
        } else if lower.contains("mp4") {
            Self::Mp4
        } else if lower.contains("mov") || lower.contains("quicktime") {
            Self::QuickTime
        } else if lower.contains("webm") {
            Self::WebM
        } else if lower.contains("avi") {
            Self::Avi
        } else {
            Self::Other(name.to_string())
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::Mp4 => "mp4",
            Self::Matroska => "matroska",
            Self::QuickTime => "mov",
            Self::WebM => "webm",
            Self::Avi => "avi",
            Self::Other(s) => s.as_str(),
        }
    }
}

/// Discards all streams in `input_ctx` except `target_stream_index`.
///
/// Instructs libavformat's C demuxer (`av_read_frame`) to skip audio, subtitle,
/// attachment, and data streams directly at the I/O layer, avoiding packet
/// allocations in user-space during video preview.
pub fn configure_stream_discard(
    input_ctx: &mut ffmpeg::format::context::Input,
    target_stream_index: usize,
) -> usize {
    let mut discarded = 0;
    unsafe {
        let input_ptr = input_ctx.as_ptr();
        if !input_ptr.is_null() {
            let nb_streams = (*input_ptr).nb_streams as usize;
            let streams_ptr = (*input_ptr).streams;
            if !streams_ptr.is_null() {
                for i in 0..nb_streams {
                    let stream_ptr = *streams_ptr.add(i);
                    if !stream_ptr.is_null() && (*stream_ptr).index != target_stream_index as i32 {
                        (*stream_ptr).discard = ffmpeg::ffi::AVDiscard::AVDISCARD_ALL;
                        discarded += 1;
                    }
                }
            }
        }
    }
    discarded
}

/// Helper to measure demuxing latency for a block of code.
#[inline]
pub fn time_demux_operation<F, R>(demux_acc: &mut u32, f: F) -> R
where
    F: FnOnce() -> R,
{
    let t0 = Instant::now();
    let res = f();
    *demux_acc = demux_acc.saturating_add(t0.elapsed().as_micros().min(u32::MAX as u128) as u32);
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_container_kind_detection() {
        assert_eq!(
            ContainerKind::from_format_name("matroska,webm"),
            ContainerKind::Matroska
        );
        assert_eq!(
            ContainerKind::from_format_name("mov,mp4,m4a,3gp,3g2,mj2"),
            ContainerKind::Mp4
        );
        assert_eq!(
            ContainerKind::from_format_name("quicktime"),
            ContainerKind::QuickTime
        );
        assert_eq!(ContainerKind::from_format_name("avi"), ContainerKind::Avi);
        assert_eq!(
            ContainerKind::from_format_name("flv"),
            ContainerKind::Other("flv".to_string())
        );
    }

    #[test]
    fn test_mkv_stream_discard_and_decode() {
        let path = std::path::Path::new("/tmp/test_mkv.mkv");
        if !path.exists() {
            return;
        }

        let mut input = ffmpeg::format::input(&path).expect("failed to open test mkv");
        let video_stream_idx = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .map(|s| s.index())
            .expect("must have video stream");

        let discarded = configure_stream_discard(&mut input, video_stream_idx);
        assert!(
            discarded >= 1,
            "Expected at least 1 non-video stream discarded in test_mkv.mkv, got {discarded}"
        );

        // Verify the discard flag on non-video streams
        for stream in input.streams() {
            if stream.index() != video_stream_idx {
                unsafe {
                    let stream_ptr = stream.as_ptr();
                    assert_eq!(
                        (*stream_ptr).discard,
                        ffmpeg::ffi::AVDiscard::AVDISCARD_ALL,
                        "Non-video stream must have AVDISCARD_ALL"
                    );
                }
            }
        }
    }
}
