import type { EvaluatedMediaLayer, EvaluatedScene, EvaluatedTextLayer } from "@/core/evaluation/types";
import { cullOccludedVisualLayers } from "@/core/evaluation/evaluator";
import type {
  NativeProjectVideoLayer,
  NativeVideoProjectFrameRequest,
} from "@/lib/platform/tauri";
import { parseColor } from "@/core/evaluation/animation";
import { resolveFilterToIR, type FilterIR } from "@/core/render/filterIR";
import { buildNativeImageAssetId } from "@/core/render/nativeRasterAssetIds";

function parseColorToRgba(color: string): [number, number, number, number] {
  if (!color) return [1, 1, 1, 1];
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      return [r, g, b, 1];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return [r, g, b, 1];
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return [r, g, b, a];
    }
  }
  const rgbaMatch = c.match(/rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = parseFloat(rgbaMatch[1]) / 255;
    const g = parseFloat(rgbaMatch[2]) / 255;
    const b = parseFloat(rgbaMatch[3]) / 255;
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    return [r, g, b, a];
  }
  return [1, 1, 1, 1];
}

function normalizeNativeTextEffect(
  layer: EvaluatedTextLayer,
): NativeTextLayerSnapshot["effect"] {
  const normalizeParam = (value: unknown): number | string | [number, number] | [number, number, number, number] | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item))) {
      if (value.length === 2) return value as [number, number];
      if (value.length === 4) return value as [number, number, number, number];
    }
    return undefined;
  };
  const definition = layer.styleDefinition as
    | (typeof layer.styleDefinition & {
        id?: string;
        version?: number;
        name?: string;
        passes?: Array<{
          primitive?: string;
          tier?: string;
          params?: Record<string, unknown>;
        }>;
      })
    | undefined;
  if (!layer.styleId && !definition?.id) return undefined;

  return {
    effectId: layer.styleId ?? definition?.id ?? "native-text-effect",
    effectVersion: layer.styleVersion ?? (Number(definition?.version) || 1),
    parameterOverrides: layer.parameterOverrides,
    ...(definition?.passes
      ? {
          definition: {
            displayName: definition.name,
            passes: definition.passes.map((pass) => ({
              primitive: pass.primitive ?? "distance_threshold",
              tier: pass.tier,
              ...(pass.params
                ? {
                    params: Object.fromEntries(
                      Object.entries(pass.params)
                        .map(([key, value]) => [key, normalizeParam(value)] as const)
                        .filter((entry): entry is [string, number | string | [number, number] | [number, number, number, number]] => entry[1] !== undefined),
                    ),
                  }
                : {}),
            })),
          },
        }
      : {}),
  };
}
import {
  DEFAULT_NATIVE_COLOR_POLICY,
  createNativeFrameRequest,
  frameIndexToNativeTime,
  secondsToNativeTime,
  type NativeColorGradeSnapshot,
  type NativeBodyEffectSnapshot,
  type NativeTransitionSnapshot,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
  type NativeTextLayerSnapshot,
} from "@/lib/platform/nativeCore";

const NATIVE_BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "add", "additive", "difference"]);
const NATIVE_COLOR_GRADE_KEYS = new Set([
  "exposure", "contrast", "saturation", "temperature", "tint",
  "brightness", "sepia", "grayscale", "hue", "vignette", "invert", "grain", "vibrance",
  "lift", "crossProcess", "channelMix", "duotone", "splitTone",
]);
const NATIVE_BODY_EFFECT_RENDERERS = new Set(["body_outline", "body_glow", "body_segmentation_glow", "body_particles"]);
const NATIVE_VIDEO_EFFECT_RENDERERS = new Set([
  "blur", "pixelate", "scanlines", "rgb_split", "chromatic_aberration", "chromatic",
  "vhs", "glitch", "wave", "ripple", "bulge", "twist", "fisheye", "crt", "film_grain", "grain",
  "vignette", "glow", "flash", "flicker", "strobe", "light_leak", "light_leak_2",
  "body_outline", "body_glow", "body_segmentation_glow", "body_particles",
  "motion_blur", "radial_blur", "zoom_blur",
  "fire", "particles", "dust_particles",
]);
const NATIVE_BACKGROUND_MEDIA_LAYER_ID = "__native-background-media";

function hasNativeImageRasterAsset(
  layer: EvaluatedMediaLayer,
  asset: NativeRasterLayerSnapshot,
): boolean {
  if (asset.isMask) return false;
  // Accept the old layer-scoped identity while projects/frames transition to
  // the deterministic source-scoped identity. New producers must use the
  // shared identity helper above.
  const sourceWidth = layer.sourceWidth ?? layer.width;
  const sourceHeight = layer.sourceHeight ?? layer.height;
  return asset.assetId === buildNativeImageAssetId(layer.sourcePath, sourceWidth, sourceHeight)
    || asset.assetId.startsWith(`native-image:${layer.layerId}:`);
}

function hasNativeTextRasterAsset(
  layer: EvaluatedTextLayer,
  rasterLayers: NativeRasterLayerSnapshot[],
): boolean {
  return rasterLayers.some(
    (asset) =>
      !asset.isMask &&
      asset.assetId.startsWith(`native-text:${layer.layerId}:`),
  );
}

