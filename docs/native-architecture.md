# Native Media Architecture

Program Preview performance changes must follow the
[Program Preview Performance Runbook](program-preview-performance-runbook.md)
and the [Native Performance Contract](performance-contract.md). These documents
are the durable guardrails for path separation, stale-frame handling, telemetry,
and release validation.

All native changes also follow the project-wide
[Architecture-First Delivery ADR](architecture-first-delivery-adr.md): a native
authority failure must be diagnosed at its owning boundary, never hidden by a
silent browser fallback.

Status: desktop native authority migration is active; contract v2 is the
current wire format.

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
audio output is available, desktop playback remains visibly unavailable rather
than silently transferring authority to browser audio. Browser preview is a
separate browser-runtime implementation, never a desktop fallback. Video
frames more than 20 ms behind audio are dropped; audio is never delayed for
late video. The target A/V drift is +/-16 ms, with 100 ms minimum audio
buffering and 200 ms maximum video lookahead. Play at the terminal frame
restarts at frame zero.

When native audio is silent, `get_native_audio_diagnostics` reports evidence
derived from the same clock and mixer that render production audio: installed
clips, timeline-active clip IDs, a next-window mixer peak, callback/rendered/
non-silent frame counts, and output-device status. This identifies the owning
boundary—clip discovery/install, timeline activation, decode/envelope/mixing,
callback handoff, or device routing—without creating a second playback graph.

### Export audio routing

The native cut-only export path is eligible only for video-only timeline
composition. It can preserve audio embedded in the source video files, but its
native plan does not carry independent timeline audio clips. If an active
audio-kind clip, audio asset, or explicit `audioPath` is present, native
eligibility is rejected and the compositor export path is used. That path calls
`getActiveAudioClips()` and passes the complete standalone audio mix to FFmpeg,
including timeline position, trims, volume, fades, and automation.

### Derived audio media

Audio extraction is not an automatic fallback for video-backed clips. If it is
adopted for a measured native performance need, it is a first-class derived
media feature: the project records the source asset, source stream, extraction
recipe/version, and deterministic cache key; the derived asset has an explicit
lifecycle; timeline clips reference that asset; and native preview, browser
preview, serialization, and export consume the same resolved media reference.
An extraction cache must be reusable across clips and invalidated by its source
or recipe, never created as a one-off `audioPath` substitution. The default
materialization policy is lazy: derive only after a measured need requests it,
then reuse the deterministic disk-cached result. Importing a video must not
eagerly create audio media that the project may never use.

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
on desktop. Paused, seek, scrub, frame-step, and continuous preview requests
now target that retained surface; RGBA readback remains an export/diagnostic
operation only. Text snapshots carry resolved font variants, alignment,
panels, stroke/shadow, karaoke runs, template data, and normalized effect
passes. Native font registration is explicit and authoritative lookup rejects
missing families.
The native audio gate now has a CPAL output stream and hardware callback clock,
bounded FFmpeg-to-f32 PCM decoding, and a deterministic bounded multi-clip
mixer with timeline seek, pause, gain, overlap summing, and device-rate
conversion. The Tauri program preview now performs a controlled native-audio
takeover and samples that clock into the shared PlaybackClock, including speed
and seek re-anchoring. Representable video scenes also have a non-blocking
continuous native-frame path. Direct
surface presentation is implemented as a retained child-surface command with
physical-pixel positioning, stale-request rejection, and swapchain recovery.
Remaining graph work is tracked explicitly by native-only blockers (notably
procedural backgrounds, Lottie/smart-overlay primitives, and the remaining
text effect shader primitives) until their pixels are produced in Rust.

## Cross-Platform Tolerance

### What CI proves vs. what requires hardware validation

The `native-golden` CI workflow (`.github/workflows/native-golden.yml`) runs
`clypra-native-cli render` + `diff` on macOS (Metal), Windows, and Linux on
every PR that touches the compositor or shaders. **What this proves:**

- WGSL shaders compile and execute on all three wgpu backends.
- Compositor math is self-consistent (same-machine determinism confirmed).
- Any shader logic regression produces a measurable pixel delta and fails CI.

**What this does not prove:** Real hardware GPU parity. GitHub-hosted Windows
and Linux runners have no dedicated GPU. wgpu falls back to software
rasterizers (WARP on Windows, Mesa Lavapipe on Linux). The CI adapter line in
each job summary confirms which path ran. A software-rasterizer run validates
portability, not driver behaviour.

### Mandatory hardware validation gate — required before v0.1.0

