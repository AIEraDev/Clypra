import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track } from "@/types";
import type { Gap } from "@/types/gap";
import { generateId } from "@/lib/utils/id";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  gaps?: Gap[];
  epoch: number;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

function cloneClips(clips: Clip[]): Clip[] {
  return clips.map(cloneClipSnapshot);
}

function cloneGapSnapshot(gap: Gap): Gap {
  return {
    ...gap,
    metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
  };
}

function cloneGaps(gaps: Gap[]): Gap[] {
  return gaps.map(cloneGapSnapshot);
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
  private replacedClips: Clip[] | null = null;
  private replacedGaps: Gap[] | null = null;

  private readonly clips: Clip[];
  private readonly gaps?: Gap[];

  constructor(clips: Clip[], gaps?: Gap[]) {
    this.clips = cloneClips(clips);
    this.gaps = gaps ? cloneGaps(gaps) : undefined;
  }

  apply(state: TimelineState): TimelineState {
    this.replacedClips = cloneClips(state.clips);
    this.replacedGaps = state.gaps ? cloneGaps(state.gaps) : null;
    return {
      ...state,
      clips: cloneClips(this.clips),
      ...(this.gaps !== undefined ? { gaps: cloneGaps(this.gaps) } : {}),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.replacedClips) throw new Error("Cannot invert before restoring clips");
    return new RestoreClipsCommand(this.replacedClips, this.replacedGaps ?? undefined);
  }
}

/** Split when necessary, insert media, and ripple only the target track. */
export class InsertEditCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Insert Media";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private before: Clip[] | null = null;
  private beforeGaps: Gap[] | null = null;
  private readonly leftClipId = generateId("clip");
  private readonly rightClipId = generateId("clip");
  private result: InsertEditResult | null = null;
  private readonly insertedClip: Clip;

  constructor(
    insertedClip: Clip,
    private readonly insertionTime: number,
    private readonly splitClipId: string | null,
  ) {
    this.insertedClip = cloneClipSnapshot(insertedClip);
  }

  apply(state: TimelineState): TimelineState {
    const targetTrack = state.tracks.find((track) => track.id === this.insertedClip.trackId);
    const insertedIsAudio = this.insertedClip.kind === "audio";
    if (!targetTrack || targetTrack.locked || (insertedIsAudio ? targetTrack.type !== "audio" : targetTrack.type !== "video")) {
      this.result = null;
      return state;
    }

    this.before = cloneClips(state.clips);
    this.beforeGaps = state.gaps ? cloneGaps(state.gaps) : null;
    const duration = this.insertedClip.duration;
    const targetTrackId = this.insertedClip.trackId;
    const splitClip = this.splitClipId ? state.clips.find((clip) => clip.id === this.splitClipId) : null;
    const next: Clip[] = [];

    for (const clip of state.clips) {
      if (splitClip && clip.id === splitClip.id) {
        const speed = typeof (clip as any).speed === "number" && (clip as any).speed > 0 ? (clip as any).speed : 1;
        const sourceOffset = this.insertionTime - clip.startTime;
        const sourceSplit = clip.trimIn + sourceOffset * speed;
        next.push({
          ...cloneClipSnapshot(clip),
          id: this.leftClipId,
          duration: sourceOffset,
          trimOut: sourceSplit,
        });
        next.push({
          ...cloneClipSnapshot(clip),
          id: this.rightClipId,
          startTime: this.insertionTime + duration,
          duration: clip.duration - sourceOffset,
          trimIn: sourceSplit,
        });
        continue;
      }

      if (clip.trackId === targetTrackId && clip.startTime >= this.insertionTime - 0.0005) {
        next.push({ ...cloneClipSnapshot(clip), startTime: clip.startTime + duration });
      } else {
        next.push(cloneClipSnapshot(clip));
      }
    }

    next.push({ ...cloneClipSnapshot(this.insertedClip), startTime: this.insertionTime });

    // Update gaps on the target track to prevent overlapping with inserted/shifted clips
    let nextGaps: Gap[] | undefined = undefined;
    if (state.gaps) {
      nextGaps = [];
      for (const gap of state.gaps) {
        if (gap.trackId !== targetTrackId) {
          nextGaps.push(cloneGapSnapshot(gap));
          continue;
        }

        const gapEnd = gap.startTime + gap.duration;
        if (gap.startTime >= this.insertionTime - 0.0005) {
          // Gap is entirely at or after the insertion point: shift right by duration
          nextGaps.push({
            ...cloneGapSnapshot(gap),
            startTime: gap.startTime + duration,
          });
        } else if (gapEnd > this.insertionTime + 0.0005) {
          // Gap spans across the insertion point: split into left and right pieces
          const leftDur = this.insertionTime - gap.startTime;
          const rightDur = gapEnd - this.insertionTime;
          if (leftDur > 0.001) {
            nextGaps.push({
              ...cloneGapSnapshot(gap),
              id: generateId("gap"),
              duration: leftDur,
            });
          }
          if (rightDur > 0.001) {
            nextGaps.push({
              ...cloneGapSnapshot(gap),
              id: generateId("gap"),
              startTime: this.insertionTime + duration,
              duration: rightDur,
            });
          }
        } else {
          // Gap is entirely before the insertion point: leave untouched
          nextGaps.push(cloneGapSnapshot(gap));
        }
      }
    }

    this.result = {
      insertedClipId: this.insertedClip.id,
      splitClipId: splitClip?.id ?? null,
      shiftedClipIds: state.clips.filter((clip) => clip.trackId === targetTrackId && clip.id !== splitClip?.id && clip.startTime >= this.insertionTime - 0.0005).map((clip) => clip.id),
    };
    return {
      ...state,
      clips: next,
      ...(nextGaps !== undefined ? { gaps: nextGaps } : {}),
      epoch: state.epoch + 1,
    };
  }

  /** Return the identities affected by the most recent successful application. */
  getResult(): InsertEditResult | null {
    return this.result;
  }

  invert(): Command {
    if (!this.before) throw new Error("Cannot invert InsertEditCommand before apply");
    return new RestoreClipsCommand(this.before, this.beforeGaps ?? undefined);
  }
}
