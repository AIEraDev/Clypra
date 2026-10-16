# Flow 01: Continuous Playback Loop

This document traces the continuous playback presentation pipeline across the native GPU surface lane and the webview canvas readback fallback lane.

---

## 1. Presenter Path Selection Logic

On each iteration of `renderLoop()` (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2710]`), the component evaluates whether the frame is eligible for direct native hardware presentation or must fall back to the canvas readback bridge:

```
                         ┌────────────────────────────────────────┐
                         │              renderLoop()              │
                         └───────────────────┬────────────────────┘
                                             │
                                             ▼
                         ┌────────────────────────────────────────┐
                         │   Evaluate Path Selection Predicate:   │
                         │   - nativeSurfaceUsable                │
                         │   - Boolean(nativeRequest)             │
                         │   - nativePlaybackPath                 │
                         │   - !qualificationForcesWebView        │
                         └───────────────────┬────────────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         │                                       │
                 [All Predicates True]                 [Any Predicate False]
                         │                                       │
                         ▼                                       ▼
       ┌───────────────────────────────────┐   ┌───────────────────────────────────┐
       │   Lane 1: Direct Native Surface   │   │     Lane 2: Canvas Readback       │
       │   (Metal / DX12 Child Window)     │   │     (Fallback or Paused/Scrub)    │
       └───────────────────────────────────┘   └───────────────────────────────────┘
```

The conditions required for Lane 1 (`nativeDirectSurfacePath`, `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3329-L3333]`):
1. `nativeSurfaceUsable`: Operating system child window is allocated and configured with non-zero dimensions (`[CODE:src/core/runtime/nativeSurfaceLifecycle.ts#L125]`).
2. `Boolean(nativeRequest)`: Valid immutable `EvaluatedScene` exists for current playhead time.
3. `nativePlaybackPath`: `playbackClock.getState().state === "playing"`.
4. `!qualificationForcesWebView`: Environment variable `VITE_CLYPRA_NATIVE_SURFACE != "0"`, and hardware tier qualification has not failed.

---

## 2. Lane 1: Direct Native Surface Dispatch

When `nativeDirectSurfacePath` is active:

1. **Demand Submission**:
   - `submitNativePlaybackDemand()` issues a lightweight IPC payload containing the target timestamp and generation (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3540]`).
   - The Rust backend decodes and composites directly into the OS child swapchain (`CAMetalLayer` on macOS, DXGI swapchain on Windows).
2. **Early `renderInFlight` Release**:
   - To prevent blocking the browser's UI thread and maintain 60 FPS pacing, `renderInFlight` is released immediately after IPC dispatch (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3550]`), rather than waiting in an asynchronous `await`.
3. **Telemetry Sample**:
   - Pacing metrics and frame intervals are logged to the session sample buffer via `record_native_surface_sample` (`[CODE:src-tauri/src/commands/native_preview.rs#L4715]`).

---

## 3. Lane 2: Canvas Readback Bridge (Fallback / Paused)

When `nativeDirectSurfacePath` is false:

1. **Frame Request IPC**:
   - `renderNativeFrame()` dispatches `NativeFrameRequest` over IPC (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L3800]`).
2. **GPU-to-CPU Readback**:
   - In `src-tauri/src/commands/native_preview.rs#L4900`, Rust renders the scene to an offscreen `wgpu::Texture`, copies pixels to a CPU buffer, and transfers bytes over Tauri IPC.
3. **Canvas Paint**:
   - The frontend parses the uncompressed byte array or recognizes the `UNCH` sentinel, painting pixels to `<canvas>` via `ctx.putImageData` or `createImageBitmap` (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L202]`, `#L2160]`).
4. **Adaptive Pacing**:
   - `AdaptiveReadbackPolicy` measures frame latency and dynamically downscales the readback resolution or caps FPS if frame delivery lags behind real time (`[CODE:src/components/editor/preview/adaptiveReadbackPolicy.ts#L45]`).
