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
      indexLoading: false,
      indexError: null,
      definitions: {},
      loadingId: null,
      prefetchingIds: new Set(),
      selectedEffect: null,
      selectedCategory: null,
    });

    useFavoritesStore.setState({
      favorites: ["classic-3d"],
      downloadedEffects: [],
      downloadedTemplates: [],
      downloadingIds: [],
    });
  });

  it("renders category tabs and maps default category correctly", () => {
    render(<EffectGrid />);

    // Check if category button exists
    expect(screen.getByText("3d")).toBeInTheDocument();
    expect(screen.getByText("neon")).toBeInTheDocument();

    // Classic 3D belongs to '3d' category which is active by default
    expect(screen.getByText("Classic 3D")).toBeInTheDocument();
  });

  it("switches categories and fetches new index on category button click", async () => {
    const loadCategorySpy = vi.spyOn(useEffectsStore.getState(), "loadCategory");

    render(<EffectGrid />);

    // Click on neon category
    const neonTab = screen.getByText("neon");
    fireEvent.click(neonTab);

    expect(loadCategorySpy).toHaveBeenCalledWith("neon");
    expect(screen.getByText("Neon Glow")).toBeInTheDocument();
    expect(screen.queryByText("Classic 3D")).not.toBeInTheDocument();
  });

  it("filters items by name based on searchQuery prop", () => {
    // Populate index with multiple 3d effects
    useEffectsStore.setState({
      index: {
        "3d": [
          { id: "3d-a", name: "Alpha 3D", category: "3d" },
          { id: "3d-b", name: "Beta 3D", category: "3d" },
        ],
      },
    });

    render(<EffectGrid searchQuery="beta" />);

    expect(screen.getByText("Beta 3D")).toBeInTheDocument();
    expect(screen.queryByText("Alpha 3D")).not.toBeInTheDocument();
  });

  it("integrates with useFavoritesStore to toggle favorites status", () => {
    const toggleFavoriteSpy = vi.spyOn(useFavoritesStore.getState(), "toggleFavorite");

    render(<EffectGrid />);

    // Get the card container and query buttons inside it
    const card = screen.getByText("Classic 3D").closest(".group");
    expect(card).toBeDefined();
    const buttons = card!.querySelectorAll("button");
    const favBtn = buttons[0];
    fireEvent.click(favBtn);

    expect(toggleFavoriteSpy).toHaveBeenCalledWith("classic-3d");
  });

  it("calls startDownload and completeDownload during apply download triggers", async () => {
    const fullEffectMock: TextEffectDefinition = {
      id: "classic-3d",
      name: "Classic 3D",
      category: "3d",
      description: "Classic 3D text style",
      tags: ["3d", "classic"],
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
    const card = screen.getByText("Classic 3D").closest(".group");
    expect(card).toBeDefined();
    const buttons = card!.querySelectorAll("button");
    const applyBtn = buttons[1];
    fireEvent.click(applyBtn);

    expect(startDownloadSpy).toHaveBeenCalledWith("classic-3d");
    expect(TextEffectsApi.getFullEffect).toHaveBeenCalledWith("3d", "classic-3d");

    // Flush promise microtasks to schedule setTimeout
    await Promise.resolve();
    await Promise.resolve();

    // Fast-forward timeline apply timer
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(completeDownloadSpy).toHaveBeenCalledWith("classic-3d", "effect");
    expect(onAddToTimeline).toHaveBeenCalledWith(expect.objectContaining({
      styleId: "classic-3d",
      effectDefinition: fullEffectMock,
    }), "text");
    vi.useRealTimers();
  });

  it("shows download spinner immediately on card click for preview, and projects preview only on completion", async () => {
    const fullEffectMock: TextEffectDefinition = {
      id: "classic-3d",
      name: "Classic 3D",
      category: "3d",
      description: "Classic 3D text style",
      tags: ["3d", "classic"],
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

    // Click the card (the element containing the text "Classic 3D")
    const cardText = screen.getByText("Classic 3D");
    fireEvent.click(cardText);

    // 1. Immediately sets previewMediaId in useUIStore and calls startDownload
    expect(useUIStore.getState().previewMediaId).toBe("classic-3d");
    expect(startDownloadSpy).toHaveBeenCalledWith("classic-3d");

    // 2. Before download finishes, it should NOT have projected the preview
    expect(previewTextPresetSpy).not.toHaveBeenCalled();

    // 3. Wait for the async download promise to resolve and preview to project
    await waitFor(() => {
      expect(completeDownloadSpy).toHaveBeenCalledWith("classic-3d", "effect");
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

    const classic3dMock: TextEffectDefinition = {
      id: "classic-3d",
      name: "Classic 3D",
      category: "3d",
      description: "Classic 3D text style",
      tags: ["3d", "classic"],
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
      if (id === "classic-3d") return promiseA;
      if (id === "neon-glow") return promiseB;
      return Promise.reject(new Error("Unknown ID"));
    });

    vi.spyOn(useEffectsStore.getState(), "selectEffect").mockResolvedValue(undefined as any);
    const previewTextPresetSpy = vi.spyOn(useUIStore.getState(), "previewTextPreset");

    render(<EffectGrid />);

    // 1. Click card A (classic-3d)
    fireEvent.click(screen.getByText("Classic 3D"));
    expect(useUIStore.getState().previewMediaId).toBe("classic-3d");

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

    // 4. Resolve A (classic-3d) later
    await act(async () => {
      resolveA(classic3dMock);
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
