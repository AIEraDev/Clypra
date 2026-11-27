import { describe, it, expect } from "vitest";
import {
  BUILTIN_PROJECT_TEMPLATES,
  getTemplateById,
} from "../projectTemplates";

describe("Built-in Project Templates & Creator Presets", () => {
  it("defines 9 built-in project templates", () => {
    expect(BUILTIN_PROJECT_TEMPLATES).toHaveLength(9);
  });

  it("retrieves templates by ID correctly", () => {
    const reels = getTemplateById("reels-tiktok");
    expect(reels).toBeDefined();
    expect(reels?.aspectRatio).toBe("9:16");
    expect(reels?.width).toBe(1080);
    expect(reels?.height).toBe(1920);
    expect(reels?.initialTracks.some((t) => t.name === "Auto Captions")).toBe(
      true,
    );
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
    const audioTracks = podcast?.initialTracks.filter(
      (t) => t.type === "audio",
    );
    expect(audioTracks?.length).toBe(2);
  });

  it("PAL template pal-16x9 exists with frameRate 25", () => {
    const pal = getTemplateById("pal-16x9");
    expect(pal).toBeDefined();
    expect(pal?.frameRate).toBe(25);
    expect(pal?.aspectRatio).toBe("16:9");
  });

  it("PAL HD template pal-hd-16x9 exists with frameRate 50", () => {
    const palHd = getTemplateById("pal-hd-16x9");
    expect(palHd).toBeDefined();
    expect(palHd?.frameRate).toBe(50);
    expect(palHd?.aspectRatio).toBe("16:9");
  });

  it("Football Highlights vertical 9:16 template exists", () => {
    const fh = getTemplateById("football-highlights");
    expect(fh).toBeDefined();
    expect(fh?.aspectRatio).toBe("9:16");
    expect(fh?.width).toBe(1080);
    expect(fh?.height).toBe(1920);
    expect(fh?.frameRate).toBe(30);
    expect(fh?.category).toBe("social");
    expect(fh?.initialTracks).toHaveLength(6);
  });

  it("Football Highlights YouTube 16:9 60fps template exists", () => {
    const fhYt = getTemplateById("football-highlights-16x9");
    expect(fhYt).toBeDefined();
    expect(fhYt?.aspectRatio).toBe("16:9");
    expect(fhYt?.width).toBe(1920);
    expect(fhYt?.height).toBe(1080);
    expect(fhYt?.frameRate).toBe(60);
    expect(fhYt?.category).toBe("video");
    expect(fhYt?.initialTracks).toHaveLength(6);
  });
});
