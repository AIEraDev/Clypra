/**
 * Template Layout Engine
 *
 * Provides content-aware, adaptive viewport sizing and positioning for text templates.
 *
 * Decouples the template's authoring artboard (e.g. 1920x1080) from its visual payload,
 * ensuring text templates always default to a prominent, readable, well-visible size
 * across any canvas aspect ratio (portrait 9:16, landscape 16:9, square 1:1, etc.).
 */

import type { TextTemplateArtifact } from "@clypra-studio/engine";

export interface TemplateContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  maxFontSize: number;
}

export interface TemplateLayoutResult {
  /** Uniform scale applied to the document artboard. */
  scale: number;
  /** Virtual document width passed to renderTextTemplateToCanvas. */
  uniformWidth: number;
  /** Virtual document height passed to renderTextTemplateToCanvas. */
  uniformHeight: number;
  /** Translation offset X applied to the canvas context before rendering. */
  offsetX: number;
  /** Translation offset Y applied to the canvas context before rendering. */
  offsetY: number;
  /** The measured content bounds in project canvas space. */
  contentBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Measure the tight visual bounding box of all active nodes in the template document,
 * taking into account custom user control values if supplied.
 */
export function measureTemplateContentBounds(
  artifact: TextTemplateArtifact,
  controlValues?: Record<string, unknown>,
): TemplateContentBounds {
  const docWidth = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.width) || 1920),
  );
  const docHeight = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.height) || 1080),
  );

  const nodes = artifact?.document?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    const w = docWidth * 0.4;
    const h = docHeight * 0.2;
    return {
      minX: (docWidth - w) / 2,
      minY: (docHeight - h) / 2,
      maxX: (docWidth + w) / 2,
      maxY: (docHeight + h) / 2,
      width: w,
      height: h,
      centerX: docWidth / 2,
      centerY: docHeight / 2,
      maxFontSize: 48,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxFontSize = 0;

  // Build a lookup for control overrides targeting node text
  const textOverridesByNodeId = new Map<string, string>();
  if (controlValues && Array.isArray(artifact.controls)) {
    for (const ctrl of artifact.controls) {
      if (ctrl.target?.nodeId && ctrl.target?.propertyPath === "text") {
        const val = controlValues[ctrl.id];
        if (typeof val === "string" && val.trim().length > 0) {
          textOverridesByNodeId.set(ctrl.target.nodeId, val);
        }
      }
    }
  }

  for (const node of nodes) {
    if ((node as any).visible === false) continue;

    const nx = typeof (node as any).x === "number" ? (node as any).x : 0;
    const ny = typeof (node as any).y === "number" ? (node as any).y : 0;
    const fontSize =
      typeof (node as any).style?.fontSize === "number" &&
      Number.isFinite((node as any).style.fontSize)
        ? (node as any).style.fontSize
        : 48;
    maxFontSize = Math.max(maxFontSize, fontSize);

    const letterSpacing =
      typeof (node as any).style?.letterSpacing === "number" &&
      Number.isFinite((node as any).style.letterSpacing)
        ? (node as any).style.letterSpacing
        : 0;

    const bgPanel = (node as any).backgroundPanel;
    const padL = Number(bgPanel?.paddingLeft ?? (node as any).style?.paddingLeft ?? 0);
    const padR = Number(bgPanel?.paddingRight ?? (node as any).style?.paddingRight ?? padL);
    const padT = Number(bgPanel?.paddingTop ?? (node as any).style?.paddingTop ?? 0);
    const padB = Number(bgPanel?.paddingBottom ?? (node as any).style?.paddingBottom ?? padT);

    let nodeW: number;
    let nodeH: number;

    if (
      typeof (node as any).width === "number" &&
      Number.isFinite((node as any).width) &&
      (node as any).width > 0
    ) {
      nodeW = (node as any).width;
    } else {
      const rawText =
        textOverridesByNodeId.get(node.id) ??
        String((node as any).text ?? "Template");
      const lines = rawText.split(/\r?\n/);
      const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
      nodeW =
        maxLineLen * fontSize * 0.6 +
        Math.max(0, maxLineLen - 1) * letterSpacing;
    }

    if (
      typeof (node as any).height === "number" &&
      Number.isFinite((node as any).height) &&
      (node as any).height > 0
    ) {
      nodeH = (node as any).height;
    } else {
      const rawText =
        textOverridesByNodeId.get(node.id) ??
        String((node as any).text ?? "Template");
      const lineCount = Math.max(1, rawText.split(/\r?\n/).length);
      const lineHeight =
        typeof (node as any).style?.lineHeight === "number" &&
        Number.isFinite((node as any).style.lineHeight)
          ? (node as any).style.lineHeight
          : 1.3;
      nodeH = lineCount * fontSize * lineHeight;
    }

    const boxX = nx - padL;
    const boxY = ny - padT;
    const boxW = nodeW + padL + padR;
    const boxH = nodeH + padT + padB;

    minX = Math.min(minX, boxX);
    minY = Math.min(minY, boxY);
    maxX = Math.max(maxX, boxX + boxW);
    maxY = Math.max(maxY, boxY + boxH);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
    const w = docWidth * 0.4;
    const h = docHeight * 0.2;
    return {
      minX: (docWidth - w) / 2,
      minY: (docHeight - h) / 2,
      maxX: (docWidth + w) / 2,
      maxY: (docHeight + h) / 2,
      width: w,
      height: h,
      centerX: docWidth / 2,
      centerY: docHeight / 2,
      maxFontSize: Math.max(48, maxFontSize),
    };
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    maxFontSize: Math.max(24, maxFontSize),
  };
}

