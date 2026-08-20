# Native-only Preview Proof Mode

The Tauri program preview can be run in a dev-only native proof mode. In this
mode, representable scenes must use the retained native wgpu surface for both
paused frames and playback. Pixi is not used as a silent fallback; unsupported
scenes display a blocker so migration gaps are visible during manual testing.

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
effect, text/sticker path, or the surface is not ready, the proof-mode blocker
is shown instead of rendering through Pixi.

The first transition proof case is two video clips with no text, sticker, or
mask layer. Cross-dissolve, directional wipe, and zoom-blur are composed by
the native wgpu transition pass for both the retained surface and readback.
Creative transitions such as glitch, film-burn, and luma-wipe remain blocked
until their shader contracts are implemented natively.

Static sticker image clips, evaluated Lottie frames, and smart-overlay cards are
uploaded as immutable native raster assets, then composited by wgpu. The
browser overlay canvas is hidden after native presentation succeeds, so the
same card is not drawn twice. Lottie frame evaluation still uses the
Studio-compatible JS asset library; only the resulting pixels cross the native
bridge. Animated GIF stickers use the native FFmpeg media decoder directly,
including timestamped seeks during playback.

Raster-only scenes are valid native proof fixtures too: a smart-overlay or
text asset can be presented on the native surface without requiring a video
layer. This is useful for isolating surface, registration, and composition
problems before testing a full timeline.
