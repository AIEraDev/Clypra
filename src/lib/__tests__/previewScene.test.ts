import { vi, describe, expect, it } from "vitest";
import { evaluateScene } from "@/core/evaluation/evaluator";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
}));

const tracks = [
  { id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 68 },
  { id: "t2", type: "video", name: "V2", muted: false, locked: false, visible: true, height: 68 },
];

const assets = [
  { id: "m1", name: "one", path: "/one.mp4", type: "video", duration: 20, size: 1, posterFrame: "/one.jpg", width: 1920, height: 1080 },
  { id: "m2", name: "two", path: "/two.png", type: "image", duration: 0, size: 1, posterFrame: "/two.png", width: 1920, height: 1080 },
];

describe("evaluateScene (canonical evaluator)", () => {
  it("resolves only active clips at time", () => {
    const scene = evaluateScene(
      5, // time
      [
        { id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 2, trimOut: 12, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t2", mediaId: "m2", startTime: 11, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 50, height: 50, opacity: 80, rotation: 0 },
      ] as any,
      tracks as any,
      assets as any,
      null,
    );
    expect(scene.visualLayers).toHaveLength(1);
    expect(scene.visualLayers[0].clipId).toBe("c1");
    const layer = scene.visualLayers[0];
    if (layer.layerType === "media") {
      expect(layer.sourceTime).toBe(7); // trimIn (2) + (time (5) - startTime (0))
    }
  });

  it("filters invisible tracks and sorts by track order", () => {
    const scene = evaluateScene(
      1, // time
      [
        { id: "c1", trackId: "t2", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t1", mediaId: "m2", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
      ] as any,
      [tracks[0], { ...tracks[1], visible: false }] as any,
      assets as any,
      null,
    );
    expect(scene.visualLayers).toHaveLength(1);
    expect(scene.visualLayers[0].clipId).toBe("c2"); // Only t1 is visible
  });

  it("returns metadata with canvas dimensions and gap detection", () => {
    const scene = evaluateScene(0, [], tracks as any, assets as any, { canvasWidth: 1920, canvasHeight: 1080, frameRate: 30 } as any);
    expect(scene.metadata.canvasWidth).toBe(1920);
    expect(scene.metadata.canvasHeight).toBe(1080);
    expect(scene.metadata.frameRate).toBe(30);
    expect(scene.metadata.isGap).toBe(true); // No clips
    expect(scene.metadata.fallbackStrategy).toBe("black");
  });

  it("sorts layers by compositing order (role → track → zIndex)", () => {
    const scene = evaluateScene(
      1,
      [
        { id: "c1", trackId: "t2", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t1", mediaId: "m2", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
      ] as any,
      tracks as any,
      assets as any,
      null,
    );
    // Should be sorted by track index (inverted: higher index renders below)
    // t2 (index 1) renders below t1 (index 0), so t1 appears on top
    expect(scene.visualLayers).toHaveLength(2);
    expect(scene.visualLayers[0].clipId).toBe("c1"); // t2 (index 1) - background
    expect(scene.visualLayers[1].clipId).toBe("c2"); // t1 (index 0) - foreground (top track)
  });
});
