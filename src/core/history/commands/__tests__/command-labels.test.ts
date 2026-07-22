import { describe, expect, test } from "vitest";

import type { Command } from "../../Command";
import { CompositeCommand } from "../../Transaction";
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

type SerializableTestCommand = Command & { toJSON: () => Record<string, unknown> };

interface CommandCase {
  name: string;
  create: () => { command: Command; state: Record<string, unknown> };
  label: string;
  inverseLabel: string;
  serialized: Record<string, unknown> | null;
}

function inverseCase(command: Command, state: Record<string, unknown>): { command: Command; state: Record<string, unknown> } {
  const nextState = command.apply(state);
  return { command: command.invert(), state: nextState };
}

const commandCases: CommandCase[] = [
  {
    name: "DeleteClipCommand",
    create: () => ({ command: new DeleteClipCommand(clip.id), state: { tracks: [track], clips: [clip], epoch: 0 } }),
    label: "删除片段",
    inverseLabel: "添加片段",
    serialized: { type: "DeleteClip", clipId: clip.id, deletedClip: clip },
  },
  {
    name: "AddClipCommand",
    create: () => ({ command: new AddClipCommand(clip), state: { clips: [], epoch: 0 } }),
    label: "添加片段",
    inverseLabel: "删除片段",
    serialized: { type: "AddClip", clip },
  },
  {
    name: "InsertGapCommand",
    create: () => ({ command: new InsertGapCommand(track.id, gap.startTime, gap.duration), state: { clips: [], gaps: [], epoch: 0 } }),
    label: "插入间隙",
    inverseLabel: "删除间隙",
    serialized: { type: "InsertGap", trackId: track.id, startTime: gap.startTime, duration: gap.duration },
  },
  {
    name: "RemoveGapCommand",
    create: () => ({ command: new RemoveGapCommand(gap.id), state: { clips: [], gaps: [gap], epoch: 0 } }),
    label: "删除间隙",
    inverseLabel: "恢复间隙",
    serialized: { type: "RemoveGap", gapId: gap.id, removedGap: gap },
  },
  {
    name: "RestoreGapCommand",
    create: () => inverseCase(new RemoveGapCommand(gap.id), { clips: [], gaps: [gap], epoch: 0 }),
    label: "恢复间隙",
    inverseLabel: "删除间隙",
    serialized: { type: "RestoreGap", gap, originalPositions: [] },
  },
  {
    name: "ResizeGapCommand",
    create: () => ({ command: new ResizeGapCommand(gap.id, 3), state: { clips: [], gaps: [gap], epoch: 0 } }),
    label: "调整间隙",
    inverseLabel: "调整间隙",
    serialized: { type: "ResizeGap", gapId: gap.id, newDuration: 3, originalDuration: gap.duration },
  },
  {
    name: "PackTrackCommand",
    create: () => ({ command: new PackTrackCommand(track.id), state: { clips: [clip], gaps: [gap], epoch: 0 } }),
    label: "收紧轨道",
    inverseLabel: "恢复轨道间隙",
    serialized: { type: "PackTrack", trackId: track.id, removedGaps: [gap] },
  },
  {
    name: "UnpackTrackCommand",
    create: () => inverseCase(new PackTrackCommand(track.id), { clips: [clip], gaps: [gap], epoch: 0 }),
    label: "恢复轨道间隙",
    inverseLabel: "收紧轨道",
    serialized: { type: "UnpackTrack", trackId: track.id, gapsToRestore: [gap] },
  },
  {
    name: "ToggleGapProtectionCommand",
    create: () => ({ command: new ToggleGapProtectionCommand(gap.id), state: { clips: [], gaps: [gap], epoch: 0 } }),
    label: "切换间隙保护",
    inverseLabel: "切换间隙保护",
    serialized: { type: "ToggleGapProtection", gapId: gap.id, gapPosition: { trackId: track.id, startTime: gap.startTime, duration: gap.duration } },
  },
  {
    name: "MoveClipCommand",
    create: () => ({ command: new MoveClipCommand(clip.id, track.id, "track-2", 0, 2), state: { clips: [clip], epoch: 0 } }),
    label: "移动片段",
    inverseLabel: "移动片段",
    serialized: { type: "MoveClip", clipId: clip.id, fromTrackId: track.id, toTrackId: "track-2", fromTime: 0, toTime: 2 },
  },
  {
    name: "RippleDeleteCommand",
    create: () => ({ command: new RippleDeleteCommand(clip.id), state: { tracks: [track], clips: [clip], epoch: 0 } }),
    label: "波纹删除片段",
    inverseLabel: "恢复波纹删除",
    serialized: { type: "RippleDelete", clipId: clip.id, deletedClip: clip },
  },
  {
    name: "RippleRestoreCommand",
    create: () => inverseCase(new RippleDeleteCommand(clip.id), { tracks: [track], clips: [clip], epoch: 0 }),
    label: "恢复波纹删除",
    inverseLabel: "波纹删除片段",
    serialized: { type: "RippleRestore", clipToRestore: clip, originalPositions: [] },
  },
  {
    name: "SplitClipCommand",
    create: () => ({ command: new SplitClipCommand(clip.id, 2, 30, clip), state: { clips: [clip], epoch: 0 } }),
    label: "拆分片段",
    inverseLabel: "合并拆分片段",
    serialized: { type: "SplitClip", clipId: clip.id, splitTime: 2, frameRate: 30, originalClip: clip },
  },
  {
    name: "MergeSplitClipsCommand",
    create: () => inverseCase(new SplitClipCommand(clip.id, 2, 30, clip), { clips: [clip], epoch: 0 }),
    label: "合并拆分片段",
    inverseLabel: "拆分片段",
    serialized: { type: "MergeSplitClips", originalClip: clip, frameRate: 30, splitTime: 2 },
  },
  {
    name: "AddTrackCommand",
    create: () => ({ command: new AddTrackCommand(track, 0), state: { tracks: [], clips: [], mainVideoTrackId: null, epoch: 0 } }),
    label: "添加轨道",
    inverseLabel: "删除轨道",
    serialized: { type: "AddTrack", track, index: 0 },
  },
  {
    name: "DeleteTrackCommand",
    create: () => ({ command: new DeleteTrackCommand(track.id), state: { tracks: [track], clips: [clip], mainVideoTrackId: track.id, epoch: 0 } }),
    label: "删除轨道",
    inverseLabel: "恢复轨道",
    serialized: { type: "DeleteTrack", trackId: track.id, deletedTrack: track, deletedClips: [clip], trackIndex: 0 },
  },
  {
    name: "RestoreTrackCommand",
    create: () => inverseCase(new DeleteTrackCommand(track.id), { tracks: [track], clips: [clip], mainVideoTrackId: track.id, epoch: 0 }),
    label: "恢复轨道",
    inverseLabel: "删除轨道",
    serialized: { type: "RestoreTrack", track, clips: [clip], index: 0 },
  },
  ...(["locked", "muted", "visible"] as const).map((property): CommandCase => ({
    name: `ToggleTrackPropertyCommand(${property})`,
    create: () => ({ command: new ToggleTrackPropertyCommand(track.id, property), state: { tracks: [track], clips: [], mainVideoTrackId: track.id, epoch: 0 } }),
    label: property === "locked" ? "切换轨道锁定" : property === "muted" ? "切换轨道静音" : "切换轨道可见性",
    inverseLabel: property === "locked" ? "切换轨道锁定" : property === "muted" ? "切换轨道静音" : "切换轨道可见性",
    serialized: { type: "ToggleTrackProperty", trackId: track.id, property },
  })),
  {
    name: "TransformClipCommand",
    create: () => ({ command: new TransformClipCommand(clip.id, { x: 0 }, { x: 1 }), state: { clips: [clip], epoch: 0 } }),
    label: "变换片段",
    inverseLabel: "变换片段",
    serialized: null,
  },
  {
    name: "UpdateClipCommand",
    create: () => ({ command: new UpdateClipCommand(clip.id, { opacity: 1 }, { opacity: 0.5 }), state: { clips: [clip], epoch: 0 } }),
    label: "更新片段",
    inverseLabel: "更新片段",
    serialized: { type: "UpdateClip", clipId: clip.id, oldProperties: { opacity: 1 }, newProperties: { opacity: 0.5 } },
  },
  {
    name: "TrimClipCommand",
    create: () => ({ command: new TrimClipCommand(clip.id, 0, 4, 4, 1, 4, 3), state: { clips: [clip], epoch: 0 } }),
    label: "裁剪片段",
    inverseLabel: "裁剪片段",
    serialized: { type: "TrimClip", clipId: clip.id, oldTrimIn: 0, oldTrimOut: 4, oldDuration: 4, newTrimIn: 1, newTrimOut: 4, newDuration: 3 },
  },
];

