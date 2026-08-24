import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../timelineStore";

describe("Timeline Store - Locked Track Mute", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        {
          id: "unlocked-track",
          type: "video",
          name: "Unlocked",
          muted: false,
          locked: false,
          visible: true,
          height: 68,
        },
        {
          id: "locked-track",
          type: "video",
          name: "Locked",
          muted: false,
          locked: true,
          visible: true,
          height: 68,
        },
      ],
      clips: [],
      transitions: [],
      gaps: [],
      epoch: 0,
    } as any);
  });

  it("does not change mute state or epoch on a locked track", () => {
    const store = useTimelineStore.getState();

    store.toggleTrackMute("locked-track");

    const lockedTrack = useTimelineStore.getState().tracks.find((track) => track.id === "locked-track")!;
    expect(lockedTrack.muted).toBe(false);
    expect(useTimelineStore.getState().epoch).toBe(0);
  });

  it("still toggles mute on an unlocked track", () => {
    useTimelineStore.getState().toggleTrackMute("unlocked-track");

    expect(useTimelineStore.getState().tracks.find((track) => track.id === "unlocked-track")?.muted).toBe(true);
    expect(useTimelineStore.getState().epoch).toBe(1);
  });
});
