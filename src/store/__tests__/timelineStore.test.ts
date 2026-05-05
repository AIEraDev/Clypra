import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../timelineStore";
import type { Clip } from "../../types";

describe("timelineStore track controls", () => {
  const makeClip = (overrides: Partial<Clip> = {}): Clip => ({
    id: "clip-1",
    trackId: "track-1",
    mediaId: "asset-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
    });
  });

  it("creates tracks with visible=true, muted=false, locked=false defaults", () => {
    useTimelineStore.getState().addTrack("video");
    const track = useTimelineStore.getState().tracks[0];

    expect(track).toBeTruthy();
    expect(track.visible).toBe(true);
    expect(track.muted).toBe(false);
    expect(track.locked).toBe(false);
  });

  it("toggles lock/mute/visibility only for the target track", () => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 52 },
      ],
    });
    const [first, second] = useTimelineStore.getState().tracks;

    useTimelineStore.getState().toggleTrackLock(first.id);
    useTimelineStore.getState().toggleTrackMute(first.id);
    useTimelineStore.getState().toggleTrackVisibility(first.id);

    const nextTracks = useTimelineStore.getState().tracks;
    const updatedFirst = nextTracks.find((t) => t.id === first.id)!;
    const untouchedSecond = nextTracks.find((t) => t.id === second.id)!;

    expect(updatedFirst.locked).toBe(true);
    expect(updatedFirst.muted).toBe(true);
    expect(updatedFirst.visible).toBe(false);

    expect(untouchedSecond.locked).toBe(false);
    expect(untouchedSecond.muted).toBe(false);
    expect(untouchedSecond.visible).toBe(true);
  });

  it("removes a track and its clips", () => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 52 },
      ],
      clips: [makeClip({ id: "clip-a", trackId: "track-1" }), makeClip({ id: "clip-b", trackId: "track-2" })],
    });

    useTimelineStore.getState().removeTrack("track-1");
    const state = useTimelineStore.getState();

    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].id).toBe("track-2");
    expect(state.clips).toHaveLength(1);
    expect(state.clips[0].trackId).toBe("track-2");
  });

  it("adds, updates, moves, and removes clips", () => {
    const clip = makeClip();

    useTimelineStore.getState().addClip(clip);
    expect(useTimelineStore.getState().clips).toHaveLength(1);

    useTimelineStore.getState().updateClip("clip-1", { opacity: 0.5, duration: 12 });
    expect(useTimelineStore.getState().clips[0].opacity).toBe(0.5);
    expect(useTimelineStore.getState().clips[0].duration).toBe(12);

    useTimelineStore.getState().moveClip("clip-1", 7.5);
    expect(useTimelineStore.getState().clips[0].startTime).toBe(7.5);

    useTimelineStore.getState().removeClip("clip-1");
    expect(useTimelineStore.getState().clips).toHaveLength(0);
  });

  it("splits a clip and updates trim/duration correctly", () => {
    useTimelineStore.setState({
      clips: [makeClip({ id: "clip-split", startTime: 5, duration: 10, trimIn: 2, trimOut: 12 })],
    });

    useTimelineStore.getState().splitClipAtTime("clip-split", 9);
    const clips = useTimelineStore.getState().clips;
    const original = clips.find((c) => c.id === "clip-split");
    const created = clips.find((c) => c.id !== "clip-split");

    expect(clips).toHaveLength(2);
    expect(original).toBeTruthy();
    expect(created).toBeTruthy();
    expect(original?.duration).toBe(4);
    expect(original?.trimOut).toBe(6);
    expect(created?.startTime).toBe(9);
    expect(created?.duration).toBe(6);
    expect(created?.trimIn).toBe(6);
  });

  it("does not split when clip is missing or split point is out of bounds", () => {
    useTimelineStore.setState({
      clips: [makeClip({ id: "clip-guard", startTime: 10, duration: 5, trimIn: 0, trimOut: 5 })],
    });

    useTimelineStore.getState().splitClipAtTime("nope", 12);
    expect(useTimelineStore.getState().clips).toHaveLength(1);

    useTimelineStore.getState().splitClipAtTime("clip-guard", 10);
    useTimelineStore.getState().splitClipAtTime("clip-guard", 15);
    expect(useTimelineStore.getState().clips).toHaveLength(1);
  });

  it("computes timeline end time from clip bounds", () => {
    useTimelineStore.setState({
      clips: [makeClip({ id: "clip-1", startTime: 0, duration: 3 }), makeClip({ id: "clip-2", startTime: 5, duration: 11 }), makeClip({ id: "clip-3", startTime: 4, duration: 2 })],
    });

    expect(useTimelineStore.getState().getTimelineEndTime()).toBe(16);
  });

  it("setPixelsPerSecond clamps to 50–500 and sets zoomLevel to pps / 100", () => {
    useTimelineStore.getState().setPixelsPerSecond(999);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(500);
    expect(useTimelineStore.getState().zoomLevel).toBe(5);

    useTimelineStore.getState().setPixelsPerSecond(10);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(50);
    expect(useTimelineStore.getState().zoomLevel).toBe(0.5);

    useTimelineStore.getState().setPixelsPerSecond(175);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(175);
    expect(useTimelineStore.getState().zoomLevel).toBe(1.75);
  });

  it("setZoom uses the same bounds via setPixelsPerSecond", () => {
    useTimelineStore.getState().setZoom(10);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(500);
    expect(useTimelineStore.getState().zoomLevel).toBe(5);
  });
});