/**
 * Calculate the optimal layout, uniform scale factor, and centered translation
 * for a text template rendered onto a canvas of dimensions (canvasWidth, canvasHeight).
 */
export function calculateOptimalTemplateLayout(
  artifact: TextTemplateArtifact,
  canvasWidth: number,
  canvasHeight: number,
  controlValues?: Record<string, unknown>,
): TemplateLayoutResult {
  const cWidth = Math.max(1, Math.round(canvasWidth));
  const cHeight = Math.max(1, Math.round(canvasHeight));

  const docWidth = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.width) || 1920),
  );
  const docHeight = Math.max(
    1,
    Math.round(Number(artifact?.document?.canvas?.height) || 1080),
  );

  const bounds = measureTemplateContentBounds(artifact, controlValues);
  const isPortrait = cWidth < cHeight;
  const isSquare = Math.abs(cWidth - cHeight) / Math.max(cWidth, cHeight) < 0.08;

  // 1. Target width proportion:
  // In portrait mobile view (9:16 / 4:5), titles/badges must be prominent (58% - 66% width).
  // In landscape widescreen (16:9 / 21:9), titles/badges occupy 38% - 46% width.
  // In square view (1:1), titles/badges occupy 48% - 56% width.
  const targetCoverageRatio = isPortrait ? 0.62 : isSquare ? 0.52 : 0.42;
  const targetContentWidth = cWidth * targetCoverageRatio;
  const scaleByWidth = targetContentWidth / Math.max(1, bounds.width);

  // 2. Guaranteed legibility floor for text:
  // Minimum effective font size on 1080p equivalent should be >= 64px.
  const minLegibleFontSize = Math.round(
    (Math.min(cWidth, cHeight) / 1080) * 64,
  );
  const scaleByFontSize =
    minLegibleFontSize / Math.max(16, bounds.maxFontSize);

  // Desired prominent scale takes the larger of width coverage and font size floor
  const desiredScale = Math.max(scaleByWidth, scaleByFontSize);

  // 3. Safety upper caps:
  // Content must never overflow 88% of canvas width or 78% of canvas height.
  const maxSafeScaleX = (cWidth * 0.88) / Math.max(1, bounds.width);
  const maxSafeScaleY = (cHeight * 0.78) / Math.max(1, bounds.height);
  const maxSafeScale = Math.min(maxSafeScaleX, maxSafeScaleY);

  // Contain floor: never smaller than the document uniform fit scale
  const containScale = Math.min(cWidth / docWidth, cHeight / docHeight);

  // Final uniform scale: ensure prominent size, but strictly cap by maxSafeScale so content never overflows
  const scale = Math.max(
    0.1,
    Math.min(Math.max(containScale, desiredScale), maxSafeScale),
  );

  const uniformWidth = Math.max(1, Math.round(docWidth * scale));
  const uniformHeight = Math.max(1, Math.round(docHeight * scale));

  // 4. Centering & Placement:
  // Center the authored content bounds on the canvas.
  let offsetX = Math.round(cWidth / 2 - bounds.centerX * scale);
  let offsetY = Math.round(cHeight / 2 - bounds.centerY * scale);

  // Semantic category placement:
  // If the template is explicitly a lower-third or placed in the bottom 30% of the document,
  // preserve its lower position rather than forcing it to the vertical center.
  const category = (artifact.metadata?.category || "").toLowerCase();
  const isLowerThird =
    category === "lower-third" || bounds.centerY > docHeight * 0.65;

  if (isLowerThird) {
    const docCenterY = docHeight / 2;
    const canvasCenterY = cHeight / 2;
    // Anchor lower third relative to canvas center scaled
    offsetY = Math.round(canvasCenterY - docCenterY * scale);
  }

  // 5. Safe margin clamping (5% safe area protection):
  const marginX = cWidth * 0.05;
  const marginY = cHeight * 0.05;

  const contentLeft = offsetX + bounds.minX * scale;
  const contentRight = offsetX + bounds.maxX * scale;
  const contentTop = offsetY + bounds.minY * scale;
  const contentBottom = offsetY + bounds.maxY * scale;

  if (contentRight > cWidth - marginX) {
    offsetX = Math.round(cWidth - marginX - bounds.maxX * scale);
  }
  if (contentLeft < marginX) {
    offsetX = Math.round(marginX - bounds.minX * scale);
  }

  if (contentBottom > cHeight - marginY) {
    offsetY = Math.round(cHeight - marginY - bounds.maxY * scale);
  }
  if (contentTop < marginY) {
    offsetY = Math.round(marginY - bounds.minY * scale);
  }

  return {
    scale,
    uniformWidth,
    uniformHeight,
    offsetX,
    offsetY,
    contentBounds: {
      x: offsetX + bounds.minX * scale,
      y: offsetY + bounds.minY * scale,
      width: Math.max(1, bounds.width * scale),
      height: Math.max(1, bounds.height * scale),
    },
  };
}
