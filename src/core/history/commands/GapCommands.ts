/**
 * Gap Commands
 *
 * History commands for gap operations (insert, remove, resize, protect).
 * Gaps are first-class timeline entities.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Gap } from "@/types/gap";
import type { Clip } from "@/types";
import { insertGapWithRipple, createGap, removeGapWithRipple, resizeGap } from "@/lib/timeline/gapEngine";
import { t } from "@/i18n";

interface TimelineState {
  clips: Clip[];
  gaps: Gap[];
  epoch: number;
}

/**
 * Insert Gap Command
 *
 * Inserts a gap at specified position, shifting clips right (ripple)
 */
export class InsertGapCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private insertedGap: Gap | null = null;
  private shiftedClips: Array<{ id: string; originalStartTime: number }> = [];

  constructor(
    private readonly trackId: string,
    private readonly startTime: number,
    private readonly duration: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.insertGap");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Use insertGapWithRipple with protected gap logic
    const result = insertGapWithRipple(
      this.trackId,
      this.startTime,
      this.duration,
      state.clips,
      state.gaps, // Pass existing gaps to respect protected ones
      "user-insert",
    );

    if (!result.success || !result.gap) {
      console.error("[InsertGapCommand] Failed to insert gap:", result.error);
      return state;
    }

    this.insertedGap = result.gap;

    // Store original positions for undo
    this.shiftedClips = result.affectedClipIds!.map((clipId) => {
      const clip = state.clips.find((c) => c.id === clipId);
      return {
        id: clipId,
        originalStartTime: clip!.startTime,
      };
    });

    // Apply the gap insertion and shift affected clips only
    return {
      ...state,
      gaps: [...state.gaps, result.gap],
      clips: state.clips.map((c) => {
        if (result.affectedClipIds!.includes(c.id)) {
          return {
            ...c,
            startTime: c.startTime + this.duration,
          };
        }
        return c;
      }),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.insertedGap) {
      throw new Error("Cannot invert InsertGapCommand: no gap stored");
    }
    return new RemoveGapCommand(this.insertedGap.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "InsertGap",
      trackId: this.trackId,
      startTime: this.startTime,
      duration: this.duration,
      insertedGap: this.insertedGap,
      shiftedClips: this.shiftedClips,
    };
  }

  static fromJSON(data: Record<string, any>): InsertGapCommand {
    const cmd = new InsertGapCommand(data.trackId, data.startTime, data.duration);
    cmd.insertedGap = data.insertedGap;
    cmd.shiftedClips = data.shiftedClips || [];
    return cmd;
  }
}

/**
 * Remove Gap Command
 *
 * Removes a gap, shifting clips left (ripple delete)
 */
export class RemoveGapCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private removedGap: Gap | null = null;
  private shiftedClips: Array<{ id: string; originalStartTime: number }> = [];

  constructor(private readonly gapId: string) {
    this.id = generateCommandId();
    this.label = t("timeline.history.removeGap");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Find the gap
    const gap = state.gaps.find((g) => g.id === this.gapId);
    if (!gap) return state;

    this.removedGap = gap;

    // Use removeGapWithRipple with protected gap logic
    const result = removeGapWithRipple(gap, state.clips, state.gaps);

    if (!result.success) {
      console.error("[RemoveGapCommand] Failed to remove gap:", result.error);
      return state;
    }

    // Store original positions for undo
    this.shiftedClips = result.affectedClipIds!.map((clipId) => {
      const clip = state.clips.find((c) => c.id === clipId);
      return {
        id: clipId,
        originalStartTime: clip!.startTime,
      };
    });

    // Remove gap and shift affected clips only
    return {
      ...state,
      gaps: state.gaps.filter((g) => g.id !== this.gapId),
      clips: state.clips.map((c) => {
        if (result.affectedClipIds!.includes(c.id)) {
          return {
            ...c,
            startTime: c.startTime - gap.duration,
          };
        }
        return c;
      }),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (!this.removedGap) {
      throw new Error("Cannot invert RemoveGapCommand: no gap stored");
    }
    return new RestoreGapCommand(this.removedGap, this.shiftedClips);
  }

  toJSON(): Record<string, any> {
    return {
      type: "RemoveGap",
      gapId: this.gapId,
      removedGap: this.removedGap,
      shiftedClips: this.shiftedClips,
    };
  }

  static fromJSON(data: Record<string, any>): RemoveGapCommand {
    const cmd = new RemoveGapCommand(data.gapId);
    cmd.removedGap = data.removedGap;
    cmd.shiftedClips = data.shiftedClips || [];
    return cmd;
  }
}

