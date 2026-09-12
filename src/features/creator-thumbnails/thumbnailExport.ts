import type {
  Project,
  Track,
  Clip,
  MediaAsset,
  TransitionTimelineItem,
  ThumbnailOverlayLayer,
} from "@/types";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import { buildNativeFrameRequest } from "@/components/editor/preview/nativeVideoPreview";
import { isTauriRuntime, renderNativeFrame, exportCreatorThumbnail } from "@/lib/platform/tauri";

export interface RenderFrameOptions {
  timestampSeconds: number;
  project: Project;
  tracks: Track[];
  clips: Clip[];
  mediaAssets?: MediaAsset[];
  transitions?: TransitionTimelineItem[];
  epoch?: number;
}

/**
 * Render a single frame from the video timeline at the project resolution.
 */
export async function renderTimelineFrameAt(
  options: RenderFrameOptions,
): Promise<HTMLCanvasElement | null> {
  const {
    timestampSeconds,
    project,
    tracks,
    clips,
    mediaAssets = project.mediaAssets ?? [],
    transitions = [],
    epoch = 0,
  } = options;

  const scene = evaluateTimelineSceneCached(
    timestampSeconds,
    clips,
    tracks,
    mediaAssets,
    project,
    epoch,
    transitions,
  );

  const canvasWidth = project.canvasWidth || 1920;
  const canvasHeight = project.canvasHeight || 1080;
  const frameRate = Math.max(1, Math.round(project.frameRate || 30));
  const frameIndex = Math.max(0, Math.round(timestampSeconds * frameRate));

  if (!isTauriRuntime()) {
    // Non-Tauri fallback: generate a placeholder canvas
    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.width = canvasWidth;
    fallbackCanvas.height = canvasHeight;
    const ctx = fallbackCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Frame @ ${timestampSeconds.toFixed(2)}s`, canvasWidth / 2, canvasHeight / 2);
    }
    return fallbackCanvas;
  }

  const nativeRequest = buildNativeFrameRequest(
    scene,
    `${project.id}:${epoch}:thumb`,
    frameIndex,
    frameRate,
    canvasWidth,
    canvasHeight,
    [],
    { mode: "frameStep", quality: "full" },
  );

  if (!nativeRequest) {
    return null;
  }

  try {
    const rgba = await renderNativeFrame(nativeRequest);
    if (!rgba || rgba.byteLength === 0) return null;

    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = canvasWidth;
    frameCanvas.height = canvasHeight;
    const ctx = frameCanvas.getContext("2d");
    if (!ctx) return null;

    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    imgData.data.set(new Uint8ClampedArray(rgba));
    ctx.putImageData(imgData, 0, 0);

    return frameCanvas;
  } catch (err) {
    console.warn("[thumbnailExport] Native frame render failed:", err);
    return null;
  }
}

/**
 * Composite the base video frame with graphic and text overlay layers at target resolution.
 */
export function compositeThumbnailCanvas(
  baseCanvas: HTMLCanvasElement | null,
  overlayLayers: ThumbnailOverlayLayer[],
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Background fallback fill
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // 1. Draw base video frame with "Cover" crop/scaling
  if (baseCanvas && baseCanvas.width > 0 && baseCanvas.height > 0) {
    const srcW = baseCanvas.width;
    const srcH = baseCanvas.height;
    const srcRatio = srcW / srcH;
    const dstRatio = targetWidth / targetHeight;

    let drawW = targetWidth;
    let drawH = targetHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (srcRatio > dstRatio) {
      // Source is wider than target
      drawW = targetHeight * srcRatio;
      offsetX = (targetWidth - drawW) / 2;
    } else {
      // Source is taller than target
      drawH = targetWidth / srcRatio;
      offsetY = (targetHeight - drawH) / 2;
    }

    ctx.save();
    ctx.drawImage(baseCanvas, offsetX, offsetY, drawW, drawH);
    ctx.restore();
  }

  // 2. Render each overlay layer
  for (const layer of overlayLayers) {
    if (!layer.text) continue;

    ctx.save();

    const posX = layer.x * targetWidth;
    const posY = layer.y * targetHeight;
    const opacity = layer.opacity ?? 1.0;
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    ctx.translate(posX, posY);
    if (layer.rotation) {
      ctx.rotate((layer.rotation * Math.PI) / 180);
    }

    // Configure text styling
    const fontSize = layer.fontSize || Math.round(targetHeight * 0.08);
    const fontWeight = layer.fontWeight || "bold";
    const fontFamily = layer.fontFamily || "Impact, Inter, system-ui, sans-serif";
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = layer.align || "center";
    ctx.textBaseline = "middle";

    const textMetrics = ctx.measureText(layer.text);
    const textW = textMetrics.width;
    const textH = fontSize * 1.2;

    // Optional Badge / Background container
    if (layer.kind === "badge" || layer.backgroundColor) {
      const padding = layer.backgroundPadding ?? Math.round(fontSize * 0.25);
      const bgW = textW + padding * 2;
      const bgH = textH + padding * 0.5;
      const bgX = layer.align === "left" ? -padding : layer.align === "right" ? -textW - padding : -bgW / 2;
      const bgY = -bgH / 2;
      const radius = layer.borderRadius ?? Math.round(fontSize * 0.15);

      ctx.fillStyle = layer.backgroundColor || "rgba(220, 38, 38, 0.9)"; // High-energy red default for badge
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(bgX, bgY, bgW, bgH, radius);
        ctx.fill();
      } else {
        ctx.fillRect(bgX, bgY, bgW, bgH);
      }
    }

    // Shadow
    if (layer.shadowColor) {
      ctx.shadowColor = layer.shadowColor;
      ctx.shadowBlur = layer.shadowBlur ?? 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
    }

    // Stroke / Outline
    if (layer.outlineColor && (layer.outlineWidth ?? 0) > 0) {
      ctx.strokeStyle = layer.outlineColor;
      ctx.lineWidth = layer.outlineWidth!;
      ctx.lineJoin = "round";
      ctx.strokeText(layer.text, 0, 0);
    }

    // Fill
    ctx.fillStyle = layer.color || "#ffffff";
    ctx.fillText(layer.text, 0, 0);

    ctx.restore();
  }

  return canvas;
}

/**
 * Save thumbnail canvas to disk using Tauri file dialog + exportCreatorThumbnail backend command.
 */
export async function saveThumbnailDialog(
  canvas: HTMLCanvasElement,
  defaultName: string,
  format: "png" | "jpeg" = "png",
  quality: number = 95,
): Promise<string | null> {
  const ext = format === "jpeg" ? "jpg" : "png";
  const defaultPath = `${defaultName}.${ext}`;

  let targetPath: string | null = null;
  if (isTauriRuntime()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      targetPath = await save({
        defaultPath,
        filters: [
          {
            name: format === "jpeg" ? "JPEG Image" : "PNG Image",
            extensions: [ext],
          },
        ],
      });
    } catch (err) {
      console.error("[saveThumbnailDialog] Save dialog error:", err);
      return null;
    }
  }

  if (!targetPath) {
    // If user cancelled dialog
    if (isTauriRuntime()) return null;

    // In web browser: trigger browser file download
    const dataUrl = canvas.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality / 100);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = defaultPath;
    a.click();
    return defaultPath;
  }

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = canvas.toDataURL(mimeType, quality / 100);

  const res = await exportCreatorThumbnail({
    outputPath: targetPath,
    dataUrl,
    format,
    quality,
  });

  return res.outputPath;
}
