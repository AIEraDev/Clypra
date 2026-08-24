/**
 * GapManager - Central controller for all gap operations
 *
 * Follows imperative architecture pattern used by:
 * - CacheManager
 * - AudioCacheManager
 * - PreviewQualityManager
 * - GlobalGPUCacheManager
 *
 * All gap operations should go through this manager to ensure:
 * - Undo/redo support via command pattern
 * - Consistent validation and error handling
 * - Centralized business logic
 * - Better testability
 */

import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { InsertGapCommand, RemoveGapCommand, ResizeGapCommand, ToggleGapProtectionCommand, PackTrackCommand } from "@/core/history/commands/GapCommands";
import { validateGap } from "./gapEngine";
import type { Gap } from "@/types/gap";

class GapManagerImpl {
  private static instance: GapManagerImpl;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): GapManagerImpl {
    if (!GapManagerImpl.instance) {
      GapManagerImpl.instance = new GapManagerImpl();
    }
    return GapManagerImpl.instance;
  }

  /**
   * Insert a gap at specified position (with undo support)
   *
   * @param trackId - Target track ID
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @returns Created gap or null if operation failed
   */
  insertGap(trackId: string, startTime: number, duration: number): Gap | null {
    const validation = this.canInsertGap(trackId, startTime, duration);

    if (!validation.valid) {
      console.warn(`[GapManager] Cannot insert gap: ${validation.reason}`);
      return null;
    }

    const { execute } = useHistoryStore.getState();
    const command = new InsertGapCommand(trackId, startTime, duration);

    execute(command);

    // Get the inserted gap from the store (it's the one at the specified position)
    const timelineStore = useTimelineStore.getState();
    const insertedGap = timelineStore.gaps.find((g) => g.trackId === trackId && g.startTime === startTime && g.duration === duration);

    return insertedGap ?? null;
  }

  /**
   * Remove a gap (with undo support)
   *
   * @param gapId - Gap ID to remove
   */
  removeGap(gapId: string): void {
    const gap = this.getGap(gapId);

    if (!gap) {
      console.warn(`[GapManager] Gap not found: ${gapId}`);
      return;
    }

    // Check if track is locked
    const { tracks } = useTimelineStore.getState();
    const track = tracks.find((t) => t.id === gap.trackId);

    if (track?.locked) {
      console.warn(`[GapManager] Cannot remove gap on locked track`);
      return;
    }

    const { execute } = useHistoryStore.getState();
    execute(new RemoveGapCommand(gapId));
  }

  /**
   * Resize a gap (with undo support)
   *
   * @param gapId - Gap ID to resize
   * @param newDuration - New duration in seconds
   */
  resizeGap(gapId: string, newDuration: number): void {
    const gap = this.getGap(gapId);

    if (!gap) {
      console.warn(`[GapManager] Gap not found: ${gapId}`);
      return;
    }

    if (newDuration <= 0) {
      console.warn(`[GapManager] Gap duration must be positive`);
      return;
    }

    // Check if track is locked
    const { tracks } = useTimelineStore.getState();
    const track = tracks.find((t) => t.id === gap.trackId);

    if (track?.locked) {
      console.warn(`[GapManager] Cannot resize gap on locked track`);
      return;
    }

    const { execute } = useHistoryStore.getState();
    execute(new ResizeGapCommand(gapId, newDuration));
  }

  /**
   * Toggle gap protection (with undo support)
   *
   * @param gapId - Gap ID to toggle protection
   */
  toggleProtection(gapId: string): void {
    const gap = this.getGap(gapId);

    if (!gap) {
      console.warn(`[GapManager] Gap not found: ${gapId}`);
      return;
    }

    const { execute } = useHistoryStore.getState();
    execute(new ToggleGapProtectionCommand(gapId));
  }

  /**
   * Pack track - remove all unprotected gaps
   *
   * Uses PackTrackCommand to do this atomically in a single operation,
   * avoiding the double-shift bug from multiple RemoveGapCommands.
   *
   * @param trackId - Track ID to pack
   */
  packTrack(trackId: string): void {
    const { gaps, tracks } = useTimelineStore.getState();
    const { execute } = useHistoryStore.getState();

    // Check if track exists and is not locked
    const track = tracks.find((t) => t.id === trackId);

    if (!track) {
      console.warn(`[GapManager] Track not found: ${trackId}`);
      return;
    }

    if (track.locked) {
      console.warn(`[GapManager] Cannot pack locked track`);
      return;
    }

    // Find all unprotected gaps on this track
    const trackGaps = gaps.filter((g) => g.trackId === trackId && !g.protected);

    if (trackGaps.length === 0) {
      // No unprotected gaps to remove
      return;
    }

    // Execute as single atomic command (no transaction needed)
    execute(new PackTrackCommand(trackId));
  }

  /** Pack every unlocked track as one undoable user action. */
  packAllTracks(): void {
    const { gaps, tracks } = useTimelineStore.getState();
    const trackIds = tracks
      .filter((track) => !track.locked && gaps.some((gap) => gap.trackId === track.id && !gap.protected))
      .map((track) => track.id);
    if (trackIds.length === 0) return;

    const history = useHistoryStore.getState();
    history.beginTransaction("Close Timeline Gaps");
    try {
      trackIds.forEach((trackId) => history.execute(new PackTrackCommand(trackId)));
      history.commitTransaction();
    } catch (error) {
      history.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Detect and sync gaps for a track or all tracks
   *
   * Note: This does NOT use commands - it's a sync operation, not a user action.
   * Auto-detected gaps are not undoable by design.
   *
   * @param trackId - Optional track ID to detect gaps for. If omitted, detects for all tracks.
   */
  detectAndSync(trackId?: string): void {
    const store = useTimelineStore.getState();
    store.detectAndSyncGaps(trackId);
  }

  /**
   * Get gap by ID
   *
   * @param gapId - Gap ID
   * @returns Gap or null if not found
   */
  getGap(gapId: string): Gap | null {
    const { gaps } = useTimelineStore.getState();
    return gaps.find((g) => g.id === gapId) ?? null;
  }

  /**
   * Get gap at specific time position on track
   *
   * @param trackId - Track ID
   * @param time - Time position in seconds
   * @returns Gap at that position or null
   */
  getGapAtPosition(trackId: string, time: number): Gap | null {
    const { gaps } = useTimelineStore.getState();

    return (
      gaps.find((g) => {
        if (g.trackId !== trackId) return false;
        const gapEnd = g.startTime + g.duration;
        return time >= g.startTime && time < gapEnd;
      }) ?? null
    );
  }

  /**
   * Get all gaps for a specific track
   *
   * @param trackId - Track ID
   * @returns Array of gaps on that track
   */
  getTrackGaps(trackId: string): Gap[] {
    const { gaps } = useTimelineStore.getState();
    return gaps.filter((g) => g.trackId === trackId);
  }

  /**
   * Check if track has any gaps
   *
   * @param trackId - Track ID
   * @returns True if track has gaps
   */
  hasGaps(trackId: string): boolean {
    return this.getTrackGaps(trackId).length > 0;
  }

  /**
   * Count unprotected gaps on track
   *
   * @param trackId - Track ID
   * @returns Number of unprotected gaps
   */
  countUnprotectedGaps(trackId: string): number {
    return this.getTrackGaps(trackId).filter((g) => !g.protected).length;
  }

  /**
   * Validate if gap can be inserted at position
   *
   * @param trackId - Track ID
   * @param startTime - Start time in seconds
   * @param duration - Duration in seconds
   * @returns Validation result with reason if invalid
   */
  canInsertGap(
    trackId: string,
    startTime: number,
    duration: number,
  ): {
    valid: boolean;
    reason?: string;
  } {
    const { tracks, clips } = useTimelineStore.getState();

    // Check track exists
    const track = tracks.find((t) => t.id === trackId);
    if (!track) {
      return { valid: false, reason: "Track not found" };
    }

    // Check track is not locked
    if (track.locked) {
      return { valid: false, reason: "Track is locked" };
    }

    // Check duration is positive
    if (duration <= 0) {
      return { valid: false, reason: "Duration must be positive" };
    }

    // Check start time is not negative
    if (startTime < 0) {
      return { valid: false, reason: "Start time cannot be negative" };
    }

    // Check for clip overlaps using gapEngine validation
    const trackClips = clips.filter((c) => c.trackId === trackId);
    const validation = validateGap({ trackId, startTime, duration }, trackClips);

    if (!validation.valid) {
      return { valid: false, reason: validation.reason };
    }

    return { valid: true };
  }

  /**
   * Get all gaps across all tracks
   *
   * @returns Array of all gaps
   */
  getAllGaps(): Gap[] {
    const { gaps } = useTimelineStore.getState();
    return gaps;
  }

  /**
   * Get total number of gaps
   *
   * @returns Total gap count
   */
  getTotalGapCount(): number {
    return this.getAllGaps().length;
  }

  /**
   * Get total duration of all gaps on a track
   *
   * @param trackId - Track ID
   * @returns Total duration in seconds
   */
  getTotalGapDuration(trackId: string): number {
    return this.getTrackGaps(trackId).reduce((sum, gap) => sum + gap.duration, 0);
  }
}

/**
 * Global singleton instance
 *
 * Usage:
 * ```typescript
 * import { GapManager } from '@/lib/gapManager';
 *
 * // Insert gap with undo support
 * const gap = GapManager.insertGap(trackId, 5, 2);
 *
 * // Remove gap with undo support
 * GapManager.removeGap(gapId);
 *
 * // Pack track (remove all unprotected gaps) with undo support
 * GapManager.packTrack(trackId);
 * ```
 */
export const GapManager = GapManagerImpl.getInstance();
