# Native-only Preview Proof Mode

The Tauri program preview can be run in a dev-only native proof mode. In this
mode, representable scenes must use the retained native wgpu surface for both
paused frames and playback. Unsupported scenes display a blocker so migration
gaps are visible during manual testing.

macOS/Linux:

```sh
VITE_CLYPRA_NATIVE_PREVIEW_ONLY=1 \
VITE_CLYPRA_NATIVE_PREVIEW_TRACE=1 \
npm run tauri dev
```

PowerShell:

```powershell
$env:VITE_CLYPRA_NATIVE_PREVIEW_ONLY = "1"
$env:VITE_CLYPRA_NATIVE_PREVIEW_TRACE = "1"
npm run tauri dev
```

Start with one local video clip that has a native-compatible solid background.
The preview header should show `Program Preview (Native-only)` and then
`wgpu Surface`. If the scene contains an unmigrated transition, background,
effect, unsupported text/sticker path, or the surface is not ready, the
proof-mode blocker lists the concrete migration reason instead of silently
rendering through a legacy browser compositor. Media backgrounds are decoded
as a native layer below the timeline. Gradient and shader backgrounds remain
explicit blockers until their native graph nodes are enabled.

The first transition proof case is two video clips with no text, sticker, or
mask layer. Cross-dissolve, directional wipe, and zoom-blur are composed by
the native wgpu transition pass for both the retained surface and readback.
Creative transitions such as glitch, film-burn, and luma-wipe remain blocked
until their shader contracts are implemented natively.

The bounded `glitch` video effect is now evaluated into native sampling
parameters and executed by the wgpu fragment shader. Creative transitions are
separate graph nodes and remain blocked when their transition contract is not
supported.

Wave, ripple, bulge, twist, and fisheye effects now share the native bounded
distortion sampling pass. Their evaluated time and strength travel as compact
uniforms; no browser canvas effect pass is required.

Static sticker image clips are uploaded as immutable native raster assets, then
composited by wgpu. Lottie frames and smart-overlay cards remain explicit
blockers until their primitives are evaluated in the native graph; the browser
overlay canvas is not an authoritative fallback. Animated GIF stickers use
the native FFmpeg media decoder directly, including timestamped seeks during
playback.

Raster-only scenes are valid native proof fixtures too: a smart-overlay or
text asset can be presented on the native surface without requiring a video
layer. This is useful for isolating surface, registration, and composition
problems before testing a full timeline.
