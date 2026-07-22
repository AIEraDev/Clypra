/// Geometry utilities for thumbnail rendering.
/// Consolidated aspect ratio and dimension calculations.
/// Calculate fitted dimensions preserving aspect ratio within a max box.
///
/// This is the single source of truth for aspect-preserving dimension fitting.
/// Used by both thumbnail.rs and pyramid.rs to ensure consistent behavior.
///
/// # Arguments
/// * `src_w` - Source width
/// * `src_h` - Source height
/// * `max_w` - Maximum width constraint
/// * `max_h` - Maximum height constraint
///
/// # Returns
/// Fitted dimensions (width, height) that fit within max_w × max_h while preserving aspect ratio
pub fn fit_preserving_aspect(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (max_w, max_h);
    }

    let src_ratio = src_w as f32 / src_h as f32;
    let box_ratio = max_w as f32 / max_h as f32;

    if src_ratio > box_ratio {
        // Source is wider: constrain by width
        let w = max_w;
        let h = ((max_w as f32) / src_ratio).round() as u32;
        (w, h.max(1))
    } else {
        // Source is taller: constrain by height
        let h = max_h;
        let w = ((max_h as f32) * src_ratio).round() as u32;
        (w.max(1), h)
    }
}

/// Align dimension to multiple of 4 (GPU texture compatibility).
fn align_dimension(d: u32) -> u32 {
    (d + 3) & !3
}

/// Calculate aspect-preserving dimensions for a spatial tier with alignment.
///
/// This variant adds dimension alignment for GPU compatibility.
/// Used by pyramid.rs for tier-based rendering.
///
/// # Arguments
/// * `src_w` - Source width
/// * `src_h` - Source height  
/// * `tier_w` - Target tier width
/// * `tier_h` - Target tier height
///
/// # Returns
/// Aligned dimensions (width, height) that fit within tier while preserving aspect ratio
pub fn fit_preserving_aspect_aligned(
    src_w: u32,
    src_h: u32,
    tier_w: u32,
    tier_h: u32,
) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (tier_w, tier_h);
    }

    let src_w_f = src_w as f64;
    let src_h_f = src_h as f64;
    let long_edge = tier_w.max(tier_h) as f64;

    let (out_w, out_h) = if src_w >= src_h {
        let scale = long_edge / src_w_f;
        (long_edge.round() as u32, (src_h_f * scale).round() as u32)
    } else {
        let scale = long_edge / src_h_f;
        ((src_w_f * scale).round() as u32, long_edge.round() as u32)
    };

    (align_dimension(out_w), align_dimension(out_h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fit_preserving_aspect_wider_source() {
        // 16:9 source in 4:3 box
        let (w, h) = fit_preserving_aspect(1920, 1080, 800, 600);
        assert_eq!(w, 800);
        assert_eq!(h, 450);
    }

    #[test]
    fn test_fit_preserving_aspect_taller_source() {
        // 3:4 source in 16:9 box
        let (w, h) = fit_preserving_aspect(600, 800, 1920, 1080);
        assert_eq!(w, 810);
        assert_eq!(h, 1080);
    }

    #[test]
    fn test_fit_preserving_aspect_zero_dimensions() {
        let (w, h) = fit_preserving_aspect(0, 0, 800, 600);
        assert_eq!(w, 800);
        assert_eq!(h, 600);
    }

    #[test]
    fn test_fit_preserving_aspect_aligned() {
        // Result should be aligned to multiple of 4
        let (w, h) = fit_preserving_aspect_aligned(1920, 1080, 320, 180);
        assert_eq!(w % 4, 0);
        assert_eq!(h % 4, 0);
    }
}
