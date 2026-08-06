export type Size = {
  width: number;
  height: number;
};

export type MediaFitMode = "cover" | "contain" | "stretch" | "original";

export interface ResolvedFit {
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Calculates how to scale and position a source size within a target size
 * depending on the chosen fit mode (cover, contain, stretch, original).
 */
export function calculateMediaFit(source: Size, target: Size, mode: MediaFitMode): ResolvedFit {
  // Guard against invalid or empty dimensions
  if (source.width <= 0 || source.height <= 0 || target.width <= 0 || target.height <= 0) {
    return {
      scaleX: 1,
      scaleY: 1,
      width: target.width,
      height: target.height,
      x: 0,
      y: 0,
    };
  }

  if (mode === "stretch") {
    const scaleX = target.width / source.width;
    const scaleY = target.height / source.height;
    return {
      scaleX,
      scaleY,
      width: target.width,
      height: target.height,
      x: 0,
      y: 0,
    };
  }

  if (mode === "original") {
    return {
      scaleX: 1,
      scaleY: 1,
      width: source.width,
      height: source.height,
      x: (target.width - source.width) / 2,
      y: (target.height - source.height) / 2,
    };
  }

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;

  const scale = mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const width = source.width * scale;
  const height = source.height * scale;

  return {
    scaleX: scale,
    scaleY: scale,
    width,
    height,
    x: (target.width - width) / 2,
    y: (target.height - height) / 2,
  };
}
