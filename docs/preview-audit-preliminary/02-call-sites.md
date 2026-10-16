# Preview Subsystem Call-Site Inventory

This document provides a comprehensive inventory of all IPC invocations, clock subscriptions, and drawing pipeline call-sites across the Clypra Program Preview subsystem (`v1.6.1`).

---

## 1. Tauri Native IPC Invocations

All communication between the frontend React application and the Rust backend executes through Tauri's `invoke` IPC mechanism. The table below catalogs every call-site related to video presentation, surface control, and frame readback.

| IPC Command | Frontend Wrapper Function | Wrapper Line | Invocation Call-Sites | Transport Payload | Return Type | Thread Affinity / Execution Context |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `present_native_frame` | `presentNativeFrame()` | `[CODE:src/lib/platform/tauri.ts#L560]` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3570]` | `NativeFrameRequest` (metadata, layers, transforms) | `NativeSurfacePresentation` | Background worker -> Wgpu Queue submit -> Metal/DX12 present |
| `submit_native_playback_demand` | `submitNativePlaybackDemand()` | `[CODE:src/lib/platform/tauri.ts#L643]` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3540]` | `NativePlaybackFrameDemand` (playhead time, generation) | `void` (fire-and-forget demand queue) | Non-blocking ring-buffer dispatch |
| `render_native_frame` | `renderNativeFrame()` | `[CODE:src/lib/platform/tauri.ts#L377]` | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3800]` | `NativeFrameRequest` | `ArrayBuffer` (RGBA uncompressed or 12-byte UNCH sentinel) | Tokio background thread -> CPU staging readback buffer |
| `probe_native_surface` | `probeNativeSurface()` | `[CODE:src/lib/platform/tauri.ts#L1093]` | `[CODE:src/core/runtime/nativeSurfaceLifecycle.ts#L125]` | `NativeSurfaceGeometry` (physical rect + DPR) | `NativeSurfaceProbe` | Main OS UI thread (`run_on_main_thread`) |
| `resize_native_surface` | `resizeNativeSurface()` | `[CODE:src/lib/platform/tauri.ts#L1157]` | `[CODE:src/core/runtime/nativeSurfaceLifecycle.ts#L190]` | `NativeSurfaceGeometry` | `NativeSurfaceProbe` | Main OS UI thread (`run_on_main_thread`) |
| `hide_native_surface` | `hideNativeSurface()` | `[CODE:src/lib/platform/tauri.ts#L1167]` | `[CODE:src/core/runtime/nativeSurfaceLifecycle.ts#L225]`, `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4430]` | None | `void` | Main OS UI thread (`run_on_main_thread`) |
| `register_native_raster_asset` | `registerNativeRasterAsset()` | `[CODE:src/lib/platform/tauri.ts#L800]` | `[CODE:src/components/editor/preview/nativeTextPreview.ts#L450]`, `[CODE:src/components/editor/preview/nativeStickerPreview.ts#L180]` | Raw byte payload / Base64 metadata + RGBA buffer | `void` | Wgpu device texture upload queue |
| `unregister_native_raster_asset`| `unregisterNativeRasterAsset()` | `[CODE:src/lib/platform/tauri.ts#L270]` | `[CODE:src/components/editor/preview/nativeTextPreview.ts#L520]`, `[CODE:src/components/editor/preview/nativeStickerPreview.ts#L220]` | `assetId: string` | `void` | Texture pool eviction |
| `capture_preview_frame` | IPC debug route | `[CODE:src-tauri/src/commands/debug.rs#L85]` | `[CODE:scripts/harness/verify-native-preview-readback.mjs#L110]` | None | `Vec<u8>` (uncompressed frame readback) | Debug-only build gate (`#[cfg(debug_assertions)]`) |

---

## 2. Timeline Evaluation Call-Sites (`evaluateTimelineSceneCached`)

The immutable scene graph projection (`EvaluatedScene`) is produced strictly by `evaluateTimelineSceneCached()`. direct access to `timelineStore` is prohibited within render loops (`[CODE:AGENTS.md#Architectural Invariant 2]`).

| Call-Site Location | File & Line | Invocation Context | Handled Signals | Fallback Behavior |
| :--- | :--- | :--- | :--- | :--- |
| Lookahead Pre-Evaluation | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L1051]` | Pre-roll cache generation during idle/pause | `currentTime`, `renderStateRef.current.clips` | Cached scene reused across frames |
| Text Rasterizer Pre-Pass | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2420]` | Offscreen rasterization of text overlays | Text style changes, transform revisions | Skips re-raster if font and content unchanged |
| Sticker Dimension Check | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2555]` | Sticker bounding-box resolution | Sticker asset ID, scale factor | Fallback to placeholder rect while downloading |
| Primary Frame Render Loop | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2953]` | Animation frame dispatch (`renderLoop()`) | Playhead time, transport revision, project resolution | Bails early if evaluation matches previous frame index |

---

## 3. Playback Clock Subscription Call-Sites (`PlaybackClock.ts`)

| Subscriber Location | File & Line | Event Type | Target Action | Guarding Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| Clock State Listener | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4580]` | `playbackClock.subscribe()` | Triggers `forceRenderNeeded = true` and calls `scheduleNextFrame()` | Closure-guarded: skips dispatch if `isActive = false` |
| Transport Controls | `[CODE:src/components/editor/preview/PreviewTransport.tsx#L95]` | `playbackClock.subscribe()` | Updates play/pause button state and playhead timestamp display | React `useState` batching |
| Scrub / Seek Settling | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4610]` | Clock seek event | Resets `lastRenderedFrameIndex = -1` and sets `isSettling = true` | Settling watchdog timer (150ms timeout) |

---

## 4. Canvas Drawing Context Call-Sites

During paused inspection, playhead scrubbing, or fallback presentation, frames are transferred to the DOM `<canvas>` backing store:

| Call-Site Location | File & Line | Context Method | Target Context | Optimization Guard |
| :--- | :--- | :--- | :--- | :--- |
| Paint Video Frame | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L202]` | `context.putImageData(image, 0, 0)` | 2D canvas context (`canvasEl.getContext("2d")`) | Skipped entirely if Rust returns `UNCH` sentinel (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2140]`) |
| Draw Bitmap Frame | `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2160]` | `context.drawImage(bitmap, 0, 0)` | 2D canvas context | Used when `createImageBitmap` is supported to bypass main thread decoding overhead |
| Clear Canvas Surface | `[CODE:src/components/editor/preview/canvasBackground.ts#L45]` | `context.clearRect(0, 0, width, height)` | 2D canvas context | Executed on project close, resize, or timeline clear |
