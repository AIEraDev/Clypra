import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EffectCard } from "../EffectCard";
import { renderTextEffect } from "@/features/text-effects/renderer";
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

    const starBtn = screen.getByRole("button", { name: "收藏 Classic 3D" });
    fireEvent.click(starBtn);

    expect(defaultProps.onFavorite).toHaveBeenCalledTimes(1);
  });

  it("labels an active favorite without changing the remote effect name", () => {
    render(<EffectCard {...defaultProps} isFavorite={true} />);

    expect(screen.getByRole("button", { name: "取消收藏 Classic 3D" })).toBeInTheDocument();
    expect(screen.getByText("Classic 3D")).toBeInTheDocument();
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

    expect(screen.getByText("正在下载…")).toBeInTheDocument();
  });

  it("shows an add-to-timeline button when isDownloaded is true", () => {
    render(<EffectCard {...defaultProps} isDownloaded={true} />);

    const applyButton = screen.getByRole("button", { name: "添加文字效果到时间线" });
    expect(applyButton).toHaveAttribute("title", "添加文字到时间线");
    expect(applyButton.className).toContain("bg-accent");
    fireEvent.click(applyButton);
    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });

  it("localizes the download button title and accessible label", () => {
    render(<EffectCard {...defaultProps} />);

    expect(screen.getByRole("button", { name: "下载并添加文字效果到时间线" })).toHaveAttribute(
      "title",
      "下载并添加文字到时间线",
    );
  });

  it("keeps the CLYPRA fallback preview text unchanged", () => {
    render(
      <EffectCard
        {...defaultProps}
        effect={{ ...mockEffect, text: "", thumbnail: "", thumbnailUrl: "" }}
      />,
    );

    expect(renderTextEffect).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), "CLYPRA", expect.any(Object), 34);
  });
});
