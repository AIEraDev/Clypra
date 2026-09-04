//! Font Registry — In-memory, thread-safe TrueType / OpenType font repository.
//!
//! Maps font identifiers (e.g. "inter-regular", "roboto-bold") to parsed `fontdue::Font`
//! instances and content hashes. The compatibility lookup retains a bundled default;
//! authoritative rendering uses `require_font` and fails on missing registrations.

use fontdue::{Font, FontSettings};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, OnceLock};

/// Bundled compatibility font bytes (Inconsolata Regular).
pub const DEFAULT_FONT_BYTES: &[u8] = include_bytes!("../tests/test_font.ttf");
pub const DEFAULT_FONT_ID: &str = "default";
/// Internal face used for glyphs missing from the selected editor font.
pub const EMOJI_FALLBACK_FONT_ID: &str = "__clypra_noto_emoji";

/// Selects a context-aware fallback font key based on typographic classification.
fn resolve_contextual_fallback_key(
    font_id: &str,
    fonts: &HashMap<String, (Arc<Font>, u64)>,
) -> &'static str {
    let lower = font_id.to_lowercase();
    if lower.contains("serif")
        || lower.contains("playfair")
        || lower.contains("times")
        || lower.contains("georgia")
    {
        if fonts.contains_key("playfair display") {
            return "playfair display";
        }
        if fonts.contains_key("playfair display variable") {
            return "playfair display variable";
        }
    }
    if lower.contains("mono")
        || lower.contains("code")
        || lower.contains("inconsolata")
        || lower.contains("courier")
    {
        if fonts.contains_key("jetbrains mono") {
            return "jetbrains mono";
        }
        if fonts.contains_key(DEFAULT_FONT_ID) {
            return DEFAULT_FONT_ID;
        }
    }
    if lower.contains("condensed")
        || lower.contains("bebas")
        || lower.contains("anton")
        || lower.contains("oswald")
    {
        if fonts.contains_key("bebas neue") {
            return "bebas neue";
        }
        if fonts.contains_key("oswald") {
            return "oswald";
        }
    }
    if lower.contains("script") || lower.contains("hand") || lower.contains("pacifico") {
        if fonts.contains_key("dancing script") {
            return "dancing script";
        }
        if fonts.contains_key("pacifico") {
            return "pacifico";
        }
    }

    // Default proportional sans-serif cascade
    if fonts.contains_key("inter variable") {
        return "inter variable";
    }
    if fonts.contains_key("inter") {
        return "inter";
    }
    if fonts.contains_key("roboto") {
        return "roboto";
    }
    DEFAULT_FONT_ID
}

/// Thread-safe registry of parsed TrueType / OpenType fonts.
pub struct FontRegistry {
    fonts: RwLock<HashMap<String, (Arc<Font>, u64)>>,
    missing_warnings: RwLock<Vec<String>>,
}

impl FontRegistry {
    /// Creates a new font registry initialized with the bundled default font.
    pub fn new() -> Self {
        let registry = Self {
            fonts: RwLock::new(HashMap::new()),
            missing_warnings: RwLock::new(Vec::new()),
        };

        // Register default fallback font
        let _ = registry.register_font(DEFAULT_FONT_ID, DEFAULT_FONT_BYTES);
        registry
    }

