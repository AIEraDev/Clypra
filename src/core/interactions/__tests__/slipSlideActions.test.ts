import { beforeEach, describe, expect, it } from "vitest";
import { EditingActions } from "../EditingActions";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, MediaAsset, Project } from "@/types";

const testProject: Project = {
  id: "project-slip-slide",
  name: "Slip Slide Test Project",
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
  duration: 5,
  trimIn: 2,
  trimOut: 7,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
  ...overrides,
});

describe("EditingActions Slip & Slide operations", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useProjectStore.setState({
      project: testProject,
      mediaAssets: [
        makeAsset("media-1", 30),
        makeAsset("media-2", 30),
        makeAsset("media-3", 30),
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

  describe("slipClip", () => {
    it("slips media later (positive delta) while preserving timeline position and duration", () => {
      const clip = makeClip("c1", { startTime: 10, duration: 4, trimIn: 2, trimOut: 6 });
      useTimelineStore.setState({ clips: [clip] });

      const result = EditingActions.slipClip("c1", 1.5);
      expect(result.success).toBe(true);
      expect(result.newTrimIn).toBeCloseTo(3.5, 5);
      expect(result.newTrimOut).toBeCloseTo(7.5, 5);

      const updated = useTimelineStore.getState().clips.find((c) => c.id === "c1")!;
      expect(updated.startTime).toBe(10); // Untouched
      expect(updated.duration).toBe(4);   // Untouched
      expect(updated.trimIn).toBeCloseTo(3.5, 5);
      expect(updated.trimOut).toBeCloseTo(7.5, 5);
    });

    it("slips media earlier (negative delta)", () => {
      const clip = makeClip("c1", { startTime: 10, duration: 4, trimIn: 5, trimOut: 9 });
      useTimelineStore.setState({ clips: [clip] });

      const result = EditingActions.slipClip("c1", -2);
      expect(result.success).toBe(true);
      expect(result.newTrimIn).toBeCloseTo(3, 5);
      expect(result.newTrimOut).toBeCloseTo(7, 5);

      const updated = useTimelineStore.getState().clips.find((c) => c.id === "c1")!;
      expect(updated.trimIn).toBeCloseTo(3, 5);
      expect(updated.trimOut).toBeCloseTo(7, 5);
    });

    it("clamps at source media beginning (trimIn = 0)", () => {
      const clip = makeClip("c1", { startTime: 0, duration: 4, trimIn: 1, trimOut: 5 });
      useTimelineStore.setState({ clips: [clip] });

      const result = EditingActions.slipClip("c1", -3);
      expect(result.success).toBe(true);
      expect(result.newTrimIn).toBe(0);
      expect(result.newTrimOut).toBe(4);

      // Attempting to slip earlier when already at 0 should report boundary error
      const atStartResult = EditingActions.slipClip("c1", -1);
      expect(atStartResult.success).toBe(false);
      expect(atStartResult.error).toContain("Reached beginning of source media");
    });

    it("clamps at source media end (trimOut = mediaAsset.duration)", () => {
      // media-1 duration is 30, clip duration is 5, max trimIn = 25
      const clip = makeClip("c1", { startTime: 0, duration: 5, trimIn: 24, trimOut: 29 });
      useTimelineStore.setState({ clips: [clip] });

      const result = EditingActions.slipClip("c1", 4);
      expect(result.success).toBe(true);
      expect(result.newTrimIn).toBe(25);
      expect(result.newTrimOut).toBe(30);

      // Attempting to slip further when already at end should report boundary error
      const atEndResult = EditingActions.slipClip("c1", 1);
      expect(atEndResult.success).toBe(false);
      expect(atEndResult.error).toContain("Reached end of source media");
    });

    it("rejects compound clips and locked tracks", () => {
      const compoundClip = makeClip("comp-1", { kind: "compound" as any });
      const lockedClip = makeClip("c-locked", { trackId: "track-2" });
      useTimelineStore.setState({ clips: [compoundClip, lockedClip] });

      const compResult = EditingActions.slipClip("comp-1", 1);
      expect(compResult.success).toBe(false);
      expect(compResult.error).toContain("Compound clips cannot be slipped");

      const lockResult = EditingActions.slipClip("c-locked", 1);
      expect(lockResult.success).toBe(false);
      expect(lockResult.error).toContain("Track is locked");
    });

    it("supports atomic undo and redo", () => {
      const clip = makeClip("c1", { startTime: 10, duration: 4, trimIn: 2, trimOut: 6 });
      useTimelineStore.setState({ clips: [clip] });

      EditingActions.slipClip("c1", 2);
      expect(useTimelineStore.getState().clips[0].trimIn).toBe(4);
      expect(useTimelineStore.getState().clips[0].trimOut).toBe(8);

      useHistoryStore.getState().undo();
      expect(useTimelineStore.getState().clips[0].trimIn).toBe(2);
      expect(useTimelineStore.getState().clips[0].trimOut).toBe(6);

      useHistoryStore.getState().redo();
      expect(useTimelineStore.getState().clips[0].trimIn).toBe(4);
      expect(useTimelineStore.getState().clips[0].trimOut).toBe(8);
    });
  });

  describe("slideClip", () => {
    it("slides clip right: shifts clip, expands preceding clip, contracts succeeding clip", () => {
      const c1 = makeClip("c1", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const c2 = makeClip("c2", { mediaId: "media-2", startTime: 10, duration: 8, trimIn: 2, trimOut: 10 });
      const c3 = makeClip("c3", { mediaId: "media-3", startTime: 18, duration: 10, trimIn: 4, trimOut: 14 });
      useTimelineStore.setState({ clips: [c1, c2, c3] });

      const slideDelta = 2; // Slide right by 2 seconds
      const result = EditingActions.slideClip("c2", slideDelta);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(2, 5);

      const [updatedC1, updatedC2, updatedC3] = useTimelineStore.getState().clips;

      // c2 moves right by 2s, duration unchanged
      expect(updatedC2.startTime).toBeCloseTo(12, 5);
      expect(updatedC2.duration).toBe(8);
      expect(updatedC2.trimIn).toBe(2);
      expect(updatedC2.trimOut).toBe(10);

      // c1 expands duration and trimOut by 2s
      expect(updatedC1.startTime).toBe(0);
      expect(updatedC1.duration).toBeCloseTo(12, 5);
      expect(updatedC1.trimOut).toBeCloseTo(12, 5);

      // c3 shifts start right by 2s, contracts duration by 2s, trims forward by 2s
      expect(updatedC3.startTime).toBeCloseTo(20, 5);
      expect(updatedC3.duration).toBeCloseTo(8, 5);
      expect(updatedC3.trimIn).toBeCloseTo(6, 5);
      expect(updatedC3.trimOut).toBe(14); // Untouched out-point in source

      // Total sequence span remains 0 to 28
      const totalSpan = updatedC3.startTime + updatedC3.duration;
      expect(totalSpan).toBeCloseTo(28, 5);
    });

    it("slides clip left: shifts clip, contracts preceding clip, expands succeeding clip", () => {
      const c1 = makeClip("c1", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const c2 = makeClip("c2", { mediaId: "media-2", startTime: 10, duration: 8, trimIn: 2, trimOut: 10 });
      const c3 = makeClip("c3", { mediaId: "media-3", startTime: 18, duration: 10, trimIn: 4, trimOut: 14 });
      useTimelineStore.setState({ clips: [c1, c2, c3] });

      const slideDelta = -3; // Slide left by 3 seconds
      const result = EditingActions.slideClip("c2", slideDelta);
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(-3, 5);

      const [updatedC1, updatedC2, updatedC3] = useTimelineStore.getState().clips;

      // c2 moves left by 3s
      expect(updatedC2.startTime).toBeCloseTo(7, 5);
      expect(updatedC2.duration).toBe(8);

      // c1 contracts by 3s
      expect(updatedC1.startTime).toBe(0);
      expect(updatedC1.duration).toBeCloseTo(7, 5);
      expect(updatedC1.trimOut).toBeCloseTo(7, 5);

      // c3 expands to the left: starts earlier at 15s, duration expands to 13s, trimIn moves earlier to 1s
      expect(updatedC3.startTime).toBeCloseTo(15, 5);
      expect(updatedC3.duration).toBeCloseTo(13, 5);
      expect(updatedC3.trimIn).toBeCloseTo(1, 5);
    });

    it("prevents shrinking neighbor clip below minimum duration (1 frame)", () => {
      const frameRate = testProject.frameRate;
      const minDuration = 1 / frameRate;

      const c1 = makeClip("c1", { mediaId: "media-1", startTime: 0, duration: 2, trimIn: 0, trimOut: 2 });
      const c2 = makeClip("c2", { mediaId: "media-2", startTime: 2, duration: 5, trimIn: 0, trimOut: 5 });
      useTimelineStore.setState({ clips: [c1, c2] });

      // Max slide left can only leave c1 with at least 1 frame
      const maxSlideLeft = -(2 - minDuration);
      const result = EditingActions.slideClip("c2", -10); // Attempt huge slide left
      expect(result.success).toBe(true);
      expect(result.deltaApplied).toBeCloseTo(maxSlideLeft, 5);

      const updatedC1 = useTimelineStore.getState().clips.find((c) => c.id === "c1")!;
      expect(updatedC1.duration).toBeCloseTo(minDuration, 5);
    });

    it("supports atomic undo and redo restoring all affected neighbor clips", () => {
      const c1 = makeClip("c1", { mediaId: "media-1", startTime: 0, duration: 10, trimIn: 0, trimOut: 10 });
      const c2 = makeClip("c2", { mediaId: "media-2", startTime: 10, duration: 8, trimIn: 2, trimOut: 10 });
      const c3 = makeClip("c3", { mediaId: "media-3", startTime: 18, duration: 10, trimIn: 4, trimOut: 14 });
      useTimelineStore.setState({ clips: [c1, c2, c3] });

      EditingActions.slideClip("c2", 2);

      expect(useTimelineStore.getState().clips[1].startTime).toBeCloseTo(12, 5);

      // Undo
      useHistoryStore.getState().undo();
      const [uC1, uC2, uC3] = useTimelineStore.getState().clips;
      expect(uC1.duration).toBe(10);
      expect(uC2.startTime).toBe(10);
      expect(uC3.startTime).toBe(18);
      expect(uC3.duration).toBe(10);

      // Redo
      useHistoryStore.getState().redo();
      const [rC1, rC2, rC3] = useTimelineStore.getState().clips;
      expect(rC1.duration).toBeCloseTo(12, 5);
      expect(rC2.startTime).toBeCloseTo(12, 5);
      expect(rC3.startTime).toBeCloseTo(20, 5);
      expect(rC3.duration).toBeCloseTo(8, 5);
    });
  });
});
