import { describe, expect, it } from "vitest";
import { calculateTextClipSize, createTextClip, hasTextClipContentTransformDrift, measureTextEffectContentBounds, resolveTextClipContentTransform } from "../text/textClip";
import type { TextEffectDefinition } from "@clypra/engine";

const inkGlowEffect = {
  id: "neon-crimson",
  name: "Neon Crimson",
  category: "built-in",
  description: "",
  tags: [],
  boundingBox: {
    mode: "ink",
    paddingX: 92,
    paddingY: 92,
  },
  font: {
    family: "Bebas Neue",
    weight: 400,
    style: "italic",
    letterSpacing: 8,
    lineHeight: 1.2,
  },
  fills: [{ type: "solid", color: "#ffffff" }],
  strokes: [],
  shadows: [],
  glows: [{ color: "#ff004c", blur: 80, opacity: 80, type: "outer" }],
} satisfies TextEffectDefinition;

const panelBannerEffect = {
  id: "boxed-title",
  name: "Boxed Title",
  category: "3d",
  description: "",
  tags: [],
  width: 800,
  height: 200,
  canvasWidth: 800,
  canvasHeight: 200,
  fontSize: 100,
  boundingBox: {
    mode: "panel",
    paddingX: 50,
    paddingY: 25,
  },
  font: {
    family: "Montserrat",
    weight: 900,
    style: "normal",
    letterSpacing: 8,
    lineHeight: 1.1,
  },
  fills: [{ type: "solid", color: "#ffffff" }],
  strokes: [],
  shadows: [],
  panel: {
    color: "#111111",
    opacity: 100,
    radius: 0,
    paddingX: 48,
    paddingY: 22,
    stroke: { color: "#ffffff", width: 2 },
  },
} satisfies TextEffectDefinition & { width: number; height: number; canvasWidth: number; canvasHeight: number; fontSize: number };

