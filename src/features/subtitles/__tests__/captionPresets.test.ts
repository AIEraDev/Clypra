import { describe, it, expect } from "vitest";
import { CAPTION_STYLE_PRESETS, getCaptionPresetById } from "../captionPresets";

describe("Caption Style Presets & Batch Formatting System", () => {
  it("defines 4 built-in caption style presets", () => {
    expect(CAPTION_STYLE_PRESETS).toHaveLength(4);
  });

  it("retrieves Yellow Bold caption preset correctly", () => {
    const yellow = getCaptionPresetById("yellow-bold");
    expect(yellow).toBeDefined();
    expect(yellow?.fillColor).toBe("#FFE600");
    expect(yellow?.strokeColor).toBe("#000000");
    expect(yellow?.bold).toBe(true);
  });

  it("retrieves High-Contrast Box preset with background color", () => {
    const box = getCaptionPresetById("black-box");
    expect(box).toBeDefined();
    expect(box?.backgroundColor).toBeDefined();
    expect(box?.fillColor).toBe("#FFFFFF");
  });
});
