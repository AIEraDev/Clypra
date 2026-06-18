import { describe, expect, it } from "vitest";
import { buildTransformStartClip, calculateScaledTextTransform, calculateTextResizeFontSize, isClipActiveAtTime, shouldScaleTextFontForHandle } from "../TransformOverlay";
import type { TextClip, TransformHandle, TransformState } from "@/types";

describe("TransformOverlay resize policy", () => {
  it("scales text font size for every resize handle", () => {
    const resizeHandles: TransformHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

    for (const handle of resizeHandles) {
      expect(shouldScaleTextFontForHandle(handle)).toBe(true);
    }
  });

  it("does not scale text font size for move or rotate", () => {
    expect(shouldScaleTextFontForHandle("move")).toBe(false);
    expect(shouldScaleTextFontForHandle("rotate")).toBe(false);
  });

  it("uses the edited axis when calculating resized text font size", () => {
    const start = { width: 200, height: 100 };

    expect(calculateTextResizeFontSize(40, "e", start, { width: 300, height: 100 })).toBe(60);
    expect(calculateTextResizeFontSize(40, "s", start, { width: 200, height: 150 })).toBe(60);
    expect(calculateTextResizeFontSize(40, "se", start, { width: 300, height: 130 })).toBe(60);
  });

  it("scales the perpendicular text box dimension for side resize handles", () => {
    const start = { x: 10, y: 20, width: 200, height: 100 };

    expect(calculateScaledTextTransform("e", start, { x: 10, width: 300 }, 1.5)).toMatchObject({
      x: 10,
      width: 300,
      y: -5,
      height: 150,
    });

    expect(calculateScaledTextTransform("s", start, { y: 20, height: 150 }, 1.5)).toMatchObject({
      x: -40,
      width: 300,
      y: 20,
      height: 150,
    });
  });

  it("preserves text fields when rebuilding the drag-start clip for resize math", () => {
    const selectedClip: TextClip = {
      id: "text-1",
      kind: "text",
      trackId: "track-1",
      mediaId: "",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 10,
      y: 20,
      width: 320,
      height: 90,
      opacity: 1,
      rotation: 0,
      aspectRatioLocked: false,
      sourceAspectRatio: 320 / 90,
      text: "MY TEXT",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 48,
      fontWeight: "bold",
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 16,
      paddingY: 16,
    };
    const activeTransform: TransformState = {
      clipId: "text-1",
      handle: "e",
      startTransform: {
        x: 10,
        y: 20,
        width: 320,
        height: 90,
        rotation: 0,
      },
      startMousePos: { x: 330, y: 65 },
      aspectRatioLocked: false,
      sourceAspectRatio: 320 / 90,
    };

    const startClip = buildTransformStartClip(
      {
        ...selectedClip,
        x: 15,
        width: 360,
      },
      activeTransform,
    );

    expect(startClip.kind).toBe("text");
    expect((startClip as TextClip).text).toBe("MY TEXT");
    expect((startClip as TextClip).fontSize).toBe(48);
    expect(startClip.x).toBe(10);
    expect(startClip.width).toBe(320);
  });
});

describe("TransformOverlay visibility policy", () => {
  it("shows selected handles only while the selected clip is active at the playhead", () => {
    const clip = { startTime: 3, duration: 5 };

    expect(isClipActiveAtTime(clip, 2.999)).toBe(false);
    expect(isClipActiveAtTime(clip, 3)).toBe(true);
    expect(isClipActiveAtTime(clip, 7.999)).toBe(true);
    expect(isClipActiveAtTime(clip, 8)).toBe(false);
  });
});
