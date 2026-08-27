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
  {
    id: "audio",
    name: "voiceover.mp3",
    path: "/media/voiceover.mp3",
    type: "audio",
    duration: 9,
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

  it("routes standalone timeline audio to the audio-mix export path", () => {
    const result = analyzeNativeTimelineExport({
      clips: [
        clip({ id: "video-clip" }),
        {
          ...clip({
            id: "audio-clip",
            kind: "audio",
            trackId: "audio-track",
            mediaId: "audio",
          }),
        },
      ],
      tracks: [
        ...tracks,
        {
          id: "audio-track",
          type: "audio",
          name: "Audio",
          muted: false,
          locked: false,
          visible: true,
          height: 70,
        },
      ],
      transitions: [],
      assets,
      project,
      startTime: 0,
      endTime: 3,
      outputPath: "/output/movie.mp4",
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      preset: "fast",
      crf: 23,
      pixelFormat: "yuv420p",
    });

    expect(result).toEqual({
      eligible: false,
      reasons: ["Standalone timeline audio requires the audio-mix export path"],
    });
  });

  it("routes active text overlays to the compositor instead of dropping them", () => {
    const result = analyzeNativeTimelineExport({
      clips: [
        clip({ id: "video-clip" }),
        {
          ...clip({
            id: "title-clip",
            kind: "text",
            trackId: "text-track",
            mediaId: "text-title",
          }),
        },
      ],
      tracks,
      transitions: [],
      assets,
      project,
      startTime: 0,
      endTime: 3,
      outputPath: "/output/movie.mp4",
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      preset: "fast",
      crf: 23,
      pixelFormat: "yuv420p",
    });

    expect(result).toEqual({
      eligible: false,
      reasons: ["Text clips require compositor export"],
    });
  });

  it("expands a compound into its visual children before building the native plan", () => {
    const compound: Clip = {
      ...clip({ id: "compound-1", mediaId: "compound-compound-1", startTime: 0, duration: 9, trimIn: 0, trimOut: 9 }),
      kind: "compound",
      compoundChildren: [
        clip({ id: "child-a", startTime: 0, duration: 3, trimIn: 10, trimOut: 13 }),
        clip({ id: "child-b", startTime: 3, duration: 6, trimIn: 0, trimOut: 6, mediaId: "ident" }),
      ],
    };

    const result = analyzeNativeTimelineExport({
      clips: [compound],
      tracks,
      transitions: [],
      assets,
      project,
      startTime: 0,
      endTime: 9,
      outputPath: "/output/compound.mp4",
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      preset: "fast",
      crf: 23,
      pixelFormat: "yuv420p",
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.plan.clips.map((planned) => [planned.path, planned.trimIn, planned.duration])).toEqual([
      ["/media/main.mov", 10, 3],
      ["/media/ident.mp4", 0, 6],
    ]);
  });
});