function getNativeTransitionSnapshot(
  scene: EvaluatedScene,
  mediaLayers: EvaluatedMediaLayer[],
): NativeTransitionSnapshot | null | undefined {
  if (scene.transitions.length === 0) return undefined;
  if (scene.transitions.length !== 1 || mediaLayers.length !== 2) return null;

  const transition = scene.transitions[0];
  const outgoingIndex = mediaLayers.findIndex((layer) => layer.layerId === transition.outgoingLayer);
  const incomingIndex = mediaLayers.findIndex((layer) => layer.layerId === transition.incomingLayer);
  if (outgoingIndex < 0 || incomingIndex < 0 || outgoingIndex === incomingIndex) return null;

  const renderer = (transition.renderer || transition.type || "").replace(/^fx-/, "").toLowerCase();
  const params = (transition.params ?? {}) as Record<string, unknown>;
  let transitionType: string;
  let fadeColor: [number, number, number, number] | undefined;
  if (["fade", "dissolve", "cross-dissolve"].includes(renderer)) {
    if (renderer === "fade" && params.color !== undefined) {
      if (typeof params.color !== "string") return null;
      const parsed = parseColor(params.color);
      fadeColor = [parsed[0] / 255, parsed[1] / 255, parsed[2] / 255, parsed[3]];
      transitionType = "fade-through-color";
    } else {
      transitionType = "cross-dissolve";
    }
  } else if (["blur_fade", "directional_blur"].includes(renderer)) {
    transitionType = "blur-fade";
  } else if (["wipe_left", "wipe_right", "wipe_up", "wipe_down", "wipe-left", "wipe-right", "wipe-up", "wipe-down"].includes(renderer)) {
    transitionType = renderer.replace(/_/g, "-");
  } else if (["wipe_diagonal", "wipe-diagonal"].includes(renderer)) {
    transitionType = "wipe-diagonal";
  } else if (["wipe_clockwise", "wipe-clockwise"].includes(renderer)) {
    transitionType = "wipe-clockwise";
  } else if (["wipe_center", "wipe-center", "circle_expand", "circle-expand", "circle_collapse", "circle-collapse"].includes(renderer)) {
    transitionType = "circle-wipe";
  } else if (["diamond_expand", "diamond-expand"].includes(renderer)) {
    transitionType = "diamond-wipe";
  } else if (["rectangle_expand", "rectangle-expand"].includes(renderer)) {
    transitionType = "rectangle-wipe";
  } else if (["slide_left", "slide-left", "slide_right", "slide-right", "slide_up", "slide-up", "slide_down", "slide-down", "slide_push"].includes(renderer)) {
    transitionType = renderer === "slide_push" ? "slide-right" : renderer.replace(/_/g, "-");
  } else if (["zoom_blur", "zoom_in", "zoom_out", "zoom-blur"].includes(renderer)) {
    transitionType = renderer === "zoom_in" ? "zoom-in" : renderer === "zoom_out" ? "zoom-out" : "zoom-blur";
  } else if (["glitch", "rgb_split", "rgb-split", "chromatic", "film_burn", "film-burn", "light_leak", "light-leak", "whip_pan", "whip-pan"].includes(renderer)) {
    transitionType = renderer.replace(/_/g, "-");
  } else if (["iris-reveal", "iris-wipe", "iris"].includes(renderer)) {
    // The timeline currently persists the published renderer, not custom
    // iris geometry. Reject non-default geometry instead of silently dropping
    // the authoring parameters on the native path.
    const centerX = params.centerX;
    const centerY = params.centerY;
    const shape = params.shape;
    if ((centerX !== undefined && centerX !== 0.5) || (centerY !== undefined && centerY !== 0.5) || (shape !== undefined && shape !== "circle")) {
      return null;
    }
    transitionType = "iris-wipe";
  } else {
    return null;
  }

  const readFinite = (value: unknown, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const feather = readFinite(params.feather, 0.1);
  const intensity = readFinite(params.intensity ?? params.blurAmount, 1);
  if (feather === null || intensity === null || !Number.isFinite(transition.progress)) return null;

  return {
    outgoingLayer: mediaLayers[outgoingIndex].layerId,
    incomingLayer: mediaLayers[incomingIndex].layerId,
    transitionType,
    progress: Math.min(1, Math.max(0, transition.progress)),
    feather: Math.min(1, Math.max(0, feather)),
    intensity: Math.max(0, intensity),
    ...(fadeColor ? { fadeColor } : {}),
  };
}

/**
 * Build a scheduler identity without serializing large RGBA payloads on every
 * animation frame. The raster asset id is content-addressed by the Studio
 * text inputs, so excluding the bytes here cannot alias two visible assets.
 */
export function getNativeFrameRequestKey(request: NativeFrameRequest): string {
  // Match NativeFrameRequest::cache_key on the Rust side. These fields identify
  // scheduling/cancellation, not rendered pixels; retaining them here prevents
  // a frame decoded during lookahead or a previous seek generation from being
  // reused by the visible request.
  const {
    generation: _generation,
    mode: _mode,
    scrubVelocityPxPerSecond: _scrubVelocityPxPerSecond,
    requestedAtMs: _requestedAtMs,
    ...cacheIdentity
  } = request;

  if (!request.project.rasterLayers?.length) return JSON.stringify(cacheIdentity);

  return JSON.stringify({
    ...cacheIdentity,
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

function getNativeBackgroundMediaPath(scene: EvaluatedScene): string | null {
  const background = scene.metadata.canvasBackground;
  if (!background || background.type !== "media" || typeof background.mediaUrl !== "string") return null;
  const mediaPath = background.mediaUrl.trim();
  return isNativeFileSource(mediaPath) ? mediaPath : null;
}

function getNativeBackgroundMediaOpacity(scene: EvaluatedScene): number {
  const opacity = scene.metadata.canvasBackground?.opacity;
  return typeof opacity === "number" && Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
}

interface NativeMpgStackGrade {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  sepia: number;
  grayscale: number;
  hueRotate: number;
  vignette: number;
  blurRadius: number;
}

/** Collapse supported MPG v2 single-input nodes into the native one-pass grade. */
function resolveNativeMpgStack(
  stack: ReadonlyArray<{ type: string; params?: Record<string, unknown> }> | undefined,
): NativeMpgStackGrade | null | undefined {
  if (!stack || stack.length === 0) return undefined;
  const grade: NativeMpgStackGrade = {
    brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0,
    sepia: 0, grayscale: 0, hueRotate: 0, vignette: 0, blurRadius: 0,
  };
  const read = (params: Record<string, unknown>, keys: string[], fallback = 0): number | null => {
    const value = keys.map((key) => params[key]).find((candidate) => candidate !== undefined);
    if (value === undefined) return fallback;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const composite = (current: number, amount: number): number => 1 - (1 - current) * (1 - amount);
  for (const node of stack) {
    const type = node.type.replace(/[-_\s]/g, "").toLowerCase();
    const params = node.params ?? {};
    if (type === "brightness") {
      const value = read(params, ["brightness"]); if (value === null) return null; grade.brightness += value;
    } else if (type === "contrast") {
      const value = read(params, ["contrast"]); if (value === null || value < -1 || value > 1) return null; grade.contrast *= 1 + value;
    } else if (type === "saturation") {
      const value = read(params, ["saturation"]); if (value === null || value < -1 || value > 1) return null; grade.saturation *= 1 + value;
    } else if (type === "temperature") {
      const value = read(params, ["temperature"]); if (value === null) return null; grade.temperature += value;
    } else if (type === "tint") {
      const value = read(params, ["tint"]); if (value === null) return null; grade.tint += value;
    } else if (type === "sepia") {
      const value = read(params, ["sepia"]); if (value === null || value < 0 || value > 1) return null; grade.sepia = composite(grade.sepia, value);
    } else if (type === "grayscale") {
      const value = read(params, ["grayscale"]); if (value === null || value < 0 || value > 1) return null; grade.grayscale = composite(grade.grayscale, value);
    } else if (type === "huerotate") {
      const value = read(params, ["hueRotate", "hue"]); if (value === null) return null; grade.hueRotate += Math.abs(value) > Math.PI * 2 ? (value * Math.PI) / 180 : value;
    } else if (type === "vignette") {
      const value = read(params, ["vignette"]); if (value === null || value < 0 || value > 1) return null; grade.vignette = composite(grade.vignette, value);
    } else if (type === "gaussianblur") {
      const value = read(params, ["blur", "blurAmount"]); if (value === null || value < 0) return null; grade.blurRadius += value;
    } else {
      return null;
    }
  }
  return grade;
}

function getNativeColorGrade(
  adjustments: EvaluatedMediaLayer["adjustments"],
  colorGrade: EvaluatedMediaLayer["colorGrade"],
  filter: EvaluatedMediaLayer["filter"],
  effects: EvaluatedMediaLayer["effects"],
  mpgStack?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>,
): NativeColorGradeSnapshot | null | undefined {
  const grade = colorGrade as Record<string, unknown> | undefined;
  const activeFilter = filter && filter.intensity > 0.001 ? filter : undefined;
  const filterLutId = (activeFilter as any)?.lutId || (activeFilter as any)?.lut;
  const hasLut = grade?.hasLut === 1 || Boolean(filterLutId);
  const effectiveLutId = (typeof grade?.lutId === "string" && grade.lutId.trim() ? grade.lutId.trim() : undefined)
    ?? (typeof filterLutId === "string" && filterLutId.trim() ? filterLutId.trim() : undefined);
  const preset = activeFilter?.gradingParams as Record<string, unknown> | undefined;
  const presetIntensity = activeFilter?.intensity ?? 0;
  const layerMpgStack = (filter as (typeof filter & {
    effectStack?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>;
  }) | undefined)?.effectStack;
  const mpgGrade = resolveNativeMpgStack(mpgStack ?? layerMpgStack);
  if (mpgGrade === null) return null;
  let filterIR: FilterIR = {};
  if (activeFilter) {
    filterIR = resolveFilterToIR(activeFilter.id, activeFilter.intensity);
    if (Object.keys(filterIR).length === 0 && !preset && !mpgGrade && !effectiveLutId) return null;
  }
  const hasGradeValues = Boolean(grade && (
    grade.exposure !== 0 || grade.contrast !== 1 || grade.saturation !== 1 ||
    grade.temperature !== 0 || grade.tint !== 0 || grade.lift !== 0 ||
    grade.crossProcessAmount !== 0 || hasLut
  )) || Boolean(preset && Object.keys(preset).length > 0) || Boolean(mpgGrade);
  const activeEffects = (effects ?? []).filter((effect) => effect.intensity > 0.001);
  if (!hasMeaningfulObject(adjustments) && !hasGradeValues && !activeFilter && activeEffects.length === 0) return undefined;
  if (hasLut && !effectiveLutId) return null;
  const values = adjustments as Record<string, unknown> | undefined;
  const readNumber = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  let invalidPresetNumber = false;
  const readPreset = (key: string): number | null | undefined => readNumber(preset?.[key]);
  const scaledPreset = (key: string): number | undefined => {
    const value = readPreset(key);
    if (value === null) {
      invalidPresetNumber = true;
      return undefined;
    }
    return value === undefined ? undefined : value * presetIntensity;
  };
  const readAdjustment = (key: string): number | null | undefined => readNumber(values?.[key]);
  const readGrade = (key: string): number | null | undefined => readNumber(grade?.[key]);
  const readObjectNumber = (value: unknown, key: string): number | null | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null) return null;
    return readNumber((value as Record<string, unknown>)[key]);
  };
  const parseNativeColor = (value: unknown): [number, number, number] | null | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const [red, green, blue] = parseColor(value);
    return [red / 255, green / 255, blue / 255];
  };
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
  const nativePresetKeys = new Set([
    "exposure", "brightness", "contrast", "saturation", "temperature", "tint",
    "sepia", "grayscale", "hueRotate", "vignette", "invert", "lift", "grain",
    "channelMix", "splitTone", "duotone", "vibrance", "crossProcess",
  ]);
  if (preset && Object.keys(preset).some((key) => !nativePresetKeys.has(key))) return null;
  if (activeEffects.some((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return !NATIVE_VIDEO_EFFECT_RENDERERS.has(renderer);
  })) return null;
  const blurEffects = activeEffects.filter((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return renderer === "blur" || renderer === "motion_blur" || renderer === "radial_blur" || renderer === "zoom_blur";
  });
  const blurRadius = blurEffects.reduce((total, effect) => {
    const amount = Number(effect.parameters.blur ?? effect.parameters.blurAmount ?? 10);
    return Number.isFinite(amount) && amount >= 0 ? total + amount * effect.intensity : Number.NaN;
  }, mpgGrade?.blurRadius ?? 0);
  if (!Number.isFinite(blurRadius)) return null;
  let pixelateSize = 0;
  let scanlineCount = 0;
  let scanlineIntensity = 0;
  let rgbSplitX = 0;
  let rgbSplitY = 0;
  let effectGrainIntensity = 0;
  let effectGrainSize = 1;
  let effectVignette = 0;
  let glowColor: [number, number, number] = [1, 1, 1];
  let glowStrength = 0;
  let glowRadius = 0;
  let flashColor: [number, number, number] = [1, 1, 1];
  let flashStrength = 0;
  let flickerStrength = 0;
  let strobeFrequency = 0;
  let strobeTime = 0;
  let strobeStrength = 0;
  let lightLeakColor: [number, number, number] = [1, 0.7843137255, 0.3921568627];
  let lightLeakStrength = 0;
  let lightLeakAngle = Math.PI / 4;
  let lightLeakTime = 0;
  let glitchIntensity = 0;
  let glitchTime = 0;
  let glitchSliceCount = 0;
  let glitchColorShift = 0;
  let distortionType = 0;
  let distortionStrength = 0;
  let distortionTime = 0;
  let distortionFrequency = 6;
  let fireParams: [number, number, number, number] = [0, 0, 0, 0];
  let fireColor1: [number, number, number, number] = [1, 0.2705882353, 0, 0];
  let fireColor2: [number, number, number, number] = [1, 0.6470588235, 0, 0];
  let fireColor3: [number, number, number, number] = [1, 0.8431372549, 0, 0];
  let particleParams: [number, number, number, number] = [0, 0, 0, 0];
  let particleColor: [number, number, number, number] = [1, 1, 1, 0];
  let particleTime = 0;
  for (const effect of activeEffects) {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    if (renderer === "wave" || renderer === "ripple" || renderer === "bulge" || renderer === "twist" || renderer === "fisheye") {
      const type = renderer === "wave" ? 1 : renderer === "ripple" ? 2 : renderer === "bulge" ? 3 : renderer === "twist" ? 4 : 5;
      const amount = Number(effect.parameters.amount ?? effect.parameters.strength ?? effect.parameters.distortionStrength ?? (renderer === "twist" ? 0.35 : 0.08));
      const frequency = Number(effect.parameters.frequency ?? (renderer === "wave" || renderer === "ripple" ? 6 : 1));
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(frequency) || frequency <= 0) return null;
      if (effect.intensity >= distortionStrength) {
        distortionType = type;
        distortionStrength = Math.min(1, amount * effect.intensity);
        distortionFrequency = Math.min(64, frequency);
        distortionTime = Math.max(0, effect.localTime);
      }
    } else if (renderer === "glitch") {
      const amount = Number(effect.parameters.glitchIntensity ?? effect.parameters.amount ?? 50);
      const sliceCount = Number(effect.parameters.sliceCount ?? 5);
      const colorShift = Number(effect.parameters.colorOffset ?? effect.parameters.splitDistance ?? 12);
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(sliceCount) || sliceCount <= 0 || !Number.isFinite(colorShift) || colorShift < 0) return null;
      glitchIntensity = Math.max(glitchIntensity, Math.min(1, amount / 100) * effect.intensity);
      glitchSliceCount = Math.max(glitchSliceCount, Math.min(64, sliceCount));
      glitchColorShift = Math.max(glitchColorShift, colorShift * effect.intensity);
      glitchTime = Math.max(glitchTime, effect.localTime);
    } else if (renderer === "pixelate") {
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
    } else if (renderer === "film_grain" || renderer === "grain") {
      const intensity = Number(effect.parameters.grainIntensity ?? 0.1);
      const size = Number(effect.parameters.grainSize ?? 1);
      if (!Number.isFinite(intensity) || intensity < 0 || !Number.isFinite(size) || size <= 0) return null;
      effectGrainIntensity = Math.max(effectGrainIntensity, intensity * effect.intensity);
      effectGrainSize = Math.max(effectGrainSize, size);
    } else if (renderer === "vignette") {
      effectVignette = Math.max(effectVignette, effect.intensity);
    } else if (renderer === "glow") {
      const radius = Number(effect.parameters.glowAmount ?? effect.parameters.blurAmount ?? 10);
      const strength = Number(effect.parameters.glowIntensity ?? 0.8) * effect.intensity;
      const colorValue = effect.parameters.glowColor ?? "#ffffff";
      if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(strength) || strength < 0 || typeof colorValue !== "string") return null;
      const [red, green, blue] = parseColor(colorValue);
      if (strength >= glowStrength) glowColor = [red / 255, green / 255, blue / 255];
      glowStrength = Math.max(glowStrength, Math.min(1, strength));
      glowRadius = Math.max(glowRadius, radius * effect.intensity);
    } else if (renderer === "flash") {
      const strength = Number(effect.parameters.flashIntensity ?? 1) * effect.intensity;
      const colorValue = effect.parameters.flashColor ?? "#ffffff";
      if (!Number.isFinite(strength) || strength < 0 || typeof colorValue !== "string") return null;
      const [red, green, blue] = parseColor(colorValue);
      if (strength >= flashStrength) flashColor = [red / 255, green / 255, blue / 255];
      flashStrength = Math.max(flashStrength, Math.min(1, strength));
    } else if (renderer === "flicker") {
      const amount = Number(effect.parameters.flickerAmount ?? 1) * effect.intensity;
      if (!Number.isFinite(amount) || amount < 0) return null;
      flickerStrength = Math.max(flickerStrength, Math.min(1, amount));
    } else if (renderer === "strobe") {
      const frequency = Number(effect.parameters.frequency ?? 10);
      const strength = Number(effect.parameters.flashIntensity ?? 0.8) * effect.intensity;
      if (!Number.isFinite(frequency) || frequency < 0 || !Number.isFinite(strength) || strength < 0) return null;
      if (strength >= strobeStrength) {
        strobeFrequency = frequency;
        strobeTime = Math.max(0, effect.localTime);
      }
      strobeStrength = Math.max(strobeStrength, Math.min(1, strength));
    } else if (renderer === "light_leak" || renderer === "light_leak_2") {
      const defaultColor = renderer === "light_leak_2" ? "#ff7096" : "#ffc864";
      const strength = Number(effect.parameters.leakIntensity ?? effect.parameters.intensity ?? 0.3) * effect.intensity;
      const angle = Number(effect.parameters.angle ?? 45) * Math.PI / 180;
      const colorValue = effect.parameters.leakColor ?? effect.parameters.color ?? defaultColor;
      if (!Number.isFinite(strength) || strength < 0 || !Number.isFinite(angle) || typeof colorValue !== "string") return null;
      const [red, green, blue] = parseColor(colorValue);
      if (strength >= lightLeakStrength) {
        lightLeakColor = [red / 255, green / 255, blue / 255];
        lightLeakAngle = angle;
        lightLeakTime = Math.max(0, effect.localTime);
      }
      lightLeakStrength = Math.max(lightLeakStrength, Math.min(1, strength));
    } else if (renderer === "vhs" || renderer === "crt") {
      const count = Number(effect.parameters.scanlineCount ?? (renderer === "crt" ? 120 : 100));
      if (!Number.isFinite(count) || count <= 0) return null;
      scanlineCount = Math.max(scanlineCount, count);
      scanlineIntensity = Math.max(scanlineIntensity, effect.intensity);
      if (renderer === "vhs") {
        const shift = Number(effect.parameters.colorOffset ?? 5);
        const noise = Number(effect.parameters.noiseAmount ?? 0.1);
        if (!Number.isFinite(shift) || shift < 0 || !Number.isFinite(noise) || noise < 0) return null;
        const scaledShift = shift * effect.intensity;
        rgbSplitX = Math.max(rgbSplitX, scaledShift);
        rgbSplitY = Math.max(rgbSplitY, scaledShift);
        effectGrainIntensity = Math.max(effectGrainIntensity, noise * effect.intensity);
      } else {
        effectVignette = Math.max(effectVignette, effect.intensity);
      }
    } else if (renderer === "fire") {
      const fireHeight = Number(effect.parameters.fireHeight ?? 0.4);
      const particleCount = Number(effect.parameters.particleCount ?? 50);
      const colors = [
        effect.parameters.fireColor1 ?? "#FF4500",
        effect.parameters.fireColor2 ?? "#FFA500",
        effect.parameters.fireColor3 ?? "#FFD700",
      ];
      if (
        !Number.isFinite(fireHeight) || fireHeight < 0.1 || fireHeight > 0.8 ||
        !Number.isFinite(particleCount) || particleCount < 1 || particleCount > 128 ||
        colors.some((value) => typeof value !== "string")
      ) return null;
      const parsedColors = colors.map((value) => {
        const [red, green, blue] = parseColor(value as string);
        return [red / 255, green / 255, blue / 255, 0] as [number, number, number, number];
      });
      if (effect.intensity >= fireParams[2]) {
        fireParams = [fireHeight, particleCount, Math.min(1, effect.intensity), Math.max(0, effect.localTime)];
        [fireColor1, fireColor2, fireColor3] = parsedColors as [
          [number, number, number, number],
          [number, number, number, number],
          [number, number, number, number],
        ];
      }
    } else if (renderer === "particles" || renderer === "dust_particles") {
      const particleCount = Number(effect.parameters.particleCount ?? (renderer === "dust_particles" ? 60 : 100));
      const particleSize = Number(effect.parameters.particleSize ?? (renderer === "dust_particles" ? 2 : 3));
      const driftSpeed = Number(effect.parameters.driftSpeed ?? (renderer === "dust_particles" ? 0.2 : 1));
      const fadeEffect = renderer === "dust_particles"
        ? false
        : effect.parameters.fadeEffect === undefined || Boolean(effect.parameters.fadeEffect);
      const colorValue = effect.parameters.particleColor ?? (renderer === "dust_particles" ? "#E0E0E0" : "#FFFFFF");
      if (
        !Number.isFinite(particleCount) || particleCount < 1 || particleCount > 128 ||
        !Number.isFinite(particleSize) || particleSize <= 0 || particleSize > 20 ||
        !Number.isFinite(driftSpeed) || driftSpeed < 0 || driftSpeed > 5 ||
        typeof colorValue !== "string"
      ) return null;
      const [red, green, blue] = parseColor(colorValue);
      if (effect.intensity >= particleParams[3]) {
        particleParams = [particleCount, particleSize, driftSpeed, Math.min(1, effect.intensity)];
        particleColor = [red / 255, green / 255, blue / 255, (renderer === "dust_particles" ? 2 : 1) + (fadeEffect ? 0.5 : 0)];
        particleTime = Math.max(0, effect.localTime);
      }
    }
  }
  const exposure = choose("exposure", 0, scaledPreset("exposure"));
  const contrastAdjustment = readAdjustment("contrast");
  const contrast = contrastAdjustment === null
    ? null
    : contrastAdjustment !== undefined
      ? contrastAdjustment + 1
      : choose("contrast", 1, filterIR.contrast, mpgGrade?.contrast, (() => {
        const value = scaledPreset("contrast");
        return value === undefined ? undefined : 1 + value;
      })());
  const saturationAdjustment = readAdjustment("saturation");
  const saturation = saturationAdjustment === null
    ? null
    : saturationAdjustment !== undefined
      ? saturationAdjustment + 1
      : choose("saturation", 1, filterIR.saturate, mpgGrade?.saturation, (() => {
        const value = scaledPreset("saturation");
        return value === undefined ? undefined : 1 + value;
      })());
  const temperature = choose("temperature", 0, scaledPreset("temperature"), mpgGrade?.temperature);
  const tint = choose("tint", 0, scaledPreset("tint"), mpgGrade?.tint);
  const brightness = choose("brightness", 0, scaledPreset("brightness"), mpgGrade?.brightness);
  const lift = choose("lift", 0, scaledPreset("lift"));
  const sepia = choose("sepia", 0, filterIR.sepia, mpgGrade?.sepia, scaledPreset("sepia"));
  const grayscale = choose("grayscale", 0, filterIR.grayscale, mpgGrade?.grayscale, scaledPreset("grayscale"));
  const hueAdjustment = readAdjustment("hue");
  const hue = hueAdjustment !== undefined ? hueAdjustment : filterIR.hueRotate ?? mpgGrade?.hueRotate ?? (() => {
    const value = scaledPreset("hueRotate");
    return value === undefined ? 0 : (value * 180) / Math.PI;
  })();
  const vignetteValue = choose("vignette", 0, scaledPreset("vignette"), mpgGrade?.vignette);
  const vignette = vignetteValue === null ? null : Math.max(vignetteValue, effectVignette);
  const grainValue = values?.grain ?? preset?.grain;
  const grainScale = values?.grain === undefined ? presetIntensity : 1;
  const adjustmentGrainIntensity = grainValue === undefined
    ? 0
    : typeof grainValue === "object" && grainValue !== null
      ? (() => {
        const value = readNumber((grainValue as Record<string, unknown>).intensity);
        return value === null || value === undefined ? value ?? null : value * grainScale;
      })()
      : null;
  const adjustmentGrainSize = grainValue === undefined
    ? 1
    : typeof grainValue === "object" && grainValue !== null
      ? readNumber((grainValue as Record<string, unknown>).size) ?? null
      : null;
  const grainIntensity = adjustmentGrainIntensity === null ? null : Math.max(adjustmentGrainIntensity, effectGrainIntensity);
  const grainSize = adjustmentGrainSize === null
    ? null
    : grainValue === undefined ? effectGrainSize : Math.max(adjustmentGrainSize, effectGrainSize);
  const vibranceValue = values?.vibrance ?? preset?.vibrance;
  const vibranceScale = values?.vibrance === undefined ? presetIntensity : 1;
  const vibranceAmount = vibranceValue === undefined
    ? 0
    : typeof vibranceValue === "object" && vibranceValue !== null
      ? (() => {
        const value = readNumber((vibranceValue as Record<string, unknown>).amount);
        return value === null || value === undefined ? value ?? null : value * vibranceScale;
      })()
      : null;
  const crossProcessValue = values?.crossProcess ?? preset?.crossProcess;
  const crossProcessScale = values?.crossProcess === undefined ? presetIntensity : 1;
  const crossProcessAmount = crossProcessValue === undefined
    ? choose("crossProcessAmount", 0)
    : typeof crossProcessValue === "object" && crossProcessValue !== null
      ? (() => {
        const value = readNumber((crossProcessValue as Record<string, unknown>).amount);
        return value === null || value === undefined ? value ?? null : value * crossProcessScale;
      })()
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
  if (vibranceValue === preset?.vibrance && vibranceValue !== undefined) {
    const protectedHue = (vibranceValue as Record<string, unknown>).protectedHue;
    if (protectedHue !== undefined) {
      if (typeof protectedHue !== "string") return null;
      const [red, green, blue] = parseColor(protectedHue);
      vibranceProtectedHue = [red / 255, green / 255, blue / 255];
    }
  }

  const channelMixValue = values?.channelMix ?? preset?.channelMix;
  const channelMix = channelMixValue === undefined
    ? [0, 0, 0] as [number, number, number]
    : (() => {
      const parsed = [
        readObjectNumber(channelMixValue, "r"),
        readObjectNumber(channelMixValue, "g"),
        readObjectNumber(channelMixValue, "b"),
      ];
      return parsed.some((value) => value === null || value === undefined) ? null : parsed as [number, number, number];
    })();
  const duotoneValue = values?.duotone ?? preset?.duotone;
  const duotone = duotoneValue === undefined
    ? { dark: [0, 0, 0] as [number, number, number], light: [1, 1, 1] as [number, number, number] }
    : (() => {
      const dark = parseNativeColor(typeof duotoneValue === "object" && duotoneValue !== null ? (duotoneValue as Record<string, unknown>).darkColor : undefined);
      const light = parseNativeColor(typeof duotoneValue === "object" && duotoneValue !== null ? (duotoneValue as Record<string, unknown>).lightColor : undefined);
      return dark && light ? { dark, light } : null;
    })();
  const splitToneValue = preset?.splitTone ?? values?.splitTone;
  const splitTone = splitToneValue === undefined
    ? { shadow: [1, 1, 1] as [number, number, number], shadowStrength: 0, highlight: [1, 1, 1] as [number, number, number], highlightStrength: 0, balance: 0.5 }
    : (() => {
      const split = splitToneValue as Record<string, unknown>;
      const shadow = parseNativeColor(split.shadowColor);
      const highlight = parseNativeColor(split.highlightColor);
      const shadowStrength = readNumber(split.shadowStrength);
      const highlightStrength = readNumber(split.highlightStrength);
      const balance = readNumber(split.balance);
      return shadow && highlight && shadowStrength !== null && shadowStrength !== undefined &&
        highlightStrength !== null && highlightStrength !== undefined && balance !== null && balance !== undefined
        ? { shadow, shadowStrength: shadowStrength * (values?.splitTone === undefined ? presetIntensity : 1), highlight, highlightStrength: highlightStrength * (values?.splitTone === undefined ? presetIntensity : 1), balance }
        : null;
    })();
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
    brightness === null || lift === null || sepia === null || grayscale === null || hue === null || vignette === null || invert === null ||
    grainIntensity === null || grainSize === null || vibranceAmount === null || crossProcessAmount === null ||
    invalidPresetNumber || channelMix === null || duotone === null || splitTone === null
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
    lift,
    sepia,
    grayscale,
    hueRotate: (hue * Math.PI) / 180,
    vignette,
    invert,
    grainIntensity,
    grainSize,
    ...(hasLut ? {
      lutId: effectiveLutId,
      lutIntensity: typeof grade?.lutIntensity === "number" && Number.isFinite(grade.lutIntensity)
        ? grade.lutIntensity
        : (activeFilter?.intensity ?? 1),
      lutSize: typeof grade?.lutSize === "number" && Number.isFinite(grade.lutSize) ? grade.lutSize : 33,
    } : { lutIntensity: 1, lutSize: 33 }),
    blurStrength: blurRadius > 0 ? 1 : 0,
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
    crossProcessAmount,
    channelMixR: channelMix[0],
    channelMixG: channelMix[1],
    channelMixB: channelMix[2],
    channelMixEnabled: channelMixValue === undefined ? 0 : 1,
    duotoneDarkR: duotone.dark[0],
    duotoneDarkG: duotone.dark[1],
    duotoneDarkB: duotone.dark[2],
    duotoneLightR: duotone.light[0],
    duotoneLightG: duotone.light[1],
    duotoneLightB: duotone.light[2],
    duotoneEnabled: duotoneValue === undefined ? 0 : 1,
    shadowTintR: splitTone.shadow[0],
    shadowTintG: splitTone.shadow[1],
    shadowTintB: splitTone.shadow[2],
    shadowTintStrength: splitTone.shadowStrength,
    highlightTintR: splitTone.highlight[0],
    highlightTintG: splitTone.highlight[1],
    highlightTintB: splitTone.highlight[2],
    highlightTintStrength: splitTone.highlightStrength,
    splitBalance: splitTone.balance,
    glowColorR: glowColor[0],
    glowColorG: glowColor[1],
    glowColorB: glowColor[2],
    glowStrength,
    glowRadius,
    flashColorR: flashColor[0],
    flashColorG: flashColor[1],
    flashColorB: flashColor[2],
    flashStrength,
    flickerStrength,
    strobeFrequency,
    strobeTime,
    strobeStrength,
    lightLeakColorR: lightLeakColor[0],
    lightLeakColorG: lightLeakColor[1],
    lightLeakColorB: lightLeakColor[2],
    lightLeakStrength,
    lightLeakAngle,
    lightLeakTime,
    ...(glitchIntensity > 0 ? {
      glitchIntensity,
      glitchTime,
      glitchSliceCount,
      glitchColorShift,
    } : {}),
    ...(distortionStrength > 0 ? {
      distortionType,
      distortionStrength,
      distortionTime,
      distortionFrequency,
    } : {}),
    ...(fireParams[2] > 0 ? { fireParams, fireColor1, fireColor2, fireColor3 } : {}),
    ...(particleParams[3] > 0 ? { particleParams, particleColor, particleTime } : {}),
  };
}

