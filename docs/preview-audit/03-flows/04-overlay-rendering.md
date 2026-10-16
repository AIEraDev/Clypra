# Flow 04: Overlay Rendering Architecture

This document describes the compositing pipeline for text, stickers, transform handles, and safe zone overlays across both native GPU and DOM preview layers.

---

## 1. Dual Overlay Execution Model

Overlays exist in two distinct representations depending on the active preview presenter mode:

```
                      ┌───────────────────────────────────────┐
                      │        Timeline Overlay Layers        │
                      │        (Text, Stickers, Shapes)       │
                      └──────────────────┬────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │                               │
                 [Playback Mode]                   [Paused Mode]
                         │                               │
                         ▼                               ▼
       ┌──────────────────────────────────┐    ┌──────────────────────────────────┐
       │   Native GPU Raster Texture      │    │        DOM & React Overlays      │
       │   (Composited in Rust Shaders)   │    │   (Rendered on top of <canvas>)  │
       └──────────────────────────────────┘    └──────────────────────────────────┘
```

---

## 2. Native Hardware Overlay Compositing

During continuous playback on the native GPU surface:
1. **Raster Asset Registration**:
   - Text elements are prerasterized into RGBA bitmap buffers via offscreen canvas (`[CODE:src/components/editor/preview/nativeTextPreview.ts#L450]`).
   - Prerasterized buffers are uploaded to the GPU texture pool using `register_native_raster_asset` (`[CODE:src/lib/platform/tauri.ts#L800]`).
   - The asset ID and transform matrix are referenced in `NativeFrameRequest.rasterLayers`.
2. **GPU Texture Blending**:
   - In `src-tauri/src/wgpu_compositor/render_pass.rs`, the GPU compositor binds the uploaded raster texture, applies the layer transform, and blends it over underlying video streams using premultiplied alpha shaders.
3. **Transition Ordering**:
   - Overlay layers (index >= 2) composite on top of video transitions, ensuring that stickers and titles remain visible while underlying video clips undergo crossfades or slide transitions (`[CODE:src-tauri/src/commands/native_preview.rs#L4000]`).

---

## 3. Paused DOM Overlay Presentation

During paused editing and playhead scrubbing:
1. The native GPU surface is hidden via the pause handover protocol (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4430]`).
2. Video frames paint directly onto the HTML5 `<canvas>` element.
3. Interactive DOM components render directly above the canvas inside the preview container:
   - `TransformOverlay.tsx`: Interactive bounding box handles for scale, rotation, and translation.
   - `SafeOverlay.tsx`: Action-safe and title-safe guidelines.
   - `SpatialMotionPath.tsx`: Keyframe motion trajectories and control points.
