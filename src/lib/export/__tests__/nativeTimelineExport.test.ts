import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, Project, Track } from "@/types";
import { analyzeNativeTimelineExport } from "../nativeTimelineExport";

const project: Project = {
  id: "project-1",
  name: "Cut-only timeline",
  createdAt: 1,
  updatedAt: 1,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 9,
};

const tracks: Track[] = [
  {
    id: "text-track",
    type: "text",
    name: "Empty captions",
    muted: false,
    locked: false,
    visible: true,
    height: 30,
  },
  {
    id: "video-track",
    type: "video",
    name: "Video",
    muted: false,
    locked: false,
    visible: true,
    height: 68,
  },
];

const assets: MediaAsset[] = [
  {
    id: "main",
    name: "main.mov",
    path: "/media/main.mov",
    type: "video",
    duration: 100,
    width: 3024,
    height: 1964,
    size: 1,
  },
  {
    id: "ident",
    name: "ident.mp4",
    path: "/media/ident.mp4",
    type: "video",
    duration: 6,
    width: 1920,
    height: 1080,
    size: 1,
  },
];

function clip(overrides: Partial<Clip>): Clip {
  return {
    id: "clip",
    kind: "video",
    trackId: "video-track",
    mediaId: "main",
    startTime: 0,
    duration: 3,
    trimIn: 10,
    trimOut: 13,
    x: 0,
    y: -83.5,
    width: 1920,
    height: 1247,
    opacity: 1,
    rotation: 0,
    fitMode: "cover",
    ...overrides,
  };
}

describe("analyzeNativeTimelineExport", () => {
  it("builds a normalized native plan for sequential mixed-format cuts", () => {
    const result = analyzeNativeTimelineExport({
      clips: [
        clip({ id: "main-clip" }),
        clip({
          id: "ident-clip",
          mediaId: "ident",
          startTime: 3,
          duration: 6,
          trimIn: 0,
          trimOut: 6,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        }),
      ],
      tracks,
      transitions: [],
      assets,
      project,
      startTime: 0,
      endTime: 9,
      outputPath: "/output/movie.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
      codec: "h265",
      preset: "medium",
      crf: 20,
      pixelFormat: "yuv420p",
    });

    expect(result).toEqual({
      eligible: true,
      plan: {
        outputPath: "/output/movie.mp4",
        width: 3840,
        height: 2160,
        frameRate: 30,
        codec: "h265",
        preset: "medium",
        crf: 20,
        pixelFormat: "yuv420p",
        totalDuration: 9,
        clips: [
          {
            path: "/media/main.mov",
            trimIn: 10,
            duration: 3,
            frameCount: 90,
            x: 0,
            y: -167,
            width: 3840,
            height: 2494,
            volume: 1,
          },
          {
            path: "/media/ident.mp4",
            trimIn: 0,
            duration: 6,
            frameCount: 180,
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
            volume: 1,
          },
        ],
      },
    });
  });

  it("rejects compositor-only timelines with actionable reasons", () => {
    const result = analyzeNativeTimelineExport({
      clips: [
        clip({
          effects: [
            {
              id: "effect-1",
              effectId: "shake",
              type: "effect",
              renderer: "shake",
              params: {},
              startTime: 0,
              duration: 3,
              intensity: 1,
            },
          ],
        }),
      ],
      tracks,
      transitions: [],
      assets,
      project,
      startTime: 0,
      endTime: 3,
      outputPath: "/output/movie.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
      codec: "h265",
      preset: "medium",
      crf: 20,
      pixelFormat: "yuv420p",
    });

    expect(result).toEqual({
      eligible: false,
      reasons: ["Clip clip uses compositor-only visual settings"],
    });
  });
});