/**
 * Restore Gap Command (inverse of remove)
 */
class RestoreGapCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly gap: Gap,
    private readonly originalPositions: Array<{ id: string; originalStartTime: number }>,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.restoreGap");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Restore gap
    const restoredGap = { ...this.gap };

    // Shift clips back to original positions
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

    return {
      ...state,
      gaps: [...state.gaps, restoredGap],
      clips: clipsWithRestoredPositions,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RemoveGapCommand(this.gap.id);
  }

  toJSON(): Record<string, any> {
    return {
      type: "RestoreGap",
      gap: this.gap,
      originalPositions: this.originalPositions,
    };
  }

  static fromJSON(data: Record<string, any>): RestoreGapCommand {
    return new RestoreGapCommand(data.gap, data.originalPositions);
  }
}

/**
 * Resize Gap Command
 *
 * Changes gap duration, shifting clips as needed
 */
export class ResizeGapCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private originalDuration: number | null = null;
  private shiftedClips: Array<{ id: string; originalStartTime: number }> = [];

  constructor(
    private readonly gapId: string,
    private readonly newDuration: number,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.resizeGap");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Find the gap
    const gap = state.gaps.find((g) => g.id === this.gapId);
    if (!gap) return state;

    this.originalDuration = gap.duration;
    const deltaTime = this.newDuration - gap.duration;

    // Use resizeGap with protected gap logic
    const result = resizeGap(gap, this.newDuration, state.clips, state.gaps);

    if (!result.success || !result.gap) {
      console.error("[ResizeGapCommand] Failed to resize gap:", result.error);
      return state;
    }

    // Store original positions for undo
    this.shiftedClips = result.affectedClipIds!.map((clipId) => {
      const clip = state.clips.find((c) => c.id === clipId);
      return {
        id: clipId,
        originalStartTime: clip!.startTime,
      };
    });

    // Resize gap and shift affected clips only
    return {
      ...state,
      gaps: state.gaps.map((g) => (g.id === this.gapId ? result.gap! : g)),
      clips: state.clips.map((c) => {
        if (result.affectedClipIds!.includes(c.id)) {
          return {
            ...c,
            startTime: c.startTime + deltaTime,
          };
        }
        return c;
      }),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    if (this.originalDuration === null) {
      throw new Error("Cannot invert ResizeGapCommand: no original duration stored");
    }
    return new ResizeGapCommand(this.gapId, this.originalDuration);
  }

  toJSON(): Record<string, any> {
    return {
      type: "ResizeGap",
      gapId: this.gapId,
      newDuration: this.newDuration,
      originalDuration: this.originalDuration,
      shiftedClips: this.shiftedClips,
    };
  }

  static fromJSON(data: Record<string, any>): ResizeGapCommand {
    const cmd = new ResizeGapCommand(data.gapId, data.newDuration);
    cmd.originalDuration = data.originalDuration;
    cmd.shiftedClips = data.shiftedClips || [];
    return cmd;
  }
}

/**
 * Pack Track Command
 *
 * Removes all unprotected gaps and packs clips tightly in one atomic operation.
 * This avoids the double-shift bug that occurs when using multiple RemoveGapCommands.
 */
export class PackTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  private removedGaps: Gap[] = [];
  private clipPositions: Array<{ id: string; originalStartTime: number; newStartTime: number }> = [];

  constructor(private readonly trackId: string) {
    this.id = generateCommandId();
    this.label = t("timeline.history.packTrack");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const trackClips = state.clips.filter((c) => c.trackId === this.trackId).sort((a, b) => a.startTime - b.startTime);

    const trackGaps = state.gaps.filter((g) => g.trackId === this.trackId);

    // Store removed gaps for undo
    this.removedGaps = trackGaps.filter((g) => !g.protected);
    const remainingGaps = trackGaps.filter((g) => g.protected);

    // Calculate new clip positions by packing them tightly
    let currentTime = 0;
    this.clipPositions = [];

    for (const clip of trackClips) {
      this.clipPositions.push({
        id: clip.id,
        originalStartTime: clip.startTime,
        newStartTime: currentTime,
      });
      currentTime += clip.duration;
    }

    // Apply new positions
    const updatedClips = state.clips.map((c) => {
      const newPosition = this.clipPositions.find((p) => p.id === c.id);
      if (newPosition) {
        return { ...c, startTime: newPosition.newStartTime };
      }
      return c;
    });

    // Keep only protected gaps, remove unprotected ones
    const updatedGaps = state.gaps.filter((g) => g.trackId !== this.trackId || g.protected);

    return {
      ...state,
      clips: updatedClips,
      gaps: updatedGaps,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new UnpackTrackCommand(this.trackId, this.removedGaps, this.clipPositions);
  }

  toJSON(): Record<string, any> {
    return {
      type: "PackTrack",
      trackId: this.trackId,
      removedGaps: this.removedGaps,
      clipPositions: this.clipPositions,
    };
  }

  static fromJSON(data: Record<string, any>): PackTrackCommand {
    const cmd = new PackTrackCommand(data.trackId);
    cmd.removedGaps = data.removedGaps || [];
    cmd.clipPositions = data.clipPositions || [];
    return cmd;
  }
}

