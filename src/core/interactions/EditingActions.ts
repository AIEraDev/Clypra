/**
 * Editing Actions - Interaction → Command Bridge Layer
 *
 * This is the unified interaction abstraction layer that bridges
 * user interactions (keyboard, mouse, playhead) to the command system.
 *
 * Architecture:
 *   User Interaction → Intent → Command → History → Store
 *
 * Key principles:
 * - All editing operations flow through commands (no direct store mutations)
 * - Interactions define intent, not implementation
 * - Commands are the single source of truth for mutations
 * - History system captures all edits automatically
 *
 * This prevents:
 * - Dual mutation paths (UI → store vs UI → command → store)
 * - Inconsistent undo/redo behavior
 * - Fragmented interaction models
 * - Replay/automation issues
 */

import { useHistoryStore } from "@/store/historyStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { useUIStore } from "@/store/uiStore";
import {
  DeleteClipCommand,
  RippleDeleteRangeCommand,
  SplitClipCommand,
  UpdateClipCommand,
  GroupClipsCommand,
  UngroupClipsCommand,
  SwapClipsCommand,
  SlipClipCommand,
  SlideClipCommand,
  RollClipCommand,
  validateGroupSelection,
} from "../history/commands";
import type { Clip } from "@/types";
import { snapToFrameBoundary } from "@/lib/utils/frameTime";
import {
  getScrollLeftToRevealTime,
  getTimelineViewportEndForDuration,
} from "@/lib/timeline/timelineViewport";
import { getClipDisplayName } from "@/lib/timeline/clipName";
import { perfLogService } from "@/services/perfLogService";

// ---------------------------------------------------------------------------
// Timeline edit telemetry types
// ---------------------------------------------------------------------------

export type TimelineEditOperation = "split" | "move" | "trim" | "slip" | "slide" | "roll";

export interface TimelineEditTelemetry {
  operation: TimelineEditOperation;
  /** Primary clip involved (for split, move, slip, slide, roll). */
  clipId?: string;
  /** Secondary clip involved (for roll edit: incoming clip). */
  secondaryClipId?: string;
  /** Delta applied in seconds (for slip, slide, roll). */
  deltaApplied?: number;
  /** For split: the time the split was applied (seconds). */
  splitTime?: number;
  /** For split: which UI surface triggered the action. */
  splitSource?: SplitIntent["source"];
  /** For move: original timeline track ID before the move. */
  fromTrackId?: string;
  /** For move: destination track ID after the move. */
  toTrackId?: string;
  /** For move/slide: original start time (seconds). */
  fromTime?: number;
  /** For move/slide: committed start time (seconds). */
  toTime?: number;
  /** For trim/slide/roll: number of clips affected by the gesture. */
  trimClipCount?: number;
  /** For slip: boundaries before and after. */
  fromTrimIn?: number;
  toTrimIn?: number;
  fromTrimOut?: number;
  toTrimOut?: number;
  /** Whether the operation completed successfully (false = rolled back). */
  success: boolean;
  /** Error message if operation failed. */
  error?: string;
  /** Wall-clock duration of the interaction from start to commit (ms). */
  durationMs: number;
}

/**
 * Split interaction context.
 * Defines the intent to split, not the implementation.
 */
export interface SplitIntent {
  /** Clip to split */
  clipId: string;
  /** Time to split at (timeline time) */
  time: number;
  /** Source of the split action (for telemetry/debugging) */
  source: "keyboard" | "click" | "playhead" | "context-menu";
}

/**
 * Split interaction result.
 */
export interface SplitResult {
  success: boolean;
  error?: string;
  /** Stable user-facing name captured before the original clip is replaced. */
  clipName?: string;
  leftClipId?: string;
  rightClipId?: string;
}

export interface TrimAtPlayheadResult {
  success: boolean;
  clipId: string;
  error?: string;
}

/** Result of deleting the current clip selection. */
export interface DeleteSelectionResult {
  deletedClipIds: string[];
  editTime: number;
  selectedClipId: string | null;
}

export interface RenameClipResult {
  success: boolean;
  name?: string;
  error?: string;
}

/**
 * Editing Actions - Unified interaction layer.
 *
 * All editing operations should flow through this layer.
 * This ensures consistent command execution and history tracking.
 */
