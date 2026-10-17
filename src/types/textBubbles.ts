/**
 * textBubbles.ts
 *
 * Canonical schema contract and layout resolver for Clypra's
 * Text Bubble & Caption Preset System.
 *
 * Invariants:
 * 1. Text Clip is the sole logical entity on the timeline.
 * 2. Bubble is rendered behind the text as a composite drawable.
 * 3. Text and Bubble share all transforms (x, y, scale, rotation, opacity, keyframes).
 * 4. Content bounds define the safe text region inside the artwork so text never clips or overflows.
 */

import React from "react";

export type TextBubbleCategory =
  | "all"
  | "speech"
  | "paper"
  | "labels"
  | "decorative"
  | "comic"
  | "cute"
  | "neon"
  | "banner";

export type BubbleRenderMode = "svg" | "raster" | "nine-slice" | "procedural";

export interface TextBubblePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TextBubbleLayout {
  /** Normalized safe content coordinates within the artwork [0..1] */
  contentBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Minimum outer dimensions in logical editor units */
  minWidth: number;
  minHeight: number;

  /** Whether the bubble artwork must preserve aspect ratio */
  preserveAspectRatio: boolean;

  /** Optional explicit padding around measured text */
  padding?: TextBubblePadding;

  /** Sizing mode: auto-fit grows with text; fixed wraps text into predefined box */
  sizingMode?: "auto-fit" | "fixed";
}

export interface TextBubblePreset {
  schemaVersion: 1;

  id: string;
  version: number;
  name: string;
  category: TextBubbleCategory;
  tags: string[];
  isReset?: boolean;

  asset?: {
    url?: string;
    format: "svg" | "png" | "webp" | "procedural";
    width: number;
    height: number;
    sha256?: string;
    renderMode: BubbleRenderMode;
  };

  layout: TextBubbleLayout;

  defaultTextStyle?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: "normal" | "italic";
    textDecoration?: "none" | "underline" | "line-through";
    color?: string;
  };

  thumbnailUrl?: string;
  sampleText?: string;
  renderPreview?: (active: boolean) => React.ReactNode;
}

/**
 * Resolves the outer bubble bounds and text position given measured text bounds
 * and preset layout rules:
 *
 *   W_outer = max(W_text + P_left + P_right, minWidth)
 *   H_outer = max(H_text + P_top + P_bottom, minHeight)
 */
export function resolveBubbleLayout(
  textWidth: number,
  textHeight: number,
  layout: TextBubbleLayout,
): {
  outerWidth: number;
  outerHeight: number;
  textOffsetX: number;
  textOffsetY: number;
  contentWidth: number;
  contentHeight: number;
} {
  const p = layout.padding ?? {
    top: 14,
    right: 18,
    bottom: 14,
    left: 18,
  };

  const rawOuterW = textWidth + p.left + p.right;
  const rawOuterH = textHeight + p.top + p.bottom;

  let outerWidth = Math.max(rawOuterW, layout.minWidth);
  let outerHeight = Math.max(rawOuterH, layout.minHeight);

  if (layout.preserveAspectRatio && layout.minWidth > 0 && layout.minHeight > 0) {
    const aspect = layout.minWidth / layout.minHeight;
    const currentAspect = outerWidth / outerHeight;
    if (currentAspect > aspect) {
      outerHeight = outerWidth / aspect;
    } else {
      outerWidth = outerHeight * aspect;
    }
  }

  // Calculate centered or content-bounded text offset relative to outer center
  const textOffsetX = (p.left - p.right) / 2;
  const textOffsetY = (p.top - p.bottom) / 2;

  return {
    outerWidth,
    outerHeight,
    textOffsetX,
    textOffsetY,
    contentWidth: outerWidth - p.left - p.right,
    contentHeight: outerHeight - p.top - p.bottom,
  };
}
