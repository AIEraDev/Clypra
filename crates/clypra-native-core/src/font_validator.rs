//! Font file and byte buffer validation.
//!
//! Enforces strict validation of TrueType, OpenType, WOFF, and WOFF2 binaries
//! before attempting decoding, parsing, or GPU resource allocation.
//! Matches the robustness discipline of Whisper model validation (`is_valid_whisper_model_file`).

use std::fmt;
use std::path::Path;

/// Maximum allowable font buffer size: 32 MiB.
pub const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;
/// Minimum allowable font buffer size: 12 bytes (sfnt offset table header).
pub const MIN_FONT_BYTES: usize = 12;

/// Supported binary font formats identified by header magic bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontFormat {
    /// TrueType font with quadratic Bézier outlines (`\0\x01\0\0` or `true`).
    TrueType,
    /// OpenType font with Compact Font Format (CFF / PostScript) outlines (`OTTO`).
    OpenTypeCff,
    /// TrueType Collection (`ttcf`).
    TrueTypeCollection,
    /// Web Open Font Format 1.0 (`wOFF`).
    Woff1,
    /// Web Open Font Format 2.0 (`wOF2`).
    Woff2,
}

impl fmt::Display for FontFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TrueType => write!(f, "TrueType"),
            Self::OpenTypeCff => write!(f, "OpenType (CFF)"),
            Self::TrueTypeCollection => write!(f, "TrueType Collection"),
            Self::Woff1 => write!(f, "WOFF 1.0"),
            Self::Woff2 => write!(f, "WOFF 2.0"),
        }
    }
}

/// Errors occurring during font byte buffer validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FontValidationError {
    /// The buffer was empty.
    EmptyBuffer,
    /// Buffer is smaller than the minimum 12-byte header.
    TooSmall { size: usize, minimum: usize },
    /// Buffer exceeds the 32 MiB size limit.
    ExceedsSizeLimit { size: usize, limit: usize },
    /// Magic bytes did not match any known font container signature.
    InvalidMagicBytes([u8; 4]),
    /// SFNT table count is invalid (< 4 or > 256).
    InvalidTableCount(u16),
    /// The table directory was truncated.
    TruncatedTableDirectory { expected: usize, actual: usize },
    /// A table record points out of buffer bounds.
    TableOutOfBounds {
        tag: String,
        offset: u64,
        length: u64,
        buffer_len: usize,
    },
    /// A required table for font rendering is missing.
    MissingRequiredTable(&'static str),
}

impl fmt::Display for FontValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyBuffer => write!(f, "Font byte buffer is empty"),
            Self::TooSmall { size, minimum } => {
                write!(f, "Font buffer too small ({size} bytes, minimum {minimum})")
            }
            Self::ExceedsSizeLimit { size, limit } => {
                write!(
                    f,
                    "Font buffer exceeds limit ({size} bytes > {limit} bytes)"
                )
            }
            Self::InvalidMagicBytes(b) => {
                write!(
                    f,
                    "Invalid font magic bytes: 0x{:02X}{:02X}{:02X}{:02X} (not TTF, OTF, TTC, or WOFF)",
                    b[0], b[1], b[2], b[3]
                )
            }
            Self::InvalidTableCount(c) => {
                write!(f, "Invalid SFNT table count: {c} (expected 4..=256)")
            }
            Self::TruncatedTableDirectory { expected, actual } => {
                write!(
                    f,
                    "Truncated table directory: expected {expected} bytes, got {actual}"
                )
            }
            Self::TableOutOfBounds {
                tag,
                offset,
                length,
                buffer_len,
            } => {
                write!(
                    f,
                    "Table '{tag}' bounds (offset {offset} + len {length}) exceed font length {buffer_len}"
                )
            }
            Self::MissingRequiredTable(t) => {
                write!(f, "Font is missing required table: '{t}'")
            }
        }
    }
}

impl std::error::Error for FontValidationError {}

