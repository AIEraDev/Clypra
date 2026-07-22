/**
 * Shortcut Store
 *
 * Defines every named keyboard shortcut action with its default binding.
 * Users can rebind shortcuts from the Settings → Shortcuts tab.
 * Bindings are persisted to localStorage under "clypra-shortcuts".
 *
 * Usage:
 *   const { matchesShortcut } = useShortcutStore();
 *   if (matchesShortcut(e, "undo")) { ... }
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MessageKey } from "@/i18n";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeyBinding {
  /** Primary key (e.g. "z", "Space", "ArrowLeft") */
  key: string;
  /** Requires Ctrl (Windows/Linux) or Cmd (macOS) */
  ctrl?: boolean;
  /** Requires Shift */
  shift?: boolean;
  /** Requires Alt / Option */
  alt?: boolean;
}

interface ShortcutDefinition {
  id: string;
  searchAlias: string;
  category: string;
  defaultBinding: KeyBinding;
}

// ─── Default Shortcut Registry ────────────────────────────────────────────────

export const SHORTCUT_DEFINITIONS = [
  // Transport
  {
    id: "play-pause",
    searchAlias: "Play / Pause",
    category: "Transport",
    defaultBinding: { key: "Space" },
  },
  {
    id: "pause",
    searchAlias: "Pause",
    category: "Transport",
    defaultBinding: { key: "k" },
  },
  {
    id: "seek-back-frame",
    searchAlias: "Step Back One Frame",
    category: "Transport",
    defaultBinding: { key: "ArrowLeft" },
  },
  {
    id: "seek-forward-frame",
    searchAlias: "Step Forward One Frame",
    category: "Transport",
    defaultBinding: { key: "ArrowRight" },
  },
  // Source Mode
  {
    id: "mark-source-in",
    searchAlias: "Mark In Point (Source)",
    category: "Source Mode",
    defaultBinding: { key: "i" },
  },
  {
    id: "mark-source-out",
    searchAlias: "Mark Out Point (Source)",
    category: "Source Mode",
    defaultBinding: { key: "o" },
  },
  {
    id: "exit-source-mode",
    searchAlias: "Exit Source Mode",
    category: "Source Mode",
    defaultBinding: { key: "Escape" },
  },
  // Edit
  {
    id: "undo",
    searchAlias: "Undo",
    category: "Edit",
    defaultBinding: { key: "z", ctrl: true },
  },
  {
    id: "redo",
    searchAlias: "Redo",
    category: "Edit",
    defaultBinding: { key: "z", ctrl: true, shift: true },
  },
  {
    id: "redo-alt",
    searchAlias: "Redo (Alt)",
    category: "Edit",
    defaultBinding: { key: "y", ctrl: true },
  },
  {
    id: "split-at-playhead",
    searchAlias: "Split at Playhead",
    category: "Edit",
    defaultBinding: { key: "s" },
  },
  {
    id: "split-selected-at-playhead",
    searchAlias: "Split Selected at Playhead",
    category: "Edit",
    defaultBinding: { key: "k", ctrl: true },
  },
  {
    id: "split-all-at-playhead",
    searchAlias: "Split All at Playhead",
    category: "Edit",
    defaultBinding: { key: "k", ctrl: true, shift: true },
  },
  {
    id: "delete-left-at-playhead",
    searchAlias: "Delete Left of Playhead",
    category: "Edit",
    defaultBinding: { key: "q" },
  },
  {
    id: "delete-right-at-playhead",
    searchAlias: "Delete Right of Playhead",
    category: "Edit",
    defaultBinding: { key: "w" },
  },
  {
    id: "duplicate-clips",
    searchAlias: "Duplicate Selected Clips",
    category: "Edit",
    defaultBinding: { key: "d", ctrl: true },
  },
  {
    id: "copy-clips",
    searchAlias: "Copy Selected Clips",
    category: "Edit",
    defaultBinding: { key: "c", ctrl: true },
  },
  {
    id: "paste-clips",
    searchAlias: "Paste Clips",
    category: "Edit",
    defaultBinding: { key: "v", ctrl: true },
  },
  {
    id: "swap-clips",
    searchAlias: "Swap Clips",
    category: "Edit",
    defaultBinding: { key: "S", ctrl: true, shift: true },
  },
  {
    id: "select-all",
    searchAlias: "Select All Clips",
    category: "Edit",
    defaultBinding: { key: "a", ctrl: true },
  },
  {
    id: "deselect-all",
    searchAlias: "Deselect All Clips",
    category: "Edit",
    defaultBinding: { key: "d", ctrl: true, shift: true },
  },
  {
    id: "clear-selection",
    searchAlias: "Clear Selection",
    category: "Edit",
    defaultBinding: { key: "Escape" },
  },
  // Nudge
  {
    id: "nudge-right",
    searchAlias: "Nudge Right 1 Frame",
    category: "Nudge",
    defaultBinding: { key: "]", ctrl: true },
  },
  {
    id: "nudge-left",
    searchAlias: "Nudge Left 1 Frame",
    category: "Nudge",
    defaultBinding: { key: "[", ctrl: true },
  },
  {
    id: "nudge-right-10",
    searchAlias: "Nudge Right 10 Frames",
    category: "Nudge",
    defaultBinding: { key: "]", ctrl: true, shift: true },
  },
  {
    id: "nudge-left-10",
    searchAlias: "Nudge Left 10 Frames",
    category: "Nudge",
    defaultBinding: { key: "[", ctrl: true, shift: true },
  },
  // Track Navigation
  {
    id: "select-clip-above",
    searchAlias: "Select Clip on Track Above",
    category: "Navigation",
    defaultBinding: { key: "ArrowUp", alt: true },
  },
  {
    id: "select-clip-below",
    searchAlias: "Select Clip on Track Below",
    category: "Navigation",
    defaultBinding: { key: "ArrowDown", alt: true },
  },
  // Timeline
  {
    id: "zoom-in",
    searchAlias: "Zoom In Timeline",
    category: "Timeline",
    defaultBinding: { key: "=", ctrl: true },
  },
  {
    id: "zoom-out",
    searchAlias: "Zoom Out Timeline",
    category: "Timeline",
    defaultBinding: { key: "-", ctrl: true },
  },
  {
    id: "toggle-ripple-edit",
    searchAlias: "Toggle Ripple Edit",
    category: "Timeline",
    defaultBinding: { key: "r" },
  },
  {
    id: "add-marker",
    searchAlias: "Add Timeline Marker",
    category: "Timeline",
    defaultBinding: { key: "m" },
  },
  // Track Operations
  {
    id: "toggle-track-lock",
    searchAlias: "Toggle Track Lock",
    category: "Track",
    defaultBinding: { key: "l", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-visibility",
    searchAlias: "Toggle Track Visibility",
    category: "Track",
    defaultBinding: { key: "v", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-mute",
    searchAlias: "Toggle Track Mute",
    category: "Track",
    defaultBinding: { key: "m", ctrl: true, alt: true },
  },
  {
    id: "pack-track",
    searchAlias: "Pack Track (Remove Gaps)",
    category: "Track",
    defaultBinding: { key: "p", ctrl: true, alt: true },
  },
  {
    id: "add-track",
    searchAlias: "Add New Track",
    category: "Track",
    defaultBinding: { key: "t", ctrl: true, alt: true },
  },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutActionId =
  (typeof SHORTCUT_DEFINITIONS)[number]["id"];
export type ShortcutCategory =
  (typeof SHORTCUT_DEFINITIONS)[number]["category"];

export interface ShortcutAction {
  /** Machine-readable action id */
  id: ShortcutActionId;
  /** English alias used only as a shortcut-search fallback */
  searchAlias: string;
  /** Category for grouping in the settings panel */
  category: ShortcutCategory;
  /** Default binding (cannot be deleted, only overridden) */
  defaultBinding: KeyBinding;
  /** Current binding (may differ from default after user customisation) */
  binding: KeyBinding;
}

export const SHORTCUT_CATEGORY_MESSAGE_KEYS = {
  Transport: "settings.shortcuts.category.transport",
  "Source Mode": "settings.shortcuts.category.sourceMode",
  Edit: "settings.shortcuts.category.edit",
  Nudge: "settings.shortcuts.category.nudge",
  Navigation: "settings.shortcuts.category.navigation",
  Timeline: "settings.shortcuts.category.timeline",
  Track: "settings.shortcuts.category.track",
} as const satisfies Record<ShortcutCategory, MessageKey>;

export const SHORTCUT_ACTION_MESSAGE_KEYS = {
  "play-pause": "settings.shortcuts.action.playPause",
  pause: "settings.shortcuts.action.pause",
  "seek-back-frame": "settings.shortcuts.action.seekBackFrame",
  "seek-forward-frame": "settings.shortcuts.action.seekForwardFrame",
  "mark-source-in": "settings.shortcuts.action.markSourceIn",
  "mark-source-out": "settings.shortcuts.action.markSourceOut",
  "exit-source-mode": "settings.shortcuts.action.exitSourceMode",
  undo: "settings.shortcuts.action.undo",
  redo: "settings.shortcuts.action.redo",
  "redo-alt": "settings.shortcuts.action.redoAlt",
  "split-at-playhead": "settings.shortcuts.action.splitAtPlayhead",
  "split-selected-at-playhead":
    "settings.shortcuts.action.splitSelectedAtPlayhead",
  "split-all-at-playhead": "settings.shortcuts.action.splitAllAtPlayhead",
  "delete-left-at-playhead": "settings.shortcuts.action.deleteLeftAtPlayhead",
  "delete-right-at-playhead": "settings.shortcuts.action.deleteRightAtPlayhead",
  "duplicate-clips": "settings.shortcuts.action.duplicateClips",
  "copy-clips": "settings.shortcuts.action.copyClips",
  "paste-clips": "settings.shortcuts.action.pasteClips",
  "swap-clips": "settings.shortcuts.action.swapClips",
  "select-all": "settings.shortcuts.action.selectAll",
  "deselect-all": "settings.shortcuts.action.deselectAll",
  "clear-selection": "settings.shortcuts.action.clearSelection",
  "nudge-right": "settings.shortcuts.action.nudgeRight",
  "nudge-left": "settings.shortcuts.action.nudgeLeft",
  "nudge-right-10": "settings.shortcuts.action.nudgeRight10",
  "nudge-left-10": "settings.shortcuts.action.nudgeLeft10",
  "select-clip-above": "settings.shortcuts.action.selectClipAbove",
  "select-clip-below": "settings.shortcuts.action.selectClipBelow",
  "zoom-in": "settings.shortcuts.action.zoomIn",
  "zoom-out": "settings.shortcuts.action.zoomOut",
  "toggle-ripple-edit": "settings.shortcuts.action.toggleRippleEdit",
  "add-marker": "settings.shortcuts.action.addMarker",
  "toggle-track-lock": "settings.shortcuts.action.toggleTrackLock",
  "toggle-track-visibility": "settings.shortcuts.action.toggleTrackVisibility",
  "toggle-track-mute": "settings.shortcuts.action.toggleTrackMute",
  "pack-track": "settings.shortcuts.action.packTrack",
  "add-track": "settings.shortcuts.action.addTrack",
} as const satisfies Record<ShortcutActionId, MessageKey>;

const SHORTCUT_ACTION_IDS = new Set<string>(
  SHORTCUT_DEFINITIONS.map(({ id }) => id),
);

function isShortcutActionId(id: string): id is ShortcutActionId {
  return SHORTCUT_ACTION_IDS.has(id);
}

// Hydrate bindings from defaults
function buildInitialShortcuts(): Record<ShortcutActionId, ShortcutAction> {
  const result = {} as Record<ShortcutActionId, ShortcutAction>;
  for (const s of SHORTCUT_DEFINITIONS) {
    result[s.id] = { ...s, binding: { ...s.defaultBinding } };
  }
  return result;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

interface ShortcutStore {
  shortcuts: Record<ShortcutActionId, ShortcutAction>;

  /** Override a single shortcut's binding */
  setShortcut: (id: ShortcutActionId, binding: KeyBinding) => void;

  /** Reset a single shortcut to its default binding */
  resetShortcut: (id: ShortcutActionId) => void;

  /** Reset all shortcuts to defaults */
  resetAll: () => void;

  /** Returns the action id whose binding matches the event, or null */
  getMatchingAction: (e: KeyboardEvent) => ShortcutActionId | null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set, get) => ({
      shortcuts: buildInitialShortcuts(),

      setShortcut: (id, binding) => {
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [id]: { ...state.shortcuts[id], binding },
          },
        }));
      },

      resetShortcut: (id) => {
        set((state) => {
          const action = state.shortcuts[id];
          if (!action) return state;
          return {
            shortcuts: {
              ...state.shortcuts,
              [id]: { ...action, binding: { ...action.defaultBinding } },
            },
          };
        });
      },

      resetAll: () => {
        set({ shortcuts: buildInitialShortcuts() });
      },

      getMatchingAction: (e: KeyboardEvent) => {
        const { shortcuts } = get();
        const isMeta = e.ctrlKey || e.metaKey;
        for (const action of Object.values(shortcuts)) {
          const b = action.binding;
          if (b.key !== e.key) continue;
          if (!!b.ctrl !== isMeta) continue;
          if (!!b.shift !== e.shiftKey) continue;
          if (!!b.alt !== e.altKey) continue;
          return action.id;
        }
        return null;
      },
    }),
    {
      name: "clypra-shortcuts",
      // Only persist the binding overrides, not the full action metadata
      // This way new shortcuts added in future versions are always picked up
      partialize: (state) => ({
        shortcuts: Object.fromEntries(
          Object.entries(state.shortcuts).map(([id, action]) => [
            id,
            { binding: action.binding },
          ])
        ),
      }),
      // Merge persisted binding overrides back onto the full action list
      merge: (persisted: any, current) => {
        const base = buildInitialShortcuts();
        if (persisted?.shortcuts) {
          for (const [id, data] of Object.entries(
            persisted.shortcuts as Record<string, any>,
          )) {
            if (isShortcutActionId(id) && data?.binding) {
              base[id] = { ...base[id], binding: data.binding };
            }
          }
        }
        return { ...current, shortcuts: base };
      },
    }
  )
);

