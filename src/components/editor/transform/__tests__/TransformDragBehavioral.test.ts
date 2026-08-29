/**
 * TransformOverlay Drag Behavioral Tests
 *
 * Verifies the live drag transformation calculations and lifecycle:
 * - Live handle calculation: Move, Scale (Corner/Side), and Rotation
 * - Proportional text resizing
 * - Snapping and boundary constraints
 * - Transform lifecycle state management
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetTransformController, getTransformController } from "@/core/interactions";
import {
  buildTransformStartClip,
  calculateTextResizeFontSize,
  shouldScaleTextFontForHandle,
  calculateScaledTextTransform,
} from "../TransformOverlay";
import { calculateTransform, getDefaultConstraints } from "../calculator";
import type { Clip, TransformState } from "@/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseVideoClip: Clip = {
  id: "clip-video",
  kind: "video",
  trackId: "track-1",
  mediaId: "asset-1",
  startTime: 0,
  duration: 10,
  trimIn: 0,
  trimOut: 10,
  x: 100,
  y: 100,
  width: 500,
  height: 281,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: true,
  sourceAspectRatio: 16 / 9,
};

const makeActiveTransform = (handle: TransformState["handle"] = "move"): TransformState => ({
  clipId: "clip-video",
  handle,
  startTransform: {
    x: 100,
    y: 100,
    width: 500,
    height: 281,
    rotation: 0,
  },
  startMousePos: { x: 350, y: 240 },
  aspectRatioLocked: true,
  sourceAspectRatio: 16 / 9,
});

// ─── Transform Controller Lifecycle ──────────────────────────────────────────

describe("Transform Controller lifecycle", () => {
  beforeEach(() => {
    resetTransformController();
  });

  it("tracks active transform state during drag", () => {
    const controller = getTransformController();
    expect(controller.getActiveTransform()).toBeNull();

    controller.startTransform(makeActiveTransform("se"));
    expect(controller.getActiveTransform()).not.toBeNull();
    expect(controller.getActiveTransform()?.handle).toBe("se");

    controller.endTransform();
    expect(controller.getActiveTransform()).toBeNull();
  });

  it("updates transform state imperatively during drag", () => {
    const controller = getTransformController();
    controller.startTransform(makeActiveTransform("move"));

    const updatedState: TransformState = {
      ...makeActiveTransform("move"),
      startTransform: {
        x: 150,
        y: 150,
        width: 500,
        height: 281,
        rotation: 0,
      },
    };

    controller.updateTransform(updatedState);
    expect(controller.getActiveTransform()?.startTransform.x).toBe(150);
    controller.endTransform();
  });
});

// ─── Live Move & Resize Math ──────────────────────────────────────────────────

describe("Live move & resize transform calculations", () => {
  const constraints = getDefaultConstraints(1920, 1080, false);

  it("calculates live position offset on move drag", () => {
    const startClip = buildTransformStartClip(baseVideoClip, makeActiveTransform("move"));
    const result = calculateTransform(
      startClip,
      "move",
      { x: 350, y: 240 },
      { x: 420, y: 310 },
      constraints,
    );
    expect(result.x).toBeCloseTo(170); // 100 + (420-350)
    expect(result.y).toBeCloseTo(170); // 100 + (310-240)
  });

  it("constrains movement within canvas limits", () => {
    const startClip = buildTransformStartClip(baseVideoClip, makeActiveTransform("move"));
    const result = calculateTransform(
      startClip,
      "move",
      { x: 350, y: 240 },
      { x: 5000, y: 5000 },
      constraints,
    );
    expect(result.x!).toBeLessThanOrEqual(constraints.canvasWidth - startClip.width * 0.5);
    expect(result.y!).toBeLessThanOrEqual(constraints.canvasHeight - startClip.height * 0.5);
  });

  it("scales dimensions proportionally on corner drag (aspect locked)", () => {
    const lockedConstraints = getDefaultConstraints(1920, 1080, true);
    const startClip = buildTransformStartClip(baseVideoClip, makeActiveTransform("se"));
    const result = calculateTransform(
      startClip,
      "se",
      { x: 600, y: 381 },
      { x: 700, y: 437 },
      lockedConstraints,
    );
    expect(result.width).toBeGreaterThan(startClip.width);
    expect(result.height).toBeGreaterThan(startClip.height);
  });
});

// ─── Text Resize Math ────────────────────────────────────────────────────────

describe("Live text resizing calculations", () => {
  it("scales font size proportionally on width resize", () => {
    const startTransform = { width: 200, height: 100 };
    const newFontSize = calculateTextResizeFontSize(
      40,
      "e",
      startTransform,
      { width: 300, height: 100 },
    );
    expect(newFontSize).toBe(60); // 40 * (300/200)
  });

  it("reduces font size when scaled down", () => {
    const startTransform = { width: 400, height: 200 };
    const newFontSize = calculateTextResizeFontSize(
      60,
      "se",
      startTransform,
      { width: 200, height: 100 },
    );
    expect(newFontSize).toBe(30); // 60 * (200/400)
  });

  it("maintains font size on move or rotate", () => {
    expect(shouldScaleTextFontForHandle("move")).toBe(false);
    expect(shouldScaleTextFontForHandle("rotate")).toBe(false);
  });

  it("preserves center position when scaling text horizontally", () => {
    const start = { x: 100, y: 200, width: 200, height: 100 };
    const result = calculateScaledTextTransform("e", start, { x: 100, width: 300 }, 1.5);
    expect(result.height).toBeCloseTo(150);
    expect(result.y).toBeCloseTo(175);
  });
});
