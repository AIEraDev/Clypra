import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track } from "@/types";
import { generateId } from "@/lib/utils/id";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  epoch: number;
}

/** Stable identities affected by a completed insert edit. */
export interface InsertEditResult {
  insertedClipId: string;
  splitClipId: string | null;
  shiftedClipIds: string[];
}

class RestoreClipsCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Restore Insert Edit";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private replaced: Clip[] | null = null;

  constructor(private readonly clips: Clip[]) {}

  apply(state: TimelineState): TimelineState {
    this.replaced = state.clips.map((clip) => ({ ...clip }));
    return { ...state, clips: this.clips.map((clip) => ({ ...clip })), epoch: state.epoch + 1 };
  }

  invert(): Command {
    if (!this.replaced) throw new Error("Cannot invert before restoring clips");
    return new RestoreClipsCommand(this.replaced);
  }
}

/** Split when necessary, insert media, and ripple only the target track. */
export class InsertEditCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Insert Media";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private before: Clip[] | null = null;
  private readonly leftClipId = generateId("clip");
  private readonly rightClipId = generateId("clip");
  private result: InsertEditResult | null = null;

  constructor(
    private readonly insertedClip: Clip,
    private readonly insertionTime: number,
    private readonly splitClipId: string | null,
  ) {}

  apply(state: TimelineState): TimelineState {
    const targetTrack = state.tracks.find((track) => track.id === this.insertedClip.trackId);
    const insertedIsAudio = this.insertedClip.kind === "audio";
    if (!targetTrack || targetTrack.locked || (insertedIsAudio ? targetTrack.type !== "audio" : targetTrack.type !== "video")) {
      this.result = null;
      return state;
    }

    this.before = state.clips.map((clip) => ({ ...clip }));
    const duration = this.insertedClip.duration;
    const targetTrackId = this.insertedClip.trackId;
    const splitClip = this.splitClipId ? state.clips.find((clip) => clip.id === this.splitClipId) : null;
    const next: Clip[] = [];

    for (const clip of state.clips) {
      if (splitClip && clip.id === splitClip.id) {
        const sourceOffset = this.insertionTime - clip.startTime;
        const sourceSplit = clip.trimIn + sourceOffset;
        next.push({
          ...clip,
          id: this.leftClipId,
          duration: sourceOffset,
          trimOut: sourceSplit,
        });
        next.push({
          ...clip,
          id: this.rightClipId,
          startTime: this.insertionTime + duration,
          duration: clip.duration - sourceOffset,
          trimIn: sourceSplit,
        });
        continue;
      }

      if (clip.trackId === targetTrackId && clip.startTime >= this.insertionTime - 0.0005) {
        next.push({ ...clip, startTime: clip.startTime + duration });
      } else {
        next.push(clip);
      }
    }

    next.push({ ...this.insertedClip, startTime: this.insertionTime });
    this.result = {
      insertedClipId: this.insertedClip.id,
      splitClipId: splitClip?.id ?? null,
      shiftedClipIds: state.clips.filter((clip) => clip.trackId === targetTrackId && clip.id !== splitClip?.id && clip.startTime >= this.insertionTime - 0.0005).map((clip) => clip.id),
    };
    return { ...state, clips: next, epoch: state.epoch + 1 };
  }

  /** Return the identities affected by the most recent successful application. */
  getResult(): InsertEditResult | null {
    return this.result;
  }

  invert(): Command {
    if (!this.before) throw new Error("Cannot invert InsertEditCommand before apply");
    return new RestoreClipsCommand(this.before);
  }
}
