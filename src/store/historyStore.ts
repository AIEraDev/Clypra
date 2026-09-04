/**
 * History Store
 *
 * OWNERSHIP: Undo/redo command journal (persistent domain state)
 * PERSISTENCE: Should be persistent (future: save with project)
 * MUTABILITY: Append-only command log
 *
 * Responsibilities:
 * - Execute commands against timelineStore
 * - Maintain undo/redo stacks
 * - Provide undo/redo operations
 * - Track history state (canUndo, canRedo)
 *
 * Does NOT:
 * - Directly mutate timeline (commands do that)
 * - Own timeline state (timelineStore is source of truth)
 * - Manage runtime resources (ProjectSession handles that)
 * - Increment epoch (commands handle that internally)
 * - Trigger auto-save (middleware handles that automatically)
 *
 * Architecture principle:
 * Commands are pure state transformers: (state) => newState
 * All side effects (epoch increment, auto-save) are encapsulated within commands
 * or handled by middleware. This enables:
 * - Deterministic undo/redo
 * - Command replay for testing
 * - Future: collaborative editing (commands as CRDT operations)
 * - Future: AI orchestration (commands as operation primitives)
 *
 * Bridges the command-based history system with Zustand state management.
 *
 * Architecture:
 *   UI Action → historyStore.execute() → CommandJournal → Command.apply() → timelineStore
 */

import { create } from "zustand";
import { CommandJournal } from "@/core/history";
import type { Command, CommandJournalState } from "@/core/history";
import { useTimelineStore } from "./timelineStore";
import { useUIStore } from "./uiStore";
import { useProjectStore } from "./projectStore";
import { getPreviewInteractionCoordinator } from "@/core/interactions";

/**
 * History commands update the timeline store with setState directly. That is
 * intentional (the command result is already a complete immutable state), but
 * it also means the timeline auto-save middleware cannot observe the write.
 * Keep persistence attached to the command bridge so property edits made from
 * the Properties panel are saved just like edits made through timeline
 * actions.
 */
function scheduleProjectSaveAfterTimelineMutation(): void {
  try {
    useProjectStore.getState().scheduleAutoSave();
  } catch {
    // History is also used in isolated tests and during startup before the
    // project store is ready. Persistence must not make a command fail.
  }
}

interface HistoryStore {
  // Command journal instance
  journal: CommandJournal;

  // Current history state
  state: CommandJournalState;

  // Execute a command
  execute: (command: Command) => void;

  // Undo last command
  undo: () => void;

  // Redo last undone command
  redo: () => void;

  // Begin transaction
  beginTransaction: (label: string) => void;

  // Commit transaction
  commitTransaction: () => void;

  // Rollback transaction
  rollbackTransaction: () => void;

  // Clear history
  clear: () => void;
}

// Create command journal instance
const commandJournal = new CommandJournal({
  maxSize: 100,
  enableCoalescing: true,
  coalescingWindowMs: 500,
});

export const useHistoryStore = create<HistoryStore>((set, get) => {
  // Subscribe to command journal changes
  commandJournal.subscribe((state) => {
    set({ state });
  });

  return {
    journal: commandJournal,
    state: commandJournal.getState(),

    execute: (command) => {
      const { journal } = get();

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // Execute command (command handles epoch increment internally)
      const newState = journal.execute(command, timelineStore);

      // Apply the command result, then explicitly notify persistence because
      // this direct setState bypasses the timeline middleware wrapper.
      useTimelineStore.setState(newState);
      scheduleProjectSaveAfterTimelineMutation();
    },

    undo: () => {
      getPreviewInteractionCoordinator().cancelActive("undo-redo");
      const { journal } = get();

      if (!journal.canUndo()) return;

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // TL-02 fix: Force epoch to increment monotonically even when restoring historical snapshots,
      // to ensure render caches are properly invalidated after undo.
      const newState = journal.undo(timelineStore);

      // Apply the historical state, then persist the undo.
      useTimelineStore.setState({ ...newState, epoch: timelineStore.epoch + 1 });
      scheduleProjectSaveAfterTimelineMutation();

      // TL-BUG-001 fix: Clear stale selection after undo.
      // Timeline state may no longer contain the previously selected clips/gaps/transitions.
      try {
        useUIStore.getState().clearSelection();
      } catch {
        // Defensive — UIStore may not be initialized during tests
      }
    },

    redo: () => {
      getPreviewInteractionCoordinator().cancelActive("undo-redo");
      const { journal } = get();

      if (!journal.canRedo()) return;

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // Redo (command handles epoch increment internally)
      const newState = journal.redo(timelineStore);

      // Apply the historical state, then persist the redo.
      useTimelineStore.setState({ ...newState, epoch: timelineStore.epoch + 1 });
      scheduleProjectSaveAfterTimelineMutation();

      // TL-BUG-001 fix: Clear stale selection after redo.
      try {
        useUIStore.getState().clearSelection();
      } catch {
        // Defensive — UIStore may not be initialized during tests
      }
    },

    beginTransaction: (label) => {
      const { journal } = get();
      journal.beginTransaction(label);
    },

    commitTransaction: () => {
      const { journal } = get();
      const timelineStore = useTimelineStore.getState();
      journal.commitTransaction(timelineStore);
    },

    rollbackTransaction: () => {
      const { journal } = get();
      const timelineStore = useTimelineStore.getState();
      const newState = journal.rollbackTransaction(timelineStore);
      useTimelineStore.setState({ ...newState, epoch: timelineStore.epoch + 1 });
      scheduleProjectSaveAfterTimelineMutation();
    },

    clear: () => {
      const { journal } = get();
      journal.clear();
    },
  };
});
