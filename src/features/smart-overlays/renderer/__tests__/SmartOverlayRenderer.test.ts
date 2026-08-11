import { describe, expect, it, vi } from "vitest";
import { SmartOverlayRenderer } from "../SmartOverlayRenderer";
import type { SmartOverlayClip } from "@/types/smartOverlay";

describe("SmartOverlayRenderer", () => {
  const createMockClip = (overlayType: SmartOverlayClip["overlayType"], contentData: any): SmartOverlayClip => ({
    id: `clip-${overlayType}`,
    kind: "smart-overlay",
    overlayType,
    trackId: "track-1",
    mediaId: "",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    content: { type: overlayType as any, data: contentData },
    style: {
      presetId: "test",
      layout: "center-card",
      fontFamily: "Inter Variable",
      fontSize: 32,
      textColor: "#FFFFFF",
      highlightColor: "#10B981",
      cardBackgroundColor: "rgba(10, 15, 26, 0.9)",
      cardOpacity: 0.9,
      animationStyle: "scale-pop",
    },
  });

  const mockCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 100 }),
    arc: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;

  it("renders Stat overlay card without throwing", () => {
    const renderer = new SmartOverlayRenderer(createMockClip("stat", { value: "+142%", label: "User Growth" }));
    expect(() => renderer.draw(mockCtx, 1.0, 1920, 1080)).not.toThrow();
  });

  it("renders Quote overlay card without throwing", () => {
    const renderer = new SmartOverlayRenderer(createMockClip("quote", { quote: "Sample Quote", author: "Author" }));
    expect(() => renderer.draw(mockCtx, 1.0, 1920, 1080)).not.toThrow();
  });

  it("renders Comparison overlay card without throwing", () => {
    const renderer = new SmartOverlayRenderer(
      createMockClip("comparison", {
        title: "VS",
        left: { title: "React", points: [] },
        right: { title: "Vue", points: [] },
      })
    );
    expect(() => renderer.draw(mockCtx, 1.0, 1920, 1080)).not.toThrow();
  });

  it("renders Code overlay card without throwing", () => {
    const renderer = new SmartOverlayRenderer(createMockClip("code", { language: "typescript", code: "const x = 1;" }));
    expect(() => renderer.draw(mockCtx, 1.0, 1920, 1080)).not.toThrow();
  });
});
