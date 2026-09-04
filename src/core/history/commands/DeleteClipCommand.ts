/**
 * Delete Clip Command
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track, TransitionTimelineItem } from "@/types";
import type { Gap } from "@/types/gap";
import { shouldAutoPruneTrack, resolvePrimaryVideoTrackId } from "@/lib/timeline/trackTypeConfig";

interface TimelineState {
  tracks?: Track[];
  clips: Clip[];
  transitions?: TransitionTimelineItem[];
  gaps?: Gap[];
  mainVideoTrackId?: string | null;
  epoch: number;
}

function cloneClipSnapshot(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

export class DeleteClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private deletedClip: Clip | null = null;
  private deletedTrack: Track | null = null;
  private deletedTrackIndex: number = -1;
  private deletedTransitions: TransitionTimelineItem[] = [];
  private deletedClipIndex: number = -1;
  private deletedGaps: Gap[] | undefined;

  constructor(private readonly clipId: string) {
    this.id = generateCommandId();
    this.label = "Delete Clip";
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const clip = state.clips.find((c) => c.id === this.clipId);
    this.deletedClip = clip ? cloneClipSnapshot(clip) : null;

    if (!clip) return state;

    this.deletedClipIndex = state.clips.findIndex((candidate) => candidate.id === this.clipId);
    this.deletedGaps = state.gaps?.map((gap) => ({
      ...gap,
      metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
    }));

    const remainingClips = state.clips.filter((c) => c.id !== this.clipId);
    const hasOtherClips = remainingClips.some((c) => c.trackId === clip.trackId);

    let tracks = state.tracks;
    let nextMainVideoTrackId = state.mainVideoTrackId;
    if (tracks && !hasOtherClips) {
      const trackToDelete = tracks.find((t) => t.id === clip.trackId);
      // Only auto-prune if the track type is configured with autoPrune: true.
      if (trackToDelete && shouldAutoPruneTrack(trackToDelete, state.tracks, state.mainVideoTrackId)) {
        this.deletedTrack = typeof structuredClone === "function"
          ? structuredClone(trackToDelete)
          : JSON.parse(JSON.stringify(trackToDelete)) as Track;
        this.deletedTrackIndex = tracks.findIndex((t) => t.id === clip.trackId);
        tracks = tracks.filter((t) => t.id !== clip.trackId);
        if (nextMainVideoTrackId === clip.trackId) {
          nextMainVideoTrackId = resolvePrimaryVideoTrackId(tracks);
        }
      }
    }

    if (state.transitions) {
      this.deletedTransitions = state.transitions.filter((t) => t.fromItemId === this.clipId || t.toItemId === this.clipId);
    }

    const nextState: TimelineState = {
      ...state,
      clips: remainingClips,
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
    }

    if (state.mainVideoTrackId !== undefined) {
      nextState.mainVideoTrackId = nextMainVideoTrackId;
    }

    if (state.transitions !== undefined) {
      nextState.transitions = state.transitions.filter((t) => t.fromItemId !== this.clipId && t.toItemId !== this.clipId);
    }

    return nextState;
  }

  invert(): Command {
    if (!this.deletedClip) {
      throw new Error("Cannot invert DeleteClipCommand: no deleted clip stored");
    }
    return new AddClipCommand(
      this.deletedClip,
      this.deletedTrack,
      this.deletedTrackIndex,
      this.deletedTransitions,
      this.deletedClipIndex,
      this.deletedGaps,
    );
  }

  toJSON(): Record<string, any> {
    return {
      type: "DeleteClip",
      clipId: this.clipId,
      deletedClip: this.deletedClip,
      deletedTrack: this.deletedTrack,
      deletedTrackIndex: this.deletedTrackIndex,
      deletedClipIndex: this.deletedClipIndex,
      deletedGaps: this.deletedGaps,
    };
  }

  static fromJSON(data: Record<string, any>): DeleteClipCommand {
    const cmd = new DeleteClipCommand(data.clipId);
    cmd.deletedClip = data.deletedClip;
    cmd.deletedTrack = data.deletedTrack;
    cmd.deletedTrackIndex = data.deletedTrackIndex ?? -1;
    cmd.deletedClipIndex = data.deletedClipIndex ?? -1;
    cmd.deletedGaps = data.deletedGaps;
    return cmd;
  }
}

/**
 * Add Clip Command (inverse of delete)
 */
export class AddClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private readonly clip: Clip;

  constructor(
    clip: Clip,
    private readonly restoredTrack?: Track | null,
    private readonly restoredTrackIndex?: number,
    private readonly restoredTransitions: TransitionTimelineItem[] = [],
    private readonly restoredClipIndex: number = -1,
    private readonly restoredGaps?: Gap[],
  ) {
    this.clip = cloneClipSnapshot(clip);
    this.id = generateCommandId();
    this.label = "Add Clip";
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    let tracks = state.tracks;
    if (tracks && this.restoredTrack && !tracks.some((t) => t.id === this.restoredTrack!.id)) {
      tracks = [...tracks];
      const insertIndex = Math.max(0, Math.min(this.restoredTrackIndex ?? tracks.length, tracks.length));
      tracks.splice(insertIndex, 0, this.restoredTrack);
    }

    let clips: Clip[];
    if (this.restoredClipIndex >= 0) {
      clips = [...state.clips];
      const insertIndex = Math.max(0, Math.min(this.restoredClipIndex, clips.length));
      clips.splice(insertIndex, 0, cloneClipSnapshot(this.clip));
    } else {
      // New clips use the legacy safe-position behavior; deleted clips carry
      // an explicit index and are restored exactly at their original slot.
      const trackClips = state.clips.filter((c) => c.trackId === this.clip.trackId).sort((a, b) => a.startTime - b.startTime);
      let finalStartTime = this.clip.startTime;
      let hasOverlap = true;

      while (hasOverlap) {
        hasOverlap = false;
        for (const existingClip of trackClips) {
          const existingEnd = existingClip.startTime + existingClip.duration;
          const newEnd = finalStartTime + this.clip.duration;
          if (finalStartTime < existingEnd && newEnd > existingClip.startTime) {
            finalStartTime = existingEnd;
            hasOverlap = true;
            break;
          }
        }
      }

      clips = [...state.clips, { ...cloneClipSnapshot(this.clip), startTime: finalStartTime }];
    }

    const nextState: TimelineState = {
      ...state,
      clips,
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
    }

    if (state.transitions !== undefined && this.restoredTransitions.length > 0) {
      const existingIds = new Set(state.transitions.map((t) => t.id));
      const transitionsToAdd = this.restoredTransitions.filter((t) => !existingIds.has(t.id));
      nextState.transitions = [...state.transitions, ...transitionsToAdd];
    }

    if (state.gaps !== undefined && this.restoredGaps !== undefined) {
      nextState.gaps = this.restoredGaps.map((gap) => ({
        ...gap,
        metadata: gap.metadata ? { ...gap.metadata } : gap.metadata,
      }));
    }

    return nextState;
  }

  invert(): Command {
    return new DeleteClipCommand(this.clip.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "AddClip",
      clip: this.clip,
      restoredTrack: this.restoredTrack,
      restoredTrackIndex: this.restoredTrackIndex,
      restoredClipIndex: this.restoredClipIndex,
      restoredGaps: this.restoredGaps,
    };
  }

  static fromJSON(data: Record<string, any>): AddClipCommand {
    return new AddClipCommand(
      data.clip,
      data.restoredTrack,
      data.restoredTrackIndex,
      data.restoredTransitions ?? [],
      data.restoredClipIndex ?? -1,
      data.restoredGaps,
    );
  }
}