describe("calculateTextClipSize", () => {
  it("uses text effect typography when creating a style clip without explicit overrides", () => {
    const clip = createTextClip({
      trackId: "track-1",
      startTime: 0,
      duration: 3,
      text: "NEON",
      canvasWidth: 1920,
      canvasHeight: 1080,
      styleId: inkGlowEffect.id,
      effectDefinition: inkGlowEffect,
    });

    expect(clip.fontFamily).toBe("Bebas Neue");
    expect(clip.fontWeight).toBe(400);
    expect(clip.fontStyle).toBe("italic");
    expect(clip.lineHeight).toBe(1.2);
    expect(clip.letterSpacing).toBe(8);
    expect(clip.styleDefinition).toBe(inkGlowEffect);
  });

  it("does not put ink-effect render bleed into the editable text box height", () => {
    const sized = calculateTextClipSize({
      text: "CLYPRA",
      fontFamily: "Bebas Neue",
      fontSize: 100,
      styleId: "neon-crimson",
      effectDefinition: inkGlowEffect,
      canvasWidth: 1080,
    });

    expect(sized.bleed.y).toBe(92);
    expect(sized.bounds.source).toBe("ink");
    expect(sized.height).toBeLessThan(120);
    expect(sized.height).toBeLessThan(220);
  });

  it("keeps glow bleed as render padding instead of editable content bounds", () => {
    const bounds = measureTextEffectContentBounds({
      text: "NEON",
      fontFamily: "Bebas Neue",
      fontSize: 100,
      styleId: "neon-crimson",
      effectDefinition: inkGlowEffect,
      canvasWidth: 1080,
    });

    expect(bounds.source).toBe("ink");
    expect(bounds.bleedLeft).toBe(92);
    expect(bounds.bleedRight).toBe(92);
    expect(bounds.bleedTop).toBe(92);
    expect(bounds.bleedBottom).toBe(92);
    expect(bounds.contentHeight).toBeLessThan(bounds.bleedTop + bounds.bleedBottom);
  });

  it("reserves additional height when massive text wraps inside the canvas width cap", () => {
    const singleLine = calculateTextClipSize({
      text: "A",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 520,
      styleId: "neon-outline",
      effectDefinition: inkGlowEffect,
      canvasWidth: 640,
    });

    const wrapped = calculateTextClipSize({
      text: "CLYPRA",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 520,
      styleId: "neon-outline",
      effectDefinition: inkGlowEffect,
      canvasWidth: 640,
    });

    expect(wrapped.width).toBeLessThanOrEqual(640 * 0.95);
    expect(wrapped.height).toBeGreaterThan(singleLine.height * 1.5);
  });

  it("sizes panel effect bounds to visible text content instead of Studio preview canvas", () => {
    const clip = createTextClip({
      trackId: "track-1",
      startTime: 0,
      duration: 3,
      text: "MY TEXT",
      canvasWidth: 1080,
      canvasHeight: 1920,
      styleId: panelBannerEffect.id,
      effectDefinition: panelBannerEffect,
    });

    expect(clip.fontSize).toBe(100);
    expect(clip.width).toBeGreaterThan(120);
    expect(clip.width).toBeLessThan(800);
    expect(clip.height).toBeLessThan(200);
    expect(clip.height).toBeGreaterThan(120);
  });

  it("panel padding and stroke affect content bounds without using Studio canvas size", () => {
    const compactPanel = {
      ...panelBannerEffect,
      boundingBox: { mode: "panel" as const, paddingX: 0, paddingY: 0 },
      panel: {
        ...panelBannerEffect.panel,
        paddingX: 8,
        paddingY: 4,
        stroke: { color: "#ffffff", width: 1 },
      },
    };

    const padded = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: panelBannerEffect.font.family,
      fontSize: 100,
      styleId: panelBannerEffect.id,
      effectDefinition: panelBannerEffect,
      canvasWidth: 1080,
    });
    const compact = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: compactPanel.font.family,
      fontSize: 100,
      styleId: compactPanel.id,
      effectDefinition: compactPanel,
      canvasWidth: 1080,
    });

    expect(padded.source).toBe("panel");
    expect(compact.source).toBe("panel");
    expect(padded.contentWidth).toBeGreaterThan(compact.contentWidth);
    expect(padded.contentHeight).toBeGreaterThan(compact.contentHeight);
    expect(padded.contentWidth).toBeLessThan(800);
  });

  it("uses the larger applied background padding when panel metadata is smaller", () => {
    const zeroPanel = {
      ...panelBannerEffect,
      panel: {
        ...panelBannerEffect.panel,
        paddingX: 0,
        paddingY: 0,
        stroke: { color: "#ffffff", width: 0 },
      },
    };

    const definitionOnly = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: zeroPanel.font.family,
      fontSize: 100,
      styleId: zeroPanel.id,
      effectDefinition: zeroPanel,
      canvasWidth: 1080,
    });
    const withAppliedPlate = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: zeroPanel.font.family,
      fontSize: 100,
      styleId: zeroPanel.id,
      effectDefinition: zeroPanel,
      background: { color: "#111111", padding: 18, borderRadius: 0 },
      canvasWidth: 1080,
    });

    expect(withAppliedPlate.source).toBe("panel");
    expect(withAppliedPlate.contentWidth - definitionOnly.contentWidth).toBeCloseTo(36);
    expect(withAppliedPlate.contentHeight - definitionOnly.contentHeight).toBeCloseTo(36);
    expect(withAppliedPlate.selectionInset).toBeGreaterThan(0);
  });

  it("adds a small panel selection inset so the visible plate sits inside handles", () => {
    const panel = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Permanent Marker",
      fontSize: 175,
      fontWeight: 700,
      background: { color: "#161618", padding: 20, borderRadius: 0 },
      canvasWidth: 1080,
    });
    const plain = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Permanent Marker",
      fontSize: 175,
      fontWeight: 700,
      canvasWidth: 1080,
    });

    expect(panel.source).toBe("panel");
    expect(panel.selectionInset).toBeGreaterThanOrEqual(4);
    expect(panel.selectionInset).toBeLessThanOrEqual(12);
    expect(plain.selectionInset).toBe(0);
  });

  it("scales definition panel padding like the engine build config", () => {
    const normal = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: panelBannerEffect.font.family,
      fontSize: 100,
      styleId: panelBannerEffect.id,
      effectDefinition: panelBannerEffect,
      canvasWidth: 1080,
    });
    const scaled = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: panelBannerEffect.font.family,
      fontSize: 150,
      styleId: panelBannerEffect.id,
      effectDefinition: panelBannerEffect,
      canvasWidth: 1080,
    });

    expect(scaled.contentWidth).toBeGreaterThan(normal.contentWidth);
    expect(scaled.contentHeight).toBeGreaterThan(normal.contentHeight);
  });

  it("includes custom background plate padding after effect style is cleared", () => {
    const withoutPlate = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Georgia",
      fontSize: 100,
      canvasWidth: 1080,
    });
    const withPlate = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Georgia",
      fontSize: 100,
      background: { color: "#111111", padding: 48, borderRadius: 0 },
      canvasWidth: 1080,
    });

    expect(withPlate.source).toBe("panel");
    expect(withPlate.contentWidth - withoutPlate.contentWidth).toBeGreaterThan(10);
    expect(withPlate.contentHeight - withoutPlate.contentHeight).toBeGreaterThan(40);
  });

  it("resolves stale selected text effect bounds through the same content box path", () => {
    const staleClip = createTextClip({
      trackId: "track-1",
      startTime: 0,
      text: "MY TEXT",
      fontFamily: "Georgia",
      fontSize: 100,
      canvasWidth: 1080,
      canvasHeight: 1920,
      background: { color: "#111111", padding: 48, borderRadius: 0 },
    });
    const oversized = {
      ...staleClip,
      x: staleClip.x - 120,
      y: staleClip.y - 60,
      width: staleClip.width + 240,
      height: staleClip.height + 120,
    };

    expect(hasTextClipContentTransformDrift(oversized, 1080, 1920)).toBe(true);

    const resolved = resolveTextClipContentTransform(oversized, 1080, 1920, "selection-normalize");
    const oldCenterX = oversized.x + oversized.width / 2;
    const oldCenterY = oversized.y + oversized.height / 2;

    expect(resolved.width).toBeCloseTo(staleClip.width, 4);
    expect(resolved.height).toBeCloseTo(staleClip.height, 4);
    expect(resolved.x + resolved.width / 2).toBeCloseTo(oldCenterX, 4);
    expect(resolved.y + resolved.height / 2).toBeCloseTo(oldCenterY, 4);
  });

  it("letter spacing changes content width deterministically", () => {
    const normal = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Montserrat",
      fontSize: 100,
      letterSpacing: 0,
      canvasWidth: 1080,
    });
    const spaced = measureTextEffectContentBounds({
      text: "MY TEXT",
      fontFamily: "Montserrat",
      fontSize: 100,
      letterSpacing: 20,
      canvasWidth: 1080,
    });

    expect(spaced.contentWidth - normal.contentWidth).toBeCloseTo(120);
  });
});
