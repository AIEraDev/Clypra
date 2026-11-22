import { describe, expect, it, beforeEach } from "vitest";
import {
  applyTheme,
  CLIP_PALETTES,
  CLIP_PALETTE_TOKEN_KEYS,
  UI_THEMES,
  useSettingsStore,
} from "../settingsStore";

describe("independent UI theme and clip palette composition", () => {
  beforeEach(() => {
    applyTheme("dark", "light", null);
  });

  it("keeps UI tokens and clip tokens in their selected layers", () => {
    const root = document.documentElement;

    expect(root.style.getPropertyValue("--clypra-theme-accent")).toBe(
      UI_THEMES.dark["--color-accent"],
    );
    expect(root.style.getPropertyValue("--color-timeline-track-name")).toBe(
      UI_THEMES.dark["--color-timeline-track-name"],
    );
    expect(root.style.getPropertyValue("--clypra-clip-video-bg")).toBe(
      CLIP_PALETTES.light["--color-timeline-clip-video"],
    );
    expect(root.style.getPropertyValue("--color-timeline-clip-video")).toBe("");
  });

  it("changes the layers independently through settings", () => {
    useSettingsStore.getState().setClipPalette("dark");
    useSettingsStore.getState().setUiTheme("light");

    expect(useSettingsStore.getState().uiTheme).toBe("light");
    expect(useSettingsStore.getState().clipPalette).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--clypra-theme-accent")).toBe(
      UI_THEMES.light["--color-accent"],
    );
    expect(document.documentElement.style.getPropertyValue("--clypra-clip-audio-bg")).toBe(
      CLIP_PALETTES.dark["--color-timeline-clip-audio"],
    );
  });

  it("keeps the clip registry complete and out of UI themes", () => {
    const expectedKeys = [...CLIP_PALETTE_TOKEN_KEYS].sort();

    for (const palette of Object.values(CLIP_PALETTES)) {
      expect(Object.keys(palette).sort()).toEqual(expectedKeys);
    }

    const clipKeys = new Set<string>(CLIP_PALETTE_TOKEN_KEYS);
    for (const uiTheme of Object.values(UI_THEMES)) {
      expect(Object.keys(uiTheme).some((key) => clipKeys.has(key))).toBe(false);
    }
  });

  it("sets data-theme attribute on document.documentElement for dark and light modes", () => {
    applyTheme("light", "light", null);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    applyTheme("dark", "dark", null);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    useSettingsStore.getState().setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(useSettingsStore.getState().uiTheme).toBe("light");
    expect(useSettingsStore.getState().clipPalette).toBe("light");

    useSettingsStore.getState().setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(useSettingsStore.getState().uiTheme).toBe("dark");
  });
});
