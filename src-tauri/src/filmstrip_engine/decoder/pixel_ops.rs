use crate::native_core::QualityTier;
use ffmpeg_next as ffmpeg;
use super::metadata::{normalize_converted_nv12_color, VideoColorMetadata};

/// NV12 chroma planes require even pixel dimensions. Keep the preview source
/// proportional while making reduced-quality CPU fallback material enough
/// smaller to avoid uploading an unnecessary 4K texture every frame.
pub(crate) fn nv12_dimensions_for_quality(width: u32, height: u32, quality: QualityTier) -> (u32, u32) {
    let divisor = match quality {
        QualityTier::Full => 1,
        QualityTier::Half => 2,
        QualityTier::Quarter | QualityTier::Proxy => 4,
    };
    let scaled_width = (width / divisor).max(2) & !1;
    let scaled_height = (height / divisor).max(2) & !1;
    (scaled_width, scaled_height)
}

pub(crate) fn scale_frame_to_nv12(
    frame: &ffmpeg::frame::Video,
    target_width: u32,
    target_height: u32,
    frame_color: VideoColorMetadata,
) -> Result<(Vec<u8>, Vec<u8>, u32, u32, VideoColorMetadata), String> {
    use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

    let mut scaler = Context::get(
        frame.format(),
        frame.width(),
        frame.height(),
        ffmpeg::format::Pixel::NV12,
        target_width,
        target_height,
        Flags::FAST_BILINEAR,
    )
    .map_err(|e| e.to_string())?;
    let mut out = ffmpeg::frame::Video::empty();
    scaler.run(frame, &mut out).map_err(|e| e.to_string())?;

    // This is intentionally a standalone helper because reduced quality has
    // to pass through the same plane extraction path as full quality.
    let y_stride = out.stride(0);
    let uv_stride = out.stride(1);
    if y_stride == 0 || uv_stride == 0 || out.data(0).is_empty() || out.data(1).is_empty() {
        return Err("Scaled NV12 output has no Y/UV planes".to_string());
    }
    let mut y = Vec::with_capacity((target_width * target_height) as usize);
    for row in 0..target_height as usize {
        let start = row * y_stride;
        y.extend_from_slice(&out.data(0)[start..start + target_width as usize]);
    }
    let uv_height = target_height.div_ceil(2) as usize;
    let mut uv = Vec::with_capacity((target_width * uv_height as u32) as usize);
    for row in 0..uv_height {
        let start = row * uv_stride;
        uv.extend_from_slice(&out.data(1)[start..start + target_width as usize]);
    }
    Ok((
        y,
        uv,
        target_width,
        target_height,
        normalize_converted_nv12_color(frame_color),
    ))
}


/// Rotate NV12 biplanar pixel data by `rotation` degrees (0, 90, 180, 270 CW).
///
/// NV12 has two planes:
///   - Y plane: one byte per pixel, stride == width
///   - UV plane: interleaved U/V pairs, one pair per 2×2 luma block,
///     stride == width (same as luma), height == ceil(luma_h / 2)
///
/// Returns `(rotated_y, rotated_uv, out_width, out_height)`.
/// For 90° and 270° the output dimensions are the transpose of the input.
///
/// # Panics
/// Panics only if the supplied plane buffers are shorter than `w * h` (Y)
/// or `w * ceil(h/2)` (UV), which would indicate a bug in the caller.
pub fn rotate_nv12(
    y_src: &[u8],
    uv_src: &[u8],
    w: u32,
    h: u32,
    rotation: u32,
) -> (Vec<u8>, Vec<u8>, u32, u32) {
    let w = w as usize;
    let h = h as usize;
    let uv_w = w.div_ceil(2);
    let uv_h = h.div_ceil(2);

    match rotation {
        90 => {
            // 90° CW: output is (h × w)
            let ow = h;
            let oh = w;
            let ouv_w = ow.div_ceil(2);
            let ouv_h = oh.div_ceil(2);

            let mut y_dst = vec![0u8; ow * oh];
            for row in 0..h {
                for col in 0..w {
                    let src_idx = row * w + col;
                    // 90° CW: new_col = h-1-row, new_row = col
                    let dst_idx = col * ow + (ow - 1 - row);
                    y_dst[dst_idx] = y_src[src_idx];
                }
            }

            // UV is a 2D grid of 2-byte (U, V) pairs: uv_h rows × uv_w cols.
            // Rotated 90° CW, it becomes ouv_h rows × ouv_w cols (ouv_w = uv_h, ouv_h = uv_w).
            let mut uv_dst = vec![0u8; ow * ouv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = c;
                    let dst_c = ouv_w.saturating_sub(1 + r);
                    let dst_off = dst_r * ow + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, ow as u32, oh as u32)
        }
        180 => {
            // 180°: same dimensions, reverse all pixels
            let mut y_dst = vec![0u8; w * h];
            let total_y = w * h;
            for i in 0..total_y {
                y_dst[total_y - 1 - i] = y_src[i];
            }

            let mut uv_dst = vec![0u8; w * uv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = uv_h.saturating_sub(1 + r);
                    let dst_c = uv_w.saturating_sub(1 + c);
                    let dst_off = dst_r * w + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, w as u32, h as u32)
        }
        270 => {
            // 270° CW (= 90° CCW): output is (h × w)
            let ow = h;
            let oh = w;
            let _ouv_w = ow.div_ceil(2);
            let ouv_h = oh.div_ceil(2);

            let mut y_dst = vec![0u8; ow * oh];
            for row in 0..h {
                for col in 0..w {
                    let src_idx = row * w + col;
                    // 270° CW: new_col = row, new_row = w-1-col
                    let dst_idx = (oh - 1 - col) * ow + row;
                    y_dst[dst_idx] = y_src[src_idx];
                }
            }

            let mut uv_dst = vec![0u8; ow * ouv_h];
            for r in 0..uv_h {
                for c in 0..uv_w {
                    let src_off = r * w + c * 2;
                    let dst_r = ouv_h.saturating_sub(1 + c);
                    let dst_c = r;
                    let dst_off = dst_r * ow + dst_c * 2;
                    if src_off + 1 < uv_src.len() && dst_off + 1 < uv_dst.len() {
                        uv_dst[dst_off] = uv_src[src_off];
                        uv_dst[dst_off + 1] = uv_src[src_off + 1];
                    }
                }
            }

            (y_dst, uv_dst, ow as u32, oh as u32)
        }
        _ => (y_src.to_vec(), uv_src.to_vec(), w as u32, h as u32),
    }
}

// ─── Global Decoder Pool with LRU Eviction ──────────────────────────────────
// One decoder per video path. Created on first use, reused with LRU tracking.
// Mutex is per-video so decoders for different videos don't block each other.

