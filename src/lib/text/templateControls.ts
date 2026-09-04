/**
 * Canonical resolution of text template control values.
 *
 * Single Source of Truth (SSOT) across all template rasterization paths:
 *   - Main-thread Canvas renderer (`textRasterizer.ts`)
 *   - OffscreenCanvas worker client (`templateRasterizerWorkerClient.ts`)
 *   - Template instantiator & clip evaluator (`textClip.ts`)
 *   - Video frame exporter (`FrameRenderer.ts`)
 */

import type { TextTemplateArtifact } from "@clypra-studio/engine";
import type { TemplateCustomization } from "@/features/text-templates/types";

export interface ResolveTemplateControlValuesOptions {
  customization?: TemplateCustomization | null;
  templateControlValues?: Record<string, unknown> | null;
  fallbackText?: string;
}

export function resolveTemplateControlValues(
  artifact: TextTemplateArtifact | null | undefined,
  optionsOrCustomization?:
    | ResolveTemplateControlValuesOptions
    | TemplateCustomization
    | null,
  fallbackText?: string,
): Record<string, unknown> {
  if (!artifact?.controls) return {};

  const options: ResolveTemplateControlValuesOptions =
    optionsOrCustomization &&
    ("customization" in optionsOrCustomization ||
      "templateControlValues" in optionsOrCustomization ||
      "fallbackText" in optionsOrCustomization)
      ? (optionsOrCustomization as ResolveTemplateControlValuesOptions)
      : {
          customization: optionsOrCustomization as TemplateCustomization | null,
          fallbackText,
        };

  const customization = options.customization;
  const existingValues = options.templateControlValues;
  const targetFallbackText = options.fallbackText;

  const firstTextNode = artifact.document?.nodes?.find(
    (candidate: any) => candidate.type === "text",
  );

  const values: Record<string, unknown> = { ...(existingValues || {}) };

  for (const control of artifact.controls) {
    if (control.type !== "text" && control.type !== "color") continue;

    const node = artifact.document?.nodes?.find(
      (candidate: any) => candidate.id === control.target.nodeId,
    ) as any;
    const role: string = node?.role || "";
    const labelLower = (control.label || "").toLowerCase();

    if (control.type === "text") {
      const explicitText = customization?.layerTexts?.[control.target.nodeId];
      let roleText: string | undefined;
      if (role === "primary" || labelLower.includes("primary")) {
        roleText = customization?.primaryText;
      } else if (role === "secondary" || labelLower.includes("secondary")) {
        roleText = customization?.secondaryText;
      } else if (role === "accent" || labelLower.includes("accent")) {
        roleText = customization?.accentText;
      }

      const firstNodeFallback =
        targetFallbackText !== undefined &&
        firstTextNode &&
        control.target.nodeId === firstTextNode.id
          ? targetFallbackText
          : undefined;

      values[control.id] =
        explicitText ??
        roleText ??
        firstNodeFallback ??
        values[control.id] ??
        control.defaultValue;
    } else if (control.type === "color") {
      const explicitColor = customization?.layerColors?.[control.target.nodeId];
      let roleColor: string | undefined;
      if (role === "secondary" || labelLower.includes("secondary")) {
        roleColor = customization?.secondaryColor;
      } else {
        roleColor = customization?.primaryColor;
      }

      values[control.id] =
        explicitColor ??
        roleColor ??
        values[control.id] ??
        control.defaultValue;
    }
  }

  return values;
}
