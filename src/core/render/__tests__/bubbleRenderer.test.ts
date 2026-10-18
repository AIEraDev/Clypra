import { describe, expect, it, vi } from "vitest";
import {
  drawTornPaper,
  drawSpeechBubble,
  drawThoughtCloud,
  drawComicBurst,
  drawRibbonBanner,
  renderBubbleBackground,
} from "../bubbleRenderer";
import { resolveBubbleLayout, type TextBubbleLayout } from "@/types/textBubbles";

function createMockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue({
      addColorStop: vi.fn(),
    }),
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe("bubbleRenderer — Procedural Canvas2D Drawing", () => {
  it("renders torn paper background with irregular edges and shadow", () => {
    const ctx = createMockContext();
    drawTornPaper(ctx, 10, 20, 200, 80, "#faf9f6", true);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("renders speech bubble balloon with tail", () => {
    const ctx = createMockContext();
    drawSpeechBubble(ctx, 0, 0, 150, 70, "#ffffff", "#000000", 2, 12);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.roundRect).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("renders thought cloud bubble with multiple lobes", () => {
    const ctx = createMockContext();
    drawThoughtCloud(ctx, 0, 0, 160, 90, "#ffffff", "#000000", 2);

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("renders comic starburst explosion", () => {
    const ctx = createMockContext();
    drawComicBurst(ctx, 0, 0, 140, 100, "#ffff00", "#000000", 3);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("renders folded ribbon banner with notched ends", () => {
    const ctx = createMockContext();
    drawRibbonBanner(ctx, 0, 0, 180, 50, "#facc15", "#000000", 2);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("dispatches renderBubbleBackground to torn paper for bubble-paper-torn", () => {
    const ctx = createMockContext();
    const result = renderBubbleBackground(
      ctx,
      "bubble-paper-torn",
      10,
      10,
      300,
      100,
      { color: "#ffffff" },
    );

    expect(result).toBe(true);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("returns false for none or empty preset", () => {
    const ctx = createMockContext();
    expect(renderBubbleBackground(ctx, "none", 0, 0, 100, 50)).toBe(false);
    expect(renderBubbleBackground(ctx, "", 0, 0, 100, 50)).toBe(false);
  });
});

describe("resolveBubbleLayout — Layout Math & Auto-fit", () => {
  const sampleLayout: TextBubbleLayout = {
    contentBounds: { x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
    minWidth: 120,
    minHeight: 50,
    preserveAspectRatio: false,
    padding: { top: 12, right: 16, bottom: 12, left: 16 },
    sizingMode: "auto-fit",
  };

  it("computes outer bounds from measured text plus padding", () => {
    const textW = 200;
    const textH = 40;
    const resolved = resolveBubbleLayout(textW, textH, sampleLayout);

    expect(resolved.outerWidth).toBe(200 + 16 + 16); // 232
    expect(resolved.outerHeight).toBe(40 + 12 + 12); // 64
    expect(resolved.contentWidth).toBe(200);
    expect(resolved.contentHeight).toBe(40);
  });

  it("enforces minWidth and minHeight constraints", () => {
    const textW = 20;
    const textH = 10;
    const resolved = resolveBubbleLayout(textW, textH, sampleLayout);

    expect(resolved.outerWidth).toBe(120);
    expect(resolved.outerHeight).toBe(50);
  });

  it("preserves aspect ratio when requested", () => {
    const ratioLayout: TextBubbleLayout = {
      ...sampleLayout,
      minWidth: 100,
      minHeight: 50, // 2:1 aspect ratio
      preserveAspectRatio: true,
    };

    const textW = 300;
    const textH = 50; // would be W=332, H=74 without ratio
    const resolved = resolveBubbleLayout(textW, textH, ratioLayout);

    // 2:1 ratio preserved: outerHeight adjusted to outerWidth / 2 = 166
    expect(resolved.outerWidth).toBe(332);
    expect(resolved.outerHeight).toBe(166);
  });
});
