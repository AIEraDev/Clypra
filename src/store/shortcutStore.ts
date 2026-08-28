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

export interface ShortcutAction {
  /** Machine-readable action id */
  id: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** Category for grouping in the settings panel */
  category: string;
  /** Default binding (cannot be deleted, only overridden) */
  defaultBinding: KeyBinding;
  /** Current binding (may differ from default after user customisation) */
  binding: KeyBinding;
}

export type ShortcutPreset = "clypra" | "premiere" | "finalcut" | "davinci";

export const PRESET_NAME_MAP: Record<ShortcutPreset, string> = {
  clypra: "Clypra Default",
  premiere: "Adobe Premiere Pro",
  finalcut: "Final Cut Pro",
  davinci: "DaVinci Resolve",
};

export const PRESET_BINDINGS: Record<ShortcutPreset, Record<string, KeyBinding>> = {
  clypra: {},
  premiere: {
    "split-at-playhead": { key: "c" },
    "split-selected-at-playhead": { key: "k", ctrl: true },
    "split-all-at-playhead": { key: "k", ctrl: true, shift: true },
    "delete-left-at-playhead": { key: "q" },
    "delete-right-at-playhead": { key: "w" },
    "toggle-ripple-edit": { key: "b" },
    "zoom-in": { key: "=" },
    "zoom-out": { key: "-" },
    "nudge-left": { key: "ArrowLeft", alt: true },
    "nudge-right": { key: "ArrowRight", alt: true },
    "nudge-left-10": { key: "ArrowLeft", alt: true, shift: true },
    "nudge-right-10": { key: "ArrowRight", alt: true, shift: true },
    "group-clips": { key: "g", ctrl: true },
    "deselect-all": { key: "d", ctrl: true, shift: true },
  },
  finalcut: {
    "split-at-playhead": { key: "b" },
    "split-selected-at-playhead": { key: "b", ctrl: true },
    "split-all-at-playhead": { key: "b", ctrl: true, shift: true },
    "delete-left-at-playhead": { key: "[", alt: true },
    "delete-right-at-playhead": { key: "]", alt: true },
    "toggle-ripple-edit": { key: "t" },
    "nudge-left": { key: "," },
    "nudge-right": { key: "." },
    "nudge-left-10": { key: ",", shift: true },
    "nudge-right-10": { key: ".", shift: true },
    "group-clips": { key: "g", alt: true },
    "deselect-all": { key: "a", ctrl: true, shift: true },
    "zoom-in": { key: "=", ctrl: true },
    "zoom-out": { key: "-", ctrl: true },
  },
  davinci: {
    "split-at-playhead": { key: "b" },
    "split-selected-at-playhead": { key: "\\", ctrl: true },
    "split-all-at-playhead": { key: "\\", ctrl: true, shift: true },
    "delete-left-at-playhead": { key: "q" },
    "delete-right-at-playhead": { key: "w" },
    "toggle-ripple-edit": { key: "t" },
    "nudge-left": { key: "," },
    "nudge-right": { key: "." },
    "nudge-left-10": { key: ",", shift: true },
    "nudge-right-10": { key: ".", shift: true },
    "group-clips": { key: "g", ctrl: true },
    "deselect-all": { key: "a", ctrl: true, shift: true },
    "zoom-in": { key: "=", ctrl: true },
    "zoom-out": { key: "-", ctrl: true },
  },
};

// ─── Default Shortcut Registry ────────────────────────────────────────────────

