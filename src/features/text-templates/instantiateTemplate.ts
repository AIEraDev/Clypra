/**
 * Template Instantiation & Application (§1, §2, §3 Architecture Plan)
 *
 * Implements the core template mechanics:
 * 1. Insert Template: Instantiates a TemplateDefinition as a compound clip on the timeline.
 *    Single-element and multi-element templates are represented uniformly as compound clips.
 * 2. Apply Template Style: Applies the primary typography and effect styling of a template
 *    to an existing selected text clip, preserving the user's existing text.
 * 3. Detach on Instantiation: Instantiated clips are independent snapshot copies pinned
 *    at creation time with zero runtime link back to the catalog definition.
 */

import type { Clip, TextClip } from "@/types";
import { generateId } from "@/lib/utils/id";
import { resolveTextEffectDefinition } from "@/lib/text/textClip";
import type { TemplateDefinition, TemplateCustomization, TemplateElement } from "./types";

export interface InstantiateTemplateOptions {
  /** Target timeline track ID */
  trackId: string;
  /** Start time on the timeline (seconds) */
  startTime: number;
  /** Canvas width (default 1920) */
  canvasWidth?: number;
  /** Canvas height (default 1080) */
  canvasHeight?: number;
  /** Optional user customizations overriding placeholder text/colors */
  customization?: TemplateCustomization;
}

/**
 * Instantiates a template definition into an independent timeline compound clip.
 */
export function instantiateTemplate(
  template: TemplateDefinition,
  options: InstantiateTemplateOptions
): Clip {
  const compoundId = generateId("compound");
  const duration = template.defaultDuration || template.duration || 4.0;
  const canvasWidth = options.canvasWidth || template.canvasWidth || 1920;
  const canvasHeight = options.canvasHeight || template.canvasHeight || 1080;

  // Build child clips for each template element
  const elements = template.elements && template.elements.length > 0
    ? template.elements
    : extractElementsFromLegacyTemplate(template);

  let textIndex = 0;
  const children: Clip[] = elements.map((element, index) => {
    const currentTextIndex = element.kind === "text" ? textIndex++ : 0;
    return instantiateTemplateElement(element, {
      compoundId,
      trackId: options.trackId,
      duration,
      canvasWidth,
      canvasHeight,
      customization: options.customization,
      index,
      textIndex: currentTextIndex,
      templateId: template.id,
      templateVersion: template.version ?? 1,
    });
  });

  const compoundClip: Clip = {
    id: compoundId,
    name: template.displayName || template.name || template.label || "Text Template",
    kind: "compound",
    trackId: options.trackId,
    startTime: options.startTime,
    duration,
    trimIn: 0,
    trimOut: 0,
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
    opacity: 1,
    rotation: 0,
    mediaId: `compound-${compoundId}`,
    templateId: template.id,
    templateVersion: template.version ?? 1,
    compoundChildren: children,
    compoundPreview: template.thumbnailUrl || template.thumbnail,
  };

  return compoundClip;
}

/**
 * Instantiates a single TemplateElement into a timeline child clip.
 */
