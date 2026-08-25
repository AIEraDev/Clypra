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
    applyTheme("dark", "ember-studio", null);
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
      CLIP_PALETTES["ember-studio"]["--color-timeline-clip-video"],
    );
    expect(root.style.getPropertyValue("--color-timeline-clip-video")).toBe("");
  });

  it("changes the layers independently through settings", () => {
    useSettingsStore.getState().setClipPalette("ember-studio");
    useSettingsStore.getState().setUiTheme("midnight");

    expect(useSettingsStore.getState().uiTheme).toBe("midnight");
    expect(useSettingsStore.getState().clipPalette).toBe("ember-studio");
    expect(document.documentElement.style.getPropertyValue("--clypra-theme-accent")).toBe(
      UI_THEMES.midnight["--color-accent"],
    );
    expect(document.documentElement.style.getPropertyValue("--clypra-clip-audio-bg")).toBe(
      CLIP_PALETTES["ember-studio"]["--color-timeline-clip-audio"],
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
});
