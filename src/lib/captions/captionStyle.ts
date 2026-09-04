import type { TemplateTextProperties } from "@/features/text-templates/types";

/**
 * Resolves the effective text style for a caption cue by merging track-level
 * default style properties with cue-level overrides.
 *
 * §3 Canonical style cascade:
 * Track Default provides baseline typography, color, and alignment.
 * Cue Override (if present) overrides only explicit non-undefined fields.
 */
export function resolveEffectiveCaptionStyle(
  trackDefault: TemplateTextProperties,
  cueOverride?: Partial<TemplateTextProperties>,
): TemplateTextProperties {
  if (!cueOverride || Object.keys(cueOverride).length === 0) {
    return { ...trackDefault };
  }

  const result: TemplateTextProperties = {
    ...trackDefault,
  };

  for (const [key, value] of Object.entries(cueOverride)) {
    if (value !== undefined) {
      if (
        key === "parameterOverrides" &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result.parameterOverrides = {
          ...(trackDefault.parameterOverrides || {}),
          ...value,
        };
      } else if (
        key === "animation" &&
        typeof value === "object" &&
        value !== null
      ) {
        result.animation = {
          ...(trackDefault.animation || { preset: "none", duration: 0 }),
          ...value,
        };
      } else {
        (result as any)[key] = value;
      }
    }
  }

  return result;
}
