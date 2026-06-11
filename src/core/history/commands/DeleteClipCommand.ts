/**
 * Delete Clip Command
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track } from "@/types";

interface TimelineState {
  tracks?: Track[];
  clips: Clip[];
  epoch: number;
}

export class DeleteClipCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private deletedClip: Clip | null = null;
  private deletedTrack: Track | null = null;
  private deletedTrackIndex: number = -1;

  constructor(private readonly clipId: string) {
    this.id = generateCommandId();
    this.label = "Delete Clip";
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const clip = state.clips.find((c) => c.id === this.clipId);
    this.deletedClip = clip || null;

    if (!clip) return state;

    const remainingClips = state.clips.filter((c) => c.id !== this.clipId);
    const hasOtherClips = remainingClips.some((c) => c.trackId === clip.trackId);

    let tracks = state.tracks;
    if (tracks && !hasOtherClips) {
      this.deletedTrack = tracks.find((t) => t.id === clip.trackId) || null;
      this.deletedTrackIndex = tracks.findIndex((t) => t.id === clip.trackId);
      if (this.deletedTrack) {
        tracks = tracks.filter((t) => t.id !== clip.trackId);
      }
    }

    const nextState: TimelineState = {
      ...state,
      clips: remainingClips,
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
    }

    return nextState;
  }

  invert(): Command {
    if (!this.deletedClip) {
      throw new Error("Cannot invert DeleteClipCommand: no deleted clip stored");
    }
    return new AddClipCommand(this.deletedClip, this.deletedTrack, this.deletedTrackIndex);
  }

  toJSON(): Record<string, any> {
    return {
      type: "DeleteClip",
      clipId: this.clipId,
      deletedClip: this.deletedClip,
      deletedTrack: this.deletedTrack,
      deletedTrackIndex: this.deletedTrackIndex,
    };
  }

  static fromJSON(data: Record<string, any>): DeleteClipCommand {
    const cmd = new DeleteClipCommand(data.clipId);
    cmd.deletedClip = data.deletedClip;
    cmd.deletedTrack = data.deletedTrack;
    cmd.deletedTrackIndex = data.deletedTrackIndex ?? -1;
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

  constructor(
    private readonly clip: Clip,
    private readonly restoredTrack?: Track | null,
    private readonly restoredTrackIndex?: number,
  ) {
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

    // Check for overlap and adjust position if needed
    const trackClips = state.clips.filter((c) => c.trackId === this.clip.trackId).sort((a, b) => a.startTime - b.startTime);

    let finalStartTime = this.clip.startTime;
    let hasOverlap = true;

    // Keep checking until no overlaps (handle cascading shifts)
    while (hasOverlap) {
      hasOverlap = false;
      for (const existingClip of trackClips) {
        const existingEnd = existingClip.startTime + existingClip.duration;
        const newEnd = finalStartTime + this.clip.duration;

        // Check for overlap
        if (finalStartTime < existingEnd && newEnd > existingClip.startTime) {
          // Overlap detected - move to end of conflicting clip
          finalStartTime = existingEnd;
          hasOverlap = true; // Re-check with new position
          break; // Restart the loop from beginning
        }
      }
    }

    // Create clip with safe position
    const safeClip = { ...this.clip, startTime: finalStartTime };

    const nextState: TimelineState = {
      ...state,
      clips: [...state.clips, safeClip],
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
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
    };
  }

  static fromJSON(data: Record<string, any>): AddClipCommand {
    return new AddClipCommand(data.clip, data.restoredTrack, data.restoredTrackIndex);
  }
}
