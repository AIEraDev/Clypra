import { describe, it, expect, beforeEach } from "vitest";
import { useShortcutStore, formatBinding } from "../shortcutStore";

describe("useShortcutStore Presets & Conflict Detection", () => {
  beforeEach(() => {
    useShortcutStore.getState().resetAll();
  });

  it("initializes with Clypra default preset", () => {
    const { activePreset, shortcuts } = useShortcutStore.getState();
    expect(activePreset).toBe("clypra");
    expect(shortcuts["split-at-playhead"].binding.key).toBe("s");
  });

  it("applies Adobe Premiere Pro hotkey preset", () => {
    useShortcutStore.getState().applyPreset("premiere");
    const { activePreset, shortcuts } = useShortcutStore.getState();

    expect(activePreset).toBe("premiere");
    // Premiere split shortcut is "c" (Razor tool)
    expect(shortcuts["split-at-playhead"].binding.key).toBe("c");
    expect(shortcuts["split-selected-at-playhead"].binding).toEqual({ key: "k", ctrl: true });
    expect(shortcuts["split-all-at-playhead"].binding).toEqual({ key: "k", ctrl: true, shift: true });
    expect(shortcuts["delete-left-at-playhead"].binding.key).toBe("q");
    expect(shortcuts["delete-right-at-playhead"].binding.key).toBe("w");
    expect(shortcuts["toggle-ripple-edit"].binding.key).toBe("b");
    expect(shortcuts["zoom-in"].binding.key).toBe("=");
    expect(shortcuts["zoom-out"].binding.key).toBe("-");
    expect(shortcuts["nudge-left"].binding).toEqual({ key: "ArrowLeft", alt: true });
    expect(shortcuts["nudge-right"].binding).toEqual({ key: "ArrowRight", alt: true });
  });

  it("applies Final Cut Pro hotkey preset", () => {
    useShortcutStore.getState().applyPreset("finalcut");
    const { activePreset, shortcuts } = useShortcutStore.getState();

    expect(activePreset).toBe("finalcut");
    // Final Cut split shortcut is "b" (Blade)
    expect(shortcuts["split-at-playhead"].binding.key).toBe("b");
    expect(shortcuts["split-selected-at-playhead"].binding).toEqual({ key: "b", ctrl: true });
    expect(shortcuts["delete-left-at-playhead"].binding).toEqual({ key: "[", alt: true });
    expect(shortcuts["delete-right-at-playhead"].binding).toEqual({ key: "]", alt: true });
    expect(shortcuts["toggle-ripple-edit"].binding.key).toBe("t");
    expect(shortcuts["nudge-left"].binding.key).toBe(",");
    expect(shortcuts["nudge-right"].binding.key).toBe(".");
    expect(shortcuts["zoom-in"].binding).toEqual({ key: "=", ctrl: true });
  });

  it("applies DaVinci Resolve hotkey preset", () => {
    useShortcutStore.getState().applyPreset("davinci");
    const { activePreset, shortcuts } = useShortcutStore.getState();

    expect(activePreset).toBe("davinci");
    // DaVinci split shortcut is "b" (Blade)
    expect(shortcuts["split-at-playhead"].binding.key).toBe("b");
    expect(shortcuts["split-selected-at-playhead"].binding).toEqual({ key: "\\", ctrl: true });
    expect(shortcuts["delete-left-at-playhead"].binding.key).toBe("q");
    expect(shortcuts["delete-right-at-playhead"].binding.key).toBe("w");
    expect(shortcuts["toggle-ripple-edit"].binding.key).toBe("t");
    expect(shortcuts["nudge-left"].binding.key).toBe(",");
    expect(shortcuts["nudge-right"].binding.key).toBe(".");
  });

  it("detects keybinding conflicts correctly", () => {
    const { findConflict, setShortcut } = useShortcutStore.getState();

    // Space is bound to play-pause
    const conflict = findConflict({ key: "Space" }, "split-at-playhead");
    expect(conflict).not.toBeNull();
    expect(conflict?.id).toBe("play-pause");

    // Setting a unique key should find no conflict
    const noConflict = findConflict({ key: "F12" }, "split-at-playhead");
    expect(noConflict).toBeNull();
  });

  it("resets all shortcuts back to Clypra defaults", () => {
    useShortcutStore.getState().applyPreset("premiere");
    expect(useShortcutStore.getState().shortcuts["split-at-playhead"].binding.key).toBe("c");

    useShortcutStore.getState().resetAll();
    expect(useShortcutStore.getState().activePreset).toBe("clypra");
    expect(useShortcutStore.getState().shortcuts["split-at-playhead"].binding.key).toBe("s");
  });

  it("persists activePreset and correctly rehydrates with user custom overrides", () => {
    // 1. Select DaVinci Resolve preset
    useShortcutStore.getState().applyPreset("davinci");
    // 2. Custom override on top of preset
    useShortcutStore.getState().setShortcut("play-pause", { key: "p" });

    // 3. Inspect partialize output
    const storePersist = (useShortcutStore as any).persist;
    const persistedData = storePersist.getOptions().partialize(useShortcutStore.getState());

    expect(persistedData.activePreset).toBe("davinci");
    expect(persistedData.shortcuts["play-pause"].binding.key).toBe("p");

    // 4. Test rehydration merge onto default state
    const mergedState = storePersist.getOptions().merge(persistedData, useShortcutStore.getState());
    expect(mergedState.activePreset).toBe("davinci");
    // Preserves preset-specific mapping
    expect(mergedState.shortcuts["split-at-playhead"].binding.key).toBe("b");
    expect(mergedState.shortcuts["delete-left-at-playhead"].binding.key).toBe("q");
    // Preserves custom override
    expect(mergedState.shortcuts["play-pause"].binding.key).toBe("p");
  });
});
