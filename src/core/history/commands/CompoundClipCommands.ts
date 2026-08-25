import type { Clip, Track, TransitionTimelineItem } from "@/types";
import type { Gap } from "@/types/gap";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import { generateId } from "@/lib/utils/id";
import { hasTransitionReference } from "@/core/timeline/compoundClips";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  transitions?: TransitionTimelineItem[];
  gaps?: Gap[];
  epoch: number;
}

export type GroupValidation = { valid: true } | { valid: false; reason: string };

export function validateGroupSelection(clipIds: string[], clips: Clip[], tracks: Track[], transitions: TransitionTimelineItem[] = []): GroupValidation {
  const uniqueIds = [...new Set(clipIds)];
  if (uniqueIds.length < 2) return { valid: false, reason: "Select at least two clips to group" };
  const selected = uniqueIds.map((id) => clips.find((clip) => clip.id === id)).filter(Boolean) as Clip[];
  if (selected.length !== uniqueIds.length) return { valid: false, reason: "One or more selected clips no longer exist" };
  const selectedTracks = selected.map((clip) => tracks.find((candidate) => candidate.id === clip.trackId));
  if (selectedTracks.some((track) => !track)) return { valid: false, reason: "One or more selected clips belong to a missing track" };
  if (selectedTracks.some((track) => track!.locked)) return { valid: false, reason: "One or more selected tracks are locked" };
  if (selected.some((clip) => hasTransitionReference(clip.id, transitions))) return { valid: false, reason: "Remove transitions from selected clips before grouping" };
  return { valid: true };
}

export class GroupClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Group Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private readonly originalClips: Clip[];
  private readonly parent: Clip;
  private readonly originalIndex: number;
  private originalGaps: Gap[] | null = null;

  constructor(clipIds: string[], clips: Clip[], tracks: Track[], preview?: string, transitions: TransitionTimelineItem[] = [], parentId?: string) {
    const validation = validateGroupSelection(clipIds, clips, tracks, transitions);
    if (!validation.valid) throw new Error(validation.reason);
    const trackIndex = new Map(tracks.map((track, index) => [track.id, index]));
    this.originalClips = [...new Set(clipIds)]
      .map((id) => clips.find((clip) => clip.id === id)!)
      .sort((a, b) =>
        a.startTime - b.startTime ||
        (trackIndex.get(a.trackId) ?? Number.MAX_SAFE_INTEGER) - (trackIndex.get(b.trackId) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
      );
    const trackId = this.originalClips[0].trackId;
    const startTime = Math.min(...this.originalClips.map((clip) => clip.startTime));
    const endTime = Math.max(...this.originalClips.map((clip) => clip.startTime + clip.duration));
    const id = parentId ?? generateId("compound");
    this.originalIndex = Math.min(...this.originalClips.map((clip) => clips.findIndex((candidate) => candidate.id === clip.id)));
    this.parent = {
      ...this.originalClips[0],
      id,
      name: `Compound (${this.originalClips.length} clips)`,
      mediaId: `compound-${id}`,
      trackId,
      startTime,
      duration: endTime - startTime,
      trimIn: 0,
      trimOut: endTime - startTime,
      kind: "compound",
      compoundChildren: this.originalClips.map((clip) => ({ ...clip, startTime: clip.startTime - startTime })),
      compoundPreview: preview,
      x: this.originalClips[0].x,
      y: this.originalClips[0].y,
      width: this.originalClips[0].width,
      height: this.originalClips[0].height,
      opacity: 1,
      rotation: 0,
    };
  }

  apply(state: TimelineState): TimelineState {
    if (state.clips.some((clip) => clip.id === this.parent.id)) return state;
    const selectedIds = new Set(this.originalClips.map((clip) => clip.id));
    if (!this.originalClips.every((clip) => state.clips.some((candidate) => candidate.id === clip.id))) return state;
    this.originalGaps = state.gaps?.map((gap) => ({
      ...gap,
      metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
    })) ?? null;
    const remaining = state.clips.filter((clip) => !selectedIds.has(clip.id));
    const insertIndex = Math.max(0, Math.min(this.originalIndex, remaining.length));
    remaining.splice(insertIndex, 0, this.parent);
    const groupEnd = this.parent.startTime + this.parent.duration;
    const groupedTrackIds = new Set(this.originalClips.map((clip) => clip.trackId));
    const gaps = state.gaps?.filter((gap) => {
      if (!groupedTrackIds.has(gap.trackId)) return true;
      const gapEnd = gap.startTime + gap.duration;
      return !(gap.startTime >= this.parent.startTime - 0.001 && gapEnd <= groupEnd + 0.001);
    });
    return { ...state, clips: remaining, ...(gaps ? { gaps } : {}), epoch: state.epoch + 1 };
  }

  invert(): UngroupClipsCommand {
    return new UngroupClipsCommand(this.parent, this.originalClips, this.originalIndex, this, [], this.originalGaps ?? undefined);
  }

  getParentClip(): Clip { return this.parent; }
}

export class UngroupClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Ungroup Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private regroupCommand: GroupClipsCommand | null = null;

  constructor(
    private readonly parent: Clip,
    private readonly originalChildren: Clip[] = parent.compoundChildren ?? [],
    private readonly _parentIndex = 0,
    private readonly inverse?: GroupClipsCommand,
    private readonly tracks: Track[] = [],
    private readonly restoredGaps?: Gap[],
  ) {}

  apply(state: TimelineState): TimelineState {
    const parentIndex = state.clips.findIndex((clip) => clip.id === this.parent.id);
    if (parentIndex < 0 || this.parent.kind !== "compound") return state;
    const children = this.originalChildren.map((child) => ({
      ...child,
      startTime: this.parent.startTime + child.startTime,
    }));
    const clips = [...state.clips.filter((clip) => clip.id !== this.parent.id)];
    clips.splice(Math.min(parentIndex, clips.length), 0, ...children);
    const gaps = this.restoredGaps?.map((gap) => ({
      ...gap,
      metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
    }));
    return { ...state, clips, ...(gaps ? { gaps } : {}), epoch: state.epoch + 1 };
  }

  invert(): GroupClipsCommand {
    if (this.inverse) return this.inverse;
    if (!this.regroupCommand) {
      const absoluteChildren = this.originalChildren.map((child) => ({ ...child, startTime: this.parent.startTime + child.startTime }));
      this.regroupCommand = new GroupClipsCommand(absoluteChildren.map((child) => child.id), absoluteChildren, this.tracks, this.parent.compoundPreview, [], this.parent.id);
    }
    return this.regroupCommand;
  }

  getChildIds(): string[] { return this.originalChildren.map((child) => child.id); }
}