    /// Register a font from raw TTF/OTF bytes.
    /// Returns the 64-bit content hash of the registered font.
    pub fn register_font(&self, font_id: &str, font_bytes: &[u8]) -> Result<u64, String> {
        if font_id.trim().is_empty() {
            return Err("Native font id must not be empty".to_string());
        }

        // Validate font byte buffer structure before parsing
        crate::font_validator::is_valid_font_bytes(font_bytes)
            .map_err(|e| format!("Font validation failed for '{font_id}': {e}"))?;

        // The web editor bundles fonts as WOFF2. Convert at the native
        // boundary so the same deterministic registration API accepts both
        // editor assets and user-provided TTF/OTF files.
        let decoded_woff2;
        let parse_bytes = if woff2::decode::is_woff2(font_bytes) {
            decoded_woff2 = woff2::convert_woff2_to_ttf(&mut Cursor::new(font_bytes))
                .map_err(|error| format!("Failed to decode WOFF2 font '{font_id}': {error}"))?;
            decoded_woff2.as_slice()
        } else {
            font_bytes
        };
        let font = Font::from_bytes(parse_bytes, FontSettings::default())
            .map_err(|e| format!("Failed to parse font '{font_id}': {e}"))?;

        // Compute deterministic 64-bit FNV-1a content hash of font bytes and id
        let mut font_hash = 0xcbf29ce484222325u64;
        for &b in font_bytes {
            font_hash ^= b as u64;
            font_hash = font_hash.wrapping_mul(0x100000001b3);
        }
        for &b in font_id.as_bytes() {
            font_hash ^= b as u64;
            font_hash = font_hash.wrapping_mul(0x100000001b3);
        }

        let mut write = self.fonts.write();
        write.insert(font_id.to_lowercase(), (Arc::new(font), font_hash));
        Ok(font_hash)
    }

    /// Retrieve a font by identifier. If the requested font is not found,
    /// falls back to the context-aware default font and records a diagnostic warning.
    pub fn get_font(&self, font_id: &str) -> (Arc<Font>, u64) {
        let (font, hash, _) = self.get_font_with_status(font_id);
        (font, hash)
    }

    /// Retrieve a font by identifier, returning `(font, font_hash, is_fallback)`.
    /// `is_fallback` is `true` when the requested font was missing and fell back to default.
    pub fn get_font_with_status(&self, font_id: &str) -> (Arc<Font>, u64, bool) {
        let key = font_id.to_lowercase();
        let read = self.fonts.read();
        if let Some(entry) = read.get(&key) {
            return (Arc::clone(&entry.0), entry.1, false);
        }

        // Determine context-aware fallback key based on font classification
        let fallback_key = resolve_contextual_fallback_key(&key, &read);
        let fallback_entry = read.get(fallback_key).cloned();
        drop(read);

        // Record missing font warning
        {
            let mut warnings = self.missing_warnings.write();
            let msg = format!(
                "Requested font '{font_id}' is not installed; fell back to '{fallback_key}'"
            );
            if !warnings.contains(&msg) {
                warnings.push(msg);
            }
        }

        if let Some(entry) = fallback_entry {
            return (Arc::clone(&entry.0), entry.1, true);
        }

        // Fallback to default font if contextual target is missing
        let read = self.fonts.read();
        if let Some(default_entry) = read.get(DEFAULT_FONT_ID) {
            return (Arc::clone(&default_entry.0), default_entry.1, true);
        }

        drop(read);
        // If even default was missing, re-register and return it
        let _ = self.register_font(DEFAULT_FONT_ID, DEFAULT_FONT_BYTES);
        let read = self.fonts.read();
        let entry = read
            .get(DEFAULT_FONT_ID)
            .expect("Default font must be registered");
        (Arc::clone(&entry.0), entry.1, true)
    }

    /// Strict lookup used by authoritative desktop rendering. Browser-style
    /// fallback is intentionally kept only for compatibility/diagnostic APIs.
    pub fn require_font(&self, font_id: &str) -> Result<(Arc<Font>, u64), String> {
        let key = font_id.to_lowercase();
        self.fonts
            .read()
            .get(&key)
            .map(|entry| (Arc::clone(&entry.0), entry.1))
            .ok_or_else(|| format!("Native font '{font_id}' is not registered"))
    }

    /// Retrieve all missing font warnings accumulated during font lookups.
    pub fn get_missing_font_warnings(&self) -> Vec<String> {
        self.missing_warnings.read().clone()
    }

    /// Clear accumulated missing font warnings.
    pub fn clear_missing_font_warnings(&self) {
        self.missing_warnings.write().clear();
    }

    /// Checks whether a specific font is registered.
    pub fn has_font(&self, font_id: &str) -> bool {
        let key = font_id.to_lowercase();
        self.fonts.read().contains_key(&key)
    }

    /// Returns list of all registered font IDs.
    pub fn list_fonts(&self) -> Vec<String> {
        self.fonts.read().keys().cloned().collect()
    }
}

