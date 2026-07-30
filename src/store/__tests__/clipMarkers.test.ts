import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import type { Clip } from "@/types";

describe("Clip-Level Markers & Timeline Marker Navigation", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [{ id: "track-v1", type: "video", name: "Main Video", muted: false, locked: false, visible: true, height: 68 }],
      clips: [
        {
          id: "clip-1",
          kind: "video",
          trackId: "track-v1",
          mediaId: "m1",
          startTime: 10,
          duration: 10,
          trimIn: 0,
          trimOut: 10,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
          markers: [],
        } as Clip,
      ],
      markers: [{ id: "ruler-m1", time: 5, name: "Intro", color: "purple" }],
    });
  });

  it("adds and removes clip markers successfully", () => {
    const store = useTimelineStore.getState();
    const markerId = store.addClipMarker("clip-1", 2.5, "Verse Start", "amber");

    let updatedClip = useTimelineStore.getState().clips.find((c) => c.id === "clip-1");
    expect(updatedClip?.markers).toHaveLength(1);
    expect(updatedClip?.markers?.[0].name).toBe("Verse Start");
    expect(updatedClip?.markers?.[0].localTime).toBe(2.5);

    useTimelineStore.getState().removeClipMarker("clip-1", markerId);
    updatedClip = useTimelineStore.getState().clips.find((c) => c.id === "clip-1");
    expect(updatedClip?.markers).toHaveLength(0);
  });

  it("sorts clip markers chronologically by local time", () => {
    const store = useTimelineStore.getState();
    store.addClipMarker("clip-1", 5.0, "Outro", "red");
    store.addClipMarker("clip-1", 1.2, "Intro Beat", "green");
    store.addClipMarker("clip-1", 3.4, "Solo", "cyan");

    const updatedClip = useTimelineStore.getState().clips.find((c) => c.id === "clip-1");
    expect(updatedClip?.markers?.map((m) => m.localTime)).toEqual([1.2, 3.4, 5.0]);
  });
});
