import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../timelineStore";
import { useUIStore } from "../uiStore";

describe("Timeline Store - Cross-Track Swap", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-a", type: "video", name: "A", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-b", type: "video", name: "B", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [
        { id: "clip-a", trackId: "track-a", mediaId: "a", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 },
        { id: "clip-b", trackId: "track-b", mediaId: "b", startTime: 0, duration: 20, trimIn: 0, trimOut: 20 },
        { id: "neighbor-a", trackId: "track-a", mediaId: "neighbor-a", startTime: 10, duration: 5, trimIn: 0, trimOut: 5 },
        { id: "neighbor-b", trackId: "track-b", mediaId: "neighbor-b", startTime: 20, duration: 5, trimIn: 0, trimOut: 5 },
      ],
      transitions: [],
      gaps: [],
      epoch: 0,
    } as any);
    useUIStore.setState({ selectedClipIds: ["clip-a", "clip-b"] });
  });

  it("rejects a cross-track swap that would overlap a neighbor", () => {
    const result = useTimelineStore.getState().swapClips();

    expect(result.error).toContain("overlap");
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.trackId, clip.startTime])).toEqual([
      ["clip-a", "track-a", 0],
      ["clip-b", "track-b", 0],
      ["neighbor-a", "track-a", 10],
      ["neighbor-b", "track-b", 20],
    ]);
    expect(useTimelineStore.getState().epoch).toBe(0);
  });
});
