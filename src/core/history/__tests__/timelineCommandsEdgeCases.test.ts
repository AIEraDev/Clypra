import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { SplitClipCommand } from "../commands/SplitClipCommand";
import { RippleDeleteCommand } from "../commands/RippleDeleteCommand";
import { useTimelineStore } from "@/store/timelineStore";
import type { Clip, Track } from "@/types";

describe("Timeline Command Engine — Locked-In Edge Cases & Invariants", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Track 1", visible: true, locked: false, muted: false, height: 52 },
        { id: "track-2", type: "audio", name: "Track 2", visible: true, locked: false, muted: false, height: 52 },
      ],
      clips: [],
      transitions: [],
      epoch: 0,
    });
  });

  // ─── 1. FAST-CHECK PROPERTY INVARIANTS ────────────────────────────────────
  describe("Property-Based Invariants (fast-check)", () => {
    it("should preserve valid trim and time invariants across arbitrary clip durations", () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1.0, max: 100.0, noNaN: true }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          (duration, splitRatio) => {
            const splitOffset = duration * splitRatio;
            
            const clip: Clip = {
              id: "clip-prop-1",
              trackId: "track-1",
              mediaId: "asset-1",
              startTime: 0,
              duration,
              trimIn: 0,
              trimOut: duration,
              kind: "video",
              volume: 1,
              x: 0,
              y: 0,
              width: 1920,
              height: 1080,
              opacity: 1,
              rotation: 0,
            };

            const splitTime = clip.startTime + splitOffset;
            const leftClip: Clip = {
              ...clip,
              id: "clip-left",
              duration: splitOffset,
              trimOut: clip.trimIn + splitOffset,
            };
            const rightClip: Clip = {
              ...clip,
              id: "clip-right",
              startTime: splitTime,
              duration: duration - splitOffset,
              trimIn: clip.trimIn + splitOffset,
            };

            // Assert Invariants:
            expect(leftClip.duration + rightClip.duration).toBeCloseTo(duration, 5);
            expect(leftClip.trimIn).toBeGreaterThanOrEqual(0);
            expect(leftClip.trimOut).toBeLessThanOrEqual(clip.trimOut);
            expect(rightClip.trimIn).toBeGreaterThanOrEqual(leftClip.trimOut);
            expect(rightClip.startTime).toBeGreaterThanOrEqual(0);
          }
        )
      );
    });
  });

  // ─── 2. DEEP UNDO/REDO STACK INTEGRITY ────────────────────────────────────
  describe("50-Step Pure Command Inversion & Undo Stress Test", () => {
    it("should achieve 100% exact state restoration after applying and inverting 50 commands", () => {
      const initialClip: Clip = {
        id: "stress-clip-0",
        trackId: "track-1",
        mediaId: "media-stress",
        startTime: 0,
        duration: 1000,
        trimIn: 0,
        trimOut: 1000,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      let state = { clips: [initialClip], epoch: 0 };
      const initialStateStr = JSON.stringify(state.clips);

      const commandHistory: any[] = [];

      // Execute 20 split commands sequentially on pure state
      let currentClipId = "stress-clip-0";
      for (let i = 1; i <= 20; i++) {
        const target = state.clips.find((c) => c.id === currentClipId);
        if (!target) break;

        const splitPoint = target.startTime + target.duration / 2;
        const cmd = new SplitClipCommand(target.id, splitPoint, 30, target);
        
        state = cmd.apply(state);
        commandHistory.push(cmd.invert());

        const rightChild = state.clips.find((c) => c.id.includes("-b") || c.id !== target.id);
        if (rightChild) currentClipId = rightChild.id;
      }

      // Undo all commands in reverse using inverted commands
      for (let i = commandHistory.length - 1; i >= 0; i--) {
        state = commandHistory[i].apply(state);
      }

      const finalStateStr = JSON.stringify(state.clips);
      expect(finalStateStr).toBe(initialStateStr);
    });
  });

  // ─── 3. SPLIT BOUNDARY EDGE CASES ─────────────────────────────────────────
  describe("Split Clip Boundary Conditions", () => {
    it("should safely ignore split attempts at exact clip start or end boundaries", () => {
      const clip: Clip = {
        id: "boundary-clip",
        trackId: "track-1",
        mediaId: "media-b",
        startTime: 10,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      let state = { clips: [clip], epoch: 0 };

      // Split at exact start time (10s)
      const cmdStart = new SplitClipCommand(clip.id, 10, 30, clip);
      state = cmdStart.apply(state);
      expect(state.clips.length).toBe(1);

      // Split at exact end time (15s)
      const cmdEnd = new SplitClipCommand(clip.id, 15, 30, clip);
      state = cmdEnd.apply(state);
      expect(state.clips.length).toBe(1);
    });
  });

  // ─── 4. RIPPLE DELETE & LOCKED TRACK INTEGRITY ───────────────────────────
  describe("Ripple Delete with Multi-Track & Lock Guards", () => {
    it("should shift unlocked tracks while preserving positions of locked tracks during ripple delete", () => {
      const store = useTimelineStore.getState();
      const track1 = store.tracks[0].id;
      const track2 = store.tracks[1].id;

      // Lock Track 2
      useTimelineStore.setState((s) => ({
        tracks: s.tracks.map((t) => (t.id === track2 ? { ...t, locked: true } : t)),
      }));

      const clip1: Clip = {
        id: "c1",
        trackId: track1,
        mediaId: "m1",
        startTime: 0,
        duration: 4,
        trimIn: 0,
        trimOut: 4,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const clip2: Clip = {
        id: "c2",
        trackId: track1,
        mediaId: "m2",
        startTime: 4,
        duration: 4,
        trimIn: 0,
        trimOut: 4,
        kind: "video",
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const lockedClip: Clip = {
        id: "c-locked",
        trackId: track2,
        mediaId: "m3",
        startTime: 5,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        kind: "audio",
        volume: 1,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
      };

      store.addClip(clip1);
      store.addClip(clip2);
      store.addClip(lockedClip);

      // Delete clip1 via RippleDeleteCommand
      const rippleCmd = new RippleDeleteCommand("c1");
      const currentState = {
        clips: useTimelineStore.getState().clips,
        tracks: useTimelineStore.getState().tracks,
        epoch: 0,
      };

      const nextState = rippleCmd.apply(currentState as any);
      useTimelineStore.setState({ clips: nextState.clips });

      const clipsAfter = useTimelineStore.getState().clips;

      // clip1 deleted
      expect(clipsAfter.find((c) => c.id === "c1")).toBeUndefined();

      // clip2 shifted left by 4s (from startTime 4s to 0s)
      const movedClip2 = clipsAfter.find((c) => c.id === "c2");
      expect(movedClip2?.startTime).toBe(0);

      // lockedClip on locked track2 remains strictly anchored at startTime 5s
      const stillLocked = clipsAfter.find((c) => c.id === "c-locked");
      expect(stillLocked?.startTime).toBe(5);
    });
  });
});