/**
 * Unpack Track Command (inverse of pack)
 *
 * Restores removed gaps and original clip positions.
 */
class UnpackTrackCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  constructor(
    private readonly trackId: string,
    private readonly gapsToRestore: Gap[],
    private readonly originalPositions: Array<{ id: string; originalStartTime: number; newStartTime: number }>,
  ) {
    this.id = generateCommandId();
    this.label = t("timeline.history.unpackTrack");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Restore gaps
    const restoredGaps = [...state.gaps, ...this.gapsToRestore];

    // Restore original clip positions
    const restoredClips = state.clips.map((c) => {
      const originalPosition = this.originalPositions.find((p) => p.id === c.id);
      if (originalPosition) {
        return { ...c, startTime: originalPosition.originalStartTime };
      }
      return c;
    });

    return {
      ...state,
      clips: restoredClips,
      gaps: restoredGaps,
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new PackTrackCommand(this.trackId);
  }

  toJSON(): Record<string, any> {
    return {
      type: "UnpackTrack",
      trackId: this.trackId,
      gapsToRestore: this.gapsToRestore,
      originalPositions: this.originalPositions,
    };
  }

  static fromJSON(data: Record<string, any>): UnpackTrackCommand {
    return new UnpackTrackCommand(data.trackId, data.gapsToRestore, data.originalPositions);
  }
}

/**
 * Toggle Gap Protection Command
 *
 * Marks a gap as protected (won't be removed during pack track)
 * Uses position-based lookup to handle undo/redo cycles where gap IDs change
 */
export class ToggleGapProtectionCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable: boolean = true;

  // Store position instead of ID for undo/redo stability
  private gapPosition?: { trackId: string; startTime: number; duration: number };

  constructor(private readonly gapId: string) {
    this.id = generateCommandId();
    this.label = t("timeline.history.toggleGapProtection");
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    // Find gap by ID or position
    let gap = state.gaps.find((g) => g.id === this.gapId);

    // If not found by ID, try finding by position (for undo/redo)
    if (!gap && this.gapPosition) {
      gap = state.gaps.find((g) => g.trackId === this.gapPosition!.trackId && Math.abs(g.startTime - this.gapPosition!.startTime) < 0.001 && Math.abs(g.duration - this.gapPosition!.duration) < 0.001);
    }

    if (!gap) {
      console.warn(`[ToggleGapProtectionCommand] Gap not found: ${this.gapId}`);
      return state;
    }

    // Store position for future lookups
    this.gapPosition = {
      trackId: gap.trackId,
      startTime: gap.startTime,
      duration: gap.duration,
    };

    return {
      ...state,
      gaps: state.gaps.map((g) =>
        g.id === gap!.id
          ? {
              ...g,
              protected: !g.protected,
              type: !g.protected ? ("protected" as const) : ("manual" as const),
            }
          : g,
      ),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    // Toggle is its own inverse, but pass the position info
    const invertCmd = new ToggleGapProtectionCommand(this.gapId);
    invertCmd.gapPosition = this.gapPosition;
    return invertCmd;
  }

  toJSON(): Record<string, any> {
    return {
      type: "ToggleGapProtection",
      gapId: this.gapId,
      gapPosition: this.gapPosition,
    };
  }

  static fromJSON(data: Record<string, any>): ToggleGapProtectionCommand {
    const cmd = new ToggleGapProtectionCommand(data.gapId);
    cmd.gapPosition = data.gapPosition;
    return cmd;
  }
}
