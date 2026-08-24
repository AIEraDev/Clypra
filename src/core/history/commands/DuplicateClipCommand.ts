import type { Clip } from "@/types";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import { generateId } from "@/lib/utils/id";

interface TimelineState {
  clips: Clip[];
  epoch: number;
}

function cloneClip<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectClipIds(clip: Clip, ids: Map<string, string>): void {
  ids.set(clip.id, generateId("clip"));
  clip.compoundChildren?.forEach((child) => collectClipIds(child, ids));
}

function remapClipTree(clip: Clip, ids: Map<string, string>, rootId: string, trackId: string, isRoot: boolean): Clip {
  const remapped = cloneClip(clip);
  return {
    ...remapped,
    id: isRoot ? rootId : ids.get(clip.id) ?? generateId("clip"),
    trackId: isRoot ? trackId : remapped.trackId,
    detachedFromClipId: remapped.detachedFromClipId ? ids.get(remapped.detachedFromClipId) ?? remapped.detachedFromClipId : remapped.detachedFromClipId,
    compoundChildren: remapped.compoundChildren?.map((child) => remapClipTree(child, ids, rootId, trackId, false)),
  };
}

export class DuplicateClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Duplicate Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;

  private readonly sourceClips: Clip[];
  private readonly duplicatedClips: Clip[];
  private readonly duplicatedClipIds: string[];

  constructor(sourceClips: Clip[], occupiedClips: Clip[] = sourceClips) {
    this.sourceClips = sourceClips.map((clip) => cloneClip(clip)).sort((a, b) => a.startTime - b.startTime);
    const minStart = this.sourceClips[0]?.startTime ?? 0;
    const maxEnd = Math.max(...this.sourceClips.map((clip) => clip.startTime + clip.duration), minStart);
    const offset = maxEnd - minStart;
    const ids = new Map<string, string>();

    this.sourceClips.forEach((clip) => collectClipIds(clip, ids));
    this.duplicatedClipIds = this.sourceClips.map((clip) => ids.get(clip.id)!);

    const occupied = occupiedClips.map((clip) => cloneClip(clip));
    let placementOffset = offset;
    let overlaps = true;
    while (overlaps) {
      overlaps = false;
      for (const sourceClip of this.sourceClips) {
        const candidateStart = sourceClip.startTime + placementOffset;
        const candidateEnd = candidateStart + sourceClip.duration;
        const conflict = occupied.find((clip) => {
          if (clip.trackId !== sourceClip.trackId) return false;
          return candidateStart < clip.startTime + clip.duration && candidateEnd > clip.startTime;
        });
        if (conflict) {
          placementOffset = Math.max(placementOffset, conflict.startTime + conflict.duration - sourceClip.startTime);
          overlaps = true;
          break;
        }
      }
    }

    this.duplicatedClips = this.sourceClips.map((clip) => {
      const startTime = clip.startTime + placementOffset;
      const duplicate = remapClipTree(clip, ids, ids.get(clip.id)!, clip.trackId, true);
      duplicate.startTime = startTime;
      return duplicate;
    });
  }

  getDuplicatedClipIds(): string[] {
    return [...this.duplicatedClipIds];
  }

  apply(state: TimelineState): TimelineState {
    const existingIds = new Set(state.clips.map((clip) => clip.id));
    const additions = this.duplicatedClips.filter((clip) => !existingIds.has(clip.id));
    if (additions.length === 0) return state;
    return { ...state, clips: [...state.clips, ...additions.map((clip) => cloneClip(clip))], epoch: state.epoch + 1 };
  }

  invert(): Command {
    return new RemoveDuplicatedClipsCommand(this.duplicatedClipIds);
  }
}

class RemoveDuplicatedClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Undo Duplicate Clips";
  readonly timestamp = Date.now();
  readonly undoable = true;

  constructor(private readonly clipIds: string[]) {}

  apply(state: TimelineState): TimelineState {
    const ids = new Set(this.clipIds);
    const clips = state.clips.filter((clip) => !ids.has(clip.id));
    return clips.length === state.clips.length ? state : { ...state, clips, epoch: state.epoch + 1 };
  }

  invert(): Command {
    throw new Error("RemoveDuplicatedClipsCommand is only used as a history inverse");
  }
}
