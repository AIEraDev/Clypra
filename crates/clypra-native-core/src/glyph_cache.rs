//! Content-Addressed Glyph Signed Distance Field (SDF) Cache & Text Layout Engine.
//!
//! Provides thread-safe, sub-millisecond cached glyph distance-field lookups
//! and multi-character text layout directly in native memory.

use crate::sdf::generate_padded_sdf;
use fontdue::Font;
use parking_lot::RwLock;
use std::collections::HashMap;

/// Cached SDF representation of an individual glyph.
#[derive(Debug, Clone)]
pub struct SdfGlyph {
    pub glyph_index: u16,
    pub width: u32,
    pub height: u32,
    pub xmin: i32,
    pub ymin: i32,
    pub advance_width: f32,
    pub padding: usize,
    pub sdf_data: Vec<u8>,
}

/// Result of shaping and generating an SDF composite for an entire string of text.
#[derive(Debug, Clone)]
pub struct ShapedTextSdf {
    pub width: u32,
    pub height: u32,
    pub sdf_buffer: Vec<u8>,
    /// Bounding box offset relative to baseline origin: [min_x, min_y, max_x, max_y]
    pub bounds: [f32; 4],
}

/// Text horizontal alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

impl TextAlign {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "center" | "middle" => Self::Center,
            "right" | "end" => Self::Right,
            _ => Self::Left,
        }
    }
}

/// Content-addressed glyph cache keyed by `(font_hash, glyph_index, target_size_px)`.
pub struct GlyphSdfCache {
    entries: RwLock<HashMap<(u64, u16, u32), SdfGlyph>>,
    total_bytes: RwLock<usize>,
    max_bytes: usize,
}

