/**
 * Text Rasterizer Worker
 *
 * Renders text templates and styled text effects entirely off the main thread
 * using OffscreenCanvas. Eliminates the main-thread stalls that caused Program
 * Preview to freeze during animated text playback.
 *
 * Rendering paths handled here:
 *   RENDER_TEMPLATE — renderTextTemplateToCanvas (animated text templates)
 *   RENDER_EFFECT   — renderTextEffectToCanvas   (styled text effects with animations)
 *
 * Plain text (no templateId, no styleId) is NOT routed here — it is static,
 * rasterizes once, and costs <2ms. The main-thread overhead of a Worker
 * round-trip would exceed the savings.
 *
 * Architecture (same for both types):
 *   Main thread          →  Worker
 *   RENDER_* msg         →  render on OffscreenCanvas
 *                              ↓
 *   FRAME_READY msg      ←  transferToImageBitmap()   [zero-copy GPU transfer]
 *
 * The worker is stateless between frames — each message is independent.
 * The LatestTextPreparationScheduler on the main thread enforces
 * at most one active + one pending job, preventing queue buildup.
 *
 * ── Message protocol ─────────────────────────────────────────────────────────
 *
 * Main → Worker:
 *   RENDER_TEMPLATE  { id, artifact, localTime, clipDuration, canvasWidth,
 *                      canvasHeight, controlValues }
 *   RENDER_EFFECT    { id, sceneDocument, time, canvasWidth, canvasHeight }
 *   DISPOSE
 *
 * Worker → Main:
 *   FRAME_READY      { id, bitmap, canvasWidth, canvasHeight }
 *   FRAME_FAILED     { id, error }
 */

import {
  renderTextTemplateToCanvas,
  renderTextEffectToCanvas,
  type TextTemplateArtifact,
} from "@clypra-studio/engine";

import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import montserratUrl from "@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url";
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import spaceGroteskUrl from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";
import robotoUrl from "@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2?url";
import outfitUrl from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url";
import robotoCondensedUrl from "@fontsource-variable/roboto-condensed/files/roboto-condensed-latin-wght-normal.woff2?url";
import openSansUrl from "@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url";
import ralewayUrl from "@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url";
import oswaldUrl from "@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2?url";
import playfairDisplayUrl from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url";
import nunitoUrl from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url";
import dancingScriptUrl from "@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url";
import latoUrl from "@fontsource/lato/files/lato-latin-400-normal.woff2?url";
import antonUrl from "@fontsource/anton/files/anton-latin-400-normal.woff2?url";
import bebasNeueUrl from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url";
import poppinsUrl from "@fontsource/poppins/files/poppins-latin-400-normal.woff2?url";
import permanentMarkerUrl from "@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url";
import bangersUrl from "@fontsource/bangers/files/bangers-latin-400-normal.woff2?url";
import pressStartUrl from "@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2?url";
import pacificoUrl from "@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url";

const BUNDLED_FONTS: Array<{ url: string; aliases: string[] }> = [
  { url: interUrl, aliases: ["Inter", "Inter Variable"] },
  { url: montserratUrl, aliases: ["Montserrat", "Montserrat Variable"] },
  { url: geistUrl, aliases: ["Geist", "Geist Variable"] },
  { url: spaceGroteskUrl, aliases: ["Space Grotesk", "Space Grotesk Variable"] },
  { url: robotoUrl, aliases: ["Roboto", "Roboto Variable"] },
  { url: outfitUrl, aliases: ["Outfit", "Outfit Variable"] },
  { url: robotoCondensedUrl, aliases: ["Roboto Condensed", "Roboto Condensed Variable"] },
  { url: openSansUrl, aliases: ["Open Sans", "Open Sans Variable"] },
  { url: ralewayUrl, aliases: ["Raleway", "Raleway Variable"] },
  { url: oswaldUrl, aliases: ["Oswald", "Oswald Variable"] },
  { url: playfairDisplayUrl, aliases: ["Playfair Display", "Playfair Display Variable"] },
  { url: nunitoUrl, aliases: ["Nunito", "Nunito Variable"] },
  { url: dancingScriptUrl, aliases: ["Dancing Script", "Dancing Script Variable"] },
  { url: latoUrl, aliases: ["Lato"] },
  { url: antonUrl, aliases: ["Anton"] },
  { url: bebasNeueUrl, aliases: ["Bebas Neue"] },
  { url: poppinsUrl, aliases: ["Poppins"] },
  { url: permanentMarkerUrl, aliases: ["Permanent Marker"] },
  { url: bangersUrl, aliases: ["Bangers"] },
  { url: pressStartUrl, aliases: ["Press Start 2P"] },
  { url: pacificoUrl, aliases: ["Pacifico"] },
];

