import { describe, it, expect, beforeEach } from "vitest";
import {
  SubtitleParserWorkerClient,
  getSubtitleParserWorkerClient,
} from "../subtitleParserWorkerClient";

describe("SubtitleParserWorkerClient", () => {
  let client: SubtitleParserWorkerClient;

  beforeEach(() => {
    client = new SubtitleParserWorkerClient();
  });

  it("provides a singleton instance", () => {
    const s1 = getSubtitleParserWorkerClient();
    const s2 = getSubtitleParserWorkerClient();
    expect(s1).toBe(s2);
  });

  it("parses SRT text in fallback mode", async () => {
    const srt = `1\n00:00:01,000 --> 00:00:04,000\nHello world!\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond line!`;
    const res = await client.parseSubtitles("srt", srt);

    expect(res.type).toBe("PARSE_RESULT");
    expect(res.cues.length).toBeGreaterThan(0);
    expect(res.durationSeconds).toBeGreaterThan(0);
  });

  it("parses Whisper word segments in fallback mode", async () => {
    const segments = [
      { word: "Welcome", startTime: 0.0, endTime: 0.5, probability: 0.98 },
      { word: "to", startTime: 0.5, endTime: 0.7, probability: 0.99 },
      { word: "Clypra", startTime: 0.7, endTime: 1.2, probability: 0.95 },
    ];

    const res = await client.parseSubtitles("whisper", undefined, segments);
    expect(res.type).toBe("PARSE_RESULT");
    expect(res.cues.length).toBe(1);
    expect(res.cues[0].text).toBe("Welcome to Clypra");
    expect(res.cues[0].words?.length).toBe(3);
  });

  it("computes cue layout in fallback mode", async () => {
    const cues = [
      {
        id: "c1",
        startTime: 0,
        endTime: 4,
        text: "This is a centered caption line.",
      },
    ];

    const res = await client.layoutCues(cues, {
      fontFamily: "Inter Variable",
      fontSize: 48,
      canvasWidth: 1920,
      canvasHeight: 1080,
    });

    expect(res.type).toBe("LAYOUT_RESULT");
    expect(res.cues.length).toBe(1);
    expect(res.cues[0].boundingBox).toBeDefined();
    expect(res.cues[0].boundingBox.width).toBeGreaterThan(0);
    expect(res.cues[0].boundingBox.height).toBeGreaterThan(0);
  });
});
