import { describe, expect, test } from "vitest";

import type { Command } from "../../Command";
import { AddClipCommand, DeleteClipCommand } from "../DeleteClipCommand";
import {
  InsertGapCommand,
  PackTrackCommand,
  RemoveGapCommand,
  ResizeGapCommand,
  ToggleGapProtectionCommand,
} from "../GapCommands";
import { MoveClipCommand } from "../MoveClipCommand";
import { RippleDeleteCommand } from "../RippleDeleteCommand";
import { SplitClipCommand } from "../SplitClipCommand";
import { AddTrackCommand, DeleteTrackCommand, ToggleTrackPropertyCommand } from "../TrackCommands";
import { TransformClipCommand } from "../TransformCommand";
import { TrimClipCommand } from "../TrimClipCommand";
import { UpdateClipCommand } from "../UpdateClipCommand";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";

const clip = {
  id: "clip-1",
  trackId: "track-1",
  mediaId: "media-1",
  startTime: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 4,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
} satisfies Clip;

const track = {
  id: "track-1",
  type: "video",
  name: "Track 1",
  muted: false,
  locked: false,
  visible: true,
  height: 100,
} satisfies Track;

const gap = {
  id: "gap-1",
  trackId: track.id,
  startTime: 4,
  duration: 2,
  type: "manual",
  source: "user-insert",
  protected: false,
} satisfies Gap;

function inverseAfterApply(command: Command, state: object): Command {
  command.apply(state);
  return command.invert();
}

describe("timeline history command labels", () => {
  test("uses concise Chinese labels while preserving serialized command types", () => {
    const deleteClip = new DeleteClipCommand(clip.id);
    const removeGap = new RemoveGapCommand(gap.id);
    const packTrack = new PackTrackCommand(track.id);
    const rippleDelete = new RippleDeleteCommand(clip.id);
    const splitClip = new SplitClipCommand(clip.id, 2, 30, clip);
    const deleteTrack = new DeleteTrackCommand(track.id);

    const rows: Array<[Command, string, string | null]> = [
      [deleteClip, "删除片段", "DeleteClip"],
      [new AddClipCommand(clip), "添加片段", "AddClip"],
      [new InsertGapCommand(track.id, 4, 2), "插入间隙", "InsertGap"],
      [removeGap, "删除间隙", "RemoveGap"],
      [inverseAfterApply(removeGap, { clips: [], gaps: [gap], epoch: 0 }), "恢复间隙", "RestoreGap"],
      [new ResizeGapCommand(gap.id, 3), "调整间隙", "ResizeGap"],
      [packTrack, "收紧轨道", "PackTrack"],
      [inverseAfterApply(packTrack, { clips: [clip], gaps: [gap], epoch: 0 }), "恢复轨道间隙", "UnpackTrack"],
      [new ToggleGapProtectionCommand(gap.id), "切换间隙保护", "ToggleGapProtection"],
      [new MoveClipCommand(clip.id, track.id, "track-2", 0, 2), "移动片段", "MoveClip"],
      [rippleDelete, "波纹删除片段", "RippleDelete"],
      [inverseAfterApply(rippleDelete, { tracks: [track], clips: [clip], epoch: 0 }), "恢复波纹删除", "RippleRestore"],
      [splitClip, "拆分片段", "SplitClip"],
      [splitClip.invert(), "合并拆分片段", "MergeSplitClips"],
      [new AddTrackCommand(track), "添加轨道", "AddTrack"],
      [deleteTrack, "删除轨道", "DeleteTrack"],
      [inverseAfterApply(deleteTrack, { tracks: [track], clips: [clip], mainVideoTrackId: track.id, epoch: 0 }), "恢复轨道", "RestoreTrack"],
      [new ToggleTrackPropertyCommand(track.id, "locked"), "切换轨道锁定", "ToggleTrackProperty"],
      [new ToggleTrackPropertyCommand(track.id, "muted"), "切换轨道静音", "ToggleTrackProperty"],
      [new ToggleTrackPropertyCommand(track.id, "visible"), "切换轨道可见性", "ToggleTrackProperty"],
      [new TransformClipCommand(clip.id, { x: 0 }, { x: 1 }), "变换片段", null],
      [new UpdateClipCommand(clip.id, { opacity: 1 }, { opacity: 0.5 }), "更新片段", "UpdateClip"],
      [new TrimClipCommand(clip.id, 0, 4, 4, 1, 4, 3), "裁剪片段", "TrimClip"],
    ];

    expect(rows).toHaveLength(23);
    for (const [command, label, type] of rows) {
      const serialized = (command as Command & { toJSON?: () => Record<string, unknown> }).toJSON?.();

      expect(command.label).toBe(label);
      expect(command.label).toMatch(/[\u3400-\u9fff]/);
      expect(serialized?.type ?? null).toBe(type);
    }
  });
});
