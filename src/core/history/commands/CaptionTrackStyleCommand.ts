/**
 * Caption Track Style Command
 *
 * Atomically broadcasts styling updates (Plain Text, Text Effects, or Motion Templates)
 * across all caption clips on a target track, maintaining full before/after snapshots
 * for deterministic undo/redo.
 */

import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import type { Clip, TextClip } from "@/types";

interface TimelineState {
  clips: Clip[];
  epoch: number;
  [key: string]: any;
}

function cloneClip(clip: Clip): Clip {
  if (typeof structuredClone === "function") return structuredClone(clip);
  return JSON.parse(JSON.stringify(clip)) as Clip;
}

export class ApplyCaptionTrackStyleCommand implements Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly undoable = true;

  private beforeClips: Clip[];
  private afterClips: Clip[];

  constructor(
    private readonly trackId: string,
    private readonly stylePatch: Partial<TextClip>,
    readonly commandLabel = "Apply Caption Style to Track",
    snapshots?: { before: Clip[]; after: Clip[] },
  ) {
    this.id = generateCommandId();
    this.label = commandLabel;
    this.timestamp = Date.now();
    this.beforeClips = snapshots?.before ? snapshots.before.map(cloneClip) : [];
    this.afterClips = snapshots?.after ? snapshots.after.map(cloneClip) : [];
  }

  apply(state: TimelineState): TimelineState {
    const trackCaptions = state.clips.filter(
      (c) => c.trackId === this.trackId && ((c as any).textRole === "caption" || c.kind === "text" || (c as any).clipKind === "text-template"),
    );

    if (trackCaptions.length === 0) {
      return state;
    }

    if (this.beforeClips.length === 0) {
      this.beforeClips = trackCaptions.map(cloneClip);
    }

    if (this.afterClips.length === 0) {
      this.afterClips = trackCaptions.map((clip) => {
        const cloned = cloneClip(clip) as TextClip;

        // Merge style patch while strictly preserving unique clip properties (id, timing, text content, words)
        const updated: TextClip = {
          ...cloned,
          ...this.stylePatch,
          id: cloned.id,
          startTime: cloned.startTime,
          duration: cloned.duration,
          text: cloned.text,
          words: cloned.words,
          trackId: cloned.trackId,
        };

        // Handle nested stroke, shadow, background objects cleanly
        if (this.stylePatch.stroke !== undefined) {
          updated.stroke = this.stylePatch.stroke ? { ...this.stylePatch.stroke } : undefined;
        }
        if (this.stylePatch.shadow !== undefined) {
          updated.shadow = this.stylePatch.shadow ? { ...this.stylePatch.shadow } : undefined;
        }
        if (this.stylePatch.background !== undefined) {
          updated.background = this.stylePatch.background ? { ...this.stylePatch.background } : undefined;
        }

        return updated as Clip;
      });
    }

    const afterMap = new Map(this.afterClips.map((c) => [c.id, c]));

    const nextClips = state.clips.map((clip) => {
      const updated = afterMap.get(clip.id);
      return updated ? cloneClip(updated) : clip;
    });

    return {
      ...state,
      clips: nextClips,
      epoch: (state.epoch || 0) + 1,
    };
  }

  invert(): Command {
    return new RestoreCaptionTrackStyleCommand(
      this.trackId,
      this.beforeClips,
      this.afterClips,
      `Undo ${this.label}`,
    );
  }
}

class RestoreCaptionTrackStyleCommand implements Command {
  readonly id: string;
  readonly timestamp: number;
  readonly undoable = true;

  constructor(
    private readonly trackId: string,
    private readonly targetClips: Clip[],
    private readonly previousClips: Clip[],
    readonly label = "Restore Caption Track Style",
  ) {
    this.id = generateCommandId();
    this.timestamp = Date.now();
  }

  apply(state: TimelineState): TimelineState {
    const targetMap = new Map(this.targetClips.map((c) => [c.id, c]));

    const nextClips = state.clips.map((clip) => {
      const target = targetMap.get(clip.id);
      return target ? cloneClip(target) : clip;
    });

    return {
      ...state,
      clips: nextClips,
      epoch: (state.epoch || 0) + 1,
    };
  }

  invert(): Command {
    return new RestoreCaptionTrackStyleCommand(
      this.trackId,
      this.previousClips,
      this.targetClips,
      `Undo ${this.label}`,
    );
  }
}