export function instantiateTemplateElement(
  element: TemplateElement,
  context: {
    compoundId: string;
    trackId: string;
    duration: number;
    canvasWidth: number;
    canvasHeight: number;
    customization?: TemplateCustomization;
    index: number;
    textIndex?: number;
    templateId: string;
    templateVersion: number;
  }
): Clip {
  const {
    trackId,
    duration,
    customization,
    index,
    textIndex = 0,
    templateId,
    templateVersion,
  } = context;

  if (element.kind === "text") {
    const textProps = element.textProperties || {
      text: "Title",
      fontFamily: "Inter Variable",
      fontSize: 48,
      color: "#FFFFFF",
    };
    const pinnedStyleDefinition = resolveTextEffectDefinition(
      textProps.styleId,
      textProps.styleDefinition,
    );

    // Apply any customized text overrides
    let finalText = textProps.text;
    if (customization?.layerTexts?.[element.id]) {
      finalText = customization.layerTexts[element.id];
    } else if (textIndex === 0 && customization?.primaryText) {
      finalText = customization.primaryText;
    } else if (textIndex === 1 && customization?.secondaryText) {
      finalText = customization.secondaryText;
    } else if (textIndex === 2 && customization?.accentText) {
      finalText = customization.accentText;
    }

    const textClip: TextClip = {
      id: generateId("text"),
      name: finalText || "Text",
      kind: "text",
      trackId,
      startTime: 0, // relative to compound parent
      duration,
      trimIn: 0,
      trimOut: 0,
      mediaId: `text-${generateId("media")}`,
      text: finalText || "Text",
      fontFamily: textProps.fontFamily || "Inter Variable",
      fontSize: textProps.fontSize || 48,
      color: textProps.color || "#FFFFFF",
      align: textProps.align || "center",
      valign: "middle",
      paddingX: 0,
      paddingY: 0,
      fontWeight: textProps.fontWeight ?? 400,
      fontStyle: textProps.fontStyle || "normal",
      letterSpacing: textProps.letterSpacing ?? 0,
      lineHeight: textProps.lineHeight ?? 1.2,
      styleId: textProps.styleId,
      styleVersion:
        textProps.styleVersion ?? (Number(pinnedStyleDefinition?.version) || 1),
      parameterOverrides: textProps.parameterOverrides
        ? cloneSerializable(textProps.parameterOverrides)
        : undefined,
      styleDefinition: pinnedStyleDefinition
        ? cloneSerializable(pinnedStyleDefinition)
        : undefined,
      templateId,
      templateVersion,
      x: element.relativePosition.x,
      y: element.relativePosition.y,
      width: element.width,
      height: element.height,
      rotation: 0,
      opacity: 1,
      zIndex: element.zIndex ?? (index + 1),
      textRole: "title",
    };

    return textClip as Clip;
  }

  if (element.kind === "solid") {
    const solidProps = element.solidProperties || {
      color: "#000000",
      opacity: 0.8,
    };

    const solidClip: Clip = {
      id: generateId("solid"),
      name: "Background Solid",
      kind: "image",
      trackId,
      startTime: 0,
      duration,
      trimIn: 0,
      trimOut: 0,
      mediaId: `solid-${generateId("media")}`,
      templateId,
      templateVersion,
      opacity: solidProps.opacity ?? 1,
      x: element.relativePosition.x,
      y: element.relativePosition.y,
      width: element.width,
      height: element.height,
      rotation: 0,
      zIndex: element.zIndex ?? index,
    };

    return solidClip;
  }

  // Image kind fallback
  const imageClip: Clip = {
    id: generateId("image"),
    name: "Template Image",
    kind: "image",
    trackId,
    startTime: 0,
    duration,
    trimIn: 0,
    trimOut: 0,
    mediaId: element.imageProperties?.assetId || `image-${generateId("media")}`,
    mediaUrl: element.imageProperties?.url,
    templateId,
    templateVersion,
    x: element.relativePosition.x,
    y: element.relativePosition.y,
    width: element.width,
    height: element.height,
    rotation: 0,
    opacity: element.imageProperties?.opacity ?? 1,
    zIndex: element.zIndex ?? index,
  };

  return imageClip;
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Applies the primary typography and text effects of a template to an existing clip,
 * preserving the clip's existing text content (§1).
 */
export function applyTemplateStyle(
  targetClip: TextClip,
  template: TemplateDefinition
): TextClip {
  const elements = template.elements && template.elements.length > 0
    ? template.elements
    : extractElementsFromLegacyTemplate(template);

  const primaryTextElement = elements.find((e) => e.kind === "text") || elements[0];
  if (!primaryTextElement || primaryTextElement.kind !== "text") {
    return targetClip;
  }

  const textProps = primaryTextElement.textProperties || {
    text: "Title",
    fontFamily: "Inter Variable",
    fontSize: 48,
    color: "#FFFFFF",
  };
  const pinnedStyleDefinition = resolveTextEffectDefinition(
    textProps.styleId,
    textProps.styleDefinition,
  );

  return {
    ...targetClip,
    // Preserve existing text content:
    text: targetClip.text,
    fontFamily: textProps.fontFamily || targetClip.fontFamily,
    fontSize: textProps.fontSize || targetClip.fontSize,
    color: textProps.color || targetClip.color,
    align: textProps.align || targetClip.align,
    fontWeight: textProps.fontWeight ?? targetClip.fontWeight,
    fontStyle: textProps.fontStyle || targetClip.fontStyle,
    letterSpacing: textProps.letterSpacing ?? targetClip.letterSpacing,
    lineHeight: textProps.lineHeight ?? targetClip.lineHeight,
    styleId: textProps.styleId,
    styleVersion:
      textProps.styleVersion ?? (Number(pinnedStyleDefinition?.version) || 1),
    parameterOverrides: textProps.parameterOverrides
      ? cloneSerializable(textProps.parameterOverrides)
      : undefined,
    styleDefinition: pinnedStyleDefinition
      ? cloneSerializable(pinnedStyleDefinition)
      : undefined,
  };
}

/**
 * Fallback converter for legacy template formats with `layers` array.
 */
function extractElementsFromLegacyTemplate(template: any): TemplateElement[] {
  const legacyLayers = template.layers || template.templateData?.layers || [];
  if (!Array.isArray(legacyLayers) || legacyLayers.length === 0) {
    return [
      {
        id: "default-title",
        kind: "text",
        relativePosition: { x: 960, y: 540 },
        width: 800,
        height: 120,
        zIndex: 1,
        textProperties: {
          text: template.name || template.label || "Title",
          fontFamily: "Inter Variable",
          fontSize: 48,
          color: "#FFFFFF",
          align: "center",
        },
      },
    ];
  }

  return legacyLayers.map((layer: any, idx: number): TemplateElement => {
    if (layer.kind === "shape") {
      return {
        id: layer.id || `shape-${idx}`,
        kind: "solid",
        relativePosition: { x: layer.x || 0, y: layer.y || 0 },
        width: layer.width || 400,
        height: layer.height || 100,
        zIndex: idx,
        solidProperties: {
          color: layer.fill || "#000000",
        },
      };
    }

    if (layer.kind === "image") {
      return {
        id: layer.id || `image-${idx}`,
        kind: "image",
        relativePosition: { x: layer.x || 0, y: layer.y || 0 },
        width: layer.width || 200,
        height: layer.height || 200,
        zIndex: idx,
        imageProperties: {
          url: layer.url,
        },
      };
    }

    return {
      id: layer.id || `text-${idx}`,
      kind: "text",
      relativePosition: { x: layer.x || 0, y: layer.y || 0 },
      width: layer.width || 600,
      height: layer.height || 100,
      zIndex: idx,
      textProperties: {
        text: layer.content || "Text",
        fontFamily: layer.fontFamily || "Inter Variable",
        fontSize: layer.fontSize || 36,
        color: layer.color || "#FFFFFF",
        align: layer.align || "left",
        fontWeight: layer.fontWeight || 400,
        styleId: layer.styleId,
      },
    };
  });
}
