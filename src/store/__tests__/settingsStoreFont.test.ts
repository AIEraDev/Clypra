import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, applyFontFamily, type FontFamily } from "../settingsStore";

describe("SettingsStore Font Family Application", () => {
  beforeEach(() => {
    useSettingsStore.setState({ fontFamily: "inter" });
  });

  it("updates fontFamily state when setFontFamily is called", () => {
    useSettingsStore.getState().setFontFamily("outfit");
    expect(useSettingsStore.getState().fontFamily).toBe("outfit");
  });

  it("applies font family to document root and body when applyFontFamily is invoked", () => {
    applyFontFamily("montserrat");
    const rootFont = document.documentElement.style.getPropertyValue("--font-sans");
    expect(rootFont).toContain("Montserrat Variable");
    expect(document.body.style.fontFamily).toContain("Montserrat Variable");
  });

  it("supports switching to system and mono fonts", () => {
    applyFontFamily("mono");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("JetBrains Mono");

    applyFontFamily("system");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("apple-system");
  });
});
