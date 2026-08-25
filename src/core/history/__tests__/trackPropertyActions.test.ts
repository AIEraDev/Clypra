import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryStore } from "@/store/historyStore";
import { useTimelineStore } from "@/store/timelineStore";
import { toggleTrackPropertyWithHistory } from "../trackPropertyActions";

describe("track property history actions", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useTimelineStore.setState({
      tracks: [{
        id: "audio-1",
        type: "audio",
        name: "Audio 1",
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        height: 60,
      }],
      clips: [],
      gaps: [],
      transitions: [],
      mainVideoTrackId: null,
      epoch: 0,
    });
  });

  it("uses the command journal for mute and supports undo", () => {
    expect(toggleTrackPropertyWithHistory("audio-1", "muted")).toBe(true);
    expect(useTimelineStore.getState().tracks[0].muted).toBe(true);
    expect(useHistoryStore.getState().state.canUndo).toBe(true);

    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().tracks[0].muted).toBe(false);
  });

  it("preserves the locked-track guard for audio contribution changes", () => {
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((track) => ({ ...track, locked: true })),
    }));

    expect(toggleTrackPropertyWithHistory("audio-1", "solo")).toBe(false);
    expect(useTimelineStore.getState().tracks[0].solo).toBe(false);
    expect(useHistoryStore.getState().state.canUndo).toBe(false);
  });
});
