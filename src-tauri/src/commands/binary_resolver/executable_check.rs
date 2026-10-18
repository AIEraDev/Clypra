use std::path::Path;

/// Check if a path points to a genuine, runnable executable file rather than a
/// placeholder or text stub.
///
/// On Windows, sidecar stubs in the repo have `.exe` extensions but contain
/// batch scripts starting with `@echo off`. Attempting to spawn them directly
/// via `Command::new` causes `ERROR_EXE_MACHINE_TYPE_MISMATCH (os error 216)`:
/// "This version of %1 is not compatible with the version of Windows you're running."
/// Genuine Windows PE executables must begin with the `MZ` DOS magic header.
///
/// On macOS/Linux the repo ships shell-script stubs (starting with `#!`) in
/// place of real binaries for non-native target triples. These stubs are valid
/// files with the execute bit set, so a plain `is_file()` check accepts them.
/// We reject any file whose first two bytes form a shebang (`#!`) because no
/// real native binary (Mach-O: `\xCF\xFA` / `\xFE\xED`, ELF: `\x7FELF`) starts
/// with those bytes. We also enforce a minimum size floor: real FFmpeg builds
/// are tens of megabytes; any file smaller than 1 MB is certainly not a usable
/// native binary and is rejected regardless of magic bytes.
pub fn is_real_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    // Read the first 4 bytes to inspect the magic header.
    // All real native binary formats start with a recognisable magic number
    // that is entirely distinct from the ASCII characters used by shell/batch stubs.
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    if f.read_exact(&mut magic).is_err() {
        // File is smaller than 4 bytes — definitely not a real binary.
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let is_exe = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
        if is_exe {
            use std::io::{Seek, SeekFrom};

            // 1. Must have DOS header starting with "MZ" (0x4D, 0x5A)
            if magic[0] != 0x4D || magic[1] != 0x5A {
                return false;
            }

            // Read the full 64-byte DOS header to reach e_lfanew at 0x3C.
            let mut dos_rest = [0u8; 60];
            if f.read_exact(&mut dos_rest).is_err() {
                return false;
            }
            let mut dos_header = [0u8; 64];
            dos_header[..4].copy_from_slice(&magic);
            dos_header[4..].copy_from_slice(&dos_rest);

            // 2. Read e_lfanew (offset to PE header) at offset 0x3C
            let pe_offset = u32::from_le_bytes([
                dos_header[0x3C],
                dos_header[0x3D],
                dos_header[0x3E],
                dos_header[0x3F],
            ]) as u64;

            // Basic sanity check on PE header offset
            if !(64..=10_000_000).contains(&pe_offset) {
                return false;
            }

            if f.seek(SeekFrom::Start(pe_offset)).is_err() {
                return false;
            }

            // 3. Must have "PE\0\0" signature (0x50, 0x45, 0x00, 0x00)
            let mut pe_sig = [0u8; 4];
            if f.read_exact(&mut pe_sig).is_err() || &pe_sig != b"PE\0\0" {
                return false;
            }

            // 4. Read IMAGE_FILE_HEADER Machine field (2 bytes)
            let mut machine_bytes = [0u8; 2];
            if f.read_exact(&mut machine_bytes).is_err() {
                return false;
            }
            let machine = u16::from_le_bytes(machine_bytes);

            // Machine architecture compatibility check:
            // 0x8664 = IMAGE_FILE_MACHINE_AMD64 (x86_64)
            // 0xAA64 = IMAGE_FILE_MACHINE_ARM64 (aarch64)
            // 0xA641 = IMAGE_FILE_MACHINE_ARM64EC (ARM64 Emulation Compatible)
            // 0x014C = IMAGE_FILE_MACHINE_I386  (x86 32-bit)
            #[cfg(target_arch = "x86_64")]
            {
                // Native x86_64 hosts can execute AMD64 (0x8664) and i386 (0x014C) via WOW64.
                // They cannot execute native ARM64 (0xAA64) or ARM64EC (0xA641) binaries.
                if machine == 0xAA64 || machine == 0xA641 {
                    return false;
                }
            }

            #[cfg(target_arch = "aarch64")]
            {
                // Native ARM64 hosts can execute ARM64 (0xAA64), ARM64EC (0xA641),
                // and on Windows 11 transparently emulate AMD64 (0x8664) and i386 (0x014C).
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // Reject shell/batch stubs: they start with `#!` (shebang, 0x23 0x21).
        // Real native binaries never start with ASCII text characters:
        //   Mach-O 64-bit little-endian: CF FA ED FE
        //   Mach-O 64-bit big-endian:    FE ED FA CF
        //   Mach-O fat binary:           CA FE BA BE
        //   ELF:                         7F 45 4C 46
        if magic[0] == b'#' && magic[1] == b'!' {
            log::debug!(
                "[BinaryResolver] Rejected shell stub at {:?} (shebang header)",
                path
            );
            return false;
        }

        // Enforce minimum size: real FFmpeg/FFprobe binaries are many megabytes.
        // A file smaller than 1 MB cannot be a real native binary.
        let Ok(meta) = std::fs::metadata(path) else {
            return false;
        };
        if meta.len() < 1_000_000 {
            log::debug!(
                "[BinaryResolver] Rejected undersized file at {:?} ({} bytes < 1 MB minimum)",
                path,
                meta.len()
            );
            return false;
        }
    }

    true
}
