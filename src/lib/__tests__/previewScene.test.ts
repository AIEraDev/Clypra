import {vi, describe, expect, it } from "vitest";
import { resolvePreviewScene } from "../previewScene";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
}));

const tracks = [
  { id: "t1", type: "video", name: "V1", muted: false, locked: false, visible: true, height: 68 },
  { id: "t2", type: "video", name: "V2", muted: false, locked: false, visible: true, height: 68 },
];

const assets = [
  { id: "m1", name: "one", path: "/one.mp4", type: "video", duration: 20, size: 1, posterFrame: "/one.jpg" },
  { id: "m2", name: "two", path: "/two.png", type: "image", duration: 0, size: 1, posterFrame: "/two.png" },
];

describe("resolvePreviewScene", () => {
  it("resolves only active clips at time", () => {
    const scene = resolvePreviewScene({
      tracks: tracks as any,
      clips: [
        { id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 10, trimIn: 2, trimOut: 12, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t2", mediaId: "m2", startTime: 11, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 50, height: 50, opacity: 80, rotation: 0 },
      ] as any,
      assets: assets as any,
      time: 5,
      project: null,
    });
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0].clipId).toBe("c1");
    expect(scene.layers[0].sourceTime).toBe(7);
  });

  it("filters invisible tracks and sorts by track order", () => {
    const scene = resolvePreviewScene({
      tracks: [
        tracks[0],
        { ...tracks[1], visible: false },
      ] as any,
      clips: [
        { id: "c1", trackId: "t2", mediaId: "m1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
        { id: "c2", trackId: "t1", mediaId: "m2", startTime: 0, duration: 10, trimIn: 0, trimOut: 10, x: 0, y: 0, width: 100, height: 100, opacity: 100, rotation: 0 },
      ] as any,
      assets: assets as any,
      time: 1,
      project: null,
    });
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0].clipId).toBe("c2");
  });
});