const fontUrlByAlias = new Map<string, string>();
for (const font of BUNDLED_FONTS) {
  for (const alias of font.aliases) {
    fontUrlByAlias.set(alias.toLowerCase(), font.url);
  }
}

const loadedWorkerFonts = new Set<string>();

async function ensureWorkerFontLoaded(fontFamily?: string): Promise<void> {
  if (!fontFamily || typeof self === "undefined" || !("fonts" in self)) return;
  const key = fontFamily.trim().toLowerCase();
  if (loadedWorkerFonts.has(key)) return;

  const url = fontUrlByAlias.get(key) || fontUrlByAlias.get(key.replace(/\s+variable$/i, ""));
  if (!url) {
    console.warn(`[TextRasterizerWorker] Font "${fontFamily}" is not in worker bundled fonts; canvas will use system fallback`);
    return;
  }

  try {
    const face = new FontFace(fontFamily, `url(${url})`);
    const loadedFace = await face.load();
    (self as any).fonts.add(loadedFace);
    loadedWorkerFonts.add(key);
  } catch (err) {
    console.warn(`[TextRasterizerWorker] Failed to load font "${fontFamily}":`, err);
  }
}

// ─── Message types ────────────────────────────────────────────────────────────

export interface WorkerRenderTemplateMessage {
  type: "RENDER_TEMPLATE";
  id: string;
  artifact: TextTemplateArtifact;
  localTime: number;
  clipDuration: number | undefined;
  layerWidth: number;
  layerHeight: number;
  controlValues: Record<string, unknown>;
}

export interface WorkerRenderEffectMessage {
  type: "RENDER_EFFECT";
  id: string;
  sceneDocument: Record<string, unknown>;
  time: number;
  evalWidth: number;
  evalHeight: number;
}

export interface WorkerDisposeMessage {
  type: "DISPOSE";
}

export type WorkerInboundMessage =
  | WorkerRenderTemplateMessage
  | WorkerRenderEffectMessage
  | WorkerDisposeMessage;

export interface WorkerFrameReadyMessage {
  type: "FRAME_READY";
  id: string;
  bitmap: ImageBitmap;
  offsetX: number;
  offsetY: number;
  croppedWidth: number;
  croppedHeight: number;
  /** How long renderTextTemplateToCanvas / renderTextEffectToCanvas + cropping took inside the worker (ms). */
  workerRasterMs: number;
}

export interface WorkerFrameFailedMessage {
  type: "FRAME_FAILED";
  id: string;
  error: string;
}

export type WorkerOutboundMessage =
  | WorkerFrameReadyMessage
  | WorkerFrameFailedMessage;

// ─── Worker implementation ────────────────────────────────────────────────────

function findVisibleBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 8,
): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (rgba[rowOffset + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function createBlankBitmap(): ImageBitmap {
  const blank = new OffscreenCanvas(1, 1);
  const ctx = blank.getContext("2d", { alpha: true });
  ctx?.clearRect(0, 0, 1, 1);
  return blank.transferToImageBitmap();
}

interface VisibleBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAX_WORKER_BOUNDS_CACHE = 64;
const staticBoundsCache = new Map<string, VisibleBounds | null>();

function isArtifactAnimated(artifact: TextTemplateArtifact | null | undefined): boolean {
  if (!artifact?.document?.nodes) return false;
  return artifact.document.nodes.some((node: any) => {
    const a = node.animation;
    return Boolean(
      a &&
      ((a.in && a.in !== "none") ||
        (a.out && a.out !== "none") ||
        Boolean(a.propertyKeyframes) ||
        Boolean(node.splitAnimator))
    );
  });
}

async function handleRenderTemplate(
  msg: WorkerRenderTemplateMessage,
): Promise<void> {
  const {
    id,
    artifact,
    localTime,
    clipDuration,
    layerWidth,
    layerHeight,
    controlValues,
  } = msg;

  const width = Math.max(1, Math.round(layerWidth));
  const height = Math.max(1, Math.round(layerHeight));

  // Ensure all fonts used by text nodes in the template are loaded in worker
  if (artifact?.document?.nodes) {
    const textNodes = artifact.document.nodes.filter((n: any) => n.type === "text");
    await Promise.all(
      textNodes.map((n: any) => ensureWorkerFontLoaded(n.style?.fontFamily)),
    );
  }

  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  ctx.clearRect(0, 0, width, height);

  const docWidth = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.width) || 1920),
  );
  const docHeight = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.height) || 1080),
  );
  const uniformScale = Math.min(width / docWidth, height / docHeight);
  const uniformWidth = Math.max(1, Math.round(docWidth * uniformScale));
  const uniformHeight = Math.max(1, Math.round(docHeight * uniformScale));
  const offsetX0 = Math.round((width - uniformWidth) / 2);
  const offsetY0 = Math.round((height - uniformHeight) / 2);

  const rasterStart = performance.now();
  ctx.save();
  ctx.translate(offsetX0, offsetY0);
  renderTextTemplateToCanvas(ctx, {
    artifact,
    context: {
      environment: "editor",
      time: localTime,
      clipDuration,
      width: uniformWidth,
      height: uniformHeight,
      controlValues,
    },
  });
  ctx.restore();

  const isAnimated = isArtifactAnimated(artifact);
  const staticCacheKey = !isAnimated
    ? `${(artifact as any)?.id ?? id}:${width}x${height}:${JSON.stringify(controlValues)}`
    : null;

  let bounds: VisibleBounds | null = null;
  if (staticCacheKey && staticBoundsCache.has(staticCacheKey)) {
    bounds = staticBoundsCache.get(staticCacheKey) ?? null;
  } else {
    const imgData = ctx.getImageData(0, 0, width, height);
    bounds = findVisibleBounds(imgData.data, width, height, 8);
    if (staticCacheKey) {
      if (staticBoundsCache.size >= MAX_WORKER_BOUNDS_CACHE) {
        const oldest = staticBoundsCache.keys().next().value;
        if (oldest) staticBoundsCache.delete(oldest);
      }
      staticBoundsCache.set(staticCacheKey, bounds);
    }
  }

  let bitmap: ImageBitmap;
  let offsetX = 0;
  let offsetY = 0;
  let croppedWidth = 1;
  let croppedHeight = 1;

  if (!bounds) {
    bitmap = createBlankBitmap();
  } else {
    offsetX = bounds.left;
    offsetY = bounds.top;
    croppedWidth = Math.max(1, bounds.width);
    croppedHeight = Math.max(1, bounds.height);

    const cropped = new OffscreenCanvas(croppedWidth, croppedHeight);
    const croppedCtx = cropped.getContext("2d", { alpha: true });
    if (croppedCtx) {
      croppedCtx.drawImage(
        offscreen,
        offsetX,
        offsetY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight,
      );
      bitmap = cropped.transferToImageBitmap();
    } else {
      bitmap = offscreen.transferToImageBitmap();
    }
  }

  const workerRasterMs = performance.now() - rasterStart;
  console.log(`[TextRasterizerWorker] Template frame rendered (id=${id}, time=${localTime.toFixed(3)}s, cropped=${croppedWidth}x${croppedHeight}, offset=(${offsetX},${offsetY}), workerMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      offsetX,
      offsetY,
      croppedWidth,
      croppedHeight,
      workerRasterMs,
    } satisfies WorkerFrameReadyMessage,
    [bitmap],
  );
}

async function handleRenderEffect(
  msg: WorkerRenderEffectMessage,
): Promise<void> {
  const {
    id,
    sceneDocument,
    time,
    evalWidth,
    evalHeight,
  } = msg;

  const width = Math.max(1, Math.round(evalWidth));
  const height = Math.max(1, Math.round(evalHeight));

  // Ensure font in scene document is loaded in worker
  const sceneText = (sceneDocument as any)?.text;
  if (sceneText?.fontFamily) {
    await ensureWorkerFontLoaded(sceneText.fontFamily);
  }

  const rasterStart = performance.now();
  const evalCanvas = new OffscreenCanvas(width, height);
  const evalCtx = evalCanvas.getContext("2d", { alpha: true });
  if (!evalCtx) throw new Error("OffscreenCanvas 2D context not available");
  evalCtx.clearRect(0, 0, width, height);

  renderTextEffectToCanvas(evalCtx, {
    source: sceneDocument as any,
    context: {
      environment: "editor",
      time,
      width,
      height,
    },
  });

  const isEffectAnimated = Boolean(
    (sceneDocument as any)?.animation &&
    (sceneDocument as any)?.animation?.type &&
    (sceneDocument as any)?.animation?.type !== "none"
  );
  const staticEffectKey = !isEffectAnimated
    ? `${id}:${width}x${height}:${sceneText?.content}:${sceneText?.fontSize}`
    : null;

  let bounds: VisibleBounds | null = null;
  if (staticEffectKey && staticBoundsCache.has(staticEffectKey)) {
    bounds = staticBoundsCache.get(staticEffectKey) ?? null;
  } else {
    const imgData = evalCtx.getImageData(0, 0, width, height);
    bounds = findVisibleBounds(imgData.data, width, height, 16);
    if (staticEffectKey) {
      if (staticBoundsCache.size >= MAX_WORKER_BOUNDS_CACHE) {
        const oldest = staticBoundsCache.keys().next().value;
        if (oldest) staticBoundsCache.delete(oldest);
      }
      staticBoundsCache.set(staticEffectKey, bounds);
    }
  }

  let bitmap: ImageBitmap;
  let offsetX = 0;
  let offsetY = 0;
  let croppedWidth = 1;
  let croppedHeight = 1;

  if (!bounds) {
    bitmap = createBlankBitmap();
    offsetX = Math.round(width / 2);
    offsetY = Math.round(height / 2);
  } else {
    offsetX = bounds.left;
    offsetY = bounds.top;
    croppedWidth = Math.max(1, bounds.width);
    croppedHeight = Math.max(1, bounds.height);

    const cropped = new OffscreenCanvas(croppedWidth, croppedHeight);
    const croppedCtx = cropped.getContext("2d", { alpha: true });
    if (croppedCtx) {
      croppedCtx.drawImage(
        evalCanvas,
        offsetX,
        offsetY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight,
      );
      bitmap = cropped.transferToImageBitmap();
    } else {
      bitmap = evalCanvas.transferToImageBitmap();
    }
  }

  const workerRasterMs = performance.now() - rasterStart;
  console.log(`[TextRasterizerWorker] Effect frame rendered (id=${id}, time=${time.toFixed(3)}s, cropped=${croppedWidth}x${croppedHeight}, offset=(${offsetX},${offsetY}), workerMs=${workerRasterMs.toFixed(2)}ms)`);

  (self as unknown as Worker).postMessage(
    {
      type: "FRAME_READY",
      id,
      bitmap,
      offsetX,
      offsetY,
      croppedWidth,
      croppedHeight,
      workerRasterMs,
    } satisfies WorkerFrameReadyMessage,
    [bitmap],
  );
}

self.onmessage = async (
  event: MessageEvent<WorkerInboundMessage>,
): Promise<void> => {
  const msg = event.data;

  if (msg.type === "DISPOSE") {
    console.log("[TextRasterizerWorker] Disposing worker");
    self.close();
    return;
  }

  try {
    if (msg.type === "RENDER_TEMPLATE") {
      await handleRenderTemplate(msg);
    } else if (msg.type === "RENDER_EFFECT") {
      await handleRenderEffect(msg);
    }
  } catch (error) {
    console.error(`[TextRasterizerWorker] Render failed for ${msg.type} (id=${(msg as { id: string }).id}):`, error);
    (self as unknown as Worker).postMessage({
      type: "FRAME_FAILED",
      id: (msg as { id: string }).id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerFrameFailedMessage);
  }
};
