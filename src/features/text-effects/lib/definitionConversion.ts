import type { TextEffectConfig } from "@clypra/engine";
import type { EffectFullDefinition } from "../types/types";

export type BoundingBoxSpec = {
  paddingX: number;
  paddingY: number;
  mode?: "ink" | "panel";
};

export type EffectDefinitionWithBounds = EffectFullDefinition & {
  boundingBox?: BoundingBoxSpec;
};

export function convertConfigToDefinition(preset: any): EffectDefinitionWithBounds {
  const cfg = preset.config;

  const font = {
    family: cfg.fontFamily ?? "Poppins",
    weight: cfg.fontWeight ?? 700,
    style: (cfg.fontStyle ?? "normal") as "normal" | "italic",
    letterSpacing: cfg.letterSpacing ?? 0,
    lineHeight: cfg.lineHeight ?? 1.2,
  };

  const fills = [];
  if (cfg.fillType !== "none") {
    fills.push({
      type: cfg.fillType ?? "solid",
      color: cfg.fillColor ?? "#FFFFFF",
      gradient: cfg.fillGradientStops
        ? {
            angle: cfg.fillGradientAngle ?? 90,
            stops: cfg.fillGradientStops,
          }
        : undefined,
      patternType: cfg.patternType,
      perCharFillEnabled: cfg.perCharFillEnabled,
      charFillColors: cfg.charFillColors,
    });
  }

  const strokes = [];
  if (cfg.strokeEnabled) {
    strokes.push({
      color: cfg.strokeColor ?? "#000000",
      width: cfg.strokeWidth ?? 0,
      position: cfg.strokePosition ?? "outside",
      opacity: cfg.strokeOpacity ?? 100,
      lineJoin: cfg.strokeLineJoin ?? "round",
      blur: cfg.strokeBlur ?? 0,
      type: cfg.strokeType ?? "single",
      colorSecondary: cfg.strokeColorSecondary,
      widthSecondary: cfg.strokeWidthSecondary,
      fadeRange: cfg.strokeFadeRange,
    });
  }

  const shadows = [];
  if (cfg.shadowEnabled) {
    shadows.push({
      color: cfg.shadowColor ?? "#000000",
      blur: cfg.shadowBlur ?? 0,
      offsetX: cfg.shadowOffsetX ?? 0,
      offsetY: cfg.shadowOffsetY ?? 0,
      opacity: cfg.shadowOpacity ?? 80,
      type: cfg.shadowType ?? "drop",
    });
  }

  let bevel = undefined;
  if (cfg.bevelEnabled) {
    bevel = {
      depth: cfg.bevelDepth ?? 5,
      highlightColor: cfg.bevelHighlight ?? "#FFFFFF",
      shadowColor: cfg.bevelShadow ?? "#000000",
      direction: cfg.bevelDirection ?? "bottom-right",
      coreColor: cfg.bevelCoreColor ?? "#000000",
      edgeColor: cfg.bevelEdgeColor ?? "#2A2A38",
      edgeWidth: cfg.bevelEdgeWidth ?? 0,
      blur: cfg.bevelBlur ?? 0,
      blurColor: cfg.bevelBlurColor ?? "#000000",
      perspectiveEnabled: cfg.bevelPerspectiveEnabled ?? false,
      vanishingPointX: cfg.bevelVanishingPointX ?? 40,
      vanishingPointY: cfg.bevelVanishingPointY ?? 80,
      focalLength: cfg.bevelFocalLength ?? 400,
    };
  }

  let glows = undefined;
  if (cfg.glowLayers) {
    glows = cfg.glowLayers
      .filter((g: any) => g.enabled)
      .map((g: any) => ({
        color: g.color,
        blur: g.blur,
        opacity: g.opacity,
        type: g.type,
        strength: g.strength,
        spread: g.spread,
      }));
  }

  let panel = undefined;
  if (cfg.panelEnabled) {
    panel = {
      color: cfg.panelColor ?? "#1E1E26",
      opacity: cfg.panelOpacity ?? 80,
      radius: cfg.panelRadius ?? 12,
      paddingX: cfg.panelPaddingX ?? 40,
      paddingY: cfg.panelPaddingY ?? 20,
      stroke: cfg.panelStrokeEnabled
        ? {
            color: cfg.panelStrokeColor ?? "#2A2A38",
            width: cfg.panelStrokeWidth ?? 2,
          }
        : undefined,
    };
  }

  let stack = undefined;
  if (cfg.stackEnabled) {
    stack = {
      count: cfg.stackCount ?? 3,
      offsetX: cfg.stackOffsetX ?? 10,
      offsetY: cfg.stackOffsetY ?? -10,
      opacityDecay: cfg.stackOpacityDecay ?? 20,
      color1: cfg.stackColor1,
      color2: cfg.stackColor2,
      color3: cfg.stackColor3,
      color4: cfg.stackColor4,
    };
  }

  return {
    ...cfg,
    id: preset.id,
    name: preset.name,
    category: preset.category,
    description: preset.description ?? cfg.description ?? "",
    tags: preset.tags ?? cfg.tags ?? [],
    boundingBox: calculateBoundingBox(cfg),
    font,
    fills,
    strokes,
    shadows,
    bevel,
    glows,
    panel,
    stack,
  };
}