function getNativeBodyEffect(
  layer: EvaluatedMediaLayer,
  rasterLayers: NativeRasterLayerSnapshot[],
): NativeBodyEffectSnapshot | null | undefined {
  const effects = (layer.effects ?? []).filter((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return effect.intensity > 0.001 && NATIVE_BODY_EFFECT_RENDERERS.has(renderer);
  });
  if (effects.length === 0) return undefined;

  const effect = effects.reduce((strongest, candidate) => candidate.intensity > strongest.intensity ? candidate : strongest);
  const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase() as NativeBodyEffectSnapshot["renderer"];
  const requestedMaskId = effect.parameters.maskAssetId;
  const defaultMaskId = `${layer.layerId}_${effect.effectId}`;
  const maskAsset = rasterLayers.find((asset) => asset.isMask && (
    typeof requestedMaskId === "string" && requestedMaskId.trim()
      ? asset.assetId === requestedMaskId
      : asset.assetId === defaultMaskId || asset.assetId.startsWith(`${defaultMaskId}:`)
  ));
  if (!maskAsset) return null;
  const maskAssetId = maskAsset.assetId;

  const colorValue = renderer === "body_outline"
    ? effect.parameters.outlineColor ?? "#ffffff"
    : renderer === "body_particles"
      ? effect.parameters.particleColor ?? effect.parameters.glowColor ?? "#00ffff"
      : effect.parameters.glowColor ?? "#00ffff";
  if (typeof colorValue !== "string") return null;
  const [red, green, blue] = parseColor(colorValue);
  const strength = renderer === "body_outline"
    ? effect.intensity
    : renderer === "body_particles"
      ? effect.intensity
      : Number(effect.parameters.glowIntensity ?? 0.8) * effect.intensity;
  // For body_particles, the third uniform slot is the bounded particle count;
  // outline/glow use the same slot for their mask sampling radius.
  const radius = renderer === "body_outline"
    ? Number(effect.parameters.thickness ?? 5) * effect.intensity
    : renderer === "body_particles"
      ? Math.min(40, Math.max(1, Math.floor(Number(effect.parameters.particleCount ?? 120) * effect.intensity)))
      : Number(effect.parameters.glowRadius ?? 22) * effect.intensity;
  if (!Number.isFinite(strength) || strength < 0 || !Number.isFinite(radius) || radius < 0) return null;

  return {
    maskAssetId,
    renderer,
    colorR: red / 255,
    colorG: green / 255,
    colorB: blue / 255,
    strength: Math.min(1, strength),
    radius,
    time: Math.max(0, effect.localTime),
  };
}