impl GlyphSdfCache {
    /// Create a new glyph cache with a given memory budget in bytes (default 32MB).
    pub fn new(max_bytes: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            total_bytes: RwLock::new(0),
            max_bytes,
        }
    }

    /// Retrieve or rasterize+generate an SDF glyph.
    pub fn get_or_insert(
        &self,
        font: &Font,
        font_hash: u64,
        character: char,
        size_px: f32,
        radius: f32,
        padding: usize,
    ) -> SdfGlyph {
        let glyph_index = font.lookup_glyph_index(character);
        let size_key = (size_px * 100.0).round() as u32;
        let key = (font_hash, glyph_index, size_key);

        // Fast path: read lock check
        {
            let read = self.entries.read();
            if let Some(glyph) = read.get(&key) {
                return glyph.clone();
            }
        }

        // Slow path: rasterize with fontdue and generate SDF
        let (metrics, bitmap) = font.rasterize(character, size_px);

        let (sdf_data, sdf_w, sdf_h) = if metrics.width > 0 && metrics.height > 0 {
            generate_padded_sdf(&bitmap, metrics.width, metrics.height, padding, radius)
        } else {
            (Vec::new(), 0, 0)
        };

        let glyph = SdfGlyph {
            glyph_index,
            width: sdf_w as u32,
            height: sdf_h as u32,
            xmin: metrics.xmin,
            ymin: metrics.ymin,
            advance_width: metrics.advance_width,
            padding,
            sdf_data,
        };

        let glyph_bytes = glyph.sdf_data.len() + std::mem::size_of::<SdfGlyph>();
        let mut write = self.entries.write();
        let mut total = self.total_bytes.write();

        // Evict if over budget
        if *total + glyph_bytes > self.max_bytes {
            write.clear();
            *total = 0;
        }

        write.insert(key, glyph.clone());
        *total += glyph_bytes;

        glyph
    }
    /// Shapes a text string and generates a composite signed-distance-field atlas buffer (Left-aligned).
    pub fn render_text_sdf(
        &self,
        font: &Font,
        font_hash: u64,
        text: &str,
        size_px: f32,
        letter_spacing: f32,
        line_height_mult: f32,
        radius: f32,
        padding: usize,
    ) -> ShapedTextSdf {
        self.render_text_sdf_aligned(
            font,
            font_hash,
            text,
            size_px,
            letter_spacing,
            line_height_mult,
            TextAlign::Left,
            radius,
            padding,
        )
    }

    /// Shapes a multi-line text string with alignment support (Left, Center, Right).
    pub fn render_text_sdf_aligned(
        &self,
        font: &Font,
        font_hash: u64,
        text: &str,
        size_px: f32,
        letter_spacing: f32,
        line_height_mult: f32,
        align: TextAlign,
        radius: f32,
        padding: usize,
    ) -> ShapedTextSdf {
        if text.is_empty() {
            return ShapedTextSdf {
                width: 0,
                height: 0,
                sdf_buffer: Vec::new(),
                bounds: [0.0; 4],
            };
        }

        let line_height = if line_height_mult > 0.0 {
            size_px * line_height_mult
        } else {
            size_px * 1.2
        };

        struct GlyphItem {
            glyph: SdfGlyph,
            rel_x: f32, // x position relative to start of line
        }

        struct LineInfo {
            glyphs: Vec<GlyphItem>,
            width: f32,
        }

        let mut lines = Vec::new();
        let mut current_line = Vec::new();
        let mut cursor_x = 0.0f32;

        for ch in text.chars() {
            if ch == '\n' {
                lines.push(LineInfo {
                    glyphs: std::mem::take(&mut current_line),
                    width: cursor_x.max(0.0),
                });
                cursor_x = 0.0;
                continue;
            }

            let glyph = self.get_or_insert(font, font_hash, ch, size_px, radius, padding);
            let adv = glyph.advance_width;

            if glyph.width > 0 && glyph.height > 0 {
                let gx = cursor_x + (glyph.xmin as f32) - (glyph.padding as f32);
                current_line.push(GlyphItem {
                    glyph,
                    rel_x: gx,
                });
            }

            cursor_x += adv + letter_spacing;
        }

        lines.push(LineInfo {
            glyphs: current_line,
            width: cursor_x.max(0.0),
        });

        let max_line_w = lines.iter().map(|l| l.width).fold(0.0f32, f32::max);

        struct PlacedGlyph {
            glyph: SdfGlyph,
            pos_x: f32,
            pos_y: f32,
        }

        let mut placed = Vec::new();
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = f32::MIN;
        let mut max_y = f32::MIN;

        for (line_idx, line) in lines.into_iter().enumerate() {
            let line_y = (line_idx as f32) * line_height;
            let offset_x = match align {
                TextAlign::Left => 0.0,
                TextAlign::Center => (max_line_w - line.width) * 0.5,
                TextAlign::Right => max_line_w - line.width,
            };

            for item in line.glyphs {
                let gx = item.rel_x + offset_x;
                let gy = line_y - (item.glyph.ymin as f32) - (item.glyph.height as f32 - item.glyph.padding as f32);

                min_x = min_x.min(gx);
                min_y = min_y.min(gy);
                max_x = max_x.max(gx + item.glyph.width as f32);
                max_y = max_y.max(gy + item.glyph.height as f32);

                placed.push(PlacedGlyph {
                    glyph: item.glyph,
                    pos_x: gx,
                    pos_y: gy,
                });
            }
        }

        if placed.is_empty() {
            return ShapedTextSdf {
                width: 0,
                height: 0,
                sdf_buffer: Vec::new(),
                bounds: [0.0; 4],
            };
        }

        let canvas_w = ((max_x - min_x).ceil() as usize).max(1);
        let canvas_h = ((max_y - min_y).ceil() as usize).max(1);

        // Background of SDF initialized to 0 (far exterior)
        let mut canvas_sdf = vec![0u8; canvas_w * canvas_h];

        for item in placed {
            let start_x = (item.pos_x - min_x).round() as isize;
            let start_y = (item.pos_y - min_y).round() as isize;
            let gw = item.glyph.width as usize;
            let gh = item.glyph.height as usize;

            for gy in 0..gh {
                let cy = start_y + gy as isize;
                if cy < 0 || cy >= canvas_h as isize {
                    continue;
                }
                for gx in 0..gw {
                    let cx = start_x + gx as isize;
                    if cx < 0 || cx >= canvas_w as isize {
                        continue;
                    }

                    let src_val = item.glyph.sdf_data[gy * gw + gx];
                    let dst_idx = (cy as usize) * canvas_w + (cx as usize);
                    // Combine SDF by taking maximum distance (union of shapes)
                    canvas_sdf[dst_idx] = canvas_sdf[dst_idx].max(src_val);
                }
            }
        }

        ShapedTextSdf {
            width: canvas_w as u32,
            height: canvas_h as u32,
            sdf_buffer: canvas_sdf,
            bounds: [min_x, min_y, max_x, max_y],
        }
    }
}

/// Process-global glyph SDF cache.  32 MB default budget — large enough to hold
/// all glyphs for a typical project's font set across all sizes.
static GLOBAL_GLYPH_SDF_CACHE: std::sync::OnceLock<GlyphSdfCache> = std::sync::OnceLock::new();

/// Returns a reference to the process-global `GlyphSdfCache`.
/// Initializes with a 32 MB budget on first call.
pub fn global_glyph_cache() -> &'static GlyphSdfCache {
    GLOBAL_GLYPH_SDF_CACHE.get_or_init(|| GlyphSdfCache::new(32 * 1024 * 1024))
}
