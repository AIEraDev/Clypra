import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EffectGrid } from "../EffectGrid";
import { useEffectsStore } from "../../store/effectsStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useUIStore } from "@/store/uiStore";
import { TextEffectsApi } from "../../api/textEffectsApi";
import type { TextEffectDefinition } from "../../types/types";

// Mock TextEffectsApi
vi.mock("../../api/textEffectsApi", () => ({
  TEXT_EFFECT_CATEGORIES: [
    "essentials",
    "neon",
    "3d",
    "glitch",
    "gradient",
    "outline",
    "cinematic",
    "retro",
    "minimal",
    "grunge",
    "metallic",
    "handwritten",
  ] as const,
  TextEffectsApi: {
    getFullEffect: vi.fn(),
  },
}));

describe("EffectGrid Component", () => {
  const mockEffects = [
    {
      id: "neon-glow",
      name: "Neon Glow",
      category: "neon",
      thumbnail: "http://example.com/neon.png",
    },
    {
      id: "metal-rust",
      name: "Metal Rust",
      category: "metallic",
      thumbnail: "http://example.com/metal.png",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset stores
    useEffectsStore.setState({
      index: {
        essentials: [
          {
            id: "bold-clean",
            name: "Bold Clean",
            category: "essentials",
            thumbnail: "http://example.com/bold-clean.png",
          },
        ],
        "3d": [
          {
            id: "classic-3d",
            name: "Classic 3D",
            category: "3d",
            thumbnail: "http://example.com/3d.png",
          },
        ],
        neon: [
          {
            id: "neon-glow",
            name: "Neon Glow",
            category: "neon",
            thumbnail: "http://example.com/neon.png",
          },
        ],
      },
      indexTimestamps: {
        essentials: Date.now(),
        "3d": Date.now(),
        neon: Date.now(),
      },
      indexLoading: false,
      indexError: null,
      definitions: {},
      loadingId: null,
      prefetchingIds: new Set(),
      selectedEffect: null,
      selectedCategory: null,
    });

    useFavoritesStore.setState({
      favorites: ["bold-clean"],
      downloadedEffects: [],
      downloadedTemplates: [],
      downloadingIds: [],
    });
  });

  it("renders category tabs and maps default category correctly", () => {
    render(<EffectGrid />);

    // Check if category button exists
    expect(screen.getByText("essentials")).toBeInTheDocument();
    expect(screen.getByText("3d")).toBeInTheDocument();
    expect(screen.getByText("neon")).toBeInTheDocument();

    // Bold Clean belongs to 'essentials' category which is active by default
    expect(screen.getByText("Bold Clean")).toBeInTheDocument();
  });

  it("switches categories and fetches new index on category button click", async () => {
    const loadCategorySpy = vi.spyOn(useEffectsStore.getState(), "loadCategory");

    render(<EffectGrid />);

    // Click on neon category
    const neonTab = screen.getByText("neon");
    fireEvent.click(neonTab);

    expect(loadCategorySpy).toHaveBeenCalledWith("neon");
    expect(screen.getByText("Neon Glow")).toBeInTheDocument();
    expect(screen.queryByText("Bold Clean")).not.toBeInTheDocument();
  });

  it("filters items by name based on searchQuery prop", () => {
    // Populate index with multiple essentials effects
    useEffectsStore.setState({
      index: {
        essentials: [
          { id: "essential-a", name: "Alpha Essential", category: "essentials" },
          { id: "essential-b", name: "Beta Essential", category: "essentials" },
        ],
      },
    });

    render(<EffectGrid searchQuery="beta" />);

    expect(screen.getByText("Beta Essential")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Essential")).not.toBeInTheDocument();
  });

  it("integrates with useFavoritesStore to toggle favorites status", () => {
    const toggleFavoriteSpy = vi.spyOn(useFavoritesStore.getState(), "toggleFavorite");

    render(<EffectGrid />);

    // Get the card container and query buttons inside it
    const card = screen.getByText("Bold Clean").closest(".group");
    expect(card).toBeDefined();
    const buttons = card!.querySelectorAll("button");
    const favBtn = buttons[0];
    fireEvent.click(favBtn);

    expect(toggleFavoriteSpy).toHaveBeenCalledWith("bold-clean");
  });

  it("calls startDownload and completeDownload during apply download triggers", async () => {
    const fullEffectMock: TextEffectDefinition = {
      id: "bold-clean",
      name: "Bold Clean",
      category: "essentials",
      description: "Bold clean text style",
      tags: ["essentials", "clean"],
      font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
      fills: [{ type: "solid", color: "#FFE259" }],
      strokes: [],
      shadows: [],
    };
    vi.mocked(TextEffectsApi.getFullEffect).mockResolvedValue(fullEffectMock);

    const startDownloadSpy = vi.spyOn(useFavoritesStore.getState(), "startDownload");
    const completeDownloadSpy = vi.spyOn(useFavoritesStore.getState(), "completeDownload");
    const onAddToTimeline = vi.fn();

    vi.useFakeTimers();
    render(<EffectGrid onAddToTimeline={onAddToTimeline} />);

    // Get the card container and query buttons inside it
    const card = screen.getByText("Bold Clean").closest(".group");
    expect(card).toBeDefined();
    const buttons = card!.querySelectorAll("button");
    const applyBtn = buttons[1];
    fireEvent.click(applyBtn);

    expect(startDownloadSpy).toHaveBeenCalledWith("bold-clean");
    expect(TextEffectsApi.getFullEffect).toHaveBeenCalledWith("essentials", "bold-clean", { forceRefresh: true });

    // Flush promise microtasks to schedule setTimeout
    await Promise.resolve();
    await Promise.resolve();

    // Fast-forward timeline apply timer
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(completeDownloadSpy).toHaveBeenCalledWith("bold-clean", "effect");
    expect(onAddToTimeline).toHaveBeenCalledWith(expect.objectContaining({
      styleId: "bold-clean",
      effectDefinition: fullEffectMock,
    }), "text");
    vi.useRealTimers();
  });

  it("shows download spinner immediately on card click for preview, and projects preview only on completion", async () => {
    const fullEffectMock: TextEffectDefinition = {
      id: "bold-clean",
      name: "Bold Clean",
      category: "essentials",
      description: "Bold clean text style",
      tags: ["essentials", "clean"],
      font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
      fills: [{ type: "solid", color: "#FFE259" }],
      strokes: [],
      shadows: [],
    };
    vi.mocked(TextEffectsApi.getFullEffect).mockResolvedValue(fullEffectMock);
    vi.spyOn(useEffectsStore.getState(), "selectEffect").mockResolvedValue(undefined as any);

    const startDownloadSpy = vi.spyOn(useFavoritesStore.getState(), "startDownload");
    const completeDownloadSpy = vi.spyOn(useFavoritesStore.getState(), "completeDownload");
    const previewTextPresetSpy = vi.spyOn(useUIStore.getState(), "previewTextPreset");

    render(<EffectGrid />);

    // Click the card (the element containing the text "Bold Clean")
    const cardText = screen.getByText("Bold Clean");
    fireEvent.click(cardText);

    // 1. Immediately sets previewMediaId in useUIStore and calls startDownload
    expect(useUIStore.getState().previewMediaId).toBe("bold-clean");
    expect(startDownloadSpy).toHaveBeenCalledWith("bold-clean");

    // 2. Before download finishes, it should NOT have projected the preview
    expect(previewTextPresetSpy).not.toHaveBeenCalled();

    // 3. Wait for the async download promise to resolve and preview to project
    await waitFor(() => {
      expect(completeDownloadSpy).toHaveBeenCalledWith("bold-clean", "effect");
      expect(previewTextPresetSpy).toHaveBeenCalledWith(fullEffectMock, "effect");
    });
  });

  it("handles race downloading of multiple cards and projects using latest-intent-wins", async () => {
    let resolveA: (value: TextEffectDefinition) => void = () => {};
    let resolveB: (value: TextEffectDefinition) => void = () => {};

    const promiseA = new Promise<TextEffectDefinition>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<TextEffectDefinition>((resolve) => {
      resolveB = resolve;
    });

    const boldCleanMock: TextEffectDefinition = {
      id: "bold-clean",
      name: "Bold Clean",
      category: "essentials",
      description: "Bold clean text style",
      tags: ["essentials", "clean"],
      font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
      fills: [{ type: "solid", color: "#FFE259" }],
      strokes: [],
      shadows: [],
    };

    const neonGlowMock: TextEffectDefinition = {
      id: "neon-glow",
      name: "Neon Glow",
      category: "neon",
      description: "Neon glow text style",
      tags: ["neon", "glow"],
      font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
      fills: [{ type: "solid", color: "#FFA751" }],
      strokes: [],
      shadows: [],
    };

    vi.mocked(TextEffectsApi.getFullEffect).mockImplementation((category, id) => {
      if (id === "bold-clean") return promiseA;
      if (id === "neon-glow") return promiseB;
      return Promise.reject(new Error("Unknown ID"));
    });

    vi.spyOn(useEffectsStore.getState(), "selectEffect").mockResolvedValue(undefined as any);
    const previewTextPresetSpy = vi.spyOn(useUIStore.getState(), "previewTextPreset");

    render(<EffectGrid />);

    // 1. Click card A (bold-clean in essentials category)
    fireEvent.click(screen.getByText("Bold Clean"));
    expect(useUIStore.getState().previewMediaId).toBe("bold-clean");

    // 2. Click card B (neon-glow in neon category)
    // First switch to neon category
    fireEvent.click(screen.getByText("neon"));
    fireEvent.click(screen.getByText("Neon Glow"));
    expect(useUIStore.getState().previewMediaId).toBe("neon-glow");

    // 3. Resolve B (neon-glow) first
    await act(async () => {
      resolveB(neonGlowMock);
      await promiseB;
    });

    // B should project because previewMediaId is "neon-glow"
    await waitFor(() => {
      expect(previewTextPresetSpy).toHaveBeenCalledWith(neonGlowMock, "effect");
    });
    previewTextPresetSpy.mockClear();

    // 4. Resolve A (bold-clean) later
    await act(async () => {
      resolveA(boldCleanMock);
      await promiseA;
    });

    // Flush any pending microtasks
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A should NOT project because the latest intent (previewMediaId) is still "neon-glow"!
    expect(previewTextPresetSpy).not.toHaveBeenCalled();
  });
});
