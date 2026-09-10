# Export Output Resolution — Architecture

Status: implemented, tsc-clean, all tests passing.

## Problem

Prior to this change, all three export entry points (`exportVideo`, `exportSequence`,
`exportFrame`) enforced a strict equality guard before constructing the native frame
request:

```typescript
// OLD — blocked any export where output ≠ canvas size
const nativeRequest =
  width === scene.metadata.canvasWidth && height === scene.metadata.canvasHeight
    ? buildNativeFrameRequest(...)
    : null; // → throws "Frame N is outside the native compositor contract"
```

This meant a project with a 1920×1080 canvas could not be exported at 4K (3840×2160),
and no aspect-ratio-preserving upscale or downscale was possible even though the
underlying compositor pipeline had always supported it.

## Root Cause

The guard was unnecessary. `buildNativeFrameRequest` accepts independent
`outputWidth`/`outputHeight` and `canvasWidth`/`canvasHeight` arguments by design — they
are separate fields in `NativeFrameRequest` and have always been allowed to differ.
The Rust bridge (`to_video_project_request` in `native_preview.rs`) already performs
the coordinate transform before compositing, with no dimension-equality constraint in
`FrameRequest::validate()`.

The guards were a premature defensive measure that accidentally prevented the
documented feature.

## Architecture: How Output Resolution Works End-to-End

```
ExportDialog
  └─ resolveExportDimensions(projectW, projectH, qualityTier)
       Preserves project aspect ratio. Long edge → tier.longEdge (720 / 1080 / 2160 / 4320).
       Rounds to even numbers (H.264/H.265 chroma subsampling requirement).
       Result: resolvedWidth × resolvedHeight  (may differ from project canvas)
         ↓
exportVideo / exportSequence / exportFrame
  └─ buildNativeFrameRequest(scene, ..., outputWidth, outputHeight, ...)
       Passes outputWidth/outputHeight through unchanged as NativeFrameRequest.outputWidth/Height.
       Also sets project.canvasWidth/Height from scene.metadata — these are the project's
       logical coordinate space and are INDEPENDENT of outputWidth/outputHeight.
         ↓
renderNativeFrame(nativeRequest)  [Tauri IPC]
  └─ present_native_frame_internal  [native_preview.rs]
       └─ to_video_project_request(request)
            scale_x = request.output_width  / request.project.canvas_width
            scale_y = request.output_height / request.project.canvas_height

            Applies scale_x / scale_y to every layer's (x, y, width, height).
            Applies scale_x / scale_y to raster layer display dimensions.
            Applies scale_x / scale_y to text layer (x, y, box_width, box_height).

            Sets NativeVideoProjectFrameRequest.canvas_width  = output_width
            Sets NativeVideoProjectFrameRequest.canvas_height = output_height
              ↓
            MultiTrackCompositor renders at output_width × output_height natively.
            No intermediate resize blit. GPU produces pixels at the final resolution.
```

### Key invariants

- `outputWidth` and `canvasWidth` are **always separate** — one is the GPU render target
  size, the other is the project's logical coordinate space.
- The coordinate transform (`scale_x`, `scale_y`) is **lossless for the compositor** —
  all layer sizes, positions, and text box dimensions are expressed in output-pixel space
  before the GPU sees them.
- The Rust contract (`FrameRequest::validate()`) enforces: `output_width` and
  `output_height` are non-zero and `≤ 8192`. There is no equality constraint with
  canvas dimensions.
- `FrameRequest::validate()` contract version is `NATIVE_CORE_CONTRACT_VERSION = 2`.

## The Fix

Removed three inline dimension-equality guards — one per export entry point — and
replaced each with a direct unconditional call to `buildNativeFrameRequest`.

### `exportVideo.ts`

```typescript
// BEFORE
const nativeRequest =
  width === scene.metadata.canvasWidth && height === scene.metadata.canvasHeight
    ? buildNativeFrameRequest(scene, ..., width, height, ...)
    : null; // → threw "Frame N is outside the native compositor contract"

// AFTER — compositor handles any output resolution
const nativeRequest = buildNativeFrameRequest(
  scene, ..., width, height, ...
);
```

### `exportFrame.ts`

```typescript
// BEFORE
if (width !== scene.metadata.canvasWidth || height !== scene.metadata.canvasHeight) {
  throw new Error("[ExportFrame] Native export requires project-sized output dimensions");
}

// AFTER — removed entirely; output dimensions are independent of canvas dimensions
```

### `exportSequence.ts`

Same ternary pattern as `exportVideo.ts` — replaced with a direct call.

## Memory Budget at 4K

Each RGBA frame at 4K (3840×2160) is **~32 MB** (3840 × 2160 × 4 bytes).

`exportVideo` uses `BATCH_SIZE = 10` frames per IPC flush. At 4K this means
~320 MB batch buffer + ~320 MB source frames ≈ **640 MB peak** during a flush.
This is acceptable on the minimum supported hardware (4 GB RAM) because the
source frame references are null'd immediately after copy into the concat buffer
(EX-2 fix), so GC can reclaim them before the batch write completes.

At 1080p the peak is ~83 MB + ~83 MB ≈ 166 MB — unchanged from before.

## What `buildNativeFrameRequest` Can Still Return `null` For

Removing the dimension guard does not mask other contract failures.
`buildNativeFrameRequest` still returns `null` (and the export still throws
"Frame N is outside the native compositor contract") for scene-content reasons:

| Condition | Example |
|---|---|
| Unsupported visual layer type | non-`"media"`, non-`"text"` layer in scene |
| Animated/gradient background not yet rasterized | raster asset not ready |
| Still image or animated sticker not yet rasterized | raster asset not ready |
| Active transition not implemented natively | unsupported transition kind |
| Lottie sticker | `stickerFormat === "lottie"` |
| Non-native source path | blob URL, HTTP URL (not filesystem / `asset://`) |
| Source rotation on the media container | `sourceRotation !== 0` |
| Unsupported blend mode | not in `NATIVE_BLEND_MODES` |
| Unsupported color grade / MPG v2 filter node | `getNativeColorGrade()` → null |
| Body effect mask not yet rasterized | segmentation mask not ready |
| Unsupported text effect primitive | non-SDF pass |
| Completely empty scene | no renderable visual content |

These are **scene-content** failures, not dimension failures, and they are correct
to block export — they represent scenes the native compositor genuinely cannot
render.

## Relationship to `resolveExportDimensions`

`resolveExportDimensions` (in `exportDimensions.ts`) resolves the user's chosen
quality tier to concrete pixel dimensions that preserve the project's aspect ratio
and produce even numbers for codec compliance. It is the canonical source of
`width`/`height` in `ExportDialog`. The fix does not change this function — it
already produced dimensions that could differ from the canvas size. The dimension
guard was simply discarding those valid, correctly-resolved dimensions.

## Regression Surface

The only behavioral change is:

1. `exportVideo`, `exportSequence`, and `exportFrame` no longer throw when
   `outputWidth !== canvasWidth || outputHeight !== canvasHeight`.
2. Those cases are now routed through `buildNativeFrameRequest` → Rust compositor
   which scales layer coordinates proportionally.

Existing behavior for same-size exports (output == canvas) is unchanged — the
scale factors become 1.0 × 1.0 in Rust, which is a no-op transform.

## Related Documents

- [`native-architecture.md`](native-architecture.md) — native media authority contract
- [`native-migration-adr.md`](native-migration-adr.md) — ADR: native media authority
- [`performance-contract.md`](performance-contract.md) — frame timing budgets
