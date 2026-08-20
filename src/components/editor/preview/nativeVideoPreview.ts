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
  type NativeBodyEffectSnapshot,
  type NativeTransitionSnapshot,
  type NativeFrameRequest,
  type NativeRasterLayerSnapshot,
} from "@/lib/platform/nativeCore";

const NATIVE_BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "add", "additive", "difference"]);
const NATIVE_COLOR_GRADE_KEYS = new Set([
  "exposure", "contrast", "saturation", "temperature", "tint",
  "brightness", "sepia", "grayscale", "hue", "vignette", "invert", "grain", "vibrance",
  "lift", "crossProcess", "channelMix", "duotone", "splitTone",
]);
const NATIVE_BODY_EFFECT_RENDERERS = new Set(["body_outline", "body_glow", "body_segmentation_glow", "body_particles"]);

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
  let transitionType: string;
  if (["fade", "dissolve", "blur_fade", "directional_blur", "cross-dissolve"].includes(renderer)) {
    transitionType = "cross-dissolve";
  } else if (["wipe_left", "wipe_right", "wipe_up", "wipe_down", "wipe-left", "wipe-right", "wipe-up", "wipe-down"].includes(renderer)) {
    transitionType = renderer.replace(/_/g, "-");
  } else if (["zoom_blur", "zoom_in", "zoom_out", "zoom-blur"].includes(renderer)) {
    transitionType = "zoom-blur";
  } else {
    return null;
  }

  const params = (transition.params ?? {}) as Record<string, unknown>;
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
  };
}

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
  const preset = activeFilter?.gradingParams as Record<string, unknown> | undefined;
  const presetIntensity = activeFilter?.intensity ?? 0;
  let filterIR: FilterIR = {};
  if (activeFilter) {
    filterIR = resolveFilterToIR(activeFilter.id, activeFilter.intensity);
    if (Object.keys(filterIR).length === 0 && !preset) return null;
  }
  const hasGradeValues = Boolean(grade && (
    grade.exposure !== 0 || grade.contrast !== 1 || grade.saturation !== 1 ||
    grade.temperature !== 0 || grade.tint !== 0 || grade.lift !== 0 ||
    grade.crossProcessAmount !== 0 || hasLut
  )) || Boolean(preset && Object.keys(preset).length > 0);
  const activeEffects = (effects ?? []).filter((effect) => effect.intensity > 0.001);
  if (!hasMeaningfulObject(adjustments) && !hasGradeValues && !activeFilter && activeEffects.length === 0) return undefined;
  if (hasLut && (typeof grade?.lutId !== "string" || !grade.lutId.trim())) return null;
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
  const supportedEffectRenderers = new Set([
    "blur", "pixelate", "scanlines", "rgb_split", "chromatic_aberration", "chromatic",
    "vhs", "crt", "film_grain", "grain", "vignette", "glow", "flash", "flicker", "strobe", "light_leak", "light_leak_2", "body_outline", "body_glow", "body_segmentation_glow", "body_particles", "motion_blur", "radial_blur", "zoom_blur",
  ]);
  if (activeEffects.some((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return !supportedEffectRenderers.has(renderer);
  })) return null;
  const blurEffects = activeEffects.filter((effect) => {
    const renderer = (effect.renderer || effect.effectId).replace(/^fx-/, "").replace(/-/g, "_").toLowerCase();
    return renderer === "blur" || renderer === "motion_blur" || renderer === "radial_blur" || renderer === "zoom_blur";
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
    }
  }
  const exposure = choose("exposure", 0, scaledPreset("exposure"));
  const contrastAdjustment = readAdjustment("contrast");
  const contrast = contrastAdjustment === null
    ? null
    : contrastAdjustment !== undefined
      ? contrastAdjustment + 1
      : choose("contrast", 1, filterIR.contrast, (() => {
        const value = scaledPreset("contrast");
        return value === undefined ? undefined : 1 + value;
      })());
  const saturationAdjustment = readAdjustment("saturation");
  const saturation = saturationAdjustment === null
    ? null
    : saturationAdjustment !== undefined
      ? saturationAdjustment + 1
      : choose("saturation", 1, filterIR.saturate, (() => {
        const value = scaledPreset("saturation");
        return value === undefined ? undefined : 1 + value;
      })());
  const temperature = choose("temperature", 0, scaledPreset("temperature"));
  const tint = choose("tint", 0, scaledPreset("tint"));
  const brightness = choose("brightness", 0, scaledPreset("brightness"));
  const lift = choose("lift", 0, scaledPreset("lift"));
  const sepia = choose("sepia", 0, filterIR.sepia, scaledPreset("sepia"));
  const grayscale = choose("grayscale", 0, filterIR.grayscale, scaledPreset("grayscale"));
  const hueAdjustment = readAdjustment("hue");
  const hue = hueAdjustment !== undefined ? hueAdjustment : filterIR.hueRotate ?? (() => {
    const value = scaledPreset("hueRotate");
    return value === undefined ? 0 : (value * 180) / Math.PI;
  })();
  const vignetteValue = choose("vignette", 0, scaledPreset("vignette"));
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
  if (scene.visualLayers.some((layer) => layer.layerType !== "media" && layer.layerType !== "text")) return null;
  const clearColor = getNativeClearColor(scene);
  if (!clearColor) return null;

  const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
  const visibleRasterLayers = rasterLayers.filter((layer) => !layer.isMask);
  if (textLayers.length !== visibleRasterLayers.length) return null;
  const mediaLayers = scene.visualLayers.filter(
    (layer): layer is EvaluatedMediaLayer => layer.layerType === "media",
  );
  if (mediaLayers.length === 0 && textLayers.length === 0) return null;
  const transition = getNativeTransitionSnapshot(scene, mediaLayers);
  if (transition === null) return null;
  if (transition && (textLayers.length > 0 || rasterLayers.some((layer) => layer.isMask))) return null;
  if (scene.activeFilter && mediaLayers.some((layer) => layer.filter?.id !== scene.activeFilter?.id)) return null;
  if (!mediaLayers.every(isSupportedNativeVideoLayer)) {
    return null;
  }

  const layers: NativeProjectVideoLayer[] = mediaLayers.map((layer) => {
    const colorGrade = getNativeColorGrade(layer.adjustments, layer.colorGrade, layer.filter, layer.effects);
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

  if (mediaLayers.some((layer) => getNativeBodyEffect(layer, rasterLayers) === null)) return null;

  if (layers.some((layer) => !Number.isFinite(layer.timeSecs) || layer.timeSecs < 0)) {
    return null;
  }

  return {
    canvasWidth: scene.metadata.canvasWidth || 1920,
    canvasHeight: scene.metadata.canvasHeight || 1080,
    clearColor,
    layers,
    ...(rasterLayers.length > 0 ? { rasterLayers } : {}),
    ...(transition ? { transition } : {}),
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
      layerId: layer.layerId,
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
      ...(request.layers[index].bodyEffect ? { bodyEffect: request.layers[index].bodyEffect } : {}),
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
      ...(request.transition ? { transition: request.transition } : {}),
    },
    outputWidth,
    outputHeight,
    quality: "full",
    colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
    renderGraphVersion: 1,
  });
}