Real cross-platform hardware parity must be verified on at least one physical
Windows GPU and one physical Linux GPU before v0.1.0 ships. This is a hard
pre-release gate, not an open-ended TODO.

**Procedure:**

1. Build `clypra-native-cli` on the target machine.
2. Run `clypra-native-cli render fixtures/minimal-request.json /tmp/minimal.png`
   and `clypra-native-cli render fixtures/raster-request.json /tmp/raster.png`.
3. Copy the PNGs back and run `clypra-native-cli diff` against the Metal
   reference PNGs in `fixtures/`.
4. Record the full result in the **Hardware Validation Log** section below.

### Hardware Validation Log

Each entry must record: platform, GPU model, driver version, wgpu backend,
and the full `GoldenDiff` JSON output for each fixture. "Passed" alone is not
an acceptable entry — the raw numbers are required so future regressions can
be distinguished from driver-update-induced drift.

**Format:**

```
Date:     YYYY-MM-DD
Platform: Windows 11 / Linux (distro + kernel)
GPU:      <adapter name from clypra-native-cli output>
Driver:   <version string — Device Manager on Windows, `glxinfo`/`vulkaninfo` on Linux>
Backend:  DX12 / Vulkan
Fixture: minimal-request.json
  maxChannelError:  N
  differingPixels:  N / 57600
  meanChannelError: N.NNNN
Fixture: raster-request.json
  maxChannelError:  N
  differingPixels:  N / 16
  meanChannelError: N.NNNN
Notes: <anything relevant — driver quirks, fallback path, etc.>
```

**Completed runs:**

| Date       | Platform         | GPU                                | Driver        | Backend | minimal max err | raster max err |
| ---------- | ---------------- | ---------------------------------- | ------------- | ------- | --------------- | -------------- |
| 2026-08-21 | macOS (Apple M1) | Apple M1                           | Metal default | Metal   | 0               | 0              |
| —          | Windows          | _pending — required before v0.1.0_ | —             | DX12    | —               | —              |
| —          | Linux            | _pending — required before v0.1.0_ | —             | Vulkan  | —               | —              |

The macOS Metal reference is the baseline. All other platforms diff against it.

### WASM parity (Phase 1 — pending `clypra-render-wasm`)

Once `clypra-render-wasm` exists, a fourth matrix entry will be added to the
CI workflow running the same fixtures through the WASM build and diffing
against the Metal native reference. Tolerance TBD from first real measured run.
The WASM leg measures "browser WebGPU vs. native Metal compositor" drift —
a different claim than cross-platform native consistency, tracked separately.

### WASM browser validation — required before v0.1.0

The WASM parity CI job runs headless Chrome which uses SwiftShader (software
Vulkan). This validates shader portability, not real-hardware browser parity.
Before v0.1.0 ships, the smoke-test page (`crates/clypra-render-wasm/test/`)
must be run manually in both Chrome and Firefox (if available) and results
recorded below. Firefox is optional if no installation is available — the
WebGL2 path is still covered by the "Force WebGL2" test in Chrome which
uses ANGLE/Metal and is functionally equivalent on macOS.

**Procedure:**

1. Start a local server: `cd crates/clypra-render-wasm && wasm-pack build --target web && python3 -m http.server 8792`
2. Open `http://localhost:8792` in Chrome → click "Run (auto-detect backend)"
3. Click "Force WebGL2 path" in Chrome → confirm WebGL2 fallback works
4. Open in Firefox → run both auto-detect and force-WebGL2
5. Record all four runs in the log below

**Format:** same as the native hardware log above.

| Date       | Browser             | Adapter                                       | Backend       | px(0,0)     | px(1,1)       | bytes | Software? |
| ---------- | ------------------- | --------------------------------------------- | ------------- | ----------- | ------------- | ----- | --------- |
| 2026-08-21 | Chrome/macOS        | Apple M1                                      | BrowserWebGpu | (0,0,0,255) | (255,0,0,255) | 132   | No        |
| —          | Chrome WebGL2       | _pending_                                     | Gl            | —           | —             | —     | —         |
| 2026-08-21 | Chrome/macOS WebGL2 | ANGLE (Apple, ANGLE Metal Renderer: Apple M1) | Gl            | (0,0,0,255) | (255,0,0,255) | 132   | No        |
| —          | Firefox/macOS       | _optional — no Firefox available_             | Gl            | —           | —             | —     | —         |
| —          | Firefox WebGL2      | _optional — covered by Chrome WebGL2 above_   | Gl            | —           | —             | —     | —         |
