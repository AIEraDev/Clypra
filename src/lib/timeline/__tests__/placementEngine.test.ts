import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimelinePlacementEngine } from "../placementEngine";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

describe("TimelinePlacementEngine", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-video-1", type: "video", name: "Video 1", locked: false, muted: false, visible: true, height: 48 },
        { id: "track-audio-1", type: "audio", name: "Audio 1", locked: false, muted: false, visible: true, height: 48 },
      ],
      clips: [],
      transitions: [],
      gaps: [],
    });

    useProjectStore.setState({
      project: {
        id: "proj-1",
        name: "Test Project",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
      } as any,
      mediaAssets: [
        {
          id: "asset-1",
          name: "Video 1.mp4",
          type: "video",
          path: "/path/video1.mp4",
          duration: 10.0,
          width: 1920,
          height: 1080,
          size: 1024,
        },
      ],
    });
  });

  it("adds media asset to timeline and places clip on target track", async () => {
    const res = await TimelinePlacementEngine.addToTimeline({
      item: { id: "asset-1" },
      type: "media",
    });

    expect(res.success).toBe(true);
    expect(res.clipId).toBeDefined();

    const clips = useTimelineStore.getState().clips;
    expect(clips.length).toBe(1);
    expect(clips[0].mediaId).toBe("asset-1");
    expect(clips[0].startTime).toBe(0);
    expect(clips[0].duration).toBe(10.0);
  });

  it("adds text clip and creates text track automatically", async () => {
    const res = await TimelinePlacementEngine.addToTimeline({
      item: { text: "Hello World", fontFamily: "Inter Variable", fontSize: 64 },
      type: "text",
    });

    expect(res.success).toBe(true);
    expect(res.clipId).toBeDefined();

    const tracks = useTimelineStore.getState().tracks;
    const textTrack = tracks.find((t) => t.type === "text");
    expect(textTrack).toBeDefined();

    const clips = useTimelineStore.getState().clips;
    const textClip = clips.find((c) => c.kind === "text");
    expect(textClip).toBeDefined();
    expect((textClip as any).text).toBe("Hello World");
  });

  it("handles in/out trimming points on addition", async () => {
    const res = await TimelinePlacementEngine.addToTimeline({
      item: { id: "asset-1" },
      type: "media",
      sourceInPoint: 2.0,
      sourceOutPoint: 7.0,
    });

    expect(res.success).toBe(true);
    const clip = useTimelineStore.getState().clips[0];
    expect(clip.trimIn).toBe(2.0);
    expect(clip.trimOut).toBe(7.0);
    expect(clip.duration).toBe(5.0);
  });

  it("serializes concurrent additions and avoids race conditions", async () => {
    // Fire 5 additions concurrently
    const promises = Array.from({ length: 5 }).map((_, i) =>
      TimelinePlacementEngine.addToTimeline({
        item: { text: `Clip ${i}` },
        type: "text",
        playheadTime: 0,
      }),
    );

    const results = await Promise.all(promises);
    expect(results.every((r) => r.success)).toBe(true);

    const timelineState = useTimelineStore.getState();
    const textClips = timelineState.clips.filter((c) => c.kind === "text");
    expect(textClips.length).toBe(5);

    // Verify each clip has a unique valid ID
    const clipIds = textClips.map((c) => c.id);
    expect(new Set(clipIds).size).toBe(5);

    // Verify all clips reference valid existing tracks
    const trackIds = new Set(timelineState.tracks.map((t) => t.id));
    for (const clip of textClips) {
      expect(trackIds.has(clip.trackId)).toBe(true);
    }
  });

  it("preserves styleId, effectDefinition, and styleSnapshot when adding a text effect", async () => {
    const mockScene = { effectLayers: [{ type: "gradient" }] };
    const mockDef = { id: "gradient-punch", name: "Gradient Punch", scene: mockScene };

    const res = await TimelinePlacementEngine.addToTimeline({
      item: {
        name: "Gradient Punch",
        text: "CLYPRA",
        presetType: "effect",
        styleId: "gradient-punch",
        styleSnapshot: mockScene,
        effectDefinition: mockDef,
      },
      type: "text",
    });

    expect(res.success).toBe(true);
    const clips = useTimelineStore.getState().clips;
    const clip = clips.find((c) => c.kind === "text") as any;
    expect(clip).toBeDefined();
    expect(clip.styleId).toBe("gradient-punch");
    expect(clip.styleSnapshot).toEqual(mockScene);
    expect(clip.styleDefinition).toEqual(mockDef);
    expect(clip.text).toBe("CLYPRA");
  });

  it("quantizes continuous playhead time to the frame start boundary so clips are visible immediately when paused", async () => {
    // Existing 10s video on timeline
    useTimelineStore.setState((s) => ({
      ...s,
      clips: [{ id: "c1", trackId: "track-video-1", startTime: 0, duration: 10.0, trimIn: 0, trimOut: 10.0, kind: "video" } as any],
    }));

    // Continuous hardware playback time paused at 6.002847s (which falls in frame 180 at 30fps: 180 / 30 = 6.0s)
    const res = await TimelinePlacementEngine.addToTimeline({
      item: { text: "Immediate Preview Text" },
      type: "text",
      playheadTime: 6.002847,
    });

    expect(res.success).toBe(true);
    const clips = useTimelineStore.getState().clips;
    const textClip = clips.find((c) => (c as any).text === "Immediate Preview Text");
    expect(textClip).toBeDefined();
    // Must be quantized exactly to frame 180 start (6.000000s), NOT 6.002847s
    expect(textClip!.startTime).toBe(6.0);
  });
});
