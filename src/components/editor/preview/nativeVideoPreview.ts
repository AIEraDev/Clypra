import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import type {
  NativeProjectVideoLayer,
  NativeVideoProjectFrameRequest,
} from "@/lib/platform/tauri";
import { parseColor } from "@/core/evaluation/animation";
import {
  DEFAULT_NATIVE_COLOR_POLICY,
  createNativeFrameRequest,
  frameIndexToNativeTime,
  secondsToNativeTime,
  type NativeFrameRequest,
} from "@/lib/platform/nativeCore";

const NATIVE_BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "add", "additive", "difference"]);

function hasMeaningfulObject(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);
}

/**
 * Validate the native frame transport without inspecting pixel content.
 *
 * Fully black is valid video data, especially at a clip's first frame. Pixel
 * heuristics cannot distinguish a real black shot from a GPU clear, so native
 * renderer health must be diagnosed by the native service rather than by
 * rejecting valid RGBA payloads in the WebView.
 */
export function isRenderableNativePreviewFrame(
  rgba: ArrayBuffer,
  width: number,
  height: number,
): boolean {
  return width > 0 && height > 0 && rgba.byteLength === width * height * 4;
}

function isNativeFileSource(sourcePath: string): boolean {
  const value = sourcePath.trim().toLowerCase();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return false;

  // Tauri v2 may expose local filesystem media through the asset protocol's
  // HTTP origin. The IPC wrapper normalizes this URL back to a native path.
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.startsWith("http://asset.localhost/") || value.startsWith("https://asset.localhost/");
  }

  return true;
}

function isSupportedNativeVideoLayer(layer: EvaluatedMediaLayer): boolean {
  return (
    layer.mediaType === "video" &&
    layer.clipKind !== "sticker" &&
    isNativeFileSource(layer.sourcePath) &&
    !layer.filter &&
    !hasMeaningfulObject(layer.adjustments) &&
    !layer.effects?.length &&
    (!layer.sourceRotation || layer.sourceRotation === 0) &&
    NATIVE_BLEND_MODES.has(layer.blendMode)
  );
}

/**
 * Return a native clear color only for backgrounds whose semantics can be
 * represented exactly by the wgpu surface. Gradients, shaders, and media
 * backgrounds must stay on the full Pixi scene path until they have native
 * graph nodes of their own.
 */
function getNativeClearColor(scene: EvaluatedScene): [number, number, number, number] | null {
  const background = scene.metadata.canvasBackground;
  if (!background) return [0, 0, 0, 1];
  if (background.isTransparent) return [0, 0, 0, 0];
  if (background.type !== "solid") return null;

  const color = background.color?.trim() || "#000000";
  if (
    color !== "transparent" &&
    !/^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) &&
    !/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+\s*)?\)$/i.test(color)
  ) {
    return null;
  }

  const [red, green, blue, alpha] = parseColor(color);
  const requestedOpacity = background.opacity ?? 1;
  if (!Number.isFinite(requestedOpacity)) return null;
  const opacity = Math.min(1, Math.max(0, requestedOpacity));
  return [red / 255, green / 255, blue / 255, alpha * opacity];
}

export function buildNativeVideoProjectRequest(
  scene: EvaluatedScene,
): NativeVideoProjectFrameRequest | null {
  if (scene.transitions.length > 0) return null;
  if (scene.activeFilter) return null;
  if (scene.visualLayers.some((layer) => layer.layerType !== "media")) return null;
  const clearColor = getNativeClearColor(scene);
  if (!clearColor) return null;

  const mediaLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media",
  );
  if (mediaLayers.length === 0 || !mediaLayers.every(isSupportedNativeVideoLayer)) {
    return null;
  }

  const layers: NativeProjectVideoLayer[] = mediaLayers.map((layer, index) => ({
    videoPath: layer.sourcePath,
    timeSecs: layer.sourceTime,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: index,
    blendMode: layer.blendMode,
  }));

  if (layers.some((layer) => !Number.isFinite(layer.timeSecs) || layer.timeSecs < 0)) {
    return null;
  }

  return {
    canvasWidth: scene.metadata.canvasWidth || 1920,
    canvasHeight: scene.metadata.canvasHeight || 1080,
    clearColor,
    layers,
  };
}

/**
 * Build the versioned native-core request used by all new frame callers.
 * The existing request builder remains available only as a compatibility
 * adapter while the rest of the graph migrates to ProjectSnapshot.
 */
export function buildNativeFrameRequest(
  scene: EvaluatedScene,
  projectRevision: string,
  frameIndex: number,
  frameRate: number,
  outputWidth: number,
  outputHeight: number,
): NativeFrameRequest | null {
  const request = buildNativeVideoProjectRequest(scene);
  if (!request) return null;

  const videoLayers = scene.visualLayers
    .filter((layer): layer is EvaluatedMediaLayer => layer.layerType === "media")
    .map((layer, index) => ({
      assetId: layer.mediaId,
      videoPath: request.layers[index].videoPath,
      sourceTime: secondsToNativeTime(layer.sourceTime, Math.max(0, Math.round(layer.sourceTime * Math.max(frameRate, 1)))),
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: index,
      blendMode: layer.blendMode,
    }));

  return createNativeFrameRequest({
    requestId: `${projectRevision}:${frameIndex}:${outputWidth}x${outputHeight}`,
    frameTime: frameIndexToNativeTime(frameIndex, frameRate),
    project: {
      schemaVersion: 1,
      projectRevision,
      canvasWidth: request.canvasWidth,
      canvasHeight: request.canvasHeight,
      clearColor: request.clearColor ?? [0, 0, 0, 1],
      videoLayers,
    },
    outputWidth,
    outputHeight,
    quality: "full",
    colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
    renderGraphVersion: 1,
  });
}
