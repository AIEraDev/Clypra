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
  pboBuffers?: WebGLBuffer[];
  pboIndex?: number;
  gl2?: WebGL2RenderingContext | null;
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

  // EXP-02: Initialize WebGL2 Pixel Buffer Objects (PBOs) for double-buffered async readback
  let pboBuffers: WebGLBuffer[] | undefined;
  let gl2: WebGL2RenderingContext | null = null;

  try {
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl && typeof gl.createBuffer === "function") {
      gl2 = gl;
      const buf0 = gl.createBuffer();
      const buf1 = gl.createBuffer();
      if (buf0 && buf1) {
        const byteSize = width * height * 4;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf0);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, byteSize, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf1);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, byteSize, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        pboBuffers = [buf0, buf1];
      }
    }
  } catch (err) {
    console.warn("[PixiExportRenderer] WebGL2 PBO initialization failed, falling back to sync readPixels:", err);
  }

  return { compositor, canvas, readbackCanvas, readbackCtx, container, width, height, pboBuffers, pboIndex: 0, gl2 };
}

/**
 * Destroy a headless compositor and clean up all associated DOM and GPU resources.
 * Always call this in a finally block after createPixiExportCompositor.
 */
export function destroyPixiExportCompositor(handle: PixiExportCompositor): void {
  if (handle.gl2 && handle.pboBuffers) {
    try {
      handle.gl2.deleteBuffer(handle.pboBuffers[0]);
      handle.gl2.deleteBuffer(handle.pboBuffers[1]);
    } catch (err) {
      console.warn("[PixiExportRenderer] Error deleting PBO buffers:", err);
    }
  }
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
 * @param videoElements - Map of `${clipId}-${mediaId}` → HTMLVideoElement (pre-seeked)
 * @returns             - ImageData containing RGBA pixels for this frame
 */
export async function renderFrameWithPixi(
  handle: PixiExportCompositor,
  scene: EvaluatedScene,
  videoElements: Map<string, HTMLVideoElement>,
  directWebGLReadback = false,
  bodyMasks: Map<string, any> = new Map(),
): Promise<ImageData | Uint8Array> {
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
    bodyMasks,  // EXP-07: Pass body segmentation masks if available
  );

  if (directWebGLReadback) {
    const gl = canvas.getContext("webgl2") || (canvas.getContext("webgl") as any);
    if (!gl) {
      throw new Error("[ExportRenderer] Failed to get WebGL context for direct readback");
    }
    // Bind default framebuffer (null) to guarantee reading from the screen render target
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const frameBytes = new Uint8Array(width * height * 4);

    // EXP-02: Use WebGL2 PBO async readback if available
    if (handle.gl2 && handle.pboBuffers && handle.pboBuffers.length === 2) {
      const pIdx = handle.pboIndex ?? 0;
      const writePbo = handle.pboBuffers[pIdx];
      const readPbo = handle.pboBuffers[1 - pIdx];

      // Initiate async read into writePbo
      handle.gl2.bindBuffer(handle.gl2.PIXEL_PACK_BUFFER, writePbo);
      handle.gl2.readPixels(0, 0, width, height, handle.gl2.RGBA, handle.gl2.UNSIGNED_BYTE, 0);

      // Read back pixels from previous frame in readPbo
      handle.gl2.bindBuffer(handle.gl2.PIXEL_PACK_BUFFER, readPbo);
      handle.gl2.getBufferSubData(handle.gl2.PIXEL_PACK_BUFFER, 0, frameBytes);
      handle.gl2.bindBuffer(handle.gl2.PIXEL_PACK_BUFFER, null);

      // Toggle buffer index
      handle.pboIndex = 1 - pIdx;
      return frameBytes;
    }

    // EXP-06 Note: WebGL gl.readPixels returns bottom-up pixel rows.
    // The Tauri FFmpeg backend (export.rs) applies a `vflip` filter ([0:v]vflip[v])
    // to invert the stream vertically into standard top-down video format.
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frameBytes);
    return frameBytes;
  }

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
