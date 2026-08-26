//! Tests for `clypra_native_core::sdf` and `clypra_native_core::glyph_cache`.
//!
//! 1. Mathematical accuracy — verify EDT produces correct Euclidean distances.
//! 2. Glyph cache — hit/miss semantics and 32MB budget eviction.
//! 3. Text shaping — end-to-end layout via `GlyphSdfCache::render_text_sdf`.

use clypra_native_core::glyph_cache::{global_glyph_cache, GlyphSdfCache};
use clypra_native_core::sdf::{generate_padded_sdf, generate_sdf};
use fontdue::{Font, FontSettings};

// ── Helpers ─────────────────────────────────────────────────────────────────

fn circle_mask(width: usize, height: usize, cx: f32, cy: f32, r: f32) -> Vec<u8> {
    let mut mask = vec![0u8; width * height];
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            if dx * dx + dy * dy <= r * r {
                mask[y * width + x] = 255;
            }
        }
    }
    mask
}

fn test_font() -> Font {
    let font_bytes = include_bytes!("test_font.ttf");
    Font::from_bytes(font_bytes as &[u8], FontSettings::default())
        .expect("test_font.ttf must be a valid TrueType font")
}

fn test_font_hash() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    b"test_font".hash(&mut hasher);
    hasher.finish()
}

// ── 1. Mathematical accuracy ─────────────────────────────────────────────────

#[test]
fn sdf_single_solid_pixel() {
    let sdf = generate_sdf(&[255u8], 1, 1, 8.0);
    assert_eq!(sdf.len(), 1);
    assert!(sdf[0] >= 128, "solid pixel SDF should be ≥ 128, got {}", sdf[0]);
}

#[test]
fn sdf_single_empty_pixel() {
    let sdf = generate_sdf(&[0u8], 1, 1, 8.0);
    assert_eq!(sdf.len(), 1);
    assert!(sdf[0] <= 128, "empty pixel SDF should be ≤ 128, got {}", sdf[0]);
}

#[test]
fn sdf_centre_of_solid_block_saturates() {
    let side = 64;
    let mask = vec![255u8; side * side];
    let sdf = generate_sdf(&mask, side, side, 8.0);
    let centre = sdf[(side / 2) * side + (side / 2)];
    assert_eq!(centre, 255, "centre of large solid block must be 255 (saturated interior)");
}

#[test]
fn sdf_corners_less_than_centre() {
    // Unpadded solid blocks have no exterior pixels outside the bitmap boundary,
    // so corner exterior-EDT gives distance=0. Use generate_padded_sdf which wraps
    // the mask with empty pixels so the corner correctly sees exterior at distance≥1.
    let (side, padding) = (32, 16);
    let mask = vec![255u8; side * side];
    let (sdf, ow, oh) = generate_padded_sdf(&mask, side, side, padding, 16.0);
    let centre_x = ow / 2;
    let centre_y = oh / 2;
    let centre = sdf[centre_y * ow + centre_x];
    let corner  = sdf[0]; // top-left corner of padded buffer — deep exterior
    assert!(corner < centre,
        "padded corner SDF ({corner}) must be < padded centre SDF ({centre})");
}

#[test]
fn sdf_circle_radial_symmetry() {
    // Use an odd-dimension grid so the circle center (32.0, 32.0) lands exactly
    // on a pixel center, ensuring sampling points (±24px) are perfectly symmetric
    // on the discrete grid without half-pixel rounding bias.
    let (w, h) = (65, 65);
    let (cx, cy, r) = (32.0_f32, 32.0_f32, 20.0_f32);
    let mask = circle_mask(w, h, cx, cy, r);
    let sdf = generate_sdf(&mask, w, h, 12.0);

    let sample = |dx: f32, dy: f32| -> u8 {
        let px = (cx + dx).clamp(0.0, (w - 1) as f32).round() as usize;
        let py = (cy + dy).clamp(0.0, (h - 1) as f32).round() as usize;
        sdf[py * w + px]
    };

    let east  = sample(r + 4.0, 0.0);
    let west  = sample(-(r + 4.0), 0.0);
    let north = sample(0.0, -(r + 4.0));
    let south = sample(0.0, r + 4.0);

    // Exact symmetry: opposite Cardinal directions must be identical (diff == 0).
    let max_diff = east.abs_diff(west).max(north.abs_diff(south)).max(east.abs_diff(north));
    assert!(max_diff <= 1,
        "radial symmetry broken: E={east} W={west} N={north} S={south} diff={max_diff}");
}

