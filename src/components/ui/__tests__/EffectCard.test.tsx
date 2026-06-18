import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EffectCard } from "../EffectCard";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";

// Mock the canvas renderTextEffect function
vi.mock("@/features/text-effects/renderer", () => ({
  renderTextEffect: vi.fn(),
}));

describe("EffectCard Component", () => {
  const mockEffect: TextEffectDefinition = {
    id: "effect-1",
    category: "3d",
    name: "Classic 3D",
    text: "CLYPRA",
    thumbnail: "http://example.com/thumbnail.png",
    thumbnailUrl: "",
    description: "A classic 3D text effect",
    tags: ["3d", "classic"],
    font: {
      family: "Inter",
      weight: 700,
      style: "normal",
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    fills: [],
    strokes: [],
    shadows: [],
  };

  const defaultProps = {
    effect: mockEffect,
    isFavorite: false,
    isDownloading: false,
    isDownloaded: false,
    onFavorite: vi.fn(),
    onApply: vi.fn(),
    onPreview: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders static thumbnail image when thumbnailUrl or thumbnail is provided", () => {
    render(<EffectCard {...defaultProps} />);
    
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("http://example.com/thumbnail.png");
    expect(img.alt).toBe("Classic 3D");
  });

  it("renders fallback canvas when no thumbnail or thumbnailUrl is provided", () => {
    const propsWithoutThumbnail = {
      ...defaultProps,
      effect: {
        ...mockEffect,
        thumbnail: "",
        thumbnailUrl: "",
      },
    };

    const { container } = render(<EffectCard {...propsWithoutThumbnail} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("calls onPreview when the card is clicked", () => {
    render(<EffectCard {...defaultProps} />);
    
    const card = screen.getByText("Classic 3D").closest("div");
    expect(card).toBeDefined();
    if (card) fireEvent.click(card);
    
    expect(defaultProps.onPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onFavorite when the favorite star button is clicked", () => {
    render(<EffectCard {...defaultProps} />);
    
    const buttons = screen.getAllByRole("button");
    const starBtn = buttons[0];
    fireEvent.click(starBtn);
    
    expect(defaultProps.onFavorite).toHaveBeenCalledTimes(1);
  });

  it("calls onApply when the download button is clicked", () => {
    render(<EffectCard {...defaultProps} />);
    
    // Click the second button, which is the download/apply button
    const buttons = screen.getAllByRole("button");
    const downloadBtn = buttons[1];
    fireEvent.click(downloadBtn);
    
    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });

  it("displays downloading overlay when isDownloading is true", () => {
    render(<EffectCard {...defaultProps} isDownloading={true} />);
    
    expect(screen.getByText("Downloading...")).toBeInTheDocument();
  });

  it("shows an add-to-timeline button when isDownloaded is true", () => {
    render(<EffectCard {...defaultProps} isDownloaded={true} />);
    
    const applyButton = screen.getByRole("button", { name: "Add text effect to timeline" });
    expect(applyButton.className).toContain("bg-accent");
    fireEvent.click(applyButton);
    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });
});
