import { describe, expect, it } from "vitest";
import {
  measureTemplateContentBounds,
  calculateOptimalTemplateLayout,
} from "../templateScale";
import type { TextTemplateArtifact } from "@clypra-studio/engine";

describe("templateScale - measureTemplateContentBounds", () => {
  it("measures content bounds with explicit node dimensions and padding", () => {
    const artifact = {
      schemaVersion: "1.0.0",
      id: "pill-badge",
      name: "Pill Badge",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "badge-text",
            type: "text",
            x: 800,
            y: 500,
            width: 320,
            height: 80,
            style: { fontSize: 40 },
            backgroundPanel: {
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 10,
              paddingBottom: 10,
            },
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const bounds = measureTemplateContentBounds(artifact);
    // x: 800 - 20 = 780, y: 500 - 10 = 490
    // w: 320 + 40 = 360, h: 80 + 20 = 100
    expect(bounds.minX).toBe(780);
    expect(bounds.minY).toBe(490);
    expect(bounds.maxX).toBe(1140);
    expect(bounds.maxY).toBe(590);
    expect(bounds.width).toBe(360);
    expect(bounds.height).toBe(100);
    expect(bounds.centerX).toBe(960);
    expect(bounds.centerY).toBe(540);
    expect(bounds.maxFontSize).toBe(40);
  });

  it("applies control value overrides when estimating text dimensions", () => {
    const artifact = {
      schemaVersion: "1.0.0",
      id: "typewriter",
      name: "Typewriter",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "title-node",
            type: "text",
            x: 200,
            y: 800,
            text: "Short",
            style: { fontSize: 36, lineHeight: 1.2 },
          },
        ],
      },
      controls: [
        {
          id: "custom_title",
          name: "Title",
          type: "text",
          target: { nodeId: "title-node", propertyPath: "text" },
          defaultValue: "Short",
        },
      ],
    } as any as TextTemplateArtifact;

    const defaultBounds = measureTemplateContentBounds(artifact);
    const overriddenBounds = measureTemplateContentBounds(artifact, {
      custom_title: "A very long headline that spans across multiple characters",
    });

    expect(overriddenBounds.width).toBeGreaterThan(defaultBounds.width);
  });

  it("handles missing or empty node arrays gracefully with sensible defaults", () => {
    const emptyArtifact = {
      schemaVersion: "1.0.0",
      id: "empty",
      name: "Empty",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [],
      },
    } as any as TextTemplateArtifact;

    const bounds = measureTemplateContentBounds(emptyArtifact);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.centerX).toBe(960);
    expect(bounds.centerY).toBe(540);
  });
});

describe("templateScale - calculateOptimalTemplateLayout", () => {
  it("scales small templates prominently on 9:16 portrait video (1080x1920)", () => {
    // A small pill badge authored at 1920x1080 with 300px width and 32px font
    const smallPillBadge = {
      schemaVersion: "1.0.0",
      id: "minimal-pill",
      name: "Minimal Pill",
      metadata: { category: "callout" },
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "pill",
            type: "text",
            x: 810,
            y: 515,
            width: 300,
            height: 50,
            style: { fontSize: 32 },
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const layout = calculateOptimalTemplateLayout(
      smallPillBadge,
      1080,
      1920,
    );

    // Old behavior would have used uniform fit: 1080/1920 = 0.5625 scale!
    // Resulting in width = 168px (only 15% width!) and font = 18px!
    // New behavior:
    // 1. Scale targets ~62% width on portrait:
    expect(layout.scale).toBeGreaterThan(1.5);
    expect(layout.contentBounds.width).toBeGreaterThanOrEqual(1080 * 0.55);
    expect(layout.contentBounds.width).toBeLessThanOrEqual(1080 * 0.88);

    // 2. Centered horizontally:
    const leftMargin = layout.contentBounds.x;
    const rightMargin = 1080 - (layout.contentBounds.x + layout.contentBounds.width);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(2);

    // 3. Guaranteed legibility: effective font size is >= 64px on 1080p
    const effectiveFontSize = 32 * layout.scale;
    expect(effectiveFontSize).toBeGreaterThanOrEqual(64);
  });

  it("scales templates comfortably on 16:9 landscape canvas (1920x1080)", () => {
    const smallPillBadge = {
      schemaVersion: "1.0.0",
      id: "minimal-pill",
      name: "Minimal Pill",
      metadata: { category: "callout" },
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "pill",
            type: "text",
            x: 810,
            y: 515,
            width: 300,
            height: 50,
            style: { fontSize: 32 },
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const layout = calculateOptimalTemplateLayout(
      smallPillBadge,
      1920,
      1080,
    );

    // In widescreen landscape, target coverage is ~42% width:
    expect(layout.contentBounds.width).toBeGreaterThanOrEqual(1920 * 0.35);
    expect(layout.contentBounds.width).toBeLessThanOrEqual(1920 * 0.70);

    // Centered horizontally:
    const leftMargin = layout.contentBounds.x;
    const rightMargin = 1920 - (layout.contentBounds.x + layout.contentBounds.width);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(2);
  });

  it("preserves lower-third positioning instead of centering vertically", () => {
    const lowerThirdArtifact = {
      schemaVersion: "1.0.0",
      id: "lower-third-1",
      name: "Lower Third News",
      metadata: { category: "lower-third" },
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "name",
            type: "text",
            x: 100,
            y: 850,
            width: 500,
            height: 100,
            style: { fontSize: 44 },
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const layout = calculateOptimalTemplateLayout(
      lowerThirdArtifact,
      1080,
      1920,
    );

    // Lower third should be placed in the lower portion of the screen (bottom half)
    expect(layout.contentBounds.y).toBeGreaterThan(1920 * 0.5);
  });

  it("enforces safe area margins so templates never clip outside viewport", () => {
    // An authored template placed near the bottom-right corner of 1920x1080
    const edgeArtifact = {
      schemaVersion: "1.0.0",
      id: "edge-badge",
      name: "Edge Badge",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "badge",
            type: "shape",
            x: 1800,
            y: 1000,
            width: 200,
            height: 100,
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const layout = calculateOptimalTemplateLayout(edgeArtifact, 1080, 1920);

    // Safe area margin is 5% (54px X, 96px Y)
    expect(layout.contentBounds.x).toBeGreaterThanOrEqual(1080 * 0.04);
    expect(layout.contentBounds.x + layout.contentBounds.width).toBeLessThanOrEqual(1080 * 0.96);
    expect(layout.contentBounds.y).toBeGreaterThanOrEqual(1920 * 0.04);
    expect(layout.contentBounds.y + layout.contentBounds.height).toBeLessThanOrEqual(1920 * 0.96);
  });

  it("caps oversized template content within safe scale limits (<= 88% width)", () => {
    // A huge template taking almost the entire artboard
    const hugeArtifact = {
      schemaVersion: "1.0.0",
      id: "huge-banner",
      name: "Huge Banner",
      document: {
        canvas: { width: 1920, height: 1080 },
        nodes: [
          {
            id: "banner",
            type: "shape",
            x: 100,
            y: 100,
            width: 1720,
            height: 880,
          },
        ],
      },
    } as any as TextTemplateArtifact;

    const layout = calculateOptimalTemplateLayout(hugeArtifact, 1080, 1920);
    expect(layout.contentBounds.width).toBeLessThanOrEqual(1080 * 0.88 + 1);
    expect(layout.contentBounds.height).toBeLessThanOrEqual(1920 * 0.78 + 1);
  });
});