// ─── Standalone helper (usable outside React) ─────────────────────────────────

/**
 * Returns true if the keyboard event matches the named action's current binding.
 * Can be called imperatively from event handlers.
 */
export function matchesShortcut(
  e: KeyboardEvent,
  actionId: ShortcutActionId,
): boolean {
  return useShortcutStore.getState().getMatchingAction(e) === actionId;
}

/** Returns a human-readable key label for a binding, e.g. "⌘ Shift Z" */
export function formatBinding(binding: KeyBinding): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
  const parts: string[] = [];
  if (binding.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
  if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
  if (binding.shift) parts.push("Shift");

  const keyLabel =
    binding.key === "Space"
      ? "Space"
      : binding.key === "Escape"
        ? "Esc"
        : binding.key === "ArrowLeft"
          ? "←"
          : binding.key === "ArrowRight"
            ? "→"
            : binding.key === "ArrowUp"
              ? "↑"
              : binding.key === "ArrowDown"
                ? "↓"
                : binding.key.toUpperCase();
  parts.push(keyLabel);
  return parts.join(" ");
}

/** Returns all unique categories in definition order */
export function getShortcutCategories(): ShortcutCategory[] {
  const seen = new Set<ShortcutCategory>();
  const result: ShortcutCategory[] = [];
  for (const s of SHORTCUT_DEFINITIONS) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      result.push(s.category);
    }
  }
  return result;
}
