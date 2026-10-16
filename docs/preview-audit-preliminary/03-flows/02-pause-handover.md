# Flow 02: Pause Handover & Surface Occlusion Management

This document details the handover protocol executed when playback transitions from playing to paused, maintaining visual continuity and unoccluded DOM editing overlays.

---

## 1. Operating System Child-Surface Occlusion Hierarchy

On desktop operating systems (AppKit on macOS, Win32 on Windows), native GPU surfaces hosted inside child windows (via `CAMetalLayer` or `HWND` swapchains) reside in front of the application's WebView window hierarchy:

- **During Active Continuous Playback**:
  - The native surface child window is visible and positioned directly over the video viewport.
  - Video decoding and composition bypass the browser engine completely.
- **During Paused Inspection & Editing**:
  - React overlays (`TransformOverlay`, `SafeOverlay`, `SpatialMotionPath`, and text inline editors) must accept mouse events and render on top of the video frame.
  - The native child window must be hidden (`hide_native_surface`) so that the WebView's HTML5 `<canvas>` and DOM overlays become visible and interactable.

---

## 2. The Atomic Handover Protocol

Hiding the native surface immediately upon pausing would expose an unpainted or blank canvas for one or more frames, producing a visible black flicker or stale-frame flash. Clypra eliminates this through a two-phase atomic handover:

```
[User Pauses Playback]
         │
         ▼
[NativeProgramPreview: set pendingHandoverSurfaceHide = true]
[Start 1000ms Safety Timer (handoverSafetyTimer)]
         │
         │ (Native child surface remains visible in foreground)
         │
         ▼
[Dispatch renderNativeFrame IPC for current paused timestamp]
         │
         ▼
[Rust renders offscreen frame and returns RGBA buffer or UNCH]
         │
         ▼
[Frontend paints paused frame onto canvasEl 2D context]
         │
         ▼
[Handover Complete: Cancel handoverSafetyTimer]
[Set pendingHandoverSurfaceHide = false, nativeSurfaceShown = false]
[Dispatch hideNativeSurface() via window.run_on_main_thread()]
         │
         ▼
(DOM Overlays and Canvas are now visible; native surface is hidden)
```

### Relevant Code Locations:
1. **Handover Arming**:
   - `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3464]`: `pendingHandoverSurfaceHide = true`.
   - `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3468-L3474]`: Starts `handoverSafetyTimer` with a 1000ms timeout.
2. **Handover Completion on Paint**:
   - `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L4420-L4431]`: When `canvasEl` successfully paints, `handoverSafetyTimer` is cleared, `pendingHandoverSurfaceHide = false`, and `hideNativeSurfaceWhenIdle()` is dispatched.
3. **Safety Watchdog Fallback**:
   - If an IPC failure or decode timeout prevents the paused frame from painting, the 1000ms safety timer triggers fallback hide (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3470-L3474]`), ensuring the editor is never permanently occluded.
4. **Playback Resumption Re-Entry**:
   - If the user presses Play before the handover completes, `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3334-L3339]` clears `pendingHandoverSurfaceHide` and cancels the timer, maintaining continuous playback without an unnecessary hide/show cycle.
