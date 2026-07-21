import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplateCard } from "../TemplateCard";
import { TextEffectsApi } from "@/features/text-effects/api/textEffectsApi";
import type { TemplateDefinition } from "@/features/text-templates/types";

declare const require: any;

// Mock the TemplatePreviewPlayer component
vi.mock("@/features/text-templates", () => {
  const React = require("react");
  const MockPlayer = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      goToFrame: vi.fn(),
      getAnimation: vi.fn(() => ({
        totalFrames: 100,
        frameRate: 30,
        isLoaded: true,
      })),
    }));
    return React.createElement("div", { "data-testid": "mock-lottie-player" });
  });
  MockPlayer.displayName = "MockTemplatePreviewPlayer";
  return {
    TemplatePreviewPlayer: MockPlayer,
  };
});

// Mock TextEffectsApi
vi.mock("@/features/text-effects/api/textEffectsApi", () => ({
  TextEffectsApi: {
    getTemplateData: vi.fn(),
  },
}));

describe("TemplateCard Component", () => {
  const mockTemplate: TemplateDefinition = {
    id: "template-1",
    category: "lower-third",
    name: "Minimal Lower Third",
    label: "Minimal Lower Third",
    thumbnail: "", // API returns empty string
    preview: "",
    thumbnailUrl: "http://example.com/template-thumbnail.png", // fallback
    durationFrames: 60,
    thumbnailFrame: 10,
    lottieData: null,
    description: "Mock template description",
    tags: ["mock", "test"],
    fps: 30,
    width: 1920,
    height: 1080,
    canvasWidth: 1920,
    canvasHeight: 1080,
    duration: 2,
    textLayers: [],
    layers: [],
    defaultPlacement: "lower-third",
    lottieFile: "mock.json",
  };

  const defaultProps = {
    template: mockTemplate,
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

  it("gracefully falls back to thumbnailUrl when thumbnail is empty", () => {
    render(<TemplateCard {...defaultProps} />);

    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("http://example.com/template-thumbnail.png");
    expect(img.alt).toBe("Minimal Lower Third");
  });

  it("renders the preview player on hover without fetching Lottie JSON data", async () => {
    render(<TemplateCard {...defaultProps} />);

    const card = screen.getByRole("img").closest("div");
    expect(card).toBeDefined();
    if (card) {
      fireEvent.mouseEnter(card);
    }

    // Does NOT display "Loading..."
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

    // Renders player immediately
    expect(screen.getByTestId("mock-lottie-player")).toBeInTheDocument();
    expect(TextEffectsApi.getTemplateData).not.toHaveBeenCalled();
  });

  it("calls onPreview when clicked", () => {
    render(<TemplateCard {...defaultProps} />);

    const card = screen.getByRole("img").closest("div");
    if (card) fireEvent.click(card);

    expect(defaultProps.onPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onFavorite when favorite star is clicked", () => {
    render(<TemplateCard {...defaultProps} />);

    const starBtn = screen.getByRole("button", { name: "收藏 Minimal Lower Third" });
    fireEvent.click(starBtn);

    expect(defaultProps.onFavorite).toHaveBeenCalledTimes(1);
  });

  it("labels an active favorite without changing the remote template name", () => {
    render(<TemplateCard {...defaultProps} isFavorite={true} />);

    expect(screen.getByRole("button", { name: "取消收藏 Minimal Lower Third" })).toBeInTheDocument();
    expect(screen.getByText("Minimal Lower Third")).toBeInTheDocument();
  });

  it("calls onApply when the apply/download button is clicked", () => {
    render(<TemplateCard {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    const downloadBtn = buttons[1];
    fireEvent.click(downloadBtn);

    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });

  it("renders download overlay when isDownloading is true", () => {
    render(<TemplateCard {...defaultProps} isDownloading={true} />);
    expect(screen.getByText("正在下载…")).toBeInTheDocument();
  });

  it("localizes download and add-to-timeline button labels", () => {
    const { rerender } = render(<TemplateCard {...defaultProps} />);

    const downloadButton = screen.getByRole("button", { name: "下载模板" });
    expect(downloadButton).toHaveAttribute("title", "下载模板");

    rerender(<TemplateCard {...defaultProps} isDownloaded={true} />);
    const addButton = screen.getByRole("button", { name: "添加模板到时间线" });
    expect(addButton).toHaveAttribute("title", "添加模板到时间线");
  });
});
