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
  type NativeColorGradeSnapshot,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
} from "@/lib/platform/nativeCore";

const NATIVE_BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "add", "additive", "difference"]);
const NATIVE_COLOR_GRADE_KEYS = new Set(["exposure", "contrast", "saturation", "temperature", "tint"]);

/**
 * Build a scheduler identity without serializing large RGBA payloads on every
 * animation frame. The raster asset id is content-addressed by the Studio
 * text inputs, so excluding the bytes here cannot alias two visible assets.
 */
export function getNativeFrameRequestKey(request: NativeFrameRequest): string {
  if (!request.project.rasterLayers?.length) return JSON.stringify(request);

  return JSON.stringify({
    ...request,
    project: {
      ...request.project,
      rasterLayers: request.project.rasterLayers.map(({ rgba: _rgba, ...layer }) => layer),
    },
  });
}

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

function getNativeColorGrade(
  adjustments: EvaluatedMediaLayer["adjustments"],
): NativeColorGradeSnapshot | null | undefined {
  if (!hasMeaningfulObject(adjustments)) return undefined;
  const values = adjustments as Record<string, unknown>;
  if (Object.keys(values).some((key) => !NATIVE_COLOR_GRADE_KEYS.has(key))) return null;

  const read = (key: string, fallback: number): number | null => {
    const value = values[key];
    if (value === undefined) return fallback;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const exposure = read("exposure", 0);
  const contrast = read("contrast", 0);
  const saturation = read("saturation", 0);
  const temperature = read("temperature", 0);
  const tint = read("tint", 0);
  if (exposure === null || contrast === null || saturation === null || temperature === null || tint === null) {
    return null;
  }

  return {
    exposure,
    contrast: 1 + contrast,
    saturation: 1 + saturation,
    temperature,
    tint,
  };
}

function isSupportedNativeVideoLayer(layer: EvaluatedMediaLayer): boolean {
  return (
    (layer.mediaType === "video" || layer.mediaType === "image") &&
    layer.clipKind !== "sticker" &&
    isNativeFileSource(layer.sourcePath) &&
    !layer.filter &&
    getNativeColorGrade(layer.adjustments) !== null &&
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
  rasterLayers: NativeRasterLayerSnapshot[] = [],
): NativeVideoProjectFrameRequest | null {
  if (scene.transitions.length > 0) return null;
  if (scene.activeFilter) return null;
  if (scene.visualLayers.some((layer) => layer.layerType !== "media" && layer.layerType !== "text")) return null;
  const clearColor = getNativeClearColor(scene);
  if (!clearColor) return null;

  const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
  if (textLayers.length !== rasterLayers.length) return null;
  const mediaLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media",
  );
  if (mediaLayers.length === 0 && textLayers.length === 0) return null;
  if (!mediaLayers.every(isSupportedNativeVideoLayer)) {
    return null;
  }

  const layers: NativeProjectVideoLayer[] = mediaLayers.map((layer) => {
    const colorGrade = getNativeColorGrade(layer.adjustments);
    return {
      videoPath: layer.sourcePath,
      timeSecs: layer.sourceTime,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      ...(colorGrade ? { colorGrade } : {}),
    };
  });

  if (layers.some((layer) => !Number.isFinite(layer.timeSecs) || layer.timeSecs < 0)) {
    return null;
  }

  return {
    canvasWidth: scene.metadata.canvasWidth || 1920,
    canvasHeight: scene.metadata.canvasHeight || 1080,
    clearColor,
    layers,
    ...(rasterLayers.length > 0 ? { rasterLayers } : {}),
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
  rasterLayers: NativeRasterLayerSnapshot[] = [],
): NativeFrameRequest | null {
  const request = buildNativeVideoProjectRequest(scene, rasterLayers);
  if (!request) return null;

  const videoLayers = scene.visualLayers
    .filter((layer): layer is EvaluatedMediaLayer => layer.layerType === "media")
    .map((layer, index) => {
      const colorGrade = getNativeColorGrade(layer.adjustments);
      return {
      assetId: layer.mediaId,
      videoPath: request.layers[index].videoPath,
      sourceTime: secondsToNativeTime(layer.sourceTime, Math.max(0, Math.round(layer.sourceTime * Math.max(frameRate, 1)))),
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      blendMode: layer.blendMode,
      ...(colorGrade ? { colorGrade } : {}),
      };
    });

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
      ...(rasterLayers.length > 0 ? { rasterLayers } : {}),
    },
    outputWidth,
    outputHeight,
    quality: "full",
    colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
    renderGraphVersion: 1,
  });
}
