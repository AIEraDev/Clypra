import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { useShortcutStore, matchesShortcut } from "../shortcutStore";
import type { KeyBinding, ShortcutPreset } from "../shortcutStore";

describe("shortcutStore Case-Insensitivity & Preset Invariants", () => {
  beforeEach(() => {
    useShortcutStore.getState().resetAll();
  });

  it("matches shortcuts case-insensitively for letter keys", () => {
    const store = useShortcutStore.getState();
    store.setShortcut("undo", { key: "z", ctrl: true });

    const eventLowercase = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    const eventUppercase = new KeyboardEvent("keydown", { key: "Z", ctrlKey: true });

    expect(store.getMatchingAction(eventLowercase)).toBe("undo");
    expect(store.getMatchingAction(eventUppercase)).toBe("undo");
  });

  it("applies NLE preset binding schemes accurately", () => {
    const presets: ShortcutPreset[] = ["clypra", "premiere", "finalcut", "davinci"];

    presets.forEach((preset) => {
      useShortcutStore.getState().applyPreset(preset);
      expect(useShortcutStore.getState().activePreset).toBe(preset);
      expect(useShortcutStore.getState().shortcuts["split-at-playhead"]).toBeDefined();
    });
  });

  it("finds keybinding conflicts accurately across registered actions", () => {
    const store = useShortcutStore.getState();
    const conflict = store.findConflict({ key: "Space" });

    expect(conflict).not.toBeNull();
    expect(conflict?.id).toBe("play-pause");
  });

  it("property test: resetAll restores all action bindings to default", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("play-pause", "split-at-playhead", "undo"),
        fc.string({ minLength: 1, maxLength: 5 }),
        (actionId, newKey) => {
          const store = useShortcutStore.getState();
          store.setShortcut(actionId, { key: newKey });

          store.resetAll();

          const restored = useShortcutStore.getState().shortcuts[actionId];
          expect(restored.binding).toEqual(restored.defaultBinding);
        }
      )
    );
  });
});
