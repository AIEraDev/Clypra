/**
 * Caption Commands (§3 Full-snapshot command journal integration)
 *
 * All mutations to caption tracks and cues are command-backed with full
 * snapshots, never partial property deltas, guaranteeing deterministic
 * undo/redo and monotonic epoch increments.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { CaptionTrack, CaptionCue } from "@/types/captions";

interface TimelineStateWithCaptions {
  captionTracks: CaptionTrack[];
  activeCaptionTrackId: string | null;
  epoch: number;
  [key: string]: any;
}

/**
 * Helper to deep-clone a caption track to prevent shared reference mutations.
 */
export function cloneCaptionTrack(track: CaptionTrack): CaptionTrack {
  return JSON.parse(JSON.stringify(track));
}

/**
 * Helper to deep-clone an array of caption tracks.
 */
export function cloneCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  return tracks.map(cloneCaptionTrack);
}

/**
 * Sorts caption cues monotonically by startTicks.
 */
export function sortCaptionCues(cues: CaptionCue[]): CaptionCue[] {
  return [...cues].sort((a, b) => a.startTicks - b.startTicks);
}

/**
 * Restore an entire array of caption tracks (used for track additions/removals undo).
 */
export class RestoreCaptionTracksCommand implements Command {
  readonly id: string;
  readonly timestamp: number;
  readonly undoable = true;

  constructor(
    private readonly targetTracks: CaptionTrack[],
    private readonly previousTracks: CaptionTrack[],
    readonly label = "Restore Caption Tracks",
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.targetTracks = cloneCaptionTracks(targetTracks);
    this.previousTracks = cloneCaptionTracks(previousTracks);
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const nextActive =
      this.targetTracks.find((t) => t.id === state.activeCaptionTrackId)?.id ??
      this.targetTracks[0]?.id ??
      null;

    return {
      ...state,
      captionTracks: cloneCaptionTracks(this.targetTracks),
      activeCaptionTrackId: nextActive,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreCaptionTracksCommand(
      this.previousTracks,
      this.targetTracks,
      `Undo ${this.label}`,
    );
  }
}

/**
 * Add a new Caption Track.
 */
export class AddCaptionTrackCommand implements Command {
  readonly id: string;
  readonly label = "Add Caption Track";
  readonly timestamp: number;
  readonly undoable = true;
  private readonly newTrack: CaptionTrack;
  private readonly beforeTracks: CaptionTrack[];

  constructor(newTrack: CaptionTrack, beforeTracks: CaptionTrack[]) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.newTrack = cloneCaptionTrack(newTrack);
    this.beforeTracks = cloneCaptionTracks(beforeTracks);
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    return {
      ...state,
      captionTracks: [...cloneCaptionTracks(state.captionTracks || []), cloneCaptionTrack(this.newTrack)],
      activeCaptionTrackId: this.newTrack.id,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreCaptionTracksCommand(
      this.beforeTracks,
      [...this.beforeTracks, this.newTrack],
      "Undo Add Caption Track",
    );
  }
}

/**
 * Remove an existing Caption Track.
 */
export class RemoveCaptionTrackCommand implements Command {
  readonly id: string;
  readonly label = "Remove Caption Track";
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTracks: CaptionTrack[];

  constructor(
    private readonly trackId: string,
    beforeTracks: CaptionTrack[],
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTracks = cloneCaptionTracks(beforeTracks);
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const afterTracks = (state.captionTracks || []).filter(
      (t) => t.id !== this.trackId,
    );
    const nextActiveId =
      state.activeCaptionTrackId === this.trackId
        ? (afterTracks[0]?.id ?? null)
        : state.activeCaptionTrackId;

    return {
      ...state,
      captionTracks: afterTracks,
      activeCaptionTrackId: nextActiveId,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreCaptionTracksCommand(
      this.beforeTracks,
      this.beforeTracks.filter((t) => t.id !== this.trackId),
      "Undo Remove Caption Track",
    );
  }
}

/**
 * Update an entire Caption Track (name, visibility, locked, defaultStyle, or cues).
 */
export class UpdateCaptionTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTrack: CaptionTrack;
  private readonly afterTrack: CaptionTrack;