export class EditingActions {
  /** Rename one timeline clip while keeping the edit undoable. */
  static renameClip(clipId: string, name: string): RenameClipResult {
    const clip = useTimelineStore
      .getState()
      .clips.find((candidate) => candidate.id === clipId);
    if (!clip) return { success: false, error: "Clip not found" };

    const trimmedName = name.trim();
    if (!trimmedName)
      return { success: false, error: "Clip name cannot be empty" };

    useHistoryStore
      .getState()
      .execute(
        new UpdateClipCommand(
          clipId,
          { name: clip.name },
          { name: trimmedName },
        ),
      );

    return { success: true, name: trimmedName };
  }

  static swapSelectedClips(): { error: string | null } {
    const selectedClipIds = useUIStore.getState().selectedClipIds;
    if (selectedClipIds.length !== 2)
      return { error: "Select exactly 2 clips to swap" };
    const timeline = useTimelineStore.getState();
    const validationError = SwapClipsCommand.validate(
      timeline,
      selectedClipIds[0],
      selectedClipIds[1],
    );
    if (validationError) return { error: validationError };
    const command = new SwapClipsCommand(
      selectedClipIds[0],
      selectedClipIds[1],
    );
    useHistoryStore.getState().execute(command);
    return { error: command.getError() };
  }

  static groupSelectedClips(clipIds: string[]): {
    success: boolean;
    compoundClipId?: string;
    error?: string;
  } {
    const timeline = useTimelineStore.getState();
    const selected = timeline.clips.filter((clip) => clipIds.includes(clip.id));
    const validation = validateGroupSelection(
      clipIds,
      timeline.clips,
      timeline.tracks,
      timeline.transitions,
    );
    if (!validation.valid) return { success: false, error: validation.reason };
    const preview = selected
      .map(
        (clip) =>
          useProjectStore
            .getState()
            .mediaAssets.find((asset) => asset.id === clip.mediaId)
            ?.posterFrame || (clip as any).compoundPreview,
      )
      .find(Boolean);
    try {
      const command = new GroupClipsCommand(
        clipIds,
        timeline.clips,
        timeline.tracks,
        preview,
        timeline.transitions,
      );
      useHistoryStore.getState().execute(command);
      const parent = command.getParentClip();
      useUIStore.getState().selectClip(parent.id);
      return { success: true, compoundClipId: parent.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to group clips",
      };
    }
  }

  static ungroupClip(clipId: string): {
    success: boolean;
    childClipIds?: string[];
    error?: string;
  } {
    const timeline = useTimelineStore.getState();
    const parent = timeline.clips.find((clip) => clip.id === clipId);
    if (!parent || parent.kind !== "compound" || !parent.compoundChildren)
      return { success: false, error: "Select a compound clip" };
    const command = new UngroupClipsCommand(
      parent,
      parent.compoundChildren,
      timeline.clips.findIndex((clip) => clip.id === clipId),
      undefined,
      timeline.tracks,
    );
    useHistoryStore.getState().execute(command);
    const childIds = command.getChildIds();
    useUIStore.getState().clearSelection();
    childIds.forEach((id) => useUIStore.getState().toggleClipSelection(id));
    return { success: true, childClipIds: childIds };
  }