function isSupportedNativeVideoLayer(
  layer: EvaluatedMediaLayer,
  mpgStack?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>,
): boolean {
  const isStaticSticker = layer.clipKind === "sticker" && layer.stickerFormat === "static";
  const isGifSticker = layer.clipKind === "sticker" && layer.stickerFormat === "gif";
  return (
    isNativeVideoGraphLayer(layer) &&
    (layer.clipKind !== "sticker" || isStaticSticker || isGifSticker) &&
    isNativeFileSource(layer.sourcePath) &&
    getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects, mpgStack) !== null &&
    (!layer.sourceRotation || layer.sourceRotation === 0) &&
    NATIVE_BLEND_MODES.has(layer.blendMode)
  );
}

function isNativeAnimatedStickerLayer(layer: EvaluatedMediaLayer): boolean {
  return layer.clipKind === "sticker" && layer.stickerFormat === "lottie";
}

function isNativeVideoGraphLayer(layer: EvaluatedMediaLayer): boolean {
  return layer.mediaType === "video" || (layer.clipKind === "sticker" && layer.stickerFormat === "gif");
}

/**
 * Return a native clear color only for backgrounds whose semantics can be
 * represented exactly by the wgpu surface. Gradients, shaders, and media
 * backgrounds stay outside the native request until they have native graph
 * nodes of their own.
 */
