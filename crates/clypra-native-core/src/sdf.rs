//! High-Performance Pure-Rust Signed Distance Field (SDF) Generator.
//!
//! Uses Felzenszwalb & Huttenlocher's exact Euclidean Distance Transform (EDT)
//! in $O(W \times H)$ linear time via separable 1D parabolic lower envelopes.
//!
//! Output is encoded into 8-bit unsigned bytes:
//! - 128 represents the exact glyph contour edge.
//! - >128 represents the glyph interior (up to +radius).
//! - <128 represents the glyph exterior (down to -radius).

const INF: f32 = 1e20;

/// Compute 1D Euclidean distance transform along an array of values `f`.
/// `d` receives the output squared Euclidean distances.
/// `v` and `z` are reusable temporary buffers to avoid allocations.
fn edt_1d(f: &[f32], d: &mut [f32], v: &mut [usize], z: &mut [f32]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    if n == 1 {
        d[0] = f[0];
        return;
    }

    let mut k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for q in 1..n {
        let f_q = f[q];
        let q_f = q as f32;
        let mut s = ((f_q + q_f * q_f) - (f[v[k]] + (v[k] as f32) * (v[k] as f32)))
            / (2.0 * q_f - 2.0 * (v[k] as f32));

        while s <= z[k] {
            k -= 1;
            s = ((f_q + q_f * q_f) - (f[v[k]] + (v[k] as f32) * (v[k] as f32)))
                / (2.0 * q_f - 2.0 * (v[k] as f32));
        }

        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }

    let mut k = 0;
    for q in 0..n {
        let q_f = q as f32;
        while z[k + 1] < q_f {
            k += 1;
        }
        let dx = q_f - (v[k] as f32);
        d[q] = dx * dx + f[v[k]];
    }
}

/// Computes a 2D squared Euclidean distance transform on a grid of initial distances.
/// Operates in-place on `grid` of dimensions `width x height`.
fn edt_2d(grid: &mut [f32], width: usize, height: usize) {
    if width == 0 || height == 0 {
        return;
    }

    let max_dim = width.max(height);
    let mut v = vec![0usize; max_dim + 1];
    let mut z = vec![0.0f32; max_dim + 2];
    let mut col_in = vec![0.0f32; height];
    let mut col_out = vec![0.0f32; height];
    let mut row_in = vec![0.0f32; width];
    let mut row_out = vec![0.0f32; width];

    // Pass 1: Transform along columns
    for x in 0..width {
        for y in 0..height {
            col_in[y] = grid[y * width + x];
        }
        edt_1d(&col_in, &mut col_out, &mut v, &mut z);
        for y in 0..height {
            grid[y * width + x] = col_out[y];
        }
    }

    // Pass 2: Transform along rows
    for y in 0..height {
        let offset = y * width;
        row_in.copy_from_slice(&grid[offset..offset + width]);
        edt_1d(&row_in, &mut row_out, &mut v, &mut z);
        grid[offset..offset + width].copy_from_slice(&row_out);
    }
}

/// Generates an 8-bit Signed Distance Field (SDF) bitmap from an 8-bit alpha mask.
///
/// # Arguments
/// - `alpha_mask`: 8-bit grayscale glyph rasterization (0 = empty, 255 = fully solid).
/// - `width`: Width of the bitmap in pixels.
/// - `height`: Height of the bitmap in pixels.
/// - `radius`: The maximum distance (in pixels) mapped to the $[0..255]$ range.
///
/// # Returns
/// A `Vec<u8>` of size `width * height` where 128 is the contour boundary.
pub fn generate_sdf(alpha_mask: &[u8], width: usize, height: usize, radius: f32) -> Vec<u8> {
    let size = width * height;
    if size == 0 {
        return Vec::new();
    }
    assert_eq!(alpha_mask.len(), size, "alpha_mask size must equal width * height");

    let radius = radius.max(1.0);

    // Prepare grid for exterior distance (distance from exterior to nearest interior)
    let mut grid_outside = vec![0.0f32; size];
    // Prepare grid for interior distance (distance from interior to nearest exterior)
    let mut grid_inside = vec![0.0f32; size];

    for i in 0..size {
        let a = alpha_mask[i] as f32 / 255.0;
        if a >= 0.5 {
            // Inside pixel
            grid_outside[i] = 0.0;
            // Subpixel refinement for inside boundary
            let d = a - 0.5;
            grid_inside[i] = if d > 0.0 { INF } else { 0.0 };
        } else {
            // Outside pixel
            grid_inside[i] = 0.0;
            // Subpixel refinement for outside boundary
            let d = 0.5 - a;
            grid_outside[i] = if d > 0.0 { INF } else { 0.0 };
        }
    }

    edt_2d(&mut grid_outside, width, height);
    edt_2d(&mut grid_inside, width, height);

    let mut sdf = vec![0u8; size];
    let inv_radius = 1.0 / radius;

    for i in 0..size {
        let d_out = grid_outside[i].sqrt();
        let d_in = grid_inside[i].sqrt();

        // Signed distance: positive inside, negative outside
        let dist = if d_in > 0.0 {
            d_in // Inside glyph
        } else {
            -d_out // Outside glyph
        };

        // Normalize distance: 128 = 0.0 dist, 255 = +radius, 0 = -radius
        let normalized = 128.0 + (dist * inv_radius * 127.0);
        sdf[i] = normalized.clamp(0.0, 255.0).round() as u8;
    }

    sdf
}

/// Generates an 8-bit Signed Distance Field (SDF) with padding around the source mask.
pub fn generate_padded_sdf(
    alpha_mask: &[u8],
    src_width: usize,
    src_height: usize,
    padding: usize,
    radius: f32,
) -> (Vec<u8>, usize, usize) {
    let dst_width = src_width + padding * 2;
    let dst_height = src_height + padding * 2;
    let mut padded_mask = vec![0u8; dst_width * dst_height];

    for y in 0..src_height {
        let src_row = &alpha_mask[y * src_width..(y + 1) * src_width];
        let dst_offset = (y + padding) * dst_width + padding;
        padded_mask[dst_offset..dst_offset + src_width].copy_from_slice(src_row);
    }

    let sdf = generate_sdf(&padded_mask, dst_width, dst_height, radius);
    (sdf, dst_width, dst_height)
}
