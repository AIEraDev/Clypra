/**
 * Ripple Delete Command
 *
 * Deletes a clip and automatically closes the gap by shifting all subsequent
 * clips on the SAME TRACK leftward by the deleted clip's duration.
 *
 * This is the standard NLE behavior in CapCut, DaVinci Resolve, and Premiere Pro.
 * Cross-track clips are NOT shifted — only clips on the deleted clip's track.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, Track } from "@/types";

interface TimelineState {
  tracks?: Track[];
  clips: Clip[];
  epoch: number;
}

export class RippleDeleteCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private deletedClip: Clip | null = null;
  private shiftedClips: Array<{ id: string; originalStartTime: number }> = [];
  private deletedTrack: Track | null = null;
  private deletedTrackIndex: number = -1;

  constructor(private readonly clipId: string) {
    this.id = generateCommandId();
    this.label = "Ripple Delete Clip";
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Find the clip to delete
    const clip = state.clips.find((c) => c.id === this.clipId);
    if (!clip) return state;

    // Store for undo
    this.deletedClip = clip;
    const gapDuration = clip.duration;
    const gapStart = clip.startTime;
    const trackId = clip.trackId;

    // Find all clips on the SAME TRACK that start after the deleted clip
    const clipsToShift = state.clips.filter((c) => c.trackId === trackId && c.startTime >= gapStart && c.id !== this.clipId);

    // Store original positions for undo
    this.shiftedClips = clipsToShift.map((c) => ({
      id: c.id,
      originalStartTime: c.startTime,
    }));

    const remainingClips = state.clips.filter((c) => c.id !== this.clipId);
    const hasOtherClips = remainingClips.some((c) => c.trackId === trackId);

    let tracks = state.tracks;
    if (tracks && !hasOtherClips) {
      this.deletedTrack = tracks.find((t) => t.id === trackId) || null;
      this.deletedTrackIndex = tracks.findIndex((t) => t.id === trackId);
      if (this.deletedTrack) {
        tracks = tracks.filter((t) => t.id !== trackId);
      }
    }

    // Apply the delete and shift
    const nextState: TimelineState = {
      ...state,
      clips: state.clips
        .filter((c) => c.id !== this.clipId) // Delete the clip
        .map((c) => {
          // Only shift clips on the same track that are after the gap
          if (c.trackId === trackId && c.startTime >= gapStart) {
            return {
              ...c,
              startTime: c.startTime - gapDuration, // Shift left by gap duration
            };
          }
          return c; // Other clips unchanged
        }),
      epoch: state.epoch + 1,
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
    }

    return nextState;
  }

  invert(): Command {
    if (!this.deletedClip) {
      throw new Error("Cannot invert RippleDeleteCommand: no deleted clip stored");
    }
    return new RippleRestoreCommand(this.deletedClip, this.shiftedClips, this.deletedTrack, this.deletedTrackIndex);
  }

  toJSON(): Record<string, any> {
    return {
      type: "RippleDelete",
      clipId: this.clipId,
      deletedClip: this.deletedClip,
      shiftedClips: this.shiftedClips,
      deletedTrack: this.deletedTrack,
      deletedTrackIndex: this.deletedTrackIndex,
    };
  }

  static fromJSON(data: Record<string, any>): RippleDeleteCommand {
    const cmd = new RippleDeleteCommand(data.clipId);
    cmd.deletedClip = data.deletedClip;
    cmd.shiftedClips = data.shiftedClips || [];
    cmd.deletedTrack = data.deletedTrack;
    cmd.deletedTrackIndex = data.deletedTrackIndex ?? -1;
    return cmd;
  }
}

/**
 * Ripple Restore Command (inverse of ripple delete)
 *
 * Restores a deleted clip and shifts all affected clips back to their
 * original positions.
 */
class RippleRestoreCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly clipToRestore: Clip,
    private readonly originalPositions: Array<{ id: string; originalStartTime: number }>,
    private readonly restoredTrack?: Track | null,
    private readonly restoredTrackIndex?: number,
  ) {
    this.id = generateCommandId();
    this.label = "Restore Ripple Delete";
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    let tracks = state.tracks;
    if (tracks && this.restoredTrack && !tracks.some((t) => t.id === this.restoredTrack!.id)) {
      tracks = [...tracks];
      const insertIndex = Math.max(0, Math.min(this.restoredTrackIndex ?? tracks.length, tracks.length));
      tracks.splice(insertIndex, 0, this.restoredTrack);
    }

    const gapDuration = this.clipToRestore.duration;
    const gapStart = this.clipToRestore.startTime;
    const trackId = this.clipToRestore.trackId;

    // Shift clips back to their original positions
    const clipsWithRestoredPositions = state.clips.map((c) => {
      const originalPosition = this.originalPositions.find((p) => p.id === c.id);
      if (originalPosition) {
        return {
          ...c,
          startTime: originalPosition.originalStartTime,
        };
      }
      return c;
    });

    // Add the restored clip back
    const nextState: TimelineState = {
      ...state,
      clips: [...clipsWithRestoredPositions, this.clipToRestore],
      epoch: state.epoch + 1,
    };

    if (state.tracks !== undefined) {
      nextState.tracks = tracks;
    }

    return nextState;
  }

  invert(): Command {
    return new RippleDeleteCommand(this.clipToRestore.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "RippleRestore",
      clipToRestore: this.clipToRestore,
      originalPositions: this.originalPositions,
      restoredTrack: this.restoredTrack,
      restoredTrackIndex: this.restoredTrackIndex,
    };
  }

  static fromJSON(data: Record<string, any>): RippleRestoreCommand {
    return new RippleRestoreCommand(data.clipToRestore, data.originalPositions, data.restoredTrack, data.restoredTrackIndex);
  }
}
