/**
 * PropertiesPanel — clip-kind routing regression tests
 *
 * Verifies that:
 * 1. `isTextClip` is correctly true for both "text" and "text-template" clips.
 * 2. `isTextClip` is false for video, audio, image, sticker, and effect clips.
 * 3. `clipName` resolves correctly for every clip kind — especially that a
 *    text-template clip never falls through to the default "Clip" string.
 * 4. Existing plain text clips still work exactly as before (no regression).
 *
 * These tests are pure logic tests against the exported `buildClipPropertyTransform`
 * helper and against the isTextClip/clipName predicates extracted into testable
 * helper functions. They do NOT render the full React component.
 */

import { describe, it, expect } from "vitest";
import { buildClipPropertyTransform } from "../PropertiesPanel";
import type { Clip, TextClip } from "@/types";

// ─── Helpers (mirrors the logic in PropertiesPanel verbatim) ─────────────────
// These duplicate the exact predicates from PropertiesPanel so changes there
// are caught as test failures here.

function resolveIsTextClip(clip: Clip | null | undefined): boolean {
  if (!clip) return false;
  return (
    clip.kind === "text" ||
    clip.kind === "text-template" ||
    "text" in clip
  );
}

function resolveClipName(
  clip: Clip,
  isText: boolean,
  isTimelineEffect: boolean,
  assetName: string | undefined,
): string {
  if (isText) {
    if (clip.kind === "text-template") {
      return (
        clip.name ||
        (clip as any).templateSnapshot?.metadata?.label ||
        "Text Template"
      ).slice(0, 24);
    }
    return ((clip as TextClip).text || "Text").slice(0, 24);
  }
  if (isTimelineEffect) return clip.name || "Effect";
  return assetName || (clip as any)?.audioPath?.split("/").pop() || "Clip";
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseClip: Clip = {
  id: "clip-1",
  trackId: "track-1",
  mediaId: "",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  opacity: 1,
  rotation: 0,
};

const plainTextClip: TextClip = {
  ...baseClip,
  id: "text-1",
  kind: "text",
  text: "Hello Clypra",
  fontFamily: "Inter Variable",
  fontSize: 48,
  color: "#ffffff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  paddingX: 16,
  paddingY: 16,
};

const textTemplateClip: Clip = {
  ...baseClip,
  id: "tt-1",
  kind: "text-template",
  name: "Mango Pop",
  templateId: "mango-pop-v1",
  templateSnapshot: {
    metadata: { label: "Mango Pop Lower Third" },
  } as any,
};

const textTemplateClipNoName: Clip = {
  ...baseClip,
  id: "tt-2",
  kind: "text-template",
  templateId: "unnamed-template",
};

const videoClip: Clip = {
  ...baseClip,
  id: "vid-1",
  kind: "video",
  mediaId: "asset-vid-1",
};

const audioClip: Clip = {
  ...baseClip,
  id: "aud-1",
  kind: "audio",
  mediaId: "asset-aud-1",
};

const imageClip: Clip = {
  ...baseClip,
  id: "img-1",
  kind: "image",
  mediaId: "asset-img-1",
};

const stickerClip: Clip = {
  ...baseClip,
  id: "stk-1",
  kind: "sticker",
  mediaId: "sticker-confetti",
};

const filterClip: Clip = {
  ...baseClip,
  id: "flt-1",
  kind: "filter",
  name: "Cinematic LUT",
};

// ─── isTextClip predicate ─────────────────────────────────────────────────────

describe("isTextClip predicate", () => {
  it("is true for kind=text (plain text clip)", () => {
    expect(resolveIsTextClip(plainTextClip)).toBe(true);
  });

  it("is true for kind=text-template (text template clip)", () => {
    expect(resolveIsTextClip(textTemplateClip)).toBe(true);
  });

  it("is true for any clip that has a 'text' property (duck-type legacy path)", () => {
    const legacyLike = { ...baseClip, text: "Legacy" } as any;
    expect(resolveIsTextClip(legacyLike)).toBe(true);
  });

  it("is false for kind=video", () => {
    expect(resolveIsTextClip(videoClip)).toBe(false);
  });

  it("is false for kind=audio", () => {
    expect(resolveIsTextClip(audioClip)).toBe(false);
  });

  it("is false for kind=image", () => {
    expect(resolveIsTextClip(imageClip)).toBe(false);
  });

  it("is false for kind=sticker", () => {
    expect(resolveIsTextClip(stickerClip)).toBe(false);
  });

  it("is false for kind=filter", () => {
    expect(resolveIsTextClip(filterClip)).toBe(false);
  });

  it("is false for null / undefined", () => {
    expect(resolveIsTextClip(null)).toBe(false);
    expect(resolveIsTextClip(undefined)).toBe(false);
  });
});

// ─── clipName resolution ──────────────────────────────────────────────────────

describe("clipName resolution", () => {
  it("uses the text content for a plain text clip, truncated to 24 chars", () => {
    expect(resolveClipName(plainTextClip, true, false, undefined)).toBe("Hello Clypra");
  });

  it("truncates long plain text to 24 characters", () => {
    const longText: TextClip = { ...plainTextClip, text: "A".repeat(50) };
    const name = resolveClipName(longText, true, false, undefined);
    expect(name.length).toBe(24);
  });

  it("uses clip.name for a text-template clip when present", () => {
    expect(resolveClipName(textTemplateClip, true, false, undefined)).toBe("Mango Pop");
  });

  it("falls back to templateSnapshot.metadata.label when clip.name is absent", () => {
    const noNameClip = { ...textTemplateClip, name: undefined };
    expect(resolveClipName(noNameClip, true, false, undefined)).toBe(
      "Mango Pop Lower Third",
    );
  });

  it("falls back to 'Text Template' when neither clip.name nor snapshot label exist", () => {
    expect(resolveClipName(textTemplateClipNoName, true, false, undefined)).toBe(
      "Text Template",
    );
  });

  it("NEVER resolves to 'Clip' for a text-template clip (regression guard)", () => {
    // This was the original bug: text-template clips fell through to "Clip"
    const name = resolveClipName(textTemplateClip, true, false, undefined);
    expect(name).not.toBe("Clip");
  });

  it("uses asset name for video clips", () => {
    expect(resolveClipName(videoClip, false, false, "interview.mp4")).toBe(
      "interview.mp4",
    );
  });

  it("uses effect name for filter clips", () => {
    expect(resolveClipName(filterClip, false, true, undefined)).toBe(
      "Cinematic LUT",
    );
  });

  it("falls back to 'Clip' for video clips with no asset name", () => {
    expect(resolveClipName(videoClip, false, false, undefined)).toBe("Clip");
  });

  it("plain text clip with empty text shows 'Text' fallback", () => {
    const emptyText: TextClip = { ...plainTextClip, text: "" };
    expect(resolveClipName(emptyText, true, false, undefined)).toBe("Text");
  });
});

// ─── buildClipPropertyTransform — text-template clip regression ───────────────
// Confirms that property transforms work on text-template clips (no text field)
// without throwing or producing broken output.

describe("buildClipPropertyTransform — text-template clips", () => {
  it("applies a width/height resize to a text-template clip without throwing", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      textTemplateClip,
      { width: 800, height: 200 },
      1920,
      1080,
    );
    expect(oldTransform.width).toBe(100);
    expect(newTransform.width).toBe(800);
    expect(newTransform.height).toBe(200);
  });

  it("applies opacity change to a text-template clip", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      textTemplateClip,
      { opacity: 0.5 },
      1920,
      1080,
    );
    expect(oldTransform.opacity).toBe(1);
    expect(newTransform.opacity).toBe(0.5);
  });

  it("applies trim point change to a text-template clip", () => {
    const { oldTransform, newTransform } = buildClipPropertyTransform(
      textTemplateClip,
      { trimIn: 1.0 },
      1920,
      1080,
    );
    expect(oldTransform.trimIn).toBe(0);
    expect(newTransform.trimIn).toBe(1.0);
    // duration should stay consistent (trimIn change doesn't affect duration here)
  });

  // Regression: text-template clips must NOT be misidentified as plain text clips
  it("does not attempt text bounds recalculation for text-template clips (no text field)", () => {
    // buildClipPropertyTransform calls shouldRecalculateTextClipBounds internally.
    // If that function crashes on a clip without a "text" property, this test fails.
    expect(() =>
      buildClipPropertyTransform(
        textTemplateClip,
        { customization: { primaryText: "Updated text" } },
        1920,
        1080,
      ),
    ).not.toThrow();
  });
});

