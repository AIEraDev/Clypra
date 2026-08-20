import type { EvaluatedMediaLayer, EvaluatedScene } from "@/core/evaluation/types";
import type {
  NativeProjectVideoLayer,
  NativeVideoProjectFrameRequest,
} from "@/lib/platform/tauri";
import { parseColor } from "@/core/evaluation/animation";
import { resolveFilterToIR, type FilterIR } from "@/core/render/filterIR";
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
const NATIVE_COLOR_GRADE_KEYS = new Set([
  "exposure", "contrast", "saturation", "temperature", "tint",
  "brightness", "sepia", "grayscale", "hue", "vignette", "invert", "grain", "vibrance",
]);

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
  colorGrade: EvaluatedMediaLayer["colorGrade"],
  filter: EvaluatedMediaLayer["filter"],
  effects: EvaluatedMediaLayer["effects"],
): NativeColorGradeSnapshot | null | undefined {
  const grade = colorGrade as Record<string, unknown> | undefined;
  const hasLut = grade?.hasLut === 1;
  const activeFilter = filter && filter.intensity > 0.001 ? filter : undefined;
  let filterIR: FilterIR = {};
  if (activeFilter) {
    filterIR = resolveFilterToIR(activeFilter.id, activeFilter.intensity);
    if (Object.keys(filterIR).length === 0) return null;
  }
  const hasGradeValues = Boolean(grade && (
    grade.exposure !== 0 || grade.contrast !== 1 || grade.saturation !== 1 ||
    grade.temperature !== 0 || grade.tint !== 0 || hasLut
  ));
  const activeEffects = (effects ?? []).filter((effect) => effect.intensity > 0.001);
  if (!hasMeaningfulObject(adjustments) && !hasGradeValues && !activeFilter && activeEffects.length === 0) return undefined;
  if (hasLut && (typeof grade?.lutId !== "string" || !grade.lutId.trim())) return null;
  const values = adjustments as Record<string, unknown> | undefined;
  const readNumber = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const readAdjustment = (key: string): number | null | undefined => readNumber(values?.[key]);
  const readGrade = (key: string): number | null | undefined => readNumber(grade?.[key]);
  const choose = (key: string, fallback: number, ...fallbacks: Array<number | undefined>): number | null => {
    const adjustment = readAdjustment(key);
    if (adjustment !== undefined) return adjustment;
    const gradeValue = readGrade(key);
    if (gradeValue !== undefined) return gradeValue;
    for (const value of fallbacks) {
      if (value !== undefined) return value;
    }
    return fallback;
  };
  const adjustmentKeys = new Set(Object.keys(values ?? {}));
  if ([...adjustmentKeys].some((key) => !NATIVE_COLOR_GRADE_KEYS.has(key))) return null;
  const supportedEffectRenderers = new Set(["blur", "pixelate", "scanlines", "rgb_split", "chromatic_aberration", "chromatic"]);
  if (activeEffects.some((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return !supportedEffectRenderers.has(renderer);
  })) return null;
  const blurEffects = activeEffects.filter((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return renderer === "blur";
  });
  const blurRadius = blurEffects.reduce((total, effect) => {
    const amount = Number(effect.parameters.blur ?? effect.parameters.blurAmount ?? 10);
    return Number.isFinite(amount) && amount >= 0 ? total + amount * effect.intensity : Number.NaN;
  }, 0);
  if (!Number.isFinite(blurRadius)) return null;
  let pixelateSize = 0;
  let scanlineCount = 0;
  let scanlineIntensity = 0;
  let rgbSplitX = 0;
  let rgbSplitY = 0;
  for (const effect of activeEffects) {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    if (renderer === "pixelate") {
      const amount = Number(effect.parameters.pixelSize ?? 18);
      if (!Number.isFinite(amount) || amount < 0) return null;
      pixelateSize = Math.max(pixelateSize, Math.max(2, Math.floor(amount * effect.intensity)));
    } else if (renderer === "scanlines") {
      const count = Number(effect.parameters.scanlineCount ?? 120);
      if (!Number.isFinite(count) || count <= 0) return null;
      scanlineCount = Math.max(scanlineCount, count);
      scanlineIntensity = Math.max(scanlineIntensity, effect.intensity);
    } else if (renderer === "rgb_split" || renderer === "chromatic_aberration" || renderer === "chromatic") {
      const shift = Number(effect.parameters.rgbSplit ?? effect.parameters.splitDistance ?? 8);
      if (!Number.isFinite(shift) || shift < 0) return null;
      const scaledShift = shift * effect.intensity;
      rgbSplitX = Math.max(rgbSplitX, scaledShift);
      rgbSplitY = Math.max(rgbSplitY, scaledShift);
    }
  }
  const exposure = choose("exposure", 0);
  const contrastAdjustment = readAdjustment("contrast");
  const contrast = contrastAdjustment === null
    ? null
    : contrastAdjustment !== undefined
      ? contrastAdjustment + 1
      : choose("contrast", 1, filterIR.contrast);
  const saturationAdjustment = readAdjustment("saturation");
  const saturation = saturationAdjustment === null
    ? null
    : saturationAdjustment !== undefined
      ? saturationAdjustment + 1
      : choose("saturation", 1, filterIR.saturate);
  const temperature = choose("temperature", 0);
  const tint = choose("tint", 0);
  const brightness = choose("brightness", 0);
  const sepia = choose("sepia", 0, filterIR.sepia);
  const grayscale = choose("grayscale", 0, filterIR.grayscale);
  const hueAdjustment = readAdjustment("hue");
  const hue = hueAdjustment !== undefined ? hueAdjustment : filterIR.hueRotate ?? 0;
  const vignette = choose("vignette", 0);
  const grainValue = values?.grain;
  const grainIntensity = grainValue === undefined
    ? 0
    : typeof grainValue === "object" && grainValue !== null
      ? readNumber((grainValue as Record<string, unknown>).intensity) ?? null
      : null;
  const grainSize = grainValue === undefined
    ? 1
    : typeof grainValue === "object" && grainValue !== null
      ? readNumber((grainValue as Record<string, unknown>).size) ?? null
      : null;
  const vibranceValue = values?.vibrance;
  const vibranceAmount = vibranceValue === undefined
    ? 0
    : typeof vibranceValue === "object" && vibranceValue !== null
      ? readNumber((vibranceValue as Record<string, unknown>).amount) ?? null
      : null;
  let vibranceProtectedHue: [number, number, number] = [0.91, 0.69, 0.55];
  if (vibranceValue !== undefined && typeof vibranceValue === "object" && vibranceValue !== null) {
    const protectedHue = (vibranceValue as Record<string, unknown>).protectedHue;
    if (protectedHue !== undefined) {
      if (typeof protectedHue !== "string") return null;
      const [red, green, blue] = parseColor(protectedHue);
      vibranceProtectedHue = [red / 255, green / 255, blue / 255];
    }
  }
  const invertValue = values?.invert;
  const invert = invertValue === undefined
    ? 0
    : typeof invertValue === "boolean"
      ? (invertValue ? 1 : 0)
      : typeof invertValue === "number" && Number.isFinite(invertValue)
        ? invertValue
        : null;
  if (
    exposure === null || contrast === null || saturation === null || temperature === null || tint === null ||
    brightness === null || sepia === null || grayscale === null || hue === null || vignette === null || invert === null ||
    grainIntensity === null || grainSize === null || vibranceAmount === null
  ) {
    return null;
  }

  return {
    exposure,
    contrast,
    saturation,
    temperature,
    tint,
    brightness,
    sepia,
    grayscale,
    hueRotate: (hue * Math.PI) / 180,
    vignette,
    invert,
    grainIntensity,
    grainSize,
    ...(hasLut ? {
      lutId: typeof grade?.lutId === "string" && grade.lutId.trim() ? grade.lutId : undefined,
      lutIntensity: typeof grade?.lutIntensity === "number" && Number.isFinite(grade.lutIntensity) ? grade.lutIntensity : 1,
      lutSize: typeof grade?.lutSize === "number" && Number.isFinite(grade.lutSize) ? grade.lutSize : 33,
    } : { lutIntensity: 1, lutSize: 33 }),
    blurStrength: blurEffects.length > 0 ? 1 : 0,
    blurRadius,
    pixelateSize,
    scanlineCount,
    scanlineIntensity,
    rgbSplitX,
    rgbSplitY,
    vibranceAmount,
    vibranceProtectedHueR: vibranceProtectedHue[0],
    vibranceProtectedHueG: vibranceProtectedHue[1],
    vibranceProtectedHueB: vibranceProtectedHue[2],
  };
}

function isSupportedNativeVideoLayer(layer: EvaluatedMediaLayer): boolean {
  return (
    (layer.mediaType === "video" || layer.mediaType === "image") &&
    layer.clipKind !== "sticker" &&
    isNativeFileSource(layer.sourcePath) &&
    getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects) !== null &&
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
  if (scene.visualLayers.some((layer) => layer.layerType !== "media" && layer.layerType !== "text")) return null;
  const clearColor = getNativeClearColor(scene);
  if (!clearColor) return null;

  const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
  if (textLayers.length !== rasterLayers.length) return null;
  const mediaLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media",
  );
  if (mediaLayers.length === 0 && textLayers.length === 0) return null;
  if (scene.activeFilter && mediaLayers.some((layer) => layer.filter?.id !== scene.activeFilter?.id)) return null;
  if (!mediaLayers.every(isSupportedNativeVideoLayer)) {
    return null;
  }

  const layers: NativeProjectVideoLayer[] = mediaLayers.map((layer) => {
    const colorGrade = getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects);
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
      const colorGrade = getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects);
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
