/**
 * Safe Zone Compliance Engine (EBU R95 & SMPTE Standards)
 *
 * Title Safe: 80% inner area (10% margin on each edge)
 * Action Safe: 90% inner area (5% margin on each edge)
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeZoneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface SafeZoneCompliance {
  isActionSafe: boolean;
  isTitleSafe: boolean;
  overflows: Array<"top" | "bottom" | "left" | "right">;
  warning: string | null;
}

/**
 * Returns pixel boundaries for Title Safe (80%) and Action Safe (90%)
 * for a given canvas dimension.
 */
export function getSafeZoneBounds(canvasWidth: number, canvasHeight: number): {
  actionSafe: SafeZoneBounds;
  titleSafe: SafeZoneBounds;
} {
  const safeW = Math.max(1, canvasWidth);
  const safeH = Math.max(1, canvasHeight);

  return {
    actionSafe: {
      minX: safeW * 0.05,
      maxX: safeW * 0.95,
      minY: safeH * 0.05,
      maxY: safeH * 0.95,
      width: safeW * 0.90,
      height: safeH * 0.90,
    },
    titleSafe: {
      minX: safeW * 0.10,
      maxX: safeW * 0.90,
      minY: safeH * 0.10,
      maxY: safeH * 0.90,
      width: safeW * 0.80,
      height: safeH * 0.80,
    },
  };
}

/**
 * Evaluates whether a bounding box complies with Title Safe and Action Safe boundaries.
 * Non-blocking: produces warning metadata without halting playback or export.
 */
export function checkSafeZoneCompliance(
  box: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
): SafeZoneCompliance {
  const { actionSafe, titleSafe } = getSafeZoneBounds(canvasWidth, canvasHeight);

  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;

  const overflows: Array<"top" | "bottom" | "left" | "right"> = [];

  if (left < titleSafe.minX) overflows.push("left");
  if (right > titleSafe.maxX) overflows.push("right");
  if (top < titleSafe.minY) overflows.push("top");
  if (bottom > titleSafe.maxY) overflows.push("bottom");

  const isTitleSafe = overflows.length === 0;

  const isActionSafe =
    left >= actionSafe.minX &&
    right <= actionSafe.maxX &&
    top >= actionSafe.minY &&
    bottom <= actionSafe.maxY;

  let warning: string | null = null;
  if (!isTitleSafe) {
    const edgeList = overflows.join(", ");
    if (!isActionSafe) {
      warning = `Caption exceeds Action Safe area (${edgeList}). May be clipped on TV and mobile displays.`;
    } else {
      warning = `Caption exceeds Title Safe (80%) area (${edgeList}).`;
    }
  }

  return {
    isActionSafe,
    isTitleSafe,
    overflows,
    warning,
  };
}
