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
    expect(shortcuts["delete-left-at-playhead"].binding.key).toBe("q");
    expect(shortcuts["delete-right-at-playhead"].binding.key).toBe("w");
  });

  it("applies Final Cut Pro hotkey preset", () => {
    useShortcutStore.getState().applyPreset("finalcut");
    const { activePreset, shortcuts } = useShortcutStore.getState();

    expect(activePreset).toBe("finalcut");
    // Final Cut split shortcut is "b" (Blade)
    expect(shortcuts["split-at-playhead"].binding.key).toBe("b");
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
});
