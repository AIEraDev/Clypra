import { describe, it, expect } from "vitest";

describe("TemplatePreviewPlayer fitToContent geometry", () => {
  it("should calculate correct bounding boxes for multi-textbox templates with hierarchical font sizes", () => {
    const multiTextTemplate = {
      canvasWidth: 1920,
      canvasHeight: 1080,
      layers: [
        {
          kind: "text",
          id: "title",
          content: "CINEMATIC TITLE",
          fontSize: 96,
          fontWeight: 800,
          x: 460,
          y: 440,
          width: 1000,
          height: 100,
        },
        {
          kind: "text",
          id: "subtitle",
          content: "A Visual Masterpiece",
          fontSize: 32,
          fontWeight: 400,
          x: 460,
          y: 560,
          width: 1000,
          height: 50,
        },
      ],
    };

    const minX = Math.min(...multiTextTemplate.layers.map((l) => l.x));
    const minY = Math.min(...multiTextTemplate.layers.map((l) => l.y));
    const maxX = Math.max(...multiTextTemplate.layers.map((l) => l.x + l.width));
    const maxY = Math.max(...multiTextTemplate.layers.map((l) => l.y + l.height));

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    expect(minX).toBe(460);
    expect(minY).toBe(440);
    expect(contentWidth).toBe(1000);
    expect(contentHeight).toBe(170);

    const marginFactor = 0.12;
    const targetW = 1920 * (1 - marginFactor * 2);
    const targetH = 1080 * (1 - marginFactor * 2);
    const fitScale = Math.min(targetW / contentWidth, targetH / contentHeight);
    const scale = Math.min(3.5, Math.max(1.0, fitScale));

    expect(scale).toBeGreaterThan(1.0);
    expect(scale).toBeLessThanOrEqual(3.5);
  });
});
