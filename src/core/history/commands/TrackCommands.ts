/**
 * Track Commands
 *
 * Commands for adding and removing tracks.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Track, Clip } from "@/types";
import { t } from "@/i18n";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  mainVideoTrackId: string | null;
  epoch: number;
}

/**
 * Add Track Command
 */
export class AddTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly track: Track,
    private readonly index?: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.addTrack");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const tracks = [...state.tracks];

    if (this.index !== undefined) {
      const clamped = Math.max(0, Math.min(this.index, tracks.length));
      tracks.splice(clamped, 0, this.track);
    } else {
      tracks.push(this.track);
    }

    return {
      ...state,
      tracks,
      mainVideoTrackId: state.mainVideoTrackId ?? (this.track.type === "video" ? this.track.id : null),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    return new DeleteTrackCommand(this.track.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "AddTrack",
      track: this.track,
      index: this.index,
    };
  }

  static fromJSON(data: Record<string, any>): AddTrackCommand {
    return new AddTrackCommand(data.track, data.index);
  }
}

/**
 * Delete Track Command
 */
export class DeleteTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private deletedTrack: Track | null = null;
  private deletedClips: Clip[] = [];
  private trackIndex: number = -1;

  constructor(private readonly trackId: string) {
    this.id = generateCommandId();
    this.label = t("timeline.history.deleteTrack");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Store deleted track and clips for undo
    this.deletedTrack = state.tracks.find((t) => t.id === this.trackId) || null;
    this.deletedClips = state.clips.filter((c) => c.trackId === this.trackId);
    this.trackIndex = state.tracks.findIndex((t) => t.id === this.trackId);

    return {
      ...state,
      tracks: state.tracks.filter((t) => t.id !== this.trackId),
      clips: state.clips.filter((c) => c.trackId !== this.trackId),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    if (!this.deletedTrack) {
      throw new Error("Cannot invert DeleteTrackCommand: no deleted track stored");
    }
    return new RestoreTrackCommand(this.deletedTrack, this.deletedClips, this.trackIndex);
  }

  toJSON(): Record<string, any> {
    return {
      type: "DeleteTrack",
      trackId: this.trackId,
      deletedTrack: this.deletedTrack,
      deletedClips: this.deletedClips,
      trackIndex: this.trackIndex,
    };
  }

  static fromJSON(data: Record<string, any>): DeleteTrackCommand {
    const cmd = new DeleteTrackCommand(data.trackId);
    cmd.deletedTrack = data.deletedTrack;
    cmd.deletedClips = data.deletedClips;
    cmd.trackIndex = data.trackIndex;
    return cmd;
  }
}

/**
 * Restore Track Command (inverse of delete)
 */
class RestoreTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly track: Track,
    private readonly clips: Clip[],
    private readonly index: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.restoreTrack");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const tracks = [...state.tracks];
    const insertIndex = Math.max(0, Math.min(this.index, tracks.length));
    tracks.splice(insertIndex, 0, this.track);

    return {
      ...state,
      tracks,
      clips: [...state.clips, ...this.clips],
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    return new DeleteTrackCommand(this.track.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "RestoreTrack",
      track: this.track,
      clips: this.clips,
      index: this.index,
    };
  }

  static fromJSON(data: Record<string, any>): RestoreTrackCommand {
    return new RestoreTrackCommand(data.track, data.clips, data.index);
  }
}

/**
 * Toggle Track Property Command
 *
 * For toggling lock, mute, visibility.
 */
export class ToggleTrackPropertyCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly trackId: string,
    private readonly property: "locked" | "muted" | "visible",
  ) {
    this.id = generateCommandId();
    this.label = t(
      property === "locked"
        ? "timeline.history.toggleTrackLocked"
        : property === "muted"
          ? "timeline.history.toggleTrackMuted"
          : "timeline.history.toggleTrackVisible",
    );
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    return {
      ...state,
      tracks: state.tracks.map((track) => (track.id === this.trackId ? { ...track, [this.property]: !track[this.property] } : track)),
      epoch: state.epoch + 1, // ✅ Epoch increment inside command
    };
  }

  invert(): Command {
    // Toggle is self-inverting
    return new ToggleTrackPropertyCommand(this.trackId, this.property);
  }

  toJSON(): Record<string, any> {
    return {
      type: "ToggleTrackProperty",
      trackId: this.trackId,
      property: this.property,
    };
  }

  static fromJSON(data: Record<string, any>): ToggleTrackPropertyCommand {
    return new ToggleTrackPropertyCommand(data.trackId, data.property);
  }
}
