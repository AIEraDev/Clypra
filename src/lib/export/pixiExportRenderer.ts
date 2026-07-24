/**
 * Pixi Export Renderer
 *
 * Renders one video frame through a headless PixiSceneCompositor and returns
 * the resulting pixel data as an ImageData.
 *
 * Architecture:
 *   videoExport.ts
 *     → createPixiExportCompositor()     (once per export session)
 *     → renderFrameWithPixi()            (once per frame)
 *     → destroyPixiExportCompositor()    (on completion or error)
 *
 * The compositor wraps a fresh HTMLCanvasElement that is appended to a hidden
 * container so the GPU context can be created, but never appears in the UI.
 * WebGL's preserveDrawingBuffer is already enabled on PixiRenderer (required for
 * pixel readback via the draw-into-2D-canvas approach below).
 *
 * Why not OffscreenCanvas?
 *   PixiRenderer.init() requires an HTMLCanvasElement so it can attach WebGL
 *   context-loss event listeners. OffscreenCanvas support would require a
 *   PixiRenderer refactor that is out of scope here.
 *
 * Pixel readback strategy:
 *   After Pixi renders the frame onto the WebGL canvas, we blit the WebGL canvas
 *   into a pooled 2D canvas via drawImage() and call getImageData(). This avoids
 *   the lower-level WebGL readPixels() call and works correctly with the
 *   preserveDrawingBuffer=true setting that is already configured in PixiRenderer.
 */

import { PixiSceneCompositor } from "@/core/render/pixiSceneCompositor";
import type { EvaluatedScene } from "@/core/evaluation/types";
import { clearAllTextBridges } from "@/core/render/textBridge";
import { clearAllStickerBridges } from "@/core/render/stickerBridge";
import type { VideoFrameSource } from "@/core/render/utils/mediaResolver";

// ── Minimal pool adapter for export ──────────────────────────────────────────
// The real PreviewMediaPool tracks frame callbacks from requestVideoFrameCallback
// to avoid redundant GPU texture uploads during live preview. For export every
// video frame is fully seeked and ready, so we always want a fresh upload.
// This adapter satisfies PixiSceneCompositor's mediaPool interface without the
// overhead of the full PreviewMediaPool.
const ALWAYS_DIRTY_POOL = {
  shouldUpdateTexture: (_clipId: string, _video: HTMLVideoElement) => true,
  markTextureClean: (_clipId: string) => {
    /* no-op for export */
  },
} as const;

// ── Export compositor handle ──────────────────────────────────────────────────

export interface PixiExportCompositor {
  compositor: PixiSceneCompositor;
  canvas: HTMLCanvasElement;
  readbackCanvas: HTMLCanvasElement;
  readbackCtx: CanvasRenderingContext2D;
  container: HTMLDivElement;
  width: number;
  height: number;
}

/**
 * Create a headless PixiSceneCompositor for export.
 *
 * Must be called once per export session and destroyed when the export
 * completes or fails (see destroyPixiExportCompositor).
 *
 * @param width  - Output frame width in pixels
 * @param height - Output frame height in pixels
 * @returns      - Handle to the compositor and its supporting resources
 */
export function createPixiExportCompositor(width: number, height: number): PixiExportCompositor {
  // Clear any cached bridges from preview so they are not shared or stolen
  clearAllTextBridges();
  clearAllStickerBridges();

  // Create an invisible DOM container — browsers suspend GPU decoding for
  // completely offscreen elements, so we keep it at 1×1 visible size.
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:-9999;overflow:hidden;";
  document.body.appendChild(container);

  // WebGL render target
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  // 2D readback surface
  const readbackCanvas = document.createElement("canvas");
  readbackCanvas.width = width;
  readbackCanvas.height = height;
  const readbackCtx = readbackCanvas.getContext("2d", { willReadFrequently: true });
  if (!readbackCtx) {
    container.remove();
    throw new Error("[PixiExportRenderer] Failed to create 2D readback context");
  }

  // Temporarily override window.devicePixelRatio to 1 during export initialization
  // so the headless compositor renders at exactly 1x resolution (no Retina upscale).
  // This avoids rendering 4x more pixels and matches readback Canvas size exactly.
  const originalDPR = window.devicePixelRatio;
  const dprDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  
  try {
    Object.defineProperty(window, "devicePixelRatio", {
      value: 1.0,
      configurable: true,
      writable: true,
    });
  } catch (e) {
    // Fallback if defineProperty fails
  }

  let compositor: PixiSceneCompositor;
  try {
    compositor = new PixiSceneCompositor(
      canvas,
      width,
      height,
      ALWAYS_DIRTY_POOL as any,
    );
  } finally {
    // Restore original window.devicePixelRatio
    try {
      if (dprDescriptor) {
        Object.defineProperty(window, "devicePixelRatio", dprDescriptor);
      } else {
        Object.defineProperty(window, "devicePixelRatio", {
          value: originalDPR,
          configurable: true,
          writable: true,
        });
      }
    } catch (e) {
      // Fallback
    }
  }

  return { compositor, canvas, readbackCanvas, readbackCtx, container, width, height };
}

