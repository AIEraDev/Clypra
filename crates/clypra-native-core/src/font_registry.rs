//! Font Registry — In-memory, thread-safe TrueType / OpenType font repository.
//!
//! Maps font identifiers (e.g. "inter-regular", "roboto-bold") to parsed `fontdue::Font`
//! instances and content hashes. Provides a bundled default font to guarantee 100%
//! deterministic, offline rendering on all platforms without missing-font panics.

use fontdue::{Font, FontSettings};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, OnceLock};

/// Bundled default fallback font bytes (Inconsolata Regular).
pub const DEFAULT_FONT_BYTES: &[u8] = include_bytes!("../tests/test_font.ttf");
pub const DEFAULT_FONT_ID: &str = "default";

/// Thread-safe registry of parsed TrueType / OpenType fonts.
pub struct FontRegistry {
    fonts: RwLock<HashMap<String, (Arc<Font>, u64)>>,
}

impl FontRegistry {
    /// Creates a new font registry initialized with the bundled default font.
    pub fn new() -> Self {
        let registry = Self {
            fonts: RwLock::new(HashMap::new()),
        };

        // Register default fallback font
        let _ = registry.register_font(DEFAULT_FONT_ID, DEFAULT_FONT_BYTES);
        registry
    }

    /// Register a font from raw TTF/OTF bytes.
    /// Returns the 64-bit content hash of the registered font.
    pub fn register_font(&self, font_id: &str, font_bytes: &[u8]) -> Result<u64, String> {
        let font = Font::from_bytes(font_bytes, FontSettings::default())
            .map_err(|e| format!("Failed to parse font '{font_id}': {e}"))?;

        // Compute 64-bit content hash of font bytes
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        font_bytes.hash(&mut hasher);
        font_id.hash(&mut hasher);
        let font_hash = hasher.finish();

        let mut write = self.fonts.write();
        write.insert(font_id.to_lowercase(), (Arc::new(font), font_hash));
        Ok(font_hash)
    }

    /// Retrieve a font by identifier. If the requested font is not found,
    /// falls back to the bundled default font to guarantee rendering never fails.
    pub fn get_font(&self, font_id: &str) -> (Arc<Font>, u64) {
        let key = font_id.to_lowercase();
        let read = self.fonts.read();
        if let Some(entry) = read.get(&key) {
            return (Arc::clone(&entry.0), entry.1);
        }

        // Fallback to default font
        if let Some(default_entry) = read.get(DEFAULT_FONT_ID) {
            return (Arc::clone(&default_entry.0), default_entry.1);
        }

        drop(read);
        // If even default was missing, re-register and return it
        let _ = self.register_font(DEFAULT_FONT_ID, DEFAULT_FONT_BYTES);
        let read = self.fonts.read();
        let entry = read.get(DEFAULT_FONT_ID).expect("Default font must be registered");
        (Arc::clone(&entry.0), entry.1)
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
        let (font, hash) = reg.get_font("default");
        assert!(hash > 0);
        assert!(font.glyph_count() > 0);
    }

    #[test]
    fn unknown_font_falls_back_to_default() {
        let reg = FontRegistry::new();
        let (default_font, default_hash) = reg.get_font("default");
        let (fallback_font, fallback_hash) = reg.get_font("non-existent-font-1234");
        assert_eq!(default_hash, fallback_hash);
        assert_eq!(default_font.glyph_count(), fallback_font.glyph_count());
    }

    #[test]
    fn register_custom_font() {
        let reg = FontRegistry::new();
        let hash = reg.register_font("inconsolata-custom", DEFAULT_FONT_BYTES).unwrap();
        assert!(reg.has_font("inconsolata-custom"));
        let (_, fetched_hash) = reg.get_font("inconsolata-custom");
        assert_eq!(hash, fetched_hash);
    }

    #[test]
    fn global_font_registry_is_singleton() {
        let r1 = global_font_registry() as *const _;
        let r2 = global_font_registry() as *const _;
        assert_eq!(r1, r2);
    }
}