  /** Delete selected clips with ripple closure, or lift them while preserving time. */
  static deleteSelection(
    clipIds: string[],
    lift = false,
  ): DeleteSelectionResult | null {
    const timeline = useTimelineStore.getState();
    const selected = timeline.clips.filter(
      (clip) =>
        clipIds.includes(clip.id) &&
        !timeline.tracks.find((track) => track.id === clip.trackId)?.locked,
    );
    if (selected.length === 0) return null;

    const editTime = Math.min(...selected.map((clip) => clip.startTime));
    const affectedTrackIds = new Set(selected.map((clip) => clip.trackId));
    const history = useHistoryStore.getState();

    if (lift) {
      history.beginTransaction("Lift Delete Clips");
      selected.forEach((clip) =>
        history.execute(new DeleteClipCommand(clip.id)),
      );
      history.commitTransaction();
    } else {
      history.execute(
        new RippleDeleteRangeCommand(selected.map((clip) => clip.id)),
      );
    }

    affectedTrackIds.forEach((trackId) =>
      useTimelineStore.getState().detectAndSyncGaps(trackId),
    );

    const nextState = useTimelineStore.getState();
    const nextClip =
      nextState.clips
        .filter(
          (clip) =>
            affectedTrackIds.has(clip.trackId) &&
            clip.startTime >= editTime - 0.001,
        )
        .sort((a, b) => a.startTime - b.startTime)[0] ?? null;

    const ui = useUIStore.getState();
    ui.clearSelection();
    if (nextClip) ui.selectClip(nextClip.id);

    const session = getActiveSessionOrNull();
    session?.transportAuthority?.seek(editTime);

    const container =
      typeof document === "undefined"
        ? null
        : (document.getElementById(
            "timeline-tracks-container",
          ) as HTMLDivElement | null);
    if (container) {
      const currentTimeline = useTimelineStore.getState();
      const nextScrollLeft = getScrollLeftToRevealTime({
        time: editTime,
        currentScrollLeft: container.scrollLeft,
        containerWidth: container.clientWidth,
        pixelsPerSecond: currentTimeline.pixelsPerSecond,
        viewportEndSeconds: getTimelineViewportEndForDuration(
          currentTimeline.getTimelineEndTime(),
        ),
        hasClips: currentTimeline.clips.length > 0,
      });
      container.scrollLeft = nextScrollLeft;
      currentTimeline.setScrollLeft(nextScrollLeft);
    }

    return {
      deletedClipIds: selected.map((clip) => clip.id),
      editTime,
      selectedClipId: nextClip?.id ?? null,
    };
  }

  /**
   * Execute a split operation.
   *
   * This is the ONLY way split should be triggered from UI.
   *
   * @param intent - Split intent (what to split, where, why)
   * @returns Split result
   */
  static executeSplit(intent: SplitIntent): SplitResult {
    const t0 = performance.now();
    const { clipId, time, source } = intent;
    const result = EditingActions._executeSplitImpl(intent);
    EditingActions.recordTimelineEdit({
      operation: "split",
      clipId,
      splitTime: time,
      splitSource: source,
      success: result.success,
      durationMs: performance.now() - t0,
    });
    return result;
  }

  private static _executeSplitImpl(intent: SplitIntent): SplitResult {
    const { clipId, time, source: _source } = intent;

    // Get current state
    const timelineState = useTimelineStore.getState();
    const clip = timelineState.clips.find((c) => c.id === clipId);

    // Validate clip exists
    if (!clip) {
      return {
        success: false,
        error: `Clip ${clipId} not found`,
      };
    }

    if (clip.kind === "compound") {
      return {
        success: false,
        error: "Compound clips are move-only; ungroup them before splitting",
      };
    }

    // Validate split time is within clip bounds
    const clipEndTime = clip.startTime + clip.duration;
    if (time <= clip.startTime || time >= clipEndTime) {
      return {
        success: false,
        error: `Split time ${time.toFixed(2)}s is outside clip bounds [${clip.startTime.toFixed(2)}s, ${clipEndTime.toFixed(2)}s]`,
      };
    }

    // Validate clip is not locked
    const track = timelineState.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) {
      return {
        success: false,
        error: "Cannot split clip on locked track",
      };
    }

    // Get frameRate from project store at call site
    const frameRate = useProjectStore.getState().project?.frameRate ?? 30;
    const snappedTime = snapToFrameBoundary(time, frameRate);
    if (snappedTime <= clip.startTime || snappedTime >= clipEndTime) {
      return {
        success: false,
        error: `Split time ${time.toFixed(2)}s snaps to a clip boundary`,
      };
    }

    // Create and execute command
    const command = new SplitClipCommand(clipId, time, frameRate, clip);
    const clipName = getClipDisplayName(
      clip,
      useProjectStore.getState().mediaAssets,
    );

