/**
 * Canonical geometry for a text background panel.
 *
 * Older projects stored a single `padding` value. The inspector now exposes
 * independent width and height controls, but renderers and selection geometry
 * must continue to agree when opening those older projects.
 */
export interface TextBackgroundGeometryInput {
  padding?: number;
  width?: number;
  height?: number;
  opacity?: number;
  yOffset?: number;
  style?: "rectangle" | "split" | string;
}

export interface TextBackgroundGeometry {
  paddingX: number;
  paddingY: number;
  opacity: number;
  /** Percentage in the inspector's 0–100 coordinate space; 50 is centered. */
  yOffset: number;
  style: "rectangle" | "split" | string;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

/** Resolve both legacy and current background fields without mutating project data. */
export function resolveTextBackgroundGeometry(
  background: TextBackgroundGeometryInput | undefined,
): TextBackgroundGeometry | null {
  if (!background) return null;

  const legacyPadding = finiteNonNegative(background.padding, 8);
  return {
    paddingX: finiteNonNegative(background.width, legacyPadding),
    paddingY: finiteNonNegative(background.height, legacyPadding),
    opacity: Math.min(100, finiteNonNegative(background.opacity, 100)),
    yOffset: Math.min(100, finiteNonNegative(background.yOffset, 50)),
    style: background.style ?? "rectangle",
  };
}
