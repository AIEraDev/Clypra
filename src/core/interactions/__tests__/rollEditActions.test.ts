import { beforeEach, describe, expect, it } from "vitest";
import { EditingActions } from "../EditingActions";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, MediaAsset, Project } from "@/types";

const testProject: Project = {
  id: "project-roll-edit",
  name: "Roll Edit Test Project",
  createdAt: 0,
  updatedAt: 0,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 60,
};

const makeAsset = (id: string, duration: number): MediaAsset => ({
  id,
  name: `${id}.mp4`,
  path: `/media/${id}.mp4`,
  type: "video",
  duration,
  size: 1024 * 1024,
});

const makeClip = (id: string, overrides: Partial<Clip> = {}): Clip => ({
  id,
  trackId: "track-1",
  mediaId: "media-1",
  name: id,
  startTime: 0,
  duration: 10,
  trimIn: 2,
  trimOut: 12,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
  ...overrides,
});

describe("EditingActions Roll Edit operations", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useProjectStore.setState({
      project: testProject,
      mediaAssets: [
        makeAsset("media-1", 30),
        makeAsset("media-2", 30),
      ],
    });
    useUIStore.setState({
      selectedClipIds: [],
      selectedGapId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
    });
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "video", name: "Video 2", muted: false, locked: true, visible: true, height: 68 },
      ],
      clips: [],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
  });

  describe("rollEdit", () => {
    it("rolls cut point right: expands outgoing clip A, contracts incoming clip B", () => {
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 10, duration: 10, trimIn: 2, trimOut: 12 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const delta = 2.5; // Roll cut 2.5s to the right
      const result = EditingActions.rollEdit("cA", "cB", delta);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(2.5, 5);

      const [updatedA, updatedB] = useTimelineStore.getState().clips;

      // clipA duration expands to 12.5s, trimOut becomes 12.5s
      expect(updatedA.startTime).toBe(0);
      expect(updatedA.duration).toBeCloseTo(12.5, 5);
      expect(updatedA.trimOut).toBeCloseTo(12.5, 5);

      // clipB startTime shifts to 12.5s, duration contracts to 7.5s, trimIn becomes 4.5s
      expect(updatedB.startTime).toBeCloseTo(12.5, 5);
      expect(updatedB.duration).toBeCloseTo(7.5, 5);
      expect(updatedB.trimIn).toBeCloseTo(4.5, 5);
      expect(updatedB.trimOut).toBe(12); // Source media end untouched

      // Overall sequence span remains exactly 0 to 20s
      expect(updatedB.startTime + updatedB.duration).toBeCloseTo(20, 5);
    });

    it("rolls cut point left: contracts outgoing clip A, expands incoming clip B", () => {
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 10, duration: 10, trimIn: 3, trimOut: 13 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const delta = -2.0; // Roll cut 2s to the left
      const result = EditingActions.rollEdit("cA", "cB", delta);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(-2.0, 5);

      const [updatedA, updatedB] = useTimelineStore.getState().clips;

      // clipA duration contracts to 8s, trimOut becomes 8s
      expect(updatedA.startTime).toBe(0);
      expect(updatedA.duration).toBeCloseTo(8, 5);
      expect(updatedA.trimOut).toBeCloseTo(8, 5);

      // clipB starts at 8s, duration expands to 12s, trimIn moves earlier to 1s
      expect(updatedB.startTime).toBeCloseTo(8, 5);
      expect(updatedB.duration).toBeCloseTo(12, 5);
      expect(updatedB.trimIn).toBeCloseTo(1, 5);
      expect(updatedB.trimOut).toBe(13);

      expect(updatedB.startTime + updatedB.duration).toBeCloseTo(20, 5);
    });

    it("enforces minimum clip duration on outgoing clip A", () => {
      const minDuration = 1 / testProject.frameRate;
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 2, trimIn: 0, trimOut: 2 });
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 2, duration: 10, trimIn: 5, trimOut: 15 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const maxRollLeft = -(2 - minDuration);
      const result = EditingActions.rollEdit("cA", "cB", -10); // Attempt huge roll left
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(maxRollLeft, 5);

      const updatedA = useTimelineStore.getState().clips.find((c) => c.id === "cA")!;
      expect(updatedA.duration).toBeCloseTo(minDuration, 5);
    });

    it("enforces minimum clip duration on incoming clip B", () => {
      const minDuration = 1 / testProject.frameRate;
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 10, duration: 2, trimIn: 0, trimOut: 2 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const maxRollRight = 2 - minDuration;
      const result = EditingActions.rollEdit("cA", "cB", 10); // Attempt huge roll right
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(maxRollRight, 5);

      const updatedB = useTimelineStore.getState().clips.find((c) => c.id === "cB")!;
      expect(updatedB.duration).toBeCloseTo(minDuration, 5);
    });

    it("enforces media bounds for both clips", () => {
      // media-1 duration is 30, clipA has trimOut: 28 -> max growth is +2s
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 18, trimOut: 28 });
      // clipB has trimIn: 1 -> can only move left by at most 1s before reaching media start
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 10, duration: 10, trimIn: 1, trimOut: 11 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      // Rolling right is capped by clipA remaining media head (2s)
      const rollRight = EditingActions.rollEdit("cA", "cB", 5);
      expect(rollRight.success).toBe(true);
      expect(rollRight.deltaApplied).toBeCloseTo(2, 5);

      useHistoryStore.getState().undo();

      // Rolling left is capped by clipB trimIn >= 0 (1s)
      const rollLeft = EditingActions.rollEdit("cA", "cB", -5);
      expect(rollLeft.success).toBe(true);
      expect(rollLeft.deltaApplied).toBeCloseTo(-1, 5);
    });

    it("rejects non-touching clips (separated by gap)", () => {
      const clipA = makeClip("cA", { startTime: 0, duration: 5 });
      const clipB = makeClip("cB", { startTime: 8, duration: 5 }); // 3s gap
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const result = EditingActions.rollEdit("cA", "cB", 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Clips must share an adjacent cut point");
    });

    it("rejects clips on locked tracks or different tracks", () => {
      const clipA = makeClip("cA", { trackId: "track-1", startTime: 0, duration: 5 });
      const clipB = makeClip("cB", { trackId: "track-2", startTime: 5, duration: 5 }); // track-2 is locked
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const diffTracksResult = EditingActions.rollEdit("cA", "cB", 1);
      expect(diffTracksResult.success).toBe(false);
      expect(diffTracksResult.error).toContain("Clips must be on the same track");

      // Both on locked track
      const lockedClipA = makeClip("lA", { trackId: "track-2", startTime: 0, duration: 5 });
      const lockedClipB = makeClip("lB", { trackId: "track-2", startTime: 5, duration: 5 });
      useTimelineStore.setState({ clips: [lockedClipA, lockedClipB] });

      const lockedResult = EditingActions.rollEdit("lA", "lB", 1);
      expect(lockedResult.success).toBe(false);
      expect(lockedResult.error).toContain("Track is locked");
    });

    it("supports atomic undo and redo", () => {
      const clipA = makeClip("cA", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { mediaId: "media-2", startTime: 10, duration: 10, trimIn: 2, trimOut: 12 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      EditingActions.rollEdit("cA", "cB", 3);
      expect(useTimelineStore.getState().clips[0].duration).toBeCloseTo(13, 5);
      expect(useTimelineStore.getState().clips[1].startTime).toBeCloseTo(13, 5);

      useHistoryStore.getState().undo();
      expect(useTimelineStore.getState().clips[0].duration).toBe(10);
      expect(useTimelineStore.getState().clips[1].startTime).toBe(10);

      useHistoryStore.getState().redo();
      expect(useTimelineStore.getState().clips[0].duration).toBeCloseTo(13, 5);
      expect(useTimelineStore.getState().clips[1].startTime).toBeCloseTo(13, 5);
    });
  });

  describe("rollClipEdge", () => {
    it("rolls outgoing cut with next clip", () => {
      const clipA = makeClip("cA", { startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { startTime: 10, duration: 10, trimIn: 2, trimOut: 12 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const result = EditingActions.rollClipEdge("cA", "outgoing", 1);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(1, 5);
      expect(useTimelineStore.getState().clips[0].duration).toBeCloseTo(11, 5);
    });

    it("rolls incoming cut with previous clip", () => {
      const clipA = makeClip("cA", { startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const clipB = makeClip("cB", { startTime: 10, duration: 10, trimIn: 2, trimOut: 12 });
      useTimelineStore.setState({ clips: [clipA, clipB] });

      const result = EditingActions.rollClipEdge("cB", "incoming", 1);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(1, 5);
      expect(useTimelineStore.getState().clips[0].duration).toBeCloseTo(11, 5);
    });

    it("fails cleanly when no adjacent clip exists", () => {
      const clipA = makeClip("cA", { startTime: 0, duration: 10 });
      useTimelineStore.setState({ clips: [clipA] });

      const result = EditingActions.rollClipEdge("cA", "outgoing", 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No adjacent clip to roll with");
    });
  });
});