  constructor(
    beforeTrack: CaptionTrack,
    afterTrack: CaptionTrack,
    label = "Update Caption Track",
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.label = label;
    this.beforeTrack = cloneCaptionTrack(beforeTrack);
    this.afterTrack = cloneCaptionTrack(afterTrack);
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const tracks = (state.captionTracks || []).map((t) =>
      t.id === this.afterTrack.id ? cloneCaptionTrack(this.afterTrack) : t,
    );

    return {
      ...state,
      captionTracks: tracks,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateCaptionTrackCommand(
      this.afterTrack,
      this.beforeTrack,
      `Undo ${this.label}`,
    );
  }
}

/**
 * Add a cue to a caption track.
 */
export class AddCaptionCueCommand implements Command {
  readonly id: string;
  readonly label = "Add Caption";
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTrack: CaptionTrack;
  private readonly afterTrack: CaptionTrack;

  constructor(track: CaptionTrack, newCue: CaptionCue) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTrack = cloneCaptionTrack(track);

    const updatedCues = sortCaptionCues([...track.cues, newCue]);
    this.afterTrack = {
      ...cloneCaptionTrack(track),
      cues: updatedCues,
    };
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const tracks = (state.captionTracks || []).map((t) =>
      t.id === this.afterTrack.id ? cloneCaptionTrack(this.afterTrack) : t,
    );

    return {
      ...state,
      captionTracks: tracks,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateCaptionTrackCommand(
      this.afterTrack,
      this.beforeTrack,
      "Undo Add Caption",
    );
  }
}

/**
 * Remove a cue from a caption track.
 */
export class RemoveCaptionCueCommand implements Command {
  readonly id: string;
  readonly label = "Delete Caption";
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTrack: CaptionTrack;
  private readonly afterTrack: CaptionTrack;

  constructor(track: CaptionTrack, cueId: string) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTrack = cloneCaptionTrack(track);

    const updatedCues = track.cues.filter((c) => c.id !== cueId);
    this.afterTrack = {
      ...cloneCaptionTrack(track),
      cues: updatedCues,
    };
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const tracks = (state.captionTracks || []).map((t) =>
      t.id === this.afterTrack.id ? cloneCaptionTrack(this.afterTrack) : t,
    );

    return {
      ...state,
      captionTracks: tracks,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateCaptionTrackCommand(
      this.afterTrack,
      this.beforeTrack,
      "Undo Delete Caption",
    );
  }
}

/**
 * Update a single cue within a caption track (text, timing, or style override).
 */
export class UpdateCaptionCueCommand implements Command {
  readonly id: string;
  readonly label = "Edit Caption";
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTrack: CaptionTrack;
  private readonly afterTrack: CaptionTrack;

  constructor(
    track: CaptionTrack,
    updatedCue: CaptionCue,
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTrack = cloneCaptionTrack(track);

    const updatedCues = sortCaptionCues(
      track.cues.map((c) => (c.id === updatedCue.id ? updatedCue : c)),
    );
    this.afterTrack = {
      ...cloneCaptionTrack(track),
      cues: updatedCues,
    };
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const tracks = (state.captionTracks || []).map((t) =>
      t.id === this.afterTrack.id ? cloneCaptionTrack(this.afterTrack) : t,
    );

    return {
      ...state,
      captionTracks: tracks,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateCaptionTrackCommand(
      this.afterTrack,
      this.beforeTrack,
      "Undo Edit Caption",
    );
  }
}

/**
 * Batch update cues within a caption track (e.g. Ingesting auto-captions or bulk retiming).
 */
export class BatchUpdateCaptionCuesCommand implements Command {
  readonly id: string;
  readonly timestamp: number;
  readonly undoable = true;
  private readonly beforeTrack: CaptionTrack;
  private readonly afterTrack: CaptionTrack;

  constructor(
    track: CaptionTrack,
    newCues: CaptionCue[],
    readonly label = "Update Captions",
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
    this.beforeTrack = cloneCaptionTrack(track);
    this.afterTrack = {
      ...cloneCaptionTrack(track),
      cues: sortCaptionCues(newCues),
    };
  }

  apply(state: TimelineStateWithCaptions): TimelineStateWithCaptions {
    const tracks = (state.captionTracks || []).map((t) =>
      t.id === this.afterTrack.id ? cloneCaptionTrack(this.afterTrack) : t,
    );

    return {
      ...state,
      captionTracks: tracks,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UpdateCaptionTrackCommand(
      this.afterTrack,
      this.beforeTrack,
      `Undo ${this.label}`,
    );
  }
}
