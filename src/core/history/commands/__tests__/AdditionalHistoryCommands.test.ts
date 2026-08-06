import { describe, it, expect } from "vitest";
import { MoveClipCommand } from "../MoveClipCommand";
import { TrimClipCommand } from "../TrimClipCommand";
import { TransformClipCommand } from "../TransformCommand";
import { AddTrackCommand, DeleteTrackCommand } from "../TrackCommands";
import type { Clip, Track } from "@/types";

describe("Additional History Commands — Complete Safety Coverage", () => {
  const createMockClip = (id: string, trackId = "track-1"): Clip => ({
    id,
    trackId,
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    kind: "video",
    volume: 1,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  });

  // ─── 1. MOVE CLIP COMMAND ────────────────────────────────────────────────
  describe("MoveClipCommand", () => {
    it("should apply clip move to new startTime and trackId, and invert cleanly", () => {
      const clip = createMockClip("c-move", "track-1");
      const state = { clips: [clip], tracks: [], epoch: 0 };

      // constructor(clipId, fromTrackId, toTrackId, fromTime, toTime)
      const moveCmd = new MoveClipCommand("c-move", "track-1", "track-2", 0, 5.0);
      const newState = moveCmd.apply(state as any);

      const movedClip = newState.clips.find((c) => c.id === "c-move");
      expect(movedClip?.startTime).toBe(5.0);
      expect(movedClip?.trackId).toBe("track-2");

      // Invert & restore
      const undoCmd = moveCmd.invert();
      const restoredState = undoCmd.apply(newState as any);
      const restoredClip = restoredState.clips.find((c: any) => c.id === "c-move");
      expect(restoredClip?.startTime).toBe(0);
      expect(restoredClip?.trackId).toBe("track-1");
    });
  });

  // ─── 2. TRIM CLIP COMMAND ────────────────────────────────────────────────
  describe("TrimClipCommand", () => {
    it("should update trimIn and trimOut bounds and invert cleanly", () => {
      const clip = createMockClip("c-trim");
      const state = { clips: [clip], epoch: 0 };

      // constructor(clipId, oldTrimIn, oldTrimOut, oldDuration, newTrimIn, newTrimOut, newDuration)
      const trimCmd = new TrimClipCommand("c-trim", 0, 10, 10, 2.0, 8.0, 6.0);
      const newState = trimCmd.apply(state as any);

      const trimmed = newState.clips.find((c) => c.id === "c-trim");
      expect(trimmed?.trimIn).toBe(2.0);
      expect(trimmed?.trimOut).toBe(8.0);
      expect(trimmed?.duration).toBe(6.0);

      // Invert & restore
      const undoCmd = trimCmd.invert();
      const restoredState = undoCmd.apply(newState as any);
      const restored = restoredState.clips.find((c: any) => c.id === "c-trim");
      expect(restored?.trimIn).toBe(0);
      expect(restored?.trimOut).toBe(10);
      expect(restored?.duration).toBe(10);
    });
  });

  // ─── 3. TRANSFORM COMMAND ────────────────────────────────────────────────
  describe("TransformClipCommand", () => {
    it("should update spatial transforms (x, y, scale, rotation, opacity)", () => {
      const clip = createMockClip("c-xfm");
      const state = { clips: [clip], epoch: 0 };

      // constructor(clipId, oldTransform, newTransform)
      const transformCmd = new TransformClipCommand(
        "c-xfm",
        { x: 0, y: 0, opacity: 1, rotation: 0 },
        { x: 100, y: 200, opacity: 0.5, rotation: 45 }
      );

      const newState = transformCmd.apply(state as any);
      const xformed = newState.clips.find((c) => c.id === "c-xfm");
      expect(xformed?.x).toBe(100);
      expect(xformed?.y).toBe(200);
      expect(xformed?.opacity).toBe(0.5);
      expect(xformed?.rotation).toBe(45);

      // Invert & restore
      const undoCmd = transformCmd.invert();
      const restoredState = undoCmd.apply(newState as any);
      const restored = restoredState.clips.find((c: any) => c.id === "c-xfm");
      expect(restored?.x).toBe(0);
      expect(restored?.y).toBe(0);
      expect(restored?.opacity).toBe(1);
      expect(restored?.rotation).toBe(0);
    });
  });

  // ─── 4. TRACK COMMANDS ───────────────────────────────────────────────────
  describe("TrackCommands (Add, Delete)", () => {
    it("should add new track and invert by deleting", () => {
      const track: Track = {
        id: "tr-new",
        type: "video",
        name: "New Track",
        visible: true,
        locked: false,
        muted: false,
        height: 52,
      };

      const state = { tracks: [], clips: [], epoch: 0 };
      const addCmd = new AddTrackCommand(track);
      const newState = addCmd.apply(state as any);

      expect(newState.tracks.length).toBe(1);
      expect(newState.tracks[0].id).toBe("tr-new");

      const undoCmd = addCmd.invert();
      const restoredState = undoCmd.apply(newState as any);
      expect(restoredState.tracks.length).toBe(0);
    });

    it("should delete track and restore it on invert", () => {
      const track: Track = {
        id: "tr-del",
        type: "video",
        name: "Track to Delete",
        visible: true,
        locked: false,
        muted: false,
        height: 52,
      };

      const state = { tracks: [track], clips: [], epoch: 0 };
      const delCmd = new DeleteTrackCommand("tr-del");
      const newState = delCmd.apply(state as any);

      expect(newState.tracks.length).toBe(0);

      const undoCmd = delCmd.invert();
      const restoredState = undoCmd.apply(newState as any);
      expect(restoredState.tracks.length).toBe(1);
    });
  });
});
