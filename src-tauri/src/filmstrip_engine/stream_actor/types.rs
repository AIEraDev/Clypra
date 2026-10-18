use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::oneshot;

use crate::filmstrip_engine::decoder::{
    DecodeFrameOptions, VideoColorMetadata, VideoStreamMetadata,
};
use clypra_native_core::QualityTier;

pub const MAX_PRIME_CACHE_ENTRIES: usize = 4;
pub const DEFAULT_FRAME_DURATION_SECS: f64 = 1.0 / 30.0;

/// Maximum number of active stream decoder actors kept resident in memory.
pub const MAX_PREVIEW_ACTOR_POOL_SIZE: usize = 8;

/// Video plane storage supporting both CPU memory slices and Windows zero-copy DXGI textures.
#[derive(Clone)]
pub enum DecodedVideoPlanes {
    Cpu {
        y: Arc<[u8]>,
        uv: Arc<[u8]>,
    },
    #[cfg(target_os = "windows")]
    D3d11(Arc<crate::wgpu_compositor::dxgi_import::D3d11SharedFrame>),
}

impl DecodedVideoPlanes {
    /// Returns CPU Y and UV slices if available.
    pub fn cpu_planes(&self) -> Option<(&Arc<[u8]>, &Arc<[u8]>)> {
        match self {
            Self::Cpu { y, uv } => Some((y, uv)),
            #[cfg(target_os = "windows")]
            Self::D3d11(_) => None,
        }
    }

    /// Check whether two decoded plane representations point to the exact same underlying GPU/CPU buffer.
    pub fn is_same_source(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Cpu { y: y1, .. }, Self::Cpu { y: y2, .. }) => Arc::ptr_eq(y1, y2),
            #[cfg(target_os = "windows")]
            (Self::D3d11(s1), Self::D3d11(s2)) => {
                Arc::ptr_eq(s1, s2) || s1.nt_handle == s2.nt_handle
            }
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }
}

/// Result of decoding a frame through the stream decoder actor.
#[derive(Clone)]
pub struct DecodedActorFrame {
    pub time_secs: f64,
    pub planes: DecodedVideoPlanes,
    pub width: u32,
    pub height: u32,
    /// Source orientation from container metadata (0, 90, 180, 270 degrees).
    /// The raw NV12 planes are in storage/encoded orientation; callers that
    /// composite at the pixel level (i.e. native preview) must rotate the
    /// pixel data by this amount before uploading to the GPU.
    pub source_rotation: u32,
    pub color: VideoColorMetadata,
    pub decode_us: u32,
    pub decoder_mutex_wait_us: u64,
    pub actor_wait_us: u64,
    pub from_prime_cache: bool,
    pub quality: QualityTier,
    pub is_approximate: bool,
    pub demux_us: u32,
    pub container_format: String,
    pub is_hardware_accelerated: bool,
    pub decoder_seek_time_us: u32,
    pub decoder_seek_count: u32,
    pub decoder_frames_decoded: u32,
    pub hardware_frame_download_us: Option<u64>,
    pub scale_colorspace_us: u64,
    pub hardware_frames_downloaded: u32,
    pub source_metadata: VideoStreamMetadata,
    /// How this frame request was satisfied by the decoder.
    pub served_from: crate::native_core::performance::ServedFrom,
    pub hw_device_type: Option<String>,
    /// Number of times this frame was served to a playback or scrub request.
    /// If 0 when evicted from prime_cache, this was a wasted download.
    pub served_count: u32,
}

pub(crate) static PRODUCER_DOWNLOADS_WASTED: AtomicU64 = AtomicU64::new(0);

pub fn producer_downloads_wasted() -> u64 {
    PRODUCER_DOWNLOADS_WASTED.load(Ordering::Relaxed)
}

pub fn reset_producer_downloads_wasted() {
    PRODUCER_DOWNLOADS_WASTED.store(0, Ordering::Relaxed);
}

pub(crate) static PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED: AtomicU64 = AtomicU64::new(0);

pub fn producer_lookahead_downloads_skipped() -> u64 {
    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.load(Ordering::Relaxed)
}

pub fn reset_producer_lookahead_downloads_skipped() {
    PRODUCER_LOOKAHEAD_DOWNLOADS_SKIPPED.store(0, Ordering::Relaxed);
}

pub use crate::native_core::performance::{
    lookahead_trigger_count, lookahead_trigger_dropped, producer_ahead_of_clock_ms,
    producer_idle_total_ms, record_lookahead_trigger, record_lookahead_trigger_dropped,
    record_producer_ahead_of_clock_ms, record_producer_idle_us,
};

/// Calculate the selective hardware download stride for lookahead priming (Arm 2b).
///
/// On hardware decoders during active playback, downloading every single frame over
/// PCIe on integrated GPUs (e.g. Intel HD 520) consumes 32–40 ms per frame, starving
/// the GPU and bus. By decoding intermediate frames on the GPU without host transfer
/// (`skip_hw_download: true`), the hardware DPB stays warm while host PCIe transfers
/// drop by 50%–66%.
///
/// Returns 1 when hardware acceleration is disabled, when not playing, or when manually forced.
pub fn calculate_download_stride(
    frame_duration_secs: f64,
    is_hw_accel: bool,
    is_playback: bool,
) -> usize {
    if !is_hw_accel || !is_playback {
        return 1;
    }

    if let Ok(val) = std::env::var("CLYPRA_PRODUCER_DOWNLOAD_STRIDE") {
        if let Ok(stride) = val.trim().parse::<usize>() {
            return stride.clamp(1, 6);
        }
    }

    let stream_fps = if frame_duration_secs > 0.0 {
        1.0 / frame_duration_secs
    } else {
        30.0
    };

    if stream_fps >= 48.0 {
        3 // 50/60 fps -> download every 3rd frame (~16-20 fps presentation)
    } else if stream_fps >= 23.0 {
        2 // 24/25/30 fps -> download every 2nd frame (~12-15 fps presentation)
    } else {
        1 // low fps stream -> download every frame
    }
}

impl DecodedActorFrame {
    pub fn into_native_video_frame(
        self,
    ) -> (DecodedVideoPlanes, u32, u32, VideoColorMetadata, u32) {
        (
            self.planes,
            self.width,
            self.height,
            self.color,
            self.source_rotation,
        )
    }

    pub fn y_plane(&self) -> Option<&Arc<[u8]>> {
        match &self.planes {
            DecodedVideoPlanes::Cpu { y, .. } => Some(y),
            #[cfg(target_os = "windows")]
            DecodedVideoPlanes::D3d11(_) => None,
        }
    }

    pub fn uv_plane(&self) -> Option<&Arc<[u8]>> {
        match &self.planes {
            DecodedVideoPlanes::Cpu { uv, .. } => Some(uv),
            #[cfg(target_os = "windows")]
            DecodedVideoPlanes::D3d11(_) => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ActorDecodeRequest {
    pub time_secs: f64,
    pub options: DecodeFrameOptions,
    pub is_prefetch: bool,
    pub generation: u64,
}

pub struct StreamDecodeJob {
    pub request: ActorDecodeRequest,
    pub response_tx: oneshot::Sender<Result<DecodedActorFrame, String>>,
}
