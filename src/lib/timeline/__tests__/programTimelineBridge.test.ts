import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@/types";
import {
  clampAndSnapProgramTime,
  getActiveProgramBridgeClips,
  getActiveVisualProgramClip,
} from "../programTimelineBridge";

const makeClip = (overrides: Partial<Clip>): Clip =>
  ({
    id: "clip",
    kind: "video",
    trackId: "video-1",
    mediaId: "asset",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    opacity: 1,
    rotation: 0,
    ...overrides,
  }) as Clip;

const tracks: Track[] = [
  { id: "overlay", type: "video", name: "Overlay", muted: false, locked: false, visible: true, height: 80 },
  { id: "video-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 },
  { id: "audio-1", type: "audio", name: "Audio", muted: false, locked: false, visible: true, height: 52 },
];

describe("program timeline bridge helpers", () => {
  it("clamps and snaps user seeks to the project frame grid", () => {
    expect(clampAndSnapProgramTime(1.04, 10, 30)).toBeCloseTo(1.0333333333);
    expect(clampAndSnapProgramTime(-2, 10, 30)).toBe(0);
    expect(clampAndSnapProgramTime(99, 10, 30)).toBe(10);
    expect(clampAndSnapProgramTime(Number.NaN, 10, 30)).toBe(0);
  });

  it("includes visual and audio clips but excludes overlay content", () => {
    const clips = [
      makeClip({ id: "video", kind: "video" }),
      makeClip({ id: "audio", kind: "audio", trackId: "audio-1" }),
      makeClip({ id: "text", kind: "text" as Clip["kind"] }),
    ];

    expect(getActiveProgramBridgeClips(clips, 1).map((clip) => clip.id)).toEqual([
      "video",
      "audio",
    ]);
  });

  it("returns the topmost visible visual clip and ignores audio", () => {
    const clips = [
      makeClip({ id: "main", trackId: "video-1" }),
      makeClip({ id: "overlay", trackId: "overlay" }),
      makeClip({ id: "audio", kind: "audio", trackId: "audio-1" }),
    ];

    expect(getActiveVisualProgramClip(clips, tracks, 1)?.id).toBe("overlay");
  });
});

