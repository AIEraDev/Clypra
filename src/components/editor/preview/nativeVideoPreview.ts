import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import type {
  NativeProjectVideoLayer,
  NativeVideoProjectFrameRequest,
} from "@/lib/platform/tauri";

const NATIVE_BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "add", "additive", "difference"]);

function isNativeFileSource(sourcePath: string): boolean {
  const value = sourcePath.trim().toLowerCase();
  return value.length > 0 && !["data:", "blob:", "http://", "https://"].some((prefix) => value.startsWith(prefix));
}

function isSupportedNativeVideoLayer(layer: EvaluatedMediaLayer): boolean {
  return (
    layer.mediaType === "video" &&
    layer.clipKind !== "sticker" &&
    isNativeFileSource(layer.sourcePath) &&
    !layer.filter &&
    !layer.adjustments &&
    !layer.effects?.length &&
    (!layer.sourceRotation || layer.sourceRotation === 0) &&
    NATIVE_BLEND_MODES.has(layer.blendMode)
  );
}

export function buildNativeVideoProjectRequest(
  scene: EvaluatedScene,
): NativeVideoProjectFrameRequest | null {
  if (scene.transitions.length > 0) return null;

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
    clearColor: [0, 0, 0, 1],
    layers,
  };
}