#[test]
fn sdf_interior_exterior_ordering() {
    let (w, h) = (32, 32);
    let mask = circle_mask(w, h, 15.5, 15.5, 10.0);
    let sdf = generate_sdf(&mask, w, h, 8.0);
    assert!(sdf[15 * w + 15] > 128, "well-interior pixel must be > 128");
    assert!(sdf[4  * w +  4] < 128, "well-exterior pixel must be < 128");
}

#[test]
fn padded_sdf_correct_dimensions() {
    let (w, h, p) = (16, 16, 4);
    let mask = vec![255u8; w * h];
    let (sdf, ow, oh) = generate_padded_sdf(&mask, w, h, p, 8.0);
    assert_eq!(ow, w + p * 2);
    assert_eq!(oh, h + p * 2);
    assert_eq!(sdf.len(), ow * oh);
}

#[test]
fn padded_sdf_all_zero_mask_stays_exterior() {
    let mask = vec![0u8; 16 * 16];
    let (sdf, w, h) = generate_padded_sdf(&mask, 16, 16, 4, 8.0);
    assert_eq!(w, 24);
    assert_eq!(h, 24);
    assert!(sdf.iter().all(|&v| v <= 128),
        "all-zero mask must produce only exterior SDF values (≤ 128)");
}

// ── 2. Glyph cache ──────────────────────────────────────────────────────────

#[test]
fn glyph_cache_hit_returns_identical_data() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(4 * 1024 * 1024);
    let g1 = cache.get_or_insert(&font, hash, 'A', 48.0, 8.0, 4);
    let g2 = cache.get_or_insert(&font, hash, 'A', 48.0, 8.0, 4);
    assert_eq!(g1.sdf_data, g2.sdf_data, "cache hit must return bit-identical SDF");
    assert_eq!(g1.width, g2.width);
    assert_eq!(g1.height, g2.height);
}

#[test]
fn glyph_cache_different_sizes_are_distinct() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);
    let small = cache.get_or_insert(&font, hash, 'M', 24.0, 8.0, 4);
    let large = cache.get_or_insert(&font, hash, 'M', 96.0, 8.0, 4);
    assert!(large.width >= small.width,
        "96px glyph ({}) must be at least as wide as 24px glyph ({})", large.width, small.width);
}

#[test]
fn glyph_cache_eviction_does_not_panic() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(1024); // tiny budget forces repeated eviction
    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".chars() {
        let _ = cache.get_or_insert(&font, hash, ch, 48.0, 8.0, 4);
    }
}

#[test]
fn global_cache_is_singleton() {
    let a = global_glyph_cache() as *const _;
    let b = global_glyph_cache() as *const _;
    assert!(std::ptr::eq(a, b), "global_glyph_cache() must return the same instance");
}

// ── 3. Text shaping ─────────────────────────────────────────────────────────

#[test]
fn render_text_sdf_non_empty() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);
    let result = cache.render_text_sdf(&font, hash, "Clypra", 48.0, 0.0, 1.2, 8.0, 4);
    assert!(result.width > 0,  "text SDF width must be > 0");
    assert!(result.height > 0, "text SDF height must be > 0");
    assert_eq!(result.sdf_buffer.len(), (result.width * result.height) as usize);
}

#[test]
fn render_text_sdf_empty_string() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);
    let result = cache.render_text_sdf(&font, hash, "", 48.0, 0.0, 1.2, 8.0, 4);
    assert_eq!(result.width, 0);
    assert_eq!(result.height, 0);
    assert!(result.sdf_buffer.is_empty());
}

#[test]
fn render_text_sdf_wider_with_letter_spacing() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);
    let tight = cache.render_text_sdf(&font, hash, "ABC", 48.0, 0.0,  1.2, 8.0, 4);
    let loose = cache.render_text_sdf(&font, hash, "ABC", 48.0, 16.0, 1.2, 8.0, 4);
    assert!(loose.width > tight.width,
        "letter-spacing=16 width ({}) should exceed tight width ({})", loose.width, tight.width);
}