export function convertRawConfigToDefinition(rawConfig: any): EffectDefinitionWithBounds {
  if (rawConfig.font && Array.isArray(rawConfig.fills)) {
    return rawConfig as EffectDefinitionWithBounds;
  }

  return convertConfigToDefinition({ ...rawConfig, config: rawConfig });
}

/**
 * Extract native canvas dimensions from an effect definition.
 *
 * Effect definitions from the Studio include native dimensions that define
 * the canvas size and font size the effect was designed at. These dimensions
 * are critical for proper scaling and aspect ratio preservation.
 *
 * @returns Native dimensions if present, null otherwise
 */
export function getNativeEffectDimensions(effectDef?: EffectDefinitionWithBounds): {
  width: number;
  height: number;
  fontSize: number;
} | null {
  if (!effectDef) return null;

  const def = effectDef as any;
  const width = def.canvasWidth ?? def.width;
  const height = def.canvasHeight ?? def.height;
  const fontSize = def.fontSize;

  if (!width || !height || !fontSize || width <= 0 || height <= 0 || fontSize <= 0) {
    return null;
  }

  return { width, height, fontSize };
}

function calculateBoundingBox(cfg: TextEffectConfig): BoundingBoxSpec {
  if (cfg.panelEnabled) {
    const strokeWidth = cfg.panelStrokeEnabled ? cfg.panelStrokeWidth || 0 : 0;
    return {
      mode: "panel",
      paddingX: (cfg.panelPaddingX ?? 0) + strokeWidth,
      paddingY: (cfg.panelPaddingY ?? 0) + strokeWidth,
    };
  }

  let paddingX = 0;
  let paddingY = 0;

  if (cfg.strokeEnabled) {
    paddingX = Math.max(paddingX, cfg.strokeWidth ?? 0);
    paddingY = Math.max(paddingY, cfg.strokeWidth ?? 0);
    paddingX += cfg.strokeBlur ?? 0;
    paddingY += cfg.strokeBlur ?? 0;
  }

  if (cfg.shadowEnabled) {
    paddingX = Math.max(paddingX, Math.abs(cfg.shadowOffsetX ?? 0) + (cfg.shadowBlur ?? 0));
    paddingY = Math.max(paddingY, Math.abs(cfg.shadowOffsetY ?? 0) + (cfg.shadowBlur ?? 0));
  }

  cfg.glowLayers?.forEach((glow) => {
    if (!glow.enabled) return;
    const glowPadding = (glow.blur ?? 0) + (glow.spread ?? 0);
    paddingX = Math.max(paddingX, glowPadding);
    paddingY = Math.max(paddingY, glowPadding);
  });

  if (cfg.bevelEnabled) {
    paddingX = Math.max(paddingX, cfg.bevelDepth ?? 0);
    paddingY = Math.max(paddingY, cfg.bevelDepth ?? 0);
    paddingX += cfg.bevelBlur ?? 0;
    paddingY += cfg.bevelBlur ?? 0;
  }

  if (cfg.stackEnabled) {
    paddingX = Math.max(paddingX, Math.abs((cfg.stackOffsetX ?? 0) * (cfg.stackCount ?? 1)));
    paddingY = Math.max(paddingY, Math.abs((cfg.stackOffsetY ?? 0) * (cfg.stackCount ?? 1)));
  }

  return {
    mode: "ink",
    paddingX: Math.max(10, Math.ceil(paddingX * 1.15)),
    paddingY: Math.max(10, Math.ceil(paddingY * 1.15)),
  };
}
