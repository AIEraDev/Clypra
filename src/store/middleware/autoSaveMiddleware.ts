/**
 * Auto-Save Middleware
 *
 * OWNERSHIP: Store middleware (cross-cutting concern)
 * PERSISTENCE: Non-persistent (behavior only)
 *
 * Automatically triggers project auto-save when timeline or project state changes.
 * Eliminates 15+ manual scheduleAutoSave() calls throughout the codebase.
 *
 * Usage:
 * ```typescript
 * export const useTimelineStore = create(
 *   autoSaveMiddleware((set, get) => ({
 *     // ... store implementation
 *   }))
 * );
 * ```
 */

import type { StateCreator, StoreMutatorIdentifier } from "zustand";
import { useProjectStore } from "../projectStore";

type AutoSave = <T, Mps extends [StoreMutatorIdentifier, unknown][] = [], Mcs extends [StoreMutatorIdentifier, unknown][] = []>(f: StateCreator<T, Mps, Mcs>) => StateCreator<T, Mps, Mcs>;

type AutoSaveImpl = <T>(f: StateCreator<T, [], []>) => StateCreator<T, [], []>;

// Transaction support: suspend auto-save during drag operations
let _suspended = false;
let _pendingSave = false;
let _suppressCount = 0;

/** Suspend auto-save (e.g., during drag). Call resumeAutoSave() when done. */
export function suspendAutoSave(): void {
  _suspended = true;
  _pendingSave = false;
}

/** Resume auto-save. If any mutations occurred while suspended, triggers one save. */
export function resumeAutoSave(): void {
  _suspended = false;
  if (_pendingSave && _suppressCount === 0) {
    _pendingSave = false;
    useProjectStore.getState().scheduleAutoSave();
  }
}

/** Completely suppress auto-save (e.g. during project hydration / loading / reset). */
export function suppressAutoSave(): void {
  _suppressCount++;
}

/** Unsuppress auto-save. Discards any pending auto-saves that occurred while suppressed. */
export function enableAutoSave(): void {
  _suppressCount = Math.max(0, _suppressCount - 1);
  if (_suppressCount === 0) {
    _pendingSave = false;
  }
}

const autoSaveImpl: AutoSaveImpl = (f) => (set, get, store) => {
  // Wrap the set function to trigger auto-save after state changes
  const wrappedSet: typeof set = (partial, replace) => {
    const oldState = get() as any;

    // Call the original set with proper arguments
    set(partial, replace as any);

    // If auto-save is globally suppressed (e.g. hydrating project from disk), do nothing
    if (_suppressCount > 0) {
      return;
    }

    const newState = get() as any;

    // Check if any persistent project data actually changed
    const hasProjectDataChanged =
      (oldState.tracks !== newState.tracks && newState.tracks !== undefined) ||
      (oldState.clips !== newState.clips && newState.clips !== undefined) ||
      (oldState.gaps !== newState.gaps && newState.gaps !== undefined) ||
      (oldState.transitions !== newState.transitions && newState.transitions !== undefined);

    if (!hasProjectDataChanged) {
      return;
    }

    // If suspended (e.g., during drag), defer save until resume
    if (_suspended) {
      _pendingSave = true;
      return;
    }

    // Synchronous call — no async side effects in middleware
    useProjectStore.getState().scheduleAutoSave();
  };

  return f(wrappedSet, get, store);
};

export const autoSaveMiddleware = autoSaveImpl as AutoSave;
