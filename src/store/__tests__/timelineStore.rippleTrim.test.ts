import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../timelineStore";

const trackId = "track-ripple-trim";

describe("Timeline Store - Ripple Trim", () => {
  beforeEach(() => {
    useTimelineStore.getState().hydrateFromProject({
      tracks: [
        {
          id: trackId,
          type: "video",
          name: "Video 1",
          height: 68,
          visible: true,
          muted: false,
          locked: false,
        },
      ],
      clips: [
        {
          id: "clip-a",
          trackId,
          mediaId: "media-a",
          startTime: 0,
          duration: 10,
          trimIn: 0,
          trimOut: 10,
        },
        {
          id: "clip-b",
          trackId,
          mediaId: "media-b",
          startTime: 10,
          duration: 5,
          trimIn: 0,
          trimOut: 5,
        },
      ],
      transitions: [],
      gaps: [],
    } as any);
  });

  it("keeps the timeline anchored when ripple-trimming the left edge", () => {
    const store = useTimelineStore.getState();
    store.rippleTrimClip("clip-a", "left", 2);
    useTimelineStore.getState().detectAndSyncGaps(trackId);

    const { clips, gaps } = useTimelineStore.getState();
    const clipA = clips.find((clip) => clip.id === "clip-a")!;
    const clipB = clips.find((clip) => clip.id === "clip-b")!;

    expect(clipA).toMatchObject({
      startTime: 0,
      duration: 8,
      trimIn: 2,
      trimOut: 10,
    });
    expect(clipB.startTime).toBe(8);
    expect(gaps.filter((gap) => gap.trackId === trackId)).toHaveLength(0);
  });
});
