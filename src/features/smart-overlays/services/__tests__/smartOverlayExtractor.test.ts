import { describe, expect, it } from "vitest";
import { extractSmartOverlaysFromTranscript } from "../smartOverlayExtractor";

describe("smartOverlayExtractor service", () => {
  it("detects stat, quote, comparison, and code intents from transcript", () => {
    const mockTranscript = {
      segments: [
        { text: "Revenue increased by 85% this quarter.", start: 1.0, end: 3.5 },
        { text: "Steve Jobs said simplicity is sophistication.", start: 4.0, end: 7.0 },
        { text: "We evaluate React versus Vue.", start: 7.5, end: 10.0 },
        { text: "Run npm install react to setup.", start: 10.5, end: 13.0 },
      ],
    };

    const plan = extractSmartOverlaysFromTranscript(mockTranscript);

    expect(plan.clips.length).toBe(4);

    // Stat clip
    const statClip = plan.clips.find((c) => c.overlayType === "stat");
    expect(statClip).toBeDefined();
    if (statClip && statClip.content.type === "stat") {
      expect(statClip.content.data.value).toBe("85%");
    }

    // Quote clip
    const quoteClip = plan.clips.find((c) => c.overlayType === "quote");
    expect(quoteClip).toBeDefined();
    if (quoteClip && quoteClip.content.type === "quote") {
      expect(quoteClip.content.data.author).toBe("Steve Jobs");
    }

    // Comparison clip
    const compClip = plan.clips.find((c) => c.overlayType === "comparison");
    expect(compClip).toBeDefined();
    if (compClip && compClip.content.type === "comparison") {
      expect(compClip.content.data.left.title).toBe("React");
      expect(compClip.content.data.right.title).toBe("Vue");
    }

    // Code clip
    const codeClip = plan.clips.find((c) => c.overlayType === "code");
    expect(codeClip).toBeDefined();
    if (codeClip && codeClip.content.type === "code") {
      expect(codeClip.content.data.language).toBe("bash");
    }
  });

  it("resolves temporal overlaps by placing overlapping clips on separate secondary tracks", () => {
    const mockTranscript = {
      segments: [
        { text: "First stat is +50% growth.", start: 2.0, end: 6.0 },
        { text: "Simultaneous quote: Linus said code rules.", start: 3.0, end: 7.0 }, // Overlaps in time!
      ],
    };

    const plan = extractSmartOverlaysFromTranscript(mockTranscript);

    expect(plan.clips.length).toBe(2);
    expect(plan.clips[0].trackId).toBe("animated-overlay");
    expect(plan.clips[1].trackId).toBe("animated-overlay-2");
    expect(plan.requiredTracks.length).toBe(2);
  });
});
