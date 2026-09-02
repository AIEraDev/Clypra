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
});