describe("timeline history command labels", () => {
  test("keeps action labels on every command and inverse", () => {
    expect(commandCases).toHaveLength(23);

    for (const commandCase of commandCases) {
      const { command, state } = commandCase.create();
      const nextState = command.apply(state);
      const inverse = command.invert();

      expect(command.label, commandCase.name).toBe(commandCase.label);
      expect(command.label, commandCase.name).toMatch(/[\u3400-\u9fff]/);
      expect(inverse.label, `${commandCase.name} inverse`).toBe(commandCase.inverseLabel);
      expect(inverse.label, `${commandCase.name} inverse`).toMatch(/[\u3400-\u9fff]/);
      expect(() => inverse.apply(nextState), `${commandCase.name} inverse apply`).not.toThrow();
    }
  });

  test("preserves every serializable command type and critical payload", () => {
    const serializableCases = commandCases.filter((commandCase) => commandCase.serialized !== null);
    expect(serializableCases).toHaveLength(22);

    for (const commandCase of serializableCases) {
      const { command, state } = commandCase.create();
      command.apply(state);

      expect((command as SerializableTestCommand).toJSON(), commandCase.name).toMatchObject(commandCase.serialized!);
    }
  });

  test("keeps a composite transaction label through inversion", () => {
    const composite = new CompositeCommand("删除片段", [new DeleteClipCommand(clip.id)]);
    composite.apply({ tracks: [track], clips: [clip], epoch: 0 });
    const inverse = composite.invert();

    expect(composite.label).toBe("删除片段");
    expect(inverse.label).toBe("删除片段");
    expect((inverse as CompositeCommand).getCommands()).toHaveLength(1);
    expect((inverse as CompositeCommand).getCommands()[0].label).toBe("添加片段");
  });
});