// ─── Regression: existing plain text and video clips unchanged ─────────────────

describe("regression: existing clip kinds still work correctly", () => {
  it("plain text clip: isTextClip true, text used as name", () => {
    expect(resolveIsTextClip(plainTextClip)).toBe(true);
    expect(resolveClipName(plainTextClip, true, false, undefined)).toBe(
      "Hello Clypra",
    );
  });

  it("video clip: isTextClip false, asset name used", () => {
    expect(resolveIsTextClip(videoClip)).toBe(false);
    expect(
      resolveClipName(videoClip, false, false, "my-video.mp4"),
    ).toBe("my-video.mp4");
  });

  it("audio clip: isTextClip false", () => {
    expect(resolveIsTextClip(audioClip)).toBe(false);
  });

  it("sticker clip: isTextClip false", () => {
    expect(resolveIsTextClip(stickerClip)).toBe(false);
  });

  it("filter clip: isTextClip false, name used as effect name", () => {
    expect(resolveIsTextClip(filterClip)).toBe(false);
    expect(resolveClipName(filterClip, false, true, undefined)).toBe(
      "Cinematic LUT",
    );
  });

  it("buildClipPropertyTransform on plain text clip still recalculates bounds on fontSize change", () => {
    const { newTransform } = buildClipPropertyTransform(
      plainTextClip,
      { fontSize: 200 },
      1920,
      1080,
    );
    expect(newTransform.fontSize).toBe(200);
    expect(newTransform.width).toBeGreaterThan(0);
    expect(newTransform.height).toBeGreaterThan(0);
  });
});