function getNativeClearColor(
  scene: EvaluatedScene,
  rasterLayers: NativeRasterLayerSnapshot[] = [],
): [number, number, number, number] | null {
  const background = scene.metadata.canvasBackground;
  if (!background) return [0, 0, 0, 1];
  if (background.isTransparent) return [0, 0, 0, 0];
  if (background.type !== "solid") {
    const hasNativeBackground = rasterLayers.some((layer) =>
      !layer.isMask && layer.assetId.startsWith("native-background:"),
    );
    return hasNativeBackground || getNativeBackgroundMediaPath(scene) !== null ? [0, 0, 0, 0] : null;
  }

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
  const canvasWidth = scene.metadata.canvasWidth || 1920;
  const canvasHeight = scene.metadata.canvasHeight || 1080;
  const culledVisualLayers = cullOccludedVisualLayers(
    scene.visualLayers,
    canvasWidth,
    canvasHeight,
  );

  if (culledVisualLayers.some((layer) => layer.layerType !== "media" && layer.layerType !== "text")) return null;
  const clearColor = getNativeClearColor(scene, rasterLayers);
  if (!clearColor) return null;

  const textLayers = culledVisualLayers.filter(
    (layer): layer is EvaluatedTextLayer => layer.layerType === "text"
  );
  const allMediaLayers = culledVisualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media",
  );
  const animatedStickerLayers = allMediaLayers.filter(isNativeAnimatedStickerLayer);
  const mediaLayers = allMediaLayers.filter((layer) => isNativeVideoGraphLayer(layer) && !isNativeAnimatedStickerLayer(layer));
  const imageLayers = allMediaLayers.filter(
    (layer) => layer.mediaType === "image" && layer.stickerFormat !== "gif" && layer.stickerFormat !== "lottie",
  );
  const backgroundMediaPath = getNativeBackgroundMediaPath(scene);
  if (imageLayers.some((layer) => !rasterLayers.some((asset) =>
    hasNativeImageRasterAsset(layer, asset),
  ))) return null;
  if (
    mediaLayers.length === 0 &&
    textLayers.length === 0 &&
    rasterLayers.filter((layer) => !layer.isMask).length === 0 &&
    backgroundMediaPath === null
  ) return null;
  if (animatedStickerLayers.some((layer) => !rasterLayers.some((asset) =>
    !asset.isMask && asset.assetId.startsWith(`native-sticker:${layer.layerId}:`),
  ))) return null;
  const transition = getNativeTransitionSnapshot(scene, mediaLayers);
  if (transition === null) return null;
  if (transition && backgroundMediaPath !== null) return null;
  if (transition && rasterLayers.some((layer) => layer.isMask)) return null;
  if (scene.activeFilter && mediaLayers.some((layer) => layer.filter?.id !== scene.activeFilter?.id)) return null;
  if (!mediaLayers.every((layer) => isSupportedNativeVideoLayer(layer, scene.activeFilter?.effectStack))) {
    return null;
  }

  const layers: NativeProjectVideoLayer[] = mediaLayers.map((layer) => {
    const colorGrade = getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects, scene.activeFilter?.effectStack);
    const bodyEffect = getNativeBodyEffect(layer, rasterLayers);
    return {
      layerId: layer.layerId,
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
      ...(bodyEffect ? { bodyEffect } : {}),
    };
  });

  if (backgroundMediaPath !== null) {
    layers.push({
      layerId: NATIVE_BACKGROUND_MEDIA_LAYER_ID,
      videoPath: backgroundMediaPath,
      timeSecs: Math.max(0, scene.metadata.time),
      x: 0,
      y: 0,
      width: scene.metadata.canvasWidth || 1920,
      height: scene.metadata.canvasHeight || 1080,
      rotation: 0,
      opacity: getNativeBackgroundMediaOpacity(scene),
      zIndex: -1_000_000,
      blendMode: "normal",
    });
  }

  if (mediaLayers.some((layer) => getNativeBodyEffect(layer, rasterLayers) === null)) return null;

  if (layers.some((layer) => !Number.isFinite(layer.timeSecs) || layer.timeSecs < 0)) {
    return null;
  }

  // A text raster is the exact shared Studio-engine output. Send those pixels
  // as a native raster layer so the compositor cannot replace a gradient,
  // bevel, stack, glow, or custom renderer with plain SDF text. Keep the
  // native text snapshot only for legacy callers that did not produce a raster.
  const nativeTextLayers = textLayers
    .filter((layer) => !hasNativeTextRasterAsset(layer, rasterLayers))
    .map((layer) => {
      const color = parseColorToRgba(layer.color || "#ffffff");
      const effect = normalizeNativeTextEffect(layer);
      return {
        text: layer.text || "",
        fontId: layer.fontFamily || "default",
        fontSize: layer.fontSize,
        fontWeight: typeof layer.fontWeight === "number" ? String(layer.fontWeight) : layer.fontWeight,
        fontStyle: layer.fontStyle,
        letterSpacing: layer.letterSpacing ?? 0,
        lineHeight: layer.lineHeight ?? 1.2,
        color,
        textAlign: layer.textAlign || "left",
        verticalAlign: layer.verticalAlign || "middle",
        runs: layer.runs?.map((run) => ({
          text: run.text,
          ...(run.color ? { color: parseColorToRgba(run.color) } : {}),
          highlighted: run.highlighted === true,
        })),
        ...(layer.templateId ? { templateId: layer.templateId, templateData: layer.customization } : {}),
        x: layer.x,
        y: layer.y,
        boxWidth: layer.width,
        boxHeight: layer.height,
        rotation: layer.rotation ?? 0,
        opacity: layer.opacity ?? 1,
        zIndex: layer.zIndex ?? 0,
        blendMode: layer.blendMode || "normal",
        ...(layer.stroke ? {
          strokeColor: parseColorToRgba(layer.stroke.color),
          strokeWidth: layer.stroke.width,
        } : {}),
        ...(layer.shadow ? {
          shadowColor: parseColorToRgba(layer.shadow.color),
          shadowOffset: [layer.shadow.offsetX, layer.shadow.offsetY] as [number, number],
          shadowBlur: layer.shadow.blur,
        } : {}),
        ...(layer.background ? {
          background: {
            color: parseColorToRgba(layer.background.color),
            padding: layer.background.padding,
            borderRadius: layer.background.borderRadius,
          },
        } : {}),
        ...(effect ? { effect } : {}),
      };
    });

  const visibleRasterLayers = rasterLayers.filter((layer) => !layer.isMask);

  return {
    canvasWidth: scene.metadata.canvasWidth || 1920,
    canvasHeight: scene.metadata.canvasHeight || 1080,
    clearColor,
    layers,
    ...(visibleRasterLayers.length > 0 ? { rasterLayers: visibleRasterLayers } : {}),
    ...(nativeTextLayers.length > 0 ? { textLayers: nativeTextLayers } : {}),
    ...(transition ? { transition } : {}),
  };
}

