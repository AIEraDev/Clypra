/**
 * UndoManager for Timeline Engine v1
 */

import type { TimelineSnapshot } from "../types/core";

/**
 * Manages undo/redo history for timeline operations
 * Maintains a stack of timeline snapshots with a maximum history limit
 */
export class UndoManager {
  private history: TimelineSnapshot[] = [];
  private index = -1;
  private readonly MAX_HISTORY = 50;

  /**
   * Push a new state snapshot to the history stack
   * Clears any redo history when a new operation is performed
   */
  pushState(snapshot: TimelineSnapshot): void {
    // Remove any redo history (everything after current index)
    this.history = this.history.slice(0, this.index + 1);

    // Add new state
    this.history.push(this.cloneSnapshot(snapshot));

    // Limit history size to MAX_HISTORY
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    } else {
      this.index++;
    }
  }

  /**
   * Undo the most recent operation and restore previous state
   */
  undo(): TimelineSnapshot | null {
    if (this.index <= 0) return null;

    // Decrement to previous state
    this.index--;

    // Return the previous state
    return this.cloneSnapshot(this.history[this.index]);
  }

  /**
   * Redo the most recently undone operation
   */
  redo(): TimelineSnapshot | null {
    if (this.index >= this.history.length - 1) return null;
    this.index++;
    return this.cloneSnapshot(this.history[this.index]);
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.index > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.index < this.history.length - 1;
  }

  /**
   * Get current history size
   */
  getHistorySize(): number {
    return this.history.length;
  }

  /**
   * Get current history index
   */
  getCurrentIndex(): number {
    return this.index;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.index = -1;
  }

  /**
   * Deep clone a snapshot to prevent mutation
   */
  private cloneSnapshot(snapshot: TimelineSnapshot): TimelineSnapshot {
    return {
      clips: new Map(snapshot.clips),
      tracks: new Map(snapshot.tracks),
      playhead: snapshot.playhead,
      selectedClipIds: new Set(snapshot.selectedClipIds),
      lastSelectedClipId: snapshot.lastSelectedClipId,
    };
  }
}
