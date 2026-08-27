import { describe, it, expect } from "vitest";
import { MoveClipCommand } from "../MoveClipCommand";
import { AddTrackCommand, DeleteTrackCommand, ToggleTrackPropertyCommand } from "../TrackCommands";
import { TransformClipCommand } from "../TransformCommand";
import { UpdateClipCommand } from "../UpdateClipCommand";
import type { Track, Clip } from "@/types";

describe("History Commands Suite", () => {
  
  describe("MoveClipCommand", () => {
    it("should apply clip position movement, support inversion, and support merging", () => {
      const state = {
        clips: [
          { id: "clip-1", trackId: "track-1", startTime: 1.0 },
          { id: "clip-2", trackId: "track-1", startTime: 5.0 },
        ],
        epoch: 0,
      };

      const cmd = new MoveClipCommand("clip-1", "track-1", "track-2", 1.0, 3.5);
      const stateAfterApply = cmd.apply(state as any);

      // Verify movement and epoch increment
      expect(stateAfterApply.clips[0].trackId).toBe("track-2");
      expect(stateAfterApply.clips[0].startTime).toBe(3.5);
      expect(stateAfterApply.epoch).toBe(1);

      // Invert
      const invCmd = cmd.invert();
      const stateAfterInvert = invCmd.apply(stateAfterApply as any);
      expect(stateAfterInvert.clips[0].trackId).toBe("track-1");
      expect(stateAfterInvert.clips[0].startTime).toBe(1.0);

      // Merge Move commands
      const cmdNext = new MoveClipCommand("clip-1", "track-2", "track-3", 3.5, 6.0);
      const mergedCmd = cmd.merge(cmdNext);
      expect(mergedCmd).not.toBeNull();
      
      const stateAfterMerge = mergedCmd!.apply(state as any);
      expect(stateAfterMerge.clips[0].trackId).toBe("track-3");
      expect(stateAfterMerge.clips[0].startTime).toBe(6.0);

      // JSON Serialization
      const json = cmd.toJSON();
      expect(json.type).toBe("MoveClip");
      expect(json.clipId).toBe("clip-1");

      const deserialized = MoveClipCommand.fromJSON(json);
      expect(deserialized.toJSON().clipId).toBe("clip-1");
    });
  });

  describe("TrackCommands", () => {
    it("should add track, support delete track, and support toggle track properties", () => {
      const state = {
        tracks: [
          { id: "track-1", type: "video" } as Track,
        ],
        clips: [
          { id: "clip-1", trackId: "track-1", startTime: 0 } as Clip,
        ],
        mainVideoTrackId: "track-1",
        epoch: 0,
      };

      // Video tracks deliberately insert at the top. Use an audio track here to
      // verify the explicit requested insertion index without conflating that
      // placement policy with command inversion.
      const newTrack = { id: "track-2", type: "audio", name: "Track 2", height: 100, visible: true, locked: false, muted: false } as Track;
      const addCmd = new AddTrackCommand(newTrack, 1);
      const state1 = addCmd.apply(state);

      expect(state1.tracks.length).toBe(2);
      expect(state1.tracks[1].id).toBe("track-2");
      expect(state1.epoch).toBe(1);

      // Invert (Delete)
      const deleteCmd = addCmd.invert();
      const state2 = deleteCmd.apply(state1);
      expect(state2.tracks.length).toBe(1);
      expect(state2.tracks.find((t: Track) => t.id === "track-2")).toBeUndefined();

      // Undo deletion (Restore track)
      const restoreCmd = deleteCmd.invert();
      const state3 = restoreCmd.apply(state2);
      expect(state3.tracks.length).toBe(2);

      // Toggle track property
      const toggleCmd = new ToggleTrackPropertyCommand("track-1", "locked");
      const state4 = toggleCmd.apply(state);
      expect(state4.tracks[0].locked).toBe(true);

      const toggleInv = toggleCmd.invert();
      const state5 = toggleInv.apply(state4);
      expect(state5.tracks[0].locked).toBe(false);

      const soloCmd = new ToggleTrackPropertyCommand("track-1", "solo");
      const state6 = soloCmd.apply(state);
      expect(state6.tracks[0].solo).toBe(true);
    });
  });

  describe("TransformClipCommand", () => {
    it("should apply scale/x/y transforms, support inversion, and support merging", () => {
      const state = {
        clips: [
          { id: "clip-1", x: 0, y: 0, scale: 1.0 } as any,
        ],
        epoch: 0,
      };

      const cmd = new TransformClipCommand("clip-1", { x: 0, y: 0, scale: 1.0 } as any, { x: 10, y: 20, scale: 1.5 } as any);
      const state1 = cmd.apply(state);
      expect(state1.clips[0].x).toBe(10);
      expect((state1.clips[0] as any).scale).toBe(1.5);
      expect(state1.epoch).toBe(1);

      // Invert
      const inv = cmd.invert();
      const state2 = inv.apply(state1);
      expect(state2.clips[0].x).toBe(0);
      expect((state2.clips[0] as any).scale).toBe(1.0);

      // Merge Transform commands
      const cmdNext = new TransformClipCommand("clip-1", { x: 10, y: 20, scale: 1.5 } as any, { x: 30, y: 40, scale: 2.0 } as any);
      const merged = cmd.merge(cmdNext);
      expect(merged).not.toBeNull();

      const state3 = merged!.apply(state);
      expect(state3.clips[0].x).toBe(30);
      expect((state3.clips[0] as any).scale).toBe(2.0);
    });

    it("restores the complete clip snapshot across undo and redo", () => {
      const clip = {
        id: "clip-1",
        x: 0,
        y: 0,
        scale: 1,
        audio: {
          linkState: "unlinked",
          linkedClipId: "source-1",
          linkOffsetSeconds: 0.25,
          volume: 0.8,
        },
        styleDefinition: { id: "pinned-neon", version: 4 },
        futureField: { preserved: true },
      } as any;
      const state = { clips: [clip], epoch: 0 };
      const command = new TransformClipCommand(
        clip.id,
        { x: clip.x },
        { x: 80 },
      );

      const transformed = command.apply(state);
      expect(transformed.clips[0].x).toBe(80);
      expect((transformed.clips[0] as any).futureField).toEqual({ preserved: true });

      const restored = command.invert().apply(transformed);
      expect(restored.clips[0]).toEqual(clip);

      const redone = command.apply(restored);
      expect(redone.clips[0]).toEqual(transformed.clips[0]);
    });
  });

  describe("UpdateClipCommand", () => {
    it("restores complete clip state when updating a partial property set", () => {
      const clip = {
        id: "clip-update",
        name: "Before",
        audio: { volume: 0.7, linkState: "linked" },
        styleDefinition: { id: "pinned-title", version: 2 },
        futureField: { preserved: true },
      } as any;
      const state = { clips: [clip], epoch: 0 };
      const command = new UpdateClipCommand(
        clip.id,
        { name: clip.name },
        { name: "After" },
      );

      const updated = command.apply(state);
      expect(updated.clips[0].name).toBe("After");
      expect((updated.clips[0] as any).futureField).toEqual({ preserved: true });

      const restored = command.invert().apply(updated);
      expect(restored.clips[0]).toEqual(clip);
      expect(command.apply(restored).clips[0]).toEqual(updated.clips[0]);
    });
  });
});