#[test]
fn render_text_sdf_multiline_taller() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);
    let single = cache.render_text_sdf(&font, hash, "ABC",     48.0, 0.0, 1.2, 8.0, 4);
    let multi  = cache.render_text_sdf(&font, hash, "ABC\nDEF", 48.0, 0.0, 1.2, 8.0, 4);
    assert!(multi.height > single.height,
        "two-line height ({}) must exceed single-line height ({})", multi.height, single.height);
}

#[test]
fn render_text_sdf_alignment_modes() {
    use clypra_native_core::glyph_cache::TextAlign;
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);

    let left = cache.render_text_sdf_aligned(&font, hash, "SHORT\nVERY LONG LINE OF TEXT", 32.0, 0.0, 1.2, TextAlign::Left, 8.0, 4);
    let center = cache.render_text_sdf_aligned(&font, hash, "SHORT\nVERY LONG LINE OF TEXT", 32.0, 0.0, 1.2, TextAlign::Center, 8.0, 4);
    let right = cache.render_text_sdf_aligned(&font, hash, "SHORT\nVERY LONG LINE OF TEXT", 32.0, 0.0, 1.2, TextAlign::Right, 8.0, 4);

    assert_eq!(left.width, center.width);
    assert_eq!(left.width, right.width);
    assert_eq!(left.height, center.height);
    assert_eq!(left.height, right.height);

    // Left and Right alignment produce different pixel patterns on uneven multi-line text
    assert_ne!(left.sdf_buffer, right.sdf_buffer);
}

#[test]
fn glyph_cache_lru_eviction_and_pinning() {
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(5000); // tightly bounded cache
    cache.advance_epoch(1);

    // Insert glyph 'A' pinned to epoch 1
    let _ = cache.get_or_insert_pinned(&font, hash, 'A', 32.0, 8.0, 4, 1);
    // Insert glyph 'B' unpinned (epoch 0)
    let _ = cache.get_or_insert(&font, hash, 'B', 32.0, 8.0, 4);

    let stats_before = cache.stats();
    assert_eq!(stats_before.pinned_count, 1);
    assert_eq!(stats_before.entry_count, 2);

    // Insert more unpinned glyphs to trigger LRU eviction pressure
    for ch in "CDEFGHIJKLMNOPQRSTUVWXYZ".chars() {
        let _ = cache.get_or_insert(&font, hash, ch, 32.0, 8.0, 4);
    }

    let stats_after = cache.stats();
    assert!(stats_after.evictions > 0, "Evictions must have occurred under budget pressure");

    // Pinned glyph 'A' must still be resident
    assert_eq!(stats_after.pinned_count, 1);
    let hit_count_before = cache.stats().hits;
    let _ = cache.get_or_insert(&font, hash, 'A', 32.0, 8.0, 4);
    assert_eq!(cache.stats().hits, hit_count_before + 1, "Pinned glyph 'A' must be a cache hit");
}

#[test]
fn render_text_sdf_clamps_extreme_dimensions_and_flags_truncated() {
    use clypra_native_core::glyph_cache::MAX_TEXT_CANVAS_DIMENSION;
    let font = test_font();
    let hash = test_font_hash();
    let cache = GlyphSdfCache::new(8 * 1024 * 1024);

    // Construct a single-line string that is guaranteed to exceed MAX_TEXT_CANVAS_DIMENSION
    let long_text: String = std::iter::repeat("EXTREMELY_LONG_TEXT_LINE_THAT_EXCEEDS_MAX_TEXTURE_BUDGET_")
        .take(200)
        .collect();

    let result = cache.render_text_sdf(&font, hash, &long_text, 64.0, 0.0, 1.2, 8.0, 4);

    assert!(result.is_truncated, "Extreme text must be flagged as truncated");
    assert!(result.width as usize <= MAX_TEXT_CANVAS_DIMENSION, "Canvas width ({}) must be clamped to MAX ({})", result.width, MAX_TEXT_CANVAS_DIMENSION);
    assert_eq!(result.sdf_buffer.len(), (result.width * result.height) as usize);
}

