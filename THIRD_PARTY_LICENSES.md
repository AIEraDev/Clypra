# Third-Party Licenses & Legal Notices

Clypra is free and open-source software licensed under the [MIT License](LICENSE).

To provide high-performance video export, audio decoding, and thumbnail generation without requiring users to install external command-line tools, Clypra distributes pre-compiled standalone binary sidecars of FFmpeg and FFprobe.

---

## FFmpeg & FFprobe

- **Project Home**: [https://ffmpeg.org](https://ffmpeg.org)
- **Source Code**: [https://git.ffmpeg.org/ffmpeg.git](https://git.ffmpeg.org/ffmpeg.git)
- **License**: GNU General Public License (GPL) version 2.1 or later / GNU GPL version 3 or later.

FFmpeg is an open-source multimedia framework licensed under the GNU Lesser General Public License (LGPL) and GNU General Public License (GPL). The standalone FFmpeg executables bundled with Clypra are compiled with GPL-licensed components enabled (such as `libx264` and `libx265`).

### Binary Provenance & Original Builders

The pre-compiled static FFmpeg and FFprobe binaries distributed with Clypra are sourced via the vetted, community-trusted distribution repository [`eugeneware/ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) (release `b6.1.1`), which redistributes static binaries produced by the following original builders:

- **macOS Apple Silicon (`aarch64-apple-darwin`)**: Built by **OSXExperts** ([osxexperts.net](https://osxexperts.net/)). Compiled with Apple VideoToolbox hardware acceleration and GPL codecs (`libx264`, `libx265`, `libvpx`).
- **macOS Intel (`x86_64-apple-darwin`)**: Built by **Helmut K. C. Tessarek** ([evermeet.cx/pub/ffmpeg/](https://evermeet.cx/pub/ffmpeg/)).
- **Linux x86_64 (`x86_64-unknown-linux-gnu`)**: Built by **John Van Sickle** ([johnvansickle.com/ffmpeg/](https://johnvansickle.com/ffmpeg/)).
- **Windows x86_64 (`x86_64-pc-windows-msvc`)**: Built by **Gyan Doshi** ([gyan.dev/ffmpeg/builds/](https://www.gyan.dev/ffmpeg/builds/)).

Each downloaded artifact is strictly verified in CI against an immutable SHA-256 cryptographic digest before being packaged into release bundles.

### Vulnerability Management & Review Cadence

Because FFmpeg processes untrusted multimedia bitstreams and has an active CVE history, Clypra adheres to a **Quarterly Static Dependency Review Cadence**:
- **Schedule**: Every January, April, July, and October.
- **Protocol**: Verify upstream releases across original builder repositories, update pinned SHA-256 digests in release automation, and rebuild release packages against the latest patched branch.

### Source Code Availability

Pursuant to the GNU General Public License (GPLv2 §3 and GPLv3 §6), the complete corresponding source code for the FFmpeg executables distributed with Clypra is available upon request and can be cloned or downloaded directly from the official upstream repositories:

- FFmpeg 6.1.1 Source Release: [https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz](https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz)
- Upstream Git Repository: [https://git.ffmpeg.org/ffmpeg.git](https://git.ffmpeg.org/ffmpeg.git)

### Build Configuration

The binaries bundled in Clypra distribution packages are standalone static builds configured substantially as follows:

```bash
./configure \
  --enable-gpl \
  --enable-nonfree \
  --enable-libx264 \
  --enable-libx265 \
  --enable-libvpx \
  --enable-pic \
  --enable-static \
  --disable-shared
```

On macOS, native Apple hardware acceleration (`--enable-videotoolbox`, `--enable-audiotoolbox`) is enabled. On Windows and Linux, hardware encoder interfaces (NVENC, AMF, QSV) are supported where compatible driver libraries are present on the host operating system.

### Process Isolation

Clypra executes FFmpeg and FFprobe as independent, standalone child processes through operating system process spawning mechanisms (`fork`/`exec` on Unix, `CreateProcess` on Windows). Clypra does not link proprietary closed code into the FFmpeg binary itself.

---

## Other Components

- **Whisper**: Local speech-to-text models licensed under the MIT License ([OpenAI Whisper](https://github.com/openai/whisper)).
- **wgpu**: Safe and portable GPU abstraction in Rust licensed under MIT / Apache 2.0.
- **Tauri**: Application framework licensed under Apache 2.0 / MIT.

---

## Stickers & Vector Assets

The Clypra desktop application bundles and distributes open-source and Creative Commons sticker animations and vector artwork:

- **Google Noto Emoji & Animated Emoji**:
  - **Author**: Google Noto Emoji Team
  - **Source**: [https://github.com/googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji)
  - **License**: Creative Commons Attribution 4.0 International ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/))
  - **Notice**: Designed by Google Noto Emoji under CC BY 4.0 license.

- **Kenney Game & UI Assets**:
  - **Author**: Kenney ([kenney.nl](https://kenney.nl))
  - **License**: Creative Commons Zero 1.0 Universal ([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)) Public Domain Dedication.

- **Clypra Original Assets**:
  - **Author**: Clypra Studio & Contributors
  - **License**: Distributed with Clypra under the [MIT License](LICENSE) / LicenseRef-Clypra-Original.