/**
 * Destroy a headless compositor and clean up all associated DOM and GPU resources.
 * Always call this in a finally block after createPixiExportCompositor.
 */
export function destroyPixiExportCompositor(handle: PixiExportCompositor): void {
  try {
    handle.compositor.destroy();
  } catch (err) {
    console.error("[PixiExportRenderer] Compositor destroy error:", err);
  }
  // Clear bridges again so the preview pipeline doesn't try to reuse destroyed sprites
  clearAllTextBridges();
  clearAllStickerBridges();
  handle.container.remove();
}

/**
 * Render one frame through the Pixi compositor and return the pixel data.
 *
 * @param handle        - Compositor handle from createPixiExportCompositor
 * @param scene         - Evaluated scene for this frame (from evaluateTimelineSceneCached)
 * @param videoElements - Map of `${clipId}-${mediaId}` to a decoded video source
 * @returns             - ImageData containing RGBA pixels for this frame
 */
export async function renderFrameWithPixi(
  handle: PixiExportCompositor,
  scene: EvaluatedScene,
  videoElements: Map<string, VideoFrameSource>,
): Promise<ImageData> {
  const { compositor, canvas, readbackCanvas, readbackCtx, width, height } = handle;

  // Resolve native project size. We must scale the layout if exporting at a resolution
  // different from the project's canonical design canvas dimensions. This ensures
  // text size, positions, templates, and effects conform perfectly at any quality tier.
  const projectWidth = scene.metadata.canvasWidth ?? width;
  const projectHeight = scene.metadata.canvasHeight ?? height;

  const scale = width / projectWidth;

  // Set projectWidth and projectHeight dynamically relative to the scale factor.
  // This guarantees that projectW * scale evaluates exactly to target width and height
  // without 1-pixel rounding errors or resizing, while allowing text/stickers to scale correctly.
  const viewport = {
    scale,
    offsetX: 0,
    offsetY: 0,
    pixelRatio: 1,
    projectWidth: width / scale,
    projectHeight: height / scale,
  };

  await compositor.composeFrame(
    scene,
    viewport,
    videoElements,
    undefined,  // resourceHandleMap (unused during export)
    new Map(),  // bodyMasks (no body segmentation during export)
  );

  // Defensive guard — if canvas dimensions have somehow diverged despite the above,
  // fail loudly and immediately rather than silently cropping the frame.
  if (canvas.width !== readbackCanvas.width || canvas.height !== readbackCanvas.height) {
    throw new Error(
      `[ExportRenderer] Canvas dimension mismatch before readback: ` +
      `WebGL ${canvas.width}x${canvas.height} vs ` +
      `Readback ${readbackCanvas.width}x${readbackCanvas.height} — ` +
      `aborting to prevent silent cropping`
    );
  }

  // Blit WebGL canvas → 2D canvas and read pixels.
  // drawImage() from a WebGL canvas works because preserveDrawingBuffer=true
  // is set on the PixiRenderer Application — without it the canvas would be
  // cleared after each render call and the readback would return black pixels.
  // We use the 5-argument drawImage call to dynamically support physical scaling (DPR).
  readbackCtx.clearRect(0, 0, readbackCanvas.width, readbackCanvas.height);
  readbackCtx.drawImage(canvas, 0, 0, readbackCanvas.width, readbackCanvas.height);

  return readbackCtx.getImageData(0, 0, width, height);
}
