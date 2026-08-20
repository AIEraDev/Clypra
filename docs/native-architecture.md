# Native Media Architecture

Status: migration branch `codex/native-architecture-migration`.

## Authority

Desktop Tauri is the authoritative runtime. Rust owns timeline evaluation,
native decode, color normalization, frame graph evaluation, playback timing,
thumbnails, filmstrips, and export. React owns editor controls and project
state presentation. The native surface is the only authoritative preview and
export presentation path.

## Contract invariants

- IPC frame addressing uses integer `FrameTime` values; floating-point seconds
  are permitted only inside native implementation adapters.
- Every frame request includes project revision, request ID, frame index,
  quality, color-policy version, render-graph version, and asset identity.
- SDR rendering uses linear Rec.709 working math and physical-pixel sRGB
  output. HDR is tone-mapped to SDR for editing preview by default.
- VFR media is mapped deterministically onto the project CFR frame index.
- A response is stale when its request ID, project revision, or frame index no
  longer matches the active request. Stale responses must be discarded.
- The last valid frame remains visible during decode, seek, resize, and GPU
  recovery.

## Playback policy

The native audio sample clock is the final playback authority. Until native
audio output is available, the existing runtime may act as a migration adapter,
but it must not define frame addressing or color conversion. Video frames more
than 20 ms behind audio are dropped; audio is never delayed for late video.
The target A/V drift is +/-16 ms, with 100 ms minimum audio buffering and 200
ms maximum video lookahead. Play at the terminal frame restarts at frame zero.

## Migration gates

1. Contract and golden harness: native requests are deterministic.
2. Surface spike: physical-pixel geometry, DPI, resize, and device recovery are
   proven on macOS, Windows, and Linux.
3. Frame service: paused frames, stills, thumbnails, and filmstrips use the
   reusable native decoder boundary.
4. Frame graph: video and all manifest features use one native graph.
5. Preview/playback: React sends intents; native owns frame selection and
   audio-clock playback.
6. Export: preview and export consume the same graph.
7. Retirement: browser media ownership and duplicate render paths are deleted.

The current implementation has the versioned frame contract, byte-bounded
native cache, native frame command, playback policy/session types, and a real
main-thread Tauri/wgpu child-surface setup that retains a transparent,
pointer-transparent preview surface for the preview session. Filmstrip
migration and paused native frames are active
on desktop. The native playback coordinator is now exposed as an opt-in
command boundary without taking authority from the current browser adapter.
The native audio gate now has a CPAL output stream and hardware callback clock,
bounded FFmpeg-to-f32 PCM decoding, and a deterministic bounded multi-clip
mixer with timeline seek, pause, gain, overlap summing, and device-rate
conversion. The Tauri program preview now performs a controlled native-audio
takeover and samples that clock into the shared PlaybackClock, including speed
and seek re-anchoring. Representable video scenes also have a non-blocking
continuous native-frame path. Direct
surface presentation is now implemented as a retained child-surface command
with physical-pixel positioning, stale-request rejection, and swapchain
recovery. Full native effects/text and legacy retirement remain gated work.