    try {
      useHistoryStore.getState().execute(command);

      // Get both new clip IDs (original clip is removed)
      const leftClipId = command.getLeftClipId();
      const rightClipId = command.getRightClipId();

      if (!leftClipId || !rightClipId) {
        return {
          success: false,
          error: "Split did not create both clips",
        };
      }

      // Verify both clips exist in timeline
      const newState = useTimelineStore.getState();
      const leftClip = newState.clips.find((c) => c.id === leftClipId);
      const rightClip = newState.clips.find((c) => c.id === rightClipId);

      if (!leftClip || !rightClip) {
        return {
          success: false,
          error: "Split clips not found in timeline",
        };
      }

      // Select only the right split. This keeps the split workflow focused on
      // the newly created continuation and prevents Delete from removing both
      // halves when the user immediately edits the selected result.
      useUIStore.getState().selectClip(rightClipId);

      return {
        success: true,
        clipName,
        leftClipId,
        rightClipId,
      };
    } catch (error) {
      console.error("[EditingActions] Split failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Split clip at playhead position.
   *
   * Splits the currently selected clip(s) at the playhead.
   * If no clips are selected, finds clips under the playhead.
   *
   * @returns Split results for all affected clips
   */
  static splitAtPlayhead(): SplitResult[] {
    const currentTime = getPlaybackClock().time;
    const selectedClipIds = useUIStore.getState().selectedClipIds;
    const clips = useTimelineStore.getState().clips;

    // If clips are selected, split those
    if (selectedClipIds.length > 0) {
      const results: SplitResult[] = [];

      for (const clipId of selectedClipIds) {
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) continue;

        // Check if playhead is within clip bounds
        const clipEndTime = clip.startTime + clip.duration;
        if (currentTime > clip.startTime && currentTime < clipEndTime) {
          const result = this.executeSplit({
            clipId,
            time: currentTime,
            source: "playhead",
          });
          results.push(result);
        }
      }

      return results;
    }

    // No selection - find all clips under playhead
    const clipsUnderPlayhead = clips.filter((clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return currentTime > clip.startTime && currentTime < clipEndTime;
    });

    return clipsUnderPlayhead.map((clip) =>
      this.executeSplit({
        clipId: clip.id,
        time: currentTime,
        source: "playhead",
      }),
    );
  }

  /**
   * PB-HIDDEN-005: Split only the specified clips at the playhead position.
   * Used by Ctrl+K to split only selected clips (vs Ctrl+Shift+K for all).
   *
   * @param clipIds - IDs of clips to split
   * @returns Split results for clips that were under the playhead
   */
  static splitSelectedAtPlayhead(clipIds: string[]): SplitResult[] {
    const currentTime = getPlaybackClock().time;
    const clips = useTimelineStore.getState().clips;
    const results: SplitResult[] = [];

    for (const clipId of clipIds) {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) continue;

      // Check if playhead is within clip bounds
      const clipEndTime = clip.startTime + clip.duration;
      if (currentTime > clip.startTime && currentTime < clipEndTime) {
        const result = this.executeSplit({
          clipId,
          time: currentTime,
          source: "playhead",
        });
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Split all clips crossing the current playhead.
   * This ignores selection and applies globally across unlocked tracks.
   */
  static splitAllAtPlayhead(): SplitResult[] {
    const currentTime = getPlaybackClock().time;
    const clips = useTimelineStore.getState().clips;
    const tracks = useTimelineStore.getState().tracks;

    const unlockedTrackIds = new Set(
      tracks.filter((t) => !t.locked).map((t) => t.id),
    );
    const clipsUnderPlayhead = clips.filter((clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return (
        clip.kind !== "compound" &&
        unlockedTrackIds.has(clip.trackId) &&
        currentTime > clip.startTime &&
        currentTime < clipEndTime
      );
    });

    if (clipsUnderPlayhead.length === 0) return [];

    const history = useHistoryStore.getState();
    history.beginTransaction("Split All at Playhead");
    const results = clipsUnderPlayhead.map((clip) =>
      this.executeSplit({
        clipId: clip.id,
        time: currentTime,
        source: "playhead",
      }),
    );
    if (results.every((result) => result.success)) history.commitTransaction();
    else history.rollbackTransaction();
    return results;
  }

  /**
   * Delete/trim left side up to playhead for selected clips
   * (or clips under playhead when nothing is selected).
   */
  static deleteLeftAtPlayhead(): TrimAtPlayheadResult[] {
    return this.trimAtPlayhead("left");
  }

  /**
   * Delete/trim right side from playhead for selected clips
   * (or clips under playhead when nothing is selected).
   */
  static deleteRightAtPlayhead(): TrimAtPlayheadResult[] {
    return this.trimAtPlayhead("right");
  }

  private static trimAtPlayhead(
    side: "left" | "right",
  ): TrimAtPlayheadResult[] {
    const currentTime = getPlaybackClock().time;
    const timelineState = useTimelineStore.getState();
    const selectedClipIds = useUIStore.getState().selectedClipIds;
    const lockedTrackIds = new Set(
      timelineState.tracks.filter((t) => t.locked).map((t) => t.id),
    );

    const selectedSet = new Set(selectedClipIds);
    const candidates = (
      selectedClipIds.length > 0
        ? timelineState.clips.filter((c) => selectedSet.has(c.id))
        : timelineState.clips.filter(
            (clip) =>
              currentTime > clip.startTime &&
              currentTime < clip.startTime + clip.duration,
          )
    ).filter(
      (clip) => !lockedTrackIds.has(clip.trackId) && clip.kind !== "compound",
    );

    if (candidates.length === 0) return [];

    const history = useHistoryStore.getState();
    history.beginTransaction(
      side === "left" ? "Delete Left at Playhead" : "Delete Right at Playhead",
    );
    const results: TrimAtPlayheadResult[] = [];

    try {
      for (const clip of candidates) {
        const clipEnd = clip.startTime + clip.duration;
        if (currentTime <= clip.startTime || currentTime >= clipEnd) {
          continue;
        }

        if (side === "left") {
          const newStartTime = currentTime;
          const consumedDuration = newStartTime - clip.startTime;
          const newTrimIn = clip.trimIn + consumedDuration;
          const newDuration = clipEnd - newStartTime;
          const newProperties = {
            startTime: newStartTime,
            trimIn: newTrimIn,
            duration: newDuration,
          };

          history.execute(
            new UpdateClipCommand(
              clip.id,
              {
                startTime: clip.startTime,
                trimIn: clip.trimIn,
                duration: clip.duration,
              },
              newProperties,
            ),
          );
        } else {
          const newTrimOut = clip.trimIn + (currentTime - clip.startTime);
          const newDuration = currentTime - clip.startTime;
          const newProperties = {
            trimOut: newTrimOut,
            duration: newDuration,
          };

          history.execute(
            new UpdateClipCommand(
              clip.id,
              {
                trimOut: clip.trimOut,
                duration: clip.duration,
              },
              newProperties,
            ),
          );
        }

        results.push({ success: true, clipId: clip.id });
      }

      if (results.length === 0) {
        history.rollbackTransaction();
        return [];
      }

      history.commitTransaction();
      return results;
    } catch (error) {
      history.rollbackTransaction();
      const message =
        error instanceof Error ? error.message : "Unknown trim error";
      return candidates.map((clip) => ({
        success: false,
        clipId: clip.id,
        error: message,
      }));
    }
  }

  /**
   * Split clip at specific position (click/cursor).
   *
   * @param clipId - Clip to split
   * @param time - Time to split at
   * @returns Split result
   */
  static splitAtPosition(clipId: string, time: number): SplitResult {
    return this.executeSplit({
      clipId,
      time,
      source: "click",
    });
  }

  /**
   * Get clips under playhead.
   *
   * Utility for finding clips that can be split at current playhead position.
   *
   * @returns Clips under playhead
   */
  static getClipsUnderPlayhead(): Clip[] {
    const currentTime = getPlaybackClock().time;
    const clips = useTimelineStore.getState().clips;

    return clips.filter((clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return currentTime > clip.startTime && currentTime < clipEndTime;
    });
  }

  /**
   * Check if split is possible at playhead.
   *
   * @returns True if at least one clip can be split at playhead
   */
  static canSplitAtPlayhead(): boolean {
    return this.getClipsUnderPlayhead().length > 0;
  }

  /**
   * Slips the source media window inside the clip by deltaSeconds without
   * changing the clip's position on the timeline or its duration.
   */
  static slipClip(clipId: string, deltaSeconds: number): {
    success: boolean;
    error?: string;
    newTrimIn?: number;
    newTrimOut?: number;
  } {
    const t0 = performance.now();
    const timeline = useTimelineStore.getState();
    const clip = timeline.clips.find((c) => c.id === clipId);
    if (!clip) {
      this.recordTimelineEdit({ operation: "slip", clipId, success: false, error: "Clip not found", durationMs: performance.now() - t0 });
      return { success: false, error: "Clip not found" };
    }
    if (clip.kind === "compound") {
      this.recordTimelineEdit({ operation: "slip", clipId, success: false, error: "Compound clips cannot be slipped", durationMs: performance.now() - t0 });
      return { success: false, error: "Compound clips cannot be slipped" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) {
      this.recordTimelineEdit({ operation: "slip", clipId, success: false, error: "Track is locked", durationMs: performance.now() - t0 });
      return { success: false, error: "Track is locked" };
    }

    const assets = useProjectStore.getState().mediaAssets;
    const asset = assets.find((a) => a.id === clip.mediaId);
    const maxDuration = asset?.duration ?? Infinity;

    const proposedTrimIn = clip.trimIn + deltaSeconds;
    const maxTrimIn = Number.isFinite(maxDuration)
      ? Math.max(0, maxDuration - clip.duration)
      : Infinity;

    const newTrimIn = Math.max(0, Math.min(maxTrimIn, proposedTrimIn));
    const newTrimOut = newTrimIn + clip.duration;

    if (Math.abs(newTrimIn - clip.trimIn) < 0.0001) {
      const err = deltaSeconds > 0 ? "Reached end of source media" : "Reached beginning of source media";
      this.recordTimelineEdit({ operation: "slip", clipId, success: false, error: err, durationMs: performance.now() - t0 });
      return {
        success: false,
        error: err,
      };
    }

    useHistoryStore.getState().execute(
      new SlipClipCommand(clip.id, clip.trimIn, clip.trimOut, newTrimIn, newTrimOut)
    );

    this.recordTimelineEdit({
      operation: "slip",
      clipId: clip.id,
      deltaApplied: newTrimIn - clip.trimIn,
      fromTrimIn: clip.trimIn,
      toTrimIn: newTrimIn,
      fromTrimOut: clip.trimOut,
      toTrimOut: newTrimOut,
      trimClipCount: 1,
      success: true,
      durationMs: performance.now() - t0,
    });

    return { success: true, newTrimIn, newTrimOut };
  }

  /**
   * Slides a clip along the timeline by deltaSeconds, adjusting the preceding
   * clip's out-point and succeeding clip's in-point to preserve total sequence length.
   */
  static slideClip(clipId: string, deltaSeconds: number): {
    success: boolean;
    error?: string;
    deltaApplied?: number;
  } {
    const t0 = performance.now();
    const timeline = useTimelineStore.getState();
    const clip = timeline.clips.find((c) => c.id === clipId);
    if (!clip) {
      this.recordTimelineEdit({ operation: "slide", clipId, success: false, error: "Clip not found", durationMs: performance.now() - t0 });
      return { success: false, error: "Clip not found" };
    }
    if (clip.kind === "compound") {
      this.recordTimelineEdit({ operation: "slide", clipId, success: false, error: "Compound clips cannot be slid", durationMs: performance.now() - t0 });
      return { success: false, error: "Compound clips cannot be slid" };
    }

    const track = timeline.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) {
      this.recordTimelineEdit({ operation: "slide", clipId, success: false, error: "Track is locked", durationMs: performance.now() - t0 });
      return { success: false, error: "Track is locked" };
    }

    const trackClips = timeline.clips
      .filter((c) => c.trackId === clip.trackId)
      .sort((a, b) => a.startTime - b.startTime);

    const idx = trackClips.findIndex((c) => c.id === clip.id);
    const prevClip = idx > 0 ? trackClips[idx - 1] : null;
    const nextClip = idx < trackClips.length - 1 ? trackClips[idx + 1] : null;

    const assets = useProjectStore.getState().mediaAssets;
    const prevAsset = prevClip ? assets.find((a) => a.id === prevClip.mediaId) : null;
    const nextAsset = nextClip ? assets.find((a) => a.id === nextClip.mediaId) : null;

    const project = useProjectStore.getState().project;
    const minClipDuration = 1 / (project?.frameRate ?? 30);

    let minAllowedDelta = -Infinity;
    let maxAllowedDelta = Infinity;

    // Timeline start boundary
    minAllowedDelta = Math.max(minAllowedDelta, -clip.startTime);

    if (prevClip) {
      const prevMinDurationDelta = -(prevClip.duration - minClipDuration);
      minAllowedDelta = Math.max(minAllowedDelta, prevMinDurationDelta);

      if (prevAsset?.duration) {
        const prevMaxGrowth = prevAsset.duration - prevClip.trimOut;
        maxAllowedDelta = Math.min(maxAllowedDelta, Math.max(0, prevMaxGrowth));
      }
    }

    if (nextClip) {
      const nextMinDurationDelta = nextClip.duration - minClipDuration;
      maxAllowedDelta = Math.min(maxAllowedDelta, nextMinDurationDelta);

      const nextMinTrimDelta = -nextClip.trimIn;
      minAllowedDelta = Math.max(minAllowedDelta, nextMinTrimDelta);
    }

    const effectiveDelta = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, deltaSeconds));

    if (Math.abs(effectiveDelta) < 0.0001) {
      const err = deltaSeconds > 0 ? "Cannot slide right (boundary reached)" : "Cannot slide left (boundary reached)";
      this.recordTimelineEdit({ operation: "slide", clipId, success: false, error: err, durationMs: performance.now() - t0 });
      return {
        success: false,
        error: err,
      };
    }

    const beforeClips: Clip[] = [clip];
    const afterClips: Clip[] = [{ ...clip, startTime: clip.startTime + effectiveDelta }];

    if (prevClip) {
      beforeClips.push(prevClip);
      afterClips.push({
        ...prevClip,
        duration: prevClip.duration + effectiveDelta,
        trimOut: prevClip.trimOut + effectiveDelta,
      });
    }

    if (nextClip) {
      beforeClips.push(nextClip);
      afterClips.push({
        ...nextClip,
        startTime: nextClip.startTime + effectiveDelta,
        duration: nextClip.duration - effectiveDelta,
        trimIn: nextClip.trimIn + effectiveDelta,
      });
    }

    useHistoryStore.getState().execute(new SlideClipCommand(beforeClips, afterClips));
    this.recordTimelineEdit({
      operation: "slide",
      clipId: clip.id,
      deltaApplied: effectiveDelta,
      fromTime: clip.startTime,
      toTime: clip.startTime + effectiveDelta,
      trimClipCount: (prevClip ? 1 : 0) + 1 + (nextClip ? 1 : 0),
      success: true,
      durationMs: performance.now() - t0,
    });
    return { success: true, deltaApplied: effectiveDelta };
  }

  /**
   * Rolls the cut point between two adjacent clips on the same track by deltaSeconds.
   * Extends/contracts the outgoing clip while simultaneously contracting/extending the incoming clip,
   * keeping overall sequence duration and outer boundaries invariant.
   */
  static rollEdit(
    outgoingClipId: string,
    incomingClipId: string,
    deltaSeconds: number,
  ): {
    success: boolean;
    error?: string;
    deltaApplied?: number;
  } {
    const t0 = performance.now();
    const timeline = useTimelineStore.getState();
    const clipA = timeline.clips.find((c) => c.id === outgoingClipId);
    const clipB = timeline.clips.find((c) => c.id === incomingClipId);

    if (!clipA || !clipB) {
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: "Clip not found", durationMs: performance.now() - t0 });
      return { success: false, error: "Clip not found" };
    }
    if (clipA.trackId !== clipB.trackId) {
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: "Clips must be on the same track", durationMs: performance.now() - t0 });
      return { success: false, error: "Clips must be on the same track" };
    }
    if (clipA.kind === "compound" || clipB.kind === "compound") {
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: "Compound clips cannot be rolled", durationMs: performance.now() - t0 });
      return { success: false, error: "Compound clips cannot be rolled" };
    }

    const track = timeline.tracks.find((t) => t.id === clipA.trackId);
    if (track?.locked) {
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: "Track is locked", durationMs: performance.now() - t0 });
      return { success: false, error: "Track is locked" };
    }

    const cutA = clipA.startTime + clipA.duration;
    if (Math.abs(cutA - clipB.startTime) > 0.001) {
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: "Clips must share an adjacent cut point", durationMs: performance.now() - t0 });
      return { success: false, error: "Clips must share an adjacent cut point" };
    }

    const assets = useProjectStore.getState().mediaAssets;
    const assetA = assets.find((a) => a.id === clipA.mediaId);

    const project = useProjectStore.getState().project;
    const minClipDuration = 1 / (project?.frameRate ?? 30);

    // Delta limits
    let minAllowedDelta = -Infinity;
    let maxAllowedDelta = Infinity;

    // Outgoing clip (clipA): duration + delta >= minClipDuration -> delta >= -(duration - min)
    minAllowedDelta = Math.max(minAllowedDelta, -(clipA.duration - minClipDuration));

    // Incoming clip (clipB): duration - delta >= minClipDuration -> delta <= (duration - min)
    maxAllowedDelta = Math.min(maxAllowedDelta, clipB.duration - minClipDuration);

    // Outgoing media max duration limit
    if (assetA?.duration && Number.isFinite(assetA.duration)) {
      const maxGrowthA = assetA.duration - clipA.trimOut;
      maxAllowedDelta = Math.min(maxAllowedDelta, Math.max(0, maxGrowthA));
    }

    // Incoming media trimIn >= 0 -> trimIn + delta >= 0 -> delta >= -trimIn
    minAllowedDelta = Math.max(minAllowedDelta, -clipB.trimIn);

    const effectiveDelta = Math.max(minAllowedDelta, Math.min(maxAllowedDelta, deltaSeconds));

    if (Math.abs(effectiveDelta) < 0.0001) {
      const err = deltaSeconds > 0 ? "Cannot roll right (boundary reached)" : "Cannot roll left (boundary reached)";
      this.recordTimelineEdit({ operation: "roll", clipId: outgoingClipId, secondaryClipId: incomingClipId, success: false, error: err, durationMs: performance.now() - t0 });
      return {
        success: false,
        error: err,
      };
    }

    const afterClipA: Clip = {
      ...clipA,
      duration: clipA.duration + effectiveDelta,
      trimOut: clipA.trimOut + effectiveDelta,
    };

    const afterClipB: Clip = {
      ...clipB,
      startTime: clipB.startTime + effectiveDelta,
      duration: clipB.duration - effectiveDelta,
      trimIn: clipB.trimIn + effectiveDelta,
    };

    useHistoryStore.getState().execute(new RollClipCommand([clipA, clipB], [afterClipA, afterClipB]));
    this.recordTimelineEdit({
      operation: "roll",
      clipId: clipA.id,
      secondaryClipId: clipB.id,
      deltaApplied: effectiveDelta,
      trimClipCount: 2,
      success: true,
      durationMs: performance.now() - t0,
    });
    return { success: true, deltaApplied: effectiveDelta };
  }

  /**
   * Rolls the cut point on the specified clip.
   * If edge === "outgoing", rolls cut between this clip and the adjacent clip to its right.
   * If edge === "incoming", rolls cut between the adjacent clip to its left and this clip.
   */
  static rollClipEdge(
    clipId: string,
    edge: "incoming" | "outgoing",
    deltaSeconds: number,
  ): {
    success: boolean;
    error?: string;
    deltaApplied?: number;
  } {
    const t0 = performance.now();
    const timeline = useTimelineStore.getState();
    const clip = timeline.clips.find((c) => c.id === clipId);
    if (!clip) {
      this.recordTimelineEdit({ operation: "roll", clipId, success: false, error: "Clip not found", durationMs: performance.now() - t0 });
      return { success: false, error: "Clip not found" };
    }

    const trackClips = timeline.clips
      .filter((c) => c.trackId === clip.trackId)
      .sort((a, b) => a.startTime - b.startTime);

    const idx = trackClips.findIndex((c) => c.id === clip.id);

    if (edge === "outgoing") {
      const nextClip = idx < trackClips.length - 1 ? trackClips[idx + 1] : null;
      if (!nextClip) {
        this.recordTimelineEdit({ operation: "roll", clipId, success: false, error: "No adjacent clip to roll with", durationMs: performance.now() - t0 });
        return { success: false, error: "No adjacent clip to roll with" };
      }
      return this.rollEdit(clip.id, nextClip.id, deltaSeconds);
    } else {
      const prevClip = idx > 0 ? trackClips[idx - 1] : null;
      if (!prevClip) {
        this.recordTimelineEdit({ operation: "roll", clipId, success: false, error: "No adjacent clip to roll with", durationMs: performance.now() - t0 });
        return { success: false, error: "No adjacent clip to roll with" };
      }
      return this.rollEdit(prevClip.id, clip.id, deltaSeconds);
    }
  }

  /**
   * Record a completed timeline edit operation to the NDJSON session log.
   *
   * Call this after every move, trim, or split commit (and on failure).
   * The entry is enqueued non-blocking — it will never throw.
   *
   * @param telemetry - Edit telemetry to record.
   */
  static recordTimelineEdit(telemetry: TimelineEditTelemetry): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "timeline-edit",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: telemetry,
      });
    } catch {
      // Never let telemetry throw into the editing hot path.
    }
  }
}
