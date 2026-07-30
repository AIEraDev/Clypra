import { describe, it, expect } from "vitest";
import { BUILTIN_PROJECT_TEMPLATES, getTemplateById } from "../projectTemplates";

describe("Built-in Project Templates & Creator Presets", () => {
  it("defines 5 built-in project templates", () => {
    expect(BUILTIN_PROJECT_TEMPLATES).toHaveLength(5);
  });

  it("retrieves templates by ID correctly", () => {
    const reels = getTemplateById("reels-tiktok");
    expect(reels).toBeDefined();
    expect(reels?.aspectRatio).toBe("9:16");
    expect(reels?.width).toBe(1080);
    expect(reels?.height).toBe(1920);
    expect(reels?.initialTracks.some((t) => t.name === "Auto Captions")).toBe(true);
  });

  it("validates YouTube Widescreen template settings", () => {
    const yt = getTemplateById("youtube-widescreen");
    expect(yt).toBeDefined();
    expect(yt?.aspectRatio).toBe("16:9");
    expect(yt?.frameRate).toBe(60);
    expect(yt?.initialTracks.length).toBeGreaterThanOrEqual(3);
  });

  it("validates Podcast template multi-audio track configuration", () => {
    const podcast = getTemplateById("podcast-speech");
    expect(podcast).toBeDefined();
    const audioTracks = podcast?.initialTracks.filter((t) => t.type === "audio");
    expect(audioTracks?.length).toBe(2);
  });
});