impl Default for FontRegistry {
    fn default() -> Self {
        Self::new()
    }
}

static GLOBAL_FONT_REGISTRY: OnceLock<FontRegistry> = OnceLock::new();

/// Process-global font registry singleton.
pub fn global_font_registry() -> &'static FontRegistry {
    GLOBAL_FONT_REGISTRY.get_or_init(FontRegistry::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_font_is_always_registered() {
        let reg = FontRegistry::new();
        assert!(reg.has_font("default"));
        let (font, hash, is_fallback) = reg.get_font_with_status("default");
        assert!(hash > 0);
        assert!(!is_fallback);
        assert!(font.glyph_count() > 0);
    }

    #[test]
    fn unknown_font_falls_back_to_default_and_records_warning() {
        let reg = FontRegistry::new();
        let (default_font, default_hash) = reg.get_font("default");
        let (fallback_font, fallback_hash, is_fallback) =
            reg.get_font_with_status("non-existent-font-1234");
        assert_eq!(default_hash, fallback_hash);
        assert!(is_fallback);
        assert_eq!(default_font.glyph_count(), fallback_font.glyph_count());

        let warnings = reg.get_missing_font_warnings();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("non-existent-font-1234"));
    }

    #[test]
    fn register_custom_font() {
        let reg = FontRegistry::new();
        let hash = reg
            .register_font("inconsolata-custom", DEFAULT_FONT_BYTES)
            .unwrap();
        assert!(reg.has_font("inconsolata-custom"));
        let (_, fetched_hash, is_fallback) = reg.get_font_with_status("inconsolata-custom");
        assert_eq!(hash, fetched_hash);
        assert!(!is_fallback);
    }

    #[test]
    fn strict_lookup_rejects_unregistered_font() {
        let reg = FontRegistry::new();
        let error = reg.require_font("missing-desktop-font").unwrap_err();
        assert!(error.contains("not registered"));
    }

    #[test]
    fn deterministic_font_hash() {
        let reg1 = FontRegistry::new();
        let reg2 = FontRegistry::new();
        let hash1 = reg1.register_font("test-det", DEFAULT_FONT_BYTES).unwrap();
        let hash2 = reg2.register_font("test-det", DEFAULT_FONT_BYTES).unwrap();
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, 0);
    }

    #[test]
    fn font_validation_rejects_corrupted_bytes() {
        let reg = FontRegistry::new();
        let corrupt_bytes = b"not a font file";
        let result = reg.register_font("corrupted", corrupt_bytes);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Font validation failed"));
    }

    #[test]
    fn contextual_fallback_resolution() {
        let reg = FontRegistry::new();
        // Register mock faces using test font bytes
        reg.register_font("inter variable", DEFAULT_FONT_BYTES).unwrap();
        reg.register_font("playfair display", DEFAULT_FONT_BYTES).unwrap();
        reg.register_font("bebas neue", DEFAULT_FONT_BYTES).unwrap();

        // 1. Unknown sans-serif should fall back to inter variable
        let (_, _, is_fb) = reg.get_font_with_status("arial-custom");
        assert!(is_fb);
        let warnings = reg.get_missing_font_warnings();
        assert!(warnings.iter().any(|w| w.contains("fell back to 'inter variable'")));

        // 2. Unknown serif should fall back to playfair display
        let (_, _, is_fb) = reg.get_font_with_status("times-serif");
        assert!(is_fb);
        let warnings = reg.get_missing_font_warnings();
        assert!(warnings.iter().any(|w| w.contains("fell back to 'playfair display'")));

        // 3. Unknown display/condensed should fall back to bebas neue
        let (_, _, is_fb) = reg.get_font_with_status("anton-condensed");
        assert!(is_fb);
        let warnings = reg.get_missing_font_warnings();
        assert!(warnings.iter().any(|w| w.contains("fell back to 'bebas neue'")));
    }

    #[test]
    fn global_font_registry_is_singleton() {
        let r1 = global_font_registry() as *const _;
        let r2 = global_font_registry() as *const _;
        assert_eq!(r1, r2);
    }
}