const DEFAULT_SHORTCUTS: Omit<ShortcutAction, "binding">[] = [
  // Transport
  {
    id: "play-pause",
    label: "Play / Pause",
    category: "Transport",
    defaultBinding: { key: "Space" },
  },
  {
    id: "pause",
    label: "Pause",
    category: "Transport",
    defaultBinding: { key: "k" },
  },
  {
    id: "seek-back-frame",
    label: "Step Back One Frame",
    category: "Transport",
    defaultBinding: { key: "ArrowLeft" },
  },
  {
    id: "seek-forward-frame",
    label: "Step Forward One Frame",
    category: "Transport",
    defaultBinding: { key: "ArrowRight" },
  },
  // Source Mode
  {
    id: "mark-source-in",
    label: "Mark In Point (Source)",
    category: "Source Mode",
    defaultBinding: { key: "i" },
  },
  {
    id: "mark-source-out",
    label: "Mark Out Point (Source)",
    category: "Source Mode",
    defaultBinding: { key: "o" },
  },
  {
    id: "exit-source-mode",
    label: "Exit Source Mode",
    category: "Source Mode",
    defaultBinding: { key: "Escape" },
  },
  // Edit
  {
    id: "undo",
    label: "Undo",
    category: "Edit",
    defaultBinding: { key: "z", ctrl: true },
  },
  {
    id: "redo",
    label: "Redo",
    category: "Edit",
    defaultBinding: { key: "z", ctrl: true, shift: true },
  },
  {
    id: "redo-alt",
    label: "Redo (Alt)",
    category: "Edit",
    defaultBinding: { key: "y", ctrl: true },
  },
  {
    id: "split-at-playhead",
    label: "Split at Playhead",
    category: "Edit",
    defaultBinding: { key: "s" },
  },
  {
    id: "split-selected-at-playhead",
    label: "Split Selected at Playhead",
    category: "Edit",
    defaultBinding: { key: "k", ctrl: true },
  },
  {
    id: "split-all-at-playhead",
    label: "Split All at Playhead",
    category: "Edit",
    defaultBinding: { key: "k", ctrl: true, shift: true },
  },
  {
    id: "delete-left-at-playhead",
    label: "Delete Left of Playhead",
    category: "Edit",
    defaultBinding: { key: "q" },
  },
  {
    id: "delete-right-at-playhead",
    label: "Delete Right of Playhead",
    category: "Edit",
    defaultBinding: { key: "w" },
  },
  {
    id: "duplicate-clips",
    label: "Duplicate Selected Clips",
    category: "Edit",
    defaultBinding: { key: "d", ctrl: true },
  },
  {
    id: "group-clips",
    label: "Group Selected Clips",
    category: "Edit",
    defaultBinding: { key: "g", alt: true },
  },
  {
    id: "copy-clips",
    label: "Copy Selected Clips",
    category: "Edit",
    defaultBinding: { key: "c", ctrl: true },
  },
  {
    id: "paste-clips",
    label: "Paste Clips",
    category: "Edit",
    defaultBinding: { key: "v", ctrl: true },
  },
  {
    id: "swap-clips",
    label: "Swap Clips",
    category: "Edit",
    defaultBinding: { key: "S", ctrl: true, shift: true },
  },
  {
    id: "select-all",
    label: "Select All Clips",
    category: "Edit",
    defaultBinding: { key: "a", ctrl: true },
  },
  {
    id: "deselect-all",
    label: "Deselect All Clips",
    category: "Edit",
    defaultBinding: { key: "d", ctrl: true, shift: true },
  },
  {
    id: "clear-selection",
    label: "Clear Selection",
    category: "Edit",
    defaultBinding: { key: "Escape" },
  },
  // Nudge
  {
    id: "nudge-right",
    label: "Nudge Right 1 Frame",
    category: "Nudge",
    defaultBinding: { key: "]", ctrl: true },
  },
  {
    id: "nudge-left",
    label: "Nudge Left 1 Frame",
    category: "Nudge",
    defaultBinding: { key: "[", ctrl: true },
  },
  {
    id: "nudge-right-10",
    label: "Nudge Right 10 Frames",
    category: "Nudge",
    defaultBinding: { key: "]", ctrl: true, shift: true },
  },
  {
    id: "nudge-left-10",
    label: "Nudge Left 10 Frames",
    category: "Nudge",
    defaultBinding: { key: "[", ctrl: true, shift: true },
  },
  // Track Navigation
  {
    id: "select-clip-above",
    label: "Select Clip on Track Above",
    category: "Navigation",
    defaultBinding: { key: "ArrowUp", alt: true },
  },
  {
    id: "select-clip-below",
    label: "Select Clip on Track Below",
    category: "Navigation",
    defaultBinding: { key: "ArrowDown", alt: true },
  },
  // Timeline
  {
    id: "zoom-in",
    label: "Zoom In Timeline",
    category: "Timeline",
    defaultBinding: { key: "=", ctrl: true },
  },
  {
    id: "zoom-out",
    label: "Zoom Out Timeline",
    category: "Timeline",
    defaultBinding: { key: "-", ctrl: true },
  },
  {
    id: "toggle-ripple-edit",
    label: "Toggle Ripple Edit",
    category: "Timeline",
    defaultBinding: { key: "r" },
  },
  {
    id: "add-marker",
    label: "Add Timeline Marker",
    category: "Timeline",
    defaultBinding: { key: "m" },
  },
  // Track Operations
  {
    id: "toggle-track-lock",
    label: "Toggle Track Lock",
    category: "Track",
    defaultBinding: { key: "l", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-visibility",
    label: "Toggle Track Visibility",
    category: "Track",
    defaultBinding: { key: "v", ctrl: true, alt: true },
  },
  {
    id: "toggle-track-mute",
    label: "Toggle Track Mute",
    category: "Track",
    defaultBinding: { key: "m", ctrl: true, alt: true },
  },
  {
    id: "pack-track",
    label: "Pack Track (Remove Gaps)",
    category: "Track",
    defaultBinding: { key: "p", ctrl: true, alt: true },
  },
  {
    id: "add-track",
    label: "Add New Track",
    category: "Track",
    defaultBinding: { key: "t", ctrl: true, alt: true },
  },
];

// Hydrate bindings from defaults
function buildInitialShortcuts(): Record<string, ShortcutAction> {
  const result: Record<string, ShortcutAction> = {};
  for (const s of DEFAULT_SHORTCUTS) {
    result[s.id] = { ...s, binding: { ...s.defaultBinding } };
  }
  return result;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

export interface ShortcutStore {
  /** Map of action id -> action definition */
  shortcuts: Record<string, ShortcutAction>;

  /** Currently selected hotkey preset scheme */
  activePreset: ShortcutPreset;

  /** Apply a predefined preset layout */
  applyPreset: (preset: ShortcutPreset) => void;

  /** Find conflict if a keybinding is already assigned to another action */
  findConflict: (binding: KeyBinding, excludeActionId?: string) => ShortcutAction | null;

  /** Override a single shortcut's binding */
  setShortcut: (id: string, binding: KeyBinding) => void;

  /** Reset a single shortcut to its default binding */
  resetShortcut: (id: string) => void;

  /** Reset all shortcuts to defaults */
  resetAll: () => void;

  /** Returns the action id whose binding matches the event, or null */
  getMatchingAction: (e: KeyboardEvent) => string | null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set, get) => ({
      shortcuts: buildInitialShortcuts(),
      activePreset: "clypra",

      applyPreset: (preset) => {
        const base = buildInitialShortcuts();
        const presetOverrides = PRESET_BINDINGS[preset] || {};
        for (const [id, binding] of Object.entries(presetOverrides)) {
          if (base[id]) {
            base[id] = { ...base[id], binding };
          }
        }
        set({ activePreset: preset, shortcuts: base });
      },

      findConflict: (binding, excludeActionId) => {
        const { shortcuts } = get();
        for (const action of Object.values(shortcuts)) {
          if (excludeActionId && action.id === excludeActionId) continue;
          const b = action.binding;
          if (
            b.key.toLowerCase() === binding.key.toLowerCase() &&
            !!b.ctrl === !!binding.ctrl &&
            !!b.shift === !!binding.shift &&
            !!b.alt === !!binding.alt
          ) {
            return action;
          }
        }
        return null;
      },

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
        set({ activePreset: "clypra", shortcuts: buildInitialShortcuts() });
      },

      getMatchingAction: (e: KeyboardEvent) => {
        const { shortcuts } = get();
        const isMeta = e.ctrlKey || e.metaKey;
        for (const action of Object.values(shortcuts)) {
          const b = action.binding;
          if (b.key.toLowerCase() !== e.key.toLowerCase()) continue;
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
      // Persist activePreset and binding overrides, not full action metadata
      // This way new shortcuts added in future versions are always picked up
      partialize: (state) => ({
        activePreset: state.activePreset,
        shortcuts: Object.fromEntries(
          Object.entries(state.shortcuts).map(([id, action]) => [
            id,
            { binding: action.binding },
          ])
        ),
      }),
      // Merge persisted preset and binding overrides back onto the full action list
      merge: (persisted: any, current) => {
        const activePreset: ShortcutPreset = persisted?.activePreset || "clypra";
        const base = buildInitialShortcuts();
        const presetOverrides = PRESET_BINDINGS[activePreset] || {};
        for (const [id, binding] of Object.entries(presetOverrides)) {
          if (base[id]) {
            base[id] = { ...base[id], binding };
          }
        }
        if (persisted?.shortcuts) {
          for (const [id, data] of Object.entries(persisted.shortcuts as Record<string, any>)) {
            if (base[id] && data?.binding) {
              base[id] = { ...base[id], binding: data.binding };
            }
          }
        }
        return { ...current, activePreset, shortcuts: base };
      },
    }
  )
);

// ─── Standalone helper (usable outside React) ─────────────────────────────────

/**
 * Returns true if the keyboard event matches the named action's current binding.
 * Can be called imperatively from event handlers.
 */
export function matchesShortcut(e: KeyboardEvent, actionId: string): boolean {
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
export function getShortcutCategories(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of DEFAULT_SHORTCUTS) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      result.push(s.category);
    }
  }
  return result;
}
