use rayon::prelude::*;
use std::sync::Arc;

use super::frame::{RawRgbaFrame, TierRgbaFrame};
use super::tiers::SpatialTier;
use crate::filmstrip_engine::geometry::fit_preserving_aspect_aligned;

/// Decode-once parallel pyramid (R2).
/// Given raw full-resolution RGBA, produce all requested tiers in parallel
/// using rayon. Each tier uses LANCZOS via ffmpeg software scaling.
///
/// Returns Vec of (SpatialTier, Arc<TierRgbaFrame>).
pub fn downsample_pyramid(
    raw: &RawRgbaFrame,
    tiers: &[SpatialTier],
) -> Vec<(SpatialTier, Result<Arc<TierRgbaFrame>, String>)> {
    tiers
        .par_iter()
        .map(|&tier| {
            let timer = crate::filmstrip_engine::metrics::Timer::start();
            let (out_w, out_h) = aspect_preserving_tier_dims(raw.width, raw.height, tier);
            let result = scale_rgba_lanczos(&raw.data, raw.width, raw.height, out_w, out_h)
                .map(|data| Arc::new(TierRgbaFrame::new(data, out_w, out_h, tier)));
            if let Some(elapsed) = timer.elapsed() {
                crate::filmstrip_engine::metrics::METRICS
                    .for_tier(tier)
                    .downsample
                    .record(elapsed);
            }
            (tier, result)
        })
        .collect()
}

/// Calculate aspect-preserving dimensions for a spatial tier.
///
/// Wrapper around shared geometry utility with tier-specific logic.
/// Use geometry::fit_preserving_aspect_aligned directly.
/// Kept for backward compatibility with existing call sites.
pub fn aspect_preserving_tier_dims(src_w: u32, src_h: u32, tier: SpatialTier) -> (u32, u32) {
    let (tier_w, tier_h) = tier.dims();
    fit_preserving_aspect_aligned(src_w, src_h, tier_w, tier_h)
}

/// Scale an RGBA buffer using FFmpeg LANCZOS scaler.
pub fn scale_rgba_lanczos(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    use ffmpeg_next as ffmpeg;
    use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

    let mut src_frame = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::RGBA, src_w, src_h);
    if src_frame.planes() == 0 {
        return Err("Failed to allocate src_frame in downsample_rgba".to_string());
    }
    let stride = src_frame.stride(0);
    let data = src_frame.data_mut(0);
    for y in 0..src_h as usize {
        let dst_off = y * stride;
        let src_off = y * src_w as usize * 4;
        let row_bytes = src_w as usize * 4;
        if src_off + row_bytes > src.len() || dst_off + row_bytes > data.len() {
            return Err("Buffer overrun in downsample_rgba copy to src_frame".to_string());
        }
        data[dst_off..dst_off + row_bytes].copy_from_slice(&src[src_off..src_off + row_bytes]);
    }

    let mut scaler = Context::get(
        ffmpeg::format::Pixel::RGBA,
        src_w,
        src_h,
        ffmpeg::format::Pixel::RGBA,
        dst_w,
        dst_h,
        Flags::LANCZOS,
    )
    .map_err(|e| e.to_string())?;

    let mut dst_frame = ffmpeg::frame::Video::empty();
    scaler
        .run(&src_frame, &mut dst_frame)
        .map_err(|e| e.to_string())?;

    if dst_frame.planes() == 0 {
        return Err("Scaled dst_frame has no image planes in downsample_rgba".to_string());
    }

    let stride = dst_frame.stride(0);
    let out = dst_frame.data(0);
    let mut result = Vec::with_capacity(dst_w as usize * dst_h as usize * 4);
    let row_bytes = dst_w as usize * 4;
    for y in 0..dst_h as usize {
        let off = y * stride;
        if off + row_bytes > out.len() {
            return Err("Buffer overrun in downsample_rgba read from dst_frame".to_string());
        }
        result.extend_from_slice(&out[off..off + row_bytes]);
    }
    Ok(result)
}