/**
 * Explain why a scene cannot currently be represented by the native graph.
 * This is intentionally diagnostic rather than authoritative: the request
 * builder remains the final validator, while proof mode uses these messages to
 * make migration gaps visible during manual testing.
 */
export function getNativePreviewBlockers(
  scene: EvaluatedScene,
  rasterLayers: NativeRasterLayerSnapshot[] = [],
): string[] {
  const blockers: string[] = [];
  const add = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };
  if (scene.visualLayers.some((layer) => layer.layerType !== "media" && layer.layerType !== "text")) {
    add("The scene contains a visual layer type without a native compositor contract.");
  }

  const background = scene.metadata.canvasBackground;
  if (background?.type === "media" && getNativeBackgroundMediaPath(scene) === null) {
    add("The media background has no native filesystem or Tauri asset source.");
  }
  if ((background?.type === "gradient" || background?.type === "shader") && !rasterLayers.some((layer) =>
    !layer.isMask && layer.assetId.startsWith("native-background:"),
  )) {
    add("The animated or gradient background has not produced its native raster asset yet.");
  }

  const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
  for (const layer of textLayers) {
    if (layer.templateId) {
      add(`Text template ${layer.templateId} requires native template primitives.`);
    }
    const passes = (layer.styleDefinition as { passes?: Array<{ primitive?: string }> } | undefined)?.passes ?? [];
    for (const pass of passes) {
      const primitive = (pass.primitive ?? "").toLowerCase().replace(/-/g, "_");
      if (!["distance_threshold", "fill", "outline", "stroke", "glow", "drop_shadow", "shadow"].includes(primitive)) {
        add(`Text effect primitive "${pass.primitive ?? "unknown"}" on layer ${layer.layerId} is not implemented by the native renderer.`);
      }
    }
  }

  const mediaLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media" && isNativeVideoGraphLayer(layer) && !isNativeAnimatedStickerLayer(layer),
  );
  const imageLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media" && layer.mediaType === "image" && layer.stickerFormat !== "gif" && layer.stickerFormat !== "lottie",
  );
  const animatedStickerLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media" && isNativeAnimatedStickerLayer(layer),
  );
  for (const layer of animatedStickerLayers) {
    if (!rasterLayers.some((asset) => !asset.isMask && asset.assetId.startsWith(`native-sticker:${layer.layerId}:`))) {
      add(`Animated sticker ${layer.layerId} is waiting for its native raster frame.`);
    }
  }
  for (const layer of imageLayers) {
    if (!rasterLayers.some((asset) => hasNativeImageRasterAsset(layer, asset))) {
      add(`Still image ${layer.layerId} is waiting for its alpha-preserving native raster frame.`);
    }
  }
  const transition = getNativeTransitionSnapshot(scene, mediaLayers);
  if (transition === null) add("The active transition is not implemented in the native compositor.");
  if (transition && rasterLayers.some((layer) => layer.isMask)) {
    add("Native transitions currently do not support mask layers.");
  }
  if (scene.activeFilter && mediaLayers.some((layer) => layer.filter?.id !== scene.activeFilter?.id)) {
    add("The active filter track does not resolve consistently across native media layers.");
  }
  for (const layer of mediaLayers) {
    for (const effect of (layer.effects ?? []).filter((item) => item.intensity > 0.001)) {
      const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
      if (!NATIVE_VIDEO_EFFECT_RENDERERS.has(renderer)) {
        add(`Video effect "${renderer}" on media layer ${layer.layerId} has no native compositor implementation.`);
      }
    }
    const filterMetadata = layer.filter as (typeof layer.filter & {
      pipeline?: string;
      effectStack?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>;
    }) | undefined;
    const filterStack = scene.activeFilter?.effectStack ?? filterMetadata?.effectStack;
    const hasMpgFilter = scene.activeFilter?.pipeline === "v2" || filterMetadata?.pipeline === "v2" || (filterStack?.length ?? 0) > 0;
    if (hasMpgFilter && resolveNativeMpgStack(filterStack) === null) {
      add(`Filter "${scene.activeFilter?.id ?? filterMetadata?.id ?? "unknown"}" on media layer ${layer.layerId} contains MPG v2 nodes that are not supported by the native compositor.`);
    } else if (hasMpgFilter && !filterStack) {
      add(`Filter "${scene.activeFilter?.id ?? filterMetadata?.id ?? "unknown"}" on media layer ${layer.layerId} uses an MPG v2 stack without serialized nodes.`);
    }
    if (!isSupportedNativeVideoLayer(layer, scene.activeFilter?.effectStack)) {
      add(`Media layer ${layer.layerId} uses a source, transform, blend mode, or effect outside the native contract.`);
    }
    if (getNativeBodyEffect(layer, rasterLayers) === null) {
      add(`Body effect on media layer ${layer.layerId} is missing its native segmentation mask.`);
    }
  }
  if (
    mediaLayers.length === 0 &&
    imageLayers.length === 0 &&
    animatedStickerLayers.length === 0 &&
    textLayers.length === 0 &&
    rasterLayers.filter((layer) => !layer.isMask).length === 0 &&
    getNativeBackgroundMediaPath(scene) === null
  ) {
    add("The scene has no native-renderable visual content at the current time.");
  }
  return blockers;
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
  intent: {
    generation?: number;
    mode?: "playback" | "playback-lookahead" | "scrub" | "seek" | "frameStep" | "prefetch";
    quality?: NativeFrameRequest["quality"];
    velocityPxPerSecond?: number;
    requestedAtMs?: number;
  } = {},
): NativeFrameRequest | null {
  const request = buildNativeVideoProjectRequest(scene, rasterLayers);
  if (!request) return null;

  const culledVisualLayers = cullOccludedVisualLayers(
    scene.visualLayers,
    request.canvasWidth,
    request.canvasHeight,
  );
  const nativeMediaLayers = request.layers.filter((layer) => layer.layerId !== NATIVE_BACKGROUND_MEDIA_LAYER_ID);
  const videoLayers = culledVisualLayers
    .filter((layer): layer is EvaluatedMediaLayer => layer.layerType === "media" && isNativeVideoGraphLayer(layer) && !isNativeAnimatedStickerLayer(layer))
    .map((layer, index) => {
      const colorGrade = getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects, scene.activeFilter?.effectStack);
      return {
      assetId: layer.mediaId,
      layerId: layer.layerId,
      videoPath: nativeMediaLayers[index].videoPath,
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
      ...(nativeMediaLayers[index].bodyEffect ? { bodyEffect: nativeMediaLayers[index].bodyEffect } : {}),
      };
    });

  const nativeBackgroundLayer = request.layers.find((layer) => layer.layerId === NATIVE_BACKGROUND_MEDIA_LAYER_ID);
  if (nativeBackgroundLayer) {
    videoLayers.push({
      assetId: NATIVE_BACKGROUND_MEDIA_LAYER_ID,
      layerId: NATIVE_BACKGROUND_MEDIA_LAYER_ID,
      videoPath: nativeBackgroundLayer.videoPath,
      sourceTime: secondsToNativeTime(nativeBackgroundLayer.timeSecs, frameIndex),
      x: nativeBackgroundLayer.x,
      y: nativeBackgroundLayer.y,
      width: nativeBackgroundLayer.width ?? request.canvasWidth,
      height: nativeBackgroundLayer.height ?? request.canvasHeight,
      rotation: nativeBackgroundLayer.rotation ?? 0,
      opacity: nativeBackgroundLayer.opacity ?? 1,
      zIndex: nativeBackgroundLayer.zIndex ?? -1_000_000,
      blendMode: "normal" as EvaluatedMediaLayer["blendMode"],
    });
  }

  // `buildNativeVideoProjectRequest` is the canonical text mapping above.
  // Reusing it here is important: remapping the scene would reintroduce all
  // text layers after the raster/native partitioning decision.
  const textLayers = request.textLayers ?? [];
  const visibleRasterLayers = rasterLayers.filter((layer) => !layer.isMask);

  return createNativeFrameRequest({
    requestId: `${projectRevision}:${frameIndex}:${outputWidth}x${outputHeight}`,
    frameTime: frameIndexToNativeTime(frameIndex, frameRate),
    project: {
      schemaVersion: 1,
      projectRevision,
      frameRate,
      canvasWidth: request.canvasWidth,
      canvasHeight: request.canvasHeight,
      clearColor: request.clearColor ?? [0, 0, 0, 1],
      videoLayers,
      ...(visibleRasterLayers.length > 0 ? { rasterLayers: visibleRasterLayers } : {}),
      ...(textLayers.length > 0 ? { textLayers } : {}),
      ...(request.transition ? { transition: request.transition } : {}),
    },
    outputWidth,
    outputHeight,
    quality: intent.quality ?? "full",
    colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
    renderGraphVersion: 1,
    ...(intent.generation !== undefined ? { generation: intent.generation } : {}),
    ...(intent.mode ? { mode: intent.mode } : {}),
    ...(intent.velocityPxPerSecond !== undefined ? { scrubVelocityPxPerSecond: intent.velocityPxPerSecond } : {}),
    ...(intent.requestedAtMs !== undefined ? { requestedAtMs: intent.requestedAtMs } : {}),
  });
}