/// Validates that a raw byte buffer contains a well-formed font binary
/// (TrueType, OpenType, WOFF, or WOFF2).
///
/// Performs magic-byte sniffing, size bounds checks, and table directory validation.
pub fn is_valid_font_bytes(bytes: &[u8]) -> Result<FontFormat, FontValidationError> {
    if bytes.is_empty() {
        return Err(FontValidationError::EmptyBuffer);
    }
    if bytes.len() < MIN_FONT_BYTES {
        return Err(FontValidationError::TooSmall {
            size: bytes.len(),
            minimum: MIN_FONT_BYTES,
        });
    }
    if bytes.len() > MAX_FONT_BYTES {
        return Err(FontValidationError::ExceedsSizeLimit {
            size: bytes.len(),
            limit: MAX_FONT_BYTES,
        });
    }

    let magic: [u8; 4] = [bytes[0], bytes[1], bytes[2], bytes[3]];

    // WOFF2 detection
    if &magic == b"wOF2" {
        return Ok(FontFormat::Woff2);
    }

    // WOFF1 detection
    if &magic == b"wOFF" {
        if bytes.len() < 44 {
            return Err(FontValidationError::TooSmall {
                size: bytes.len(),
                minimum: 44,
            });
        }
        return Ok(FontFormat::Woff1);
    }

    // TrueType Collection detection
    if &magic == b"ttcf" {
        return Ok(FontFormat::TrueTypeCollection);
    }

    // Determine SFNT container type
    let format = if magic == [0x00, 0x01, 0x00, 0x00] || &magic == b"true" || &magic == b"typ1" {
        FontFormat::TrueType
    } else if &magic == b"OTTO" {
        FontFormat::OpenTypeCff
    } else {
        return Err(FontValidationError::InvalidMagicBytes(magic));
    };

    // Validate table directory for standard SFNT (TTF / OTF)
    let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]);
    if !(4..=256).contains(&num_tables) {
        return Err(FontValidationError::InvalidTableCount(num_tables));
    }

    let required_header_len = 12 + (num_tables as usize) * 16;
    if bytes.len() < required_header_len {
        return Err(FontValidationError::TruncatedTableDirectory {
            expected: required_header_len,
            actual: bytes.len(),
        });
    }

    let mut has_cmap = false;
    let mut has_head = false;
    let mut has_outlines = false; // glyf or CFF 

    for i in 0..num_tables as usize {
        let entry_start = 12 + i * 16;
        let tag = &bytes[entry_start..entry_start + 4];
        let offset = u32::from_be_bytes([
            bytes[entry_start + 8],
            bytes[entry_start + 9],
            bytes[entry_start + 10],
            bytes[entry_start + 11],
        ]) as u64;
        let length = u32::from_be_bytes([
            bytes[entry_start + 12],
            bytes[entry_start + 13],
            bytes[entry_start + 14],
            bytes[entry_start + 15],
        ]) as u64;

        if offset.saturating_add(length) > bytes.len() as u64 {
            let tag_str = String::from_utf8_lossy(tag).to_string();
            return Err(FontValidationError::TableOutOfBounds {
                tag: tag_str,
                offset,
                length,
                buffer_len: bytes.len(),
            });
        }

        if tag == b"cmap" {
            has_cmap = true;
        } else if tag == b"head" {
            has_head = true;
        } else if tag == b"glyf" || tag == b"CFF " {
            has_outlines = true;
        }
    }

    if !has_cmap {
        return Err(FontValidationError::MissingRequiredTable("cmap"));
    }
    if !has_head {
        return Err(FontValidationError::MissingRequiredTable("head"));
    }
    if !has_outlines {
        return Err(FontValidationError::MissingRequiredTable("glyf/CFF"));
    }

    Ok(format)
}

/// Checks whether a file at `path` exists, is within the size budget, and contains
/// a valid TrueType, OpenType, or WOFF font binary.
pub fn is_valid_font_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    let len = metadata.len() as usize;
    if !(MIN_FONT_BYTES..=MAX_FONT_BYTES).contains(&len) {
        return false;
    }

    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    is_valid_font_bytes(&bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_empty_and_undersized() {
        assert_eq!(
            is_valid_font_bytes(&[]),
            Err(FontValidationError::EmptyBuffer)
        );
        assert_eq!(
            is_valid_font_bytes(&[0, 1, 2]),
            Err(FontValidationError::TooSmall {
                size: 3,
                minimum: 12
            })
        );
    }

    #[test]
    fn reject_invalid_magic() {
        let fake_bytes = [0xde, 0xad, 0xbe, 0xef, 0, 4, 0, 0, 0, 0, 0, 0];
        assert_eq!(
            is_valid_font_bytes(&fake_bytes),
            Err(FontValidationError::InvalidMagicBytes([
                0xde, 0xad, 0xbe, 0xef
            ]))
        );
    }

    #[test]
    fn accept_woff2_magic() {
        let mut woff2_dummy = vec![0u8; 64];
        woff2_dummy[0..4].copy_from_slice(b"wOF2");
        assert_eq!(is_valid_font_bytes(&woff2_dummy), Ok(FontFormat::Woff2));
    }

    #[test]
    fn accept_woff1_magic() {
        let mut woff1_dummy = vec![0u8; 64];
        woff1_dummy[0..4].copy_from_slice(b"wOFF");
        assert_eq!(is_valid_font_bytes(&woff1_dummy), Ok(FontFormat::Woff1));
    }

    #[test]
    fn reject_sfnt_truncated_directory() {
        let mut sfnt = vec![0u8; 20];
        sfnt[0..4].copy_from_slice(&[0x00, 0x01, 0x00, 0x00]);
        // num_tables = 5 -> requires 12 + 5 * 16 = 92 bytes
        sfnt[4] = 0;
        sfnt[5] = 5;
        assert!(matches!(
            is_valid_font_bytes(&sfnt),
            Err(FontValidationError::TruncatedTableDirectory { .. })
        ));
    }
}
