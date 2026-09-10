import { beforeEach, describe, expect, it, vi } from "vitest";
import { timelineCommands } from "../timelineCommands";
import type { TimelineCommandContext } from "../types";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, Track } from "@/types";

vi.mock("@/lib/toast", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({ time: 0 }),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const trackA: Track = {
  id: "track-a",
  type: "video",
  name: "Video A",
  muted: false,
  locked: false,
  visible: true,
  height: 68,
};

const trackB: Track = {
  id: "track-b",
  type: "audio",
  name: "Audio B",
  muted: false,
  locked: false,
  visible: true,
  height: 52,
};

const trackLocked: Track = {
  id: "track-locked",
  type: "video",
  name: "Video Locked",
  muted: false,
  locked: true,
  visible: true,
  height: 68,
};

const makeClip = (id: string, trackId: string, startTime = 0): Clip =>
  ({
    id,
    trackId,
    mediaId: "asset-1",
    startTime,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    volume: 1.0,
  }) as Clip;

const clipA1 = makeClip("clip-a1", "track-a", 0);
const clipA2 = makeClip("clip-a2", "track-a", 6);
const clipB1 = makeClip("clip-b1", "track-b", 0);
const clipLocked = makeClip("clip-locked", "track-locked", 0);

function resetStores(clips: Clip[] = [clipA1, clipA2, clipB1, clipLocked]) {
  useTimelineStore.setState({
    tracks: [trackA, trackB, trackLocked],
    clips,
    gaps: [],
    transitions: [],
    mainVideoTrackId: "track-a",
    epoch: 0,
    zoomLevel: 1,
    scrollLeft: 0,
    viewportWidth: 1200,
    pixelsPerSecond: 100,
    rippleEditEnabled: false,
    snapEnabled: true,
    snapGuides: [],
  });
  useUIStore.setState({
    selectedClipIds: [],
    selectedGapId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
  });
}

function makeCtx(
  trackId: string | null,
  overrides: Partial<TimelineCommandContext> = {},
): TimelineCommandContext {
  const state = useTimelineStore.getState();
  return {
    clickedTrackId: trackId,
    clickedTime: 0,
    playheadTime: 0,
    tracks: state.tracks,
    clips: state.clips,
    hasClipboard: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectAllClipsInTrack (uiStore method)
// ---------------------------------------------------------------------------

describe("uiStore.selectAllClipsInTrack", () => {
  beforeEach(() => resetStores());

  it("sets selectedClipIds to all clips on the target track", () => {
    useUIStore.getState().selectAllClipsInTrack("track-a");
    const { selectedClipIds } = useUIStore.getState();
    expect(selectedClipIds).toHaveLength(2);
    expect(selectedClipIds).toContain("clip-a1");
    expect(selectedClipIds).toContain("clip-a2");
  });

  it("does not include clips from other tracks", () => {
    useUIStore.getState().selectAllClipsInTrack("track-a");
    const { selectedClipIds } = useUIStore.getState();
    expect(selectedClipIds).not.toContain("clip-b1");
    expect(selectedClipIds).not.toContain("clip-locked");
  });

  it("selects exactly the one clip when a track has a single clip", () => {
    useUIStore.getState().selectAllClipsInTrack("track-b");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-b1"]);
  });

  it("results in an empty selection when the track has no clips", () => {
    // Remove all clips from track-a
    resetStores([clipB1, clipLocked]);
    useUIStore.getState().selectAllClipsInTrack("track-a");
    expect(useUIStore.getState().selectedClipIds).toEqual([]);
  });

  it("clears selectedGapId after selecting", () => {
    useUIStore.setState({ selectedGapId: "gap-1" });
    useUIStore.getState().selectAllClipsInTrack("track-a");
    expect(useUIStore.getState().selectedGapId).toBeNull();
  });

  it("clears selectedTransitionId after selecting", () => {
    useUIStore.setState({ selectedTransitionId: "trans-1" });
    useUIStore.getState().selectAllClipsInTrack("track-a");
    expect(useUIStore.getState().selectedTransitionId).toBeNull();
  });

  it("replaces an existing multi-track selection", () => {
    useUIStore.setState({ selectedClipIds: ["clip-b1", "clip-a1"] });
    useUIStore.getState().selectAllClipsInTrack("track-b");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-b1"]);
  });
});

// ---------------------------------------------------------------------------
// track.selectAllClips command
// ---------------------------------------------------------------------------

describe("timelineCommands: track.selectAllClips", () => {
  const cmd = timelineCommands.find((c) => c.id === "track.selectAllClips")!;

  beforeEach(() => resetStores());

  it("is defined in the registry", () => {
    expect(cmd).toBeDefined();
  });

  it("is visible when clickedTrackId is set", () => {
    expect(cmd.isVisible(makeCtx("track-a"))).toBe(true);
  });

  it("is not visible when clickedTrackId is null", () => {
    expect(cmd.isVisible(makeCtx(null))).toBe(false);
  });

  it("is enabled when the track has clips", () => {
    expect(cmd.isEnabled(makeCtx("track-a"))).toBe(true);
  });

  it("is disabled when the track has no clips", () => {
    resetStores([clipB1, clipLocked]); // track-a is now empty
    expect(cmd.isEnabled(makeCtx("track-a"))).toBe(false);
  });

  it("provides the correct disabledReason for an empty track", () => {
    resetStores([clipB1, clipLocked]);
    expect(cmd.disabledReason?.(makeCtx("track-a"))).toBe("Track has no clips");
  });

  it("is enabled on a locked track — selection is read-only", () => {
    expect(cmd.isEnabled(makeCtx("track-locked"))).toBe(true);
  });

  it("execute selects all clips on the track", () => {
    cmd.execute(makeCtx("track-a"));
    const { selectedClipIds } = useUIStore.getState();
    expect(selectedClipIds).toContain("clip-a1");
    expect(selectedClipIds).toContain("clip-a2");
    expect(selectedClipIds).toHaveLength(2);
  });

  it("execute does not affect clips on other tracks", () => {
    cmd.execute(makeCtx("track-a"));
    expect(useUIStore.getState().selectedClipIds).not.toContain("clip-b1");
  });
});

// ---------------------------------------------------------------------------
// track.deleteAllClips command
// ---------------------------------------------------------------------------

describe("timelineCommands: track.deleteAllClips", () => {
  const cmd = timelineCommands.find((c) => c.id === "track.deleteAllClips")!;

  beforeEach(() => resetStores());

  it("is defined in the registry", () => {
    expect(cmd).toBeDefined();
  });

  it("is visible when clickedTrackId is set", () => {
    expect(cmd.isVisible(makeCtx("track-a"))).toBe(true);
  });

  it("is not visible when clickedTrackId is null", () => {
    expect(cmd.isVisible(makeCtx(null))).toBe(false);
  });

  it("is enabled on an unlocked non-empty track", () => {
    expect(cmd.isEnabled(makeCtx("track-a"))).toBe(true);
  });

  it("is disabled on a locked track", () => {
    expect(cmd.isEnabled(makeCtx("track-locked"))).toBe(false);
  });

  it("provides disabledReason 'Track is locked' for locked tracks", () => {
    expect(cmd.disabledReason?.(makeCtx("track-locked"))).toBe("Track is locked");
  });

  it("is disabled when the track has no clips", () => {
    resetStores([clipB1, clipLocked]); // track-a is now empty
    expect(cmd.isEnabled(makeCtx("track-a"))).toBe(false);
  });

  it("provides disabledReason 'Track has no clips' for an empty track", () => {
    resetStores([clipB1, clipLocked]);
    expect(cmd.disabledReason?.(makeCtx("track-a"))).toBe("Track has no clips");
  });

  it("marks the command as danger", () => {
    expect(cmd.danger).toBe(true);
  });

  it("execute removes all clips from the target track", () => {
    cmd.execute(makeCtx("track-a"));
    const remaining = useTimelineStore.getState().clips.filter(
      (c) => c.trackId === "track-a",
    );
    expect(remaining).toHaveLength(0);
  });

  it("execute does not remove clips from other tracks", () => {
    cmd.execute(makeCtx("track-a"));
    const { clips } = useTimelineStore.getState();
    expect(clips.some((c) => c.id === "clip-b1")).toBe(true);
  });

  it("execute does not touch clips on the locked track", () => {
    cmd.execute(makeCtx("track-a"));
    const { clips } = useTimelineStore.getState();
    expect(clips.some((c) => c.id === "clip-locked")).toBe(true);
  });

  it("execute clears selectedClipIds after deletion", () => {
    useUIStore.setState({ selectedClipIds: ["clip-a1", "clip-a2"] });
    cmd.execute(makeCtx("track-a"));
    expect(useUIStore.getState().selectedClipIds).toHaveLength(0);
  });

  it("does nothing when execute is called but the track is empty", () => {
    resetStores([clipB1, clipLocked]);
    const before = useTimelineStore.getState().clips.length;
    // isEnabled is false, but call execute directly to verify guard
    cmd.execute(makeCtx("track-a"));
    expect(useTimelineStore.getState().clips.length).toBe(before);
  });
});
