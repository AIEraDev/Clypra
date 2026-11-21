import { describe, expect, it } from "vitest";
import { applyNativeTransformSnapping } from "../nativeSnap";
import type { Clip } from "@/types";

const clip = (id: string, x: number, y: number, width: number, height: number) =>
  ({ id, kind: "video", x, y, width, height } as Clip);

describe("native transform snapping", () => {
  it("snaps move geometry to canvas center and exposes guides", () => {
    const result = applyNativeTransformSnapping({
      geometry: { x: 456, y: 245, width: 100, height: 100, rotation: 0 },
      clip: clip("selected", 456, 245, 100, 100),
      activeClips: [],
      canvasWidth: 1000,
      canvasHeight: 600,
      scale: 1,
      handle: "move",
    });
    expect(result.geometry).toMatchObject({ x: 450, y: 250 });
    expect(result.guides).toMatchObject({ snappedX: true, snappedY: true, snapGuideX: 500, snapGuideY: 300 });
  });

  it("snaps to another clip edge without affecting resize handles", () => {
    const result = applyNativeTransformSnapping({
      geometry: { x: 198, y: 100, width: 80, height: 80, rotation: 0 },
      clip: clip("selected", 198, 100, 80, 80),
      activeClips: [clip("other", 300, 100, 100, 100)],
      canvasWidth: 1000,
      canvasHeight: 600,
      scale: 1,
      handle: "se",
    });
    expect(result.geometry.x).toBe(198);
    expect(result.guides).toBeNull();
  });
});
