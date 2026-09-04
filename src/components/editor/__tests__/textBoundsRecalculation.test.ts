import { describe, expect, it } from "vitest";
import {
  createTextClip,
  resolveTextClipStyleUpdate,
  hasTextClipContentTransformDrift,
  resolveTextClipContentTransform,
} from "@/lib/text/textClip";
import { resolveCanonicalFamily } from "@/core/fonts/fontRegistry";
import { buildClipPropertyTransform } from "../PropertiesPanel";
import type { TextClip } from "@/types";

describe("Text Bounds Recalculation & Font Stack Resolution", () => {
  describe("resolveCanonicalFamily CSS Font Stacks", () => {
    it("resolves default fallback font stack 'Inter, system-ui, sans-serif' to 'Inter Variable'", () => {
      expect(resolveCanonicalFamily("Inter, system-ui, sans-serif")).toBe("Inter Variable");
    });

    it("resolves quoted variable font stack \"'Inter Variable', sans-serif\" to 'Inter Variable'", () => {
      expect(resolveCanonicalFamily("'Inter Variable', sans-serif")).toBe("Inter Variable");
    });

    it("resolves Roboto fallback stack to 'Roboto Variable'", () => {
      expect(resolveCanonicalFamily("Roboto, Arial, sans-serif")).toBe("Roboto Variable");
    });

    it("resolves Roboto Condensed stack to 'Roboto Condensed Variable'", () => {
      expect(resolveCanonicalFamily("'Roboto Condensed', sans-serif")).toBe("Roboto Condensed Variable");
    });

    it("preserves system fonts with generic fallbacks", () => {
      expect(resolveCanonicalFamily("Times New Roman, serif")).toBe("Times New Roman");
      expect(resolveCanonicalFamily("Arial, sans-serif")).toBe("Arial");
    });
  });

  describe("resolveTextClipStyleUpdate on Font Size & Content Change", () => {
    it("recalculates bounds when font size increases to 400px while keeping center stationary", () => {
      const clip = createTextClip({
        trackId: "track-1",
        startTime: 0,
        text: "Abdulkabir",
        fontSize: 48,
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      const initialCenterX = clip.x + clip.width / 2;
      const initialCenterY = clip.y + clip.height / 2;

      const updated = resolveTextClipStyleUpdate(
        clip,
        { fontSize: 400 },
        1920,
        1080,
      ) as Partial<TextClip>;

      expect(updated.fontSize).toBe(400);
      expect(updated.width).toBeDefined();
      expect(updated.height).toBeDefined();

      // At 400px, width and height must be much larger than at 48px
      expect(updated.width!).toBeGreaterThan(clip.width * 3);
      expect(updated.height!).toBeGreaterThan(clip.height * 3);

      // Center must remain stationary
      const newCenterX = updated.x! + updated.width! / 2;
      const newCenterY = updated.y! + updated.height! / 2;
      expect(newCenterX).toBeCloseTo(initialCenterX, 1);
      expect(newCenterY).toBeCloseTo(initialCenterY, 1);

      // Aspect ratio must match new width / height
      expect(updated.sourceAspectRatio).toBeCloseTo(
        updated.width! / updated.height!,
        2,
      );
    });

    it("recalculates bounds when text content expands from short to long", () => {
      const shortClip = createTextClip({
        trackId: "track-1",
        startTime: 0,
        text: "Hi",
        fontSize: 100,
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      const updated = resolveTextClipStyleUpdate(
        shortClip,
        { text: "Abdulkabir with a much longer headline" },
        1920,
        1080,
      ) as Partial<TextClip>;

      expect(updated.width!).toBeGreaterThan(shortClip.width * 3);
    });

    it("skips bounds recalculation when _skipTextBoundsRecalculation is set during live preview drag", () => {
      const clip = createTextClip({
        trackId: "track-1",
        startTime: 0,
        text: "Abdulkabir",
        fontSize: 48,
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      const updated = resolveTextClipStyleUpdate(
        clip,
        {
          fontSize: 400,
          _skipTextBoundsRecalculation: true,
        } as any,
        1920,
        1080,
      ) as Partial<TextClip>;

      // Bounds keys should NOT be present in preview-only draft update
      expect(updated.fontSize).toBe(400);
      expect(updated.width).toBeUndefined();
      expect(updated.height).toBeUndefined();
    });
  });

  describe("buildClipPropertyTransform on Text Properties Commit", () => {
    it("computes complete old and new transforms including recalculated bounds for fontSize", () => {
      const clip = createTextClip({
        trackId: "track-1",
        startTime: 0,
        text: "Abdulkabir",
        fontSize: 48,
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      const { oldTransform, newTransform } = buildClipPropertyTransform(
        clip,
        { fontSize: 400 },
        1920,
        1080,
      );

      expect(oldTransform.fontSize).toBe(48);
      expect(newTransform.fontSize).toBe(400);

      expect(oldTransform.width).toBe(clip.width);
      expect(oldTransform.height).toBe(clip.height);
      expect(oldTransform.x).toBe(clip.x);
      expect(oldTransform.y).toBe(clip.y);

      expect(newTransform.width).toBeGreaterThan(clip.width * 3);
      expect(newTransform.height).toBeGreaterThan(clip.height * 3);
      expect(newTransform.x).toBeDefined();
      expect(newTransform.y).toBeDefined();
      expect(newTransform.sourceAspectRatio).toBeDefined();
    });
  });

  describe("Plain Text Drift Normalization", () => {
    it("detects drift when plain text clip has mismatch between fontSize and bounds", () => {
      const clip = createTextClip({
        trackId: "track-1",
        startTime: 0,
        text: "Abdulkabir",
        fontSize: 48,
        canvasWidth: 1920,
        canvasHeight: 1080,
      });

      // Simulate a clip where fontSize was updated to 400 without updating bounds
      const staleClip: TextClip = {
        ...clip,
        fontSize: 400,
      };

      expect(hasTextClipContentTransformDrift(staleClip, 1920, 1080)).toBe(true);

      const normalized = resolveTextClipContentTransform(
        staleClip,
        1920,
        1080,
        "selection-normalize",
      );

      expect(normalized.width).toBeGreaterThan(clip.width * 3);
      expect(normalized.height).toBeGreaterThan(clip.height * 3);

      const reconciledClip: TextClip = {
        ...staleClip,
        ...normalized,
      };

      expect(hasTextClipContentTransformDrift(reconciledClip, 1920, 1080)).toBe(false);
    });
  });
});
