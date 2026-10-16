# Flow 03: Dual-Lane Scrub & Settle Pacing

This document describes the dual-lane rendering architecture used during rapid playhead dragging and settling, balancing interactive seek responsiveness with display precision.

---

## 1. Dual-Lane Rendering Architecture

During high-velocity timeline scrubbing, issuing continuous uncompressed 1080p or 4K frame readback requests would saturate IPC bandwidth and exhaust hardware decoder buffers. Clypra divides scrub rendering into two distinct operational lanes:

| Attribute | Lane 1: Coarse Scrubbing Lane | Lane 2: Settled Display Lane |
| :--- | :--- | :--- |
| **Activation Trigger** | `isScrubbing \|\| isCoarseSeek` (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2793]`) | `isSettling` or playhead stationary (`[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2805]`) |
| **Max Render Dimension**| Capped at 480px (`maxScrubDim = 480`, `[CODE:src/components/editor/preview/NativeProgramPreview.tsx#L2794]`) | Native project resolution (e.g., 1920x1080, 3840x2160) |
| **Quality Tier** | `"proxy"` or `"quarter"` tier | `"full"` native project quality |
| **Decoder Behavior** | Keyframe-approximate seek (`allowKeyframeApprox = true`) | Exact-frame inter-frame reconstruction |
| **IPC Payload Size** | ~920 KB (480x270 RGBA) | ~8.29 MB (1920x1080 RGBA) |

---

## 2. Scrub Pacing & Resolution Scaling

When scrubbing starts:
1. `NativeProgramPreview.tsx#L2794` calculates the downscale factor:
   ```ts
   const maxScrubDim = 480;
   const scrubScale = Math.min(1, maxScrubDim / Math.max(renderTarget.width, renderTarget.height));
   ```
2. The scaled dimensions are submitted in `NativeFrameRequest.renderTarget`.
3. The Rust compositor decodes at reduced resolution and transfers the downscaled buffer over IPC.
4. The canvas context draws the frame stretched to the viewport dimensions.

---

## 3. Settle Transition Protocol

When the user releases the playhead or stops dragging:
1. `isScrubbing` transitions to `false`.
2. A 150ms settling timer tracks the cessation of seek intents.
3. Once settled, the component dispatches a final `NativeFrameRequest` with full resolution and exact decoding.
4. The full-quality frame replaces the proxy frame on the canvas, eliminating keyframe approximation artifacts.
