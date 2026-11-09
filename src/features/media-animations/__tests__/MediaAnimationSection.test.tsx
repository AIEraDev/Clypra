import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { MediaAnimationSection } from "../MediaAnimationSection";
import type { Clip } from "@/types";

const mockToast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: mockToast,
}));

vi.mock("../cache/mediaAnimationCache", () => ({
  mediaAnimationCacheManager: {
    initialize: vi.fn(async () => {}),
    isCached: vi.fn(() => true),
    manifests: new Map([["media-slide-in-left@1.6.1", {}]]),
    onHydrated: vi.fn(() => () => {}),
  },
}));

vi.mock("../mediaAnimationCatalog", async () => {
  const actual = await vi.importActual<typeof import("../mediaAnimationCatalog")>(
    "../mediaAnimationCatalog",
  );
  return {
    ...actual,
    useMediaAnimationCategory: vi.fn((category: string) => {
      if (category === "in") {
        return {
          presets: [
            {
              id: "media-slide-in-left",
              name: "Slide In Left",
              phase: "in",
              category: "in",
              subCategory: "Motion",
              tags: ["slide"],
              description: "Slides in from the left",
              defaultDuration: 0.5,
              icon: "ArrowRight",
              revisionId: "1.6.1",
              tracks: [
                {
                  property: "translateX",
                  keyframes: [
                    { progress: 0, value: -1815 },
                    { progress: 1, value: 0 },
                  ],
                },
              ],
            },
          ],
          status: "ready",
          error: null,
          refetch: vi.fn(),
        };
      }
      return { presets: [], status: "ready", error: null, refetch: vi.fn() };
    }),
    getMediaAnimationPreset: vi.fn((id: string) => {
      if (id === "media-slide-in-left") {
        return {
          id: "media-slide-in-left",
          name: "Slide In Left",
          phase: "in",
          category: "in",
          subCategory: "Motion",
          tags: ["slide"],
          description: "Slides in from the left",
          defaultDuration: 0.5,
          icon: "ArrowRight",
          revisionId: "1.6.1",
          tracks: [
            {
              property: "translateX",
              keyframes: [
                { progress: 0, value: -1815 },
                { progress: 1, value: 0 },
              ],
            },
          ],
        };
      }
      return undefined;
    }),
    useMediaAnimationCatalogSnapshot: vi.fn(() => ({
      presets: [],
      phases: { in: [], out: [], combo: [] },
      status: "ready",
    })),
  };
});

describe("MediaAnimationSection Toasts", () => {
  const sampleClip: Clip = {
    id: "clip-test-1",
    name: "Test Video.mp4",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    motion: {
      inPreset: "none",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast.info when 'None' is clicked to remove animation", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MediaAnimationSection
        selectedClip={sampleClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    const noneButtons = screen.getAllByRole("button", { name: /none/i });
    fireEvent.click(noneButtons[0]);

    expect(mockToast.info).toHaveBeenCalledWith(
      "properties.mediaAnimation.toastRemoved",
    );
  });

  it("shows toast.success with preset name when a preset is selected", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MediaAnimationSection
        selectedClip={sampleClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    const presetCard = screen.getByText("Slide In Left");
    fireEvent.click(presetCard);

    expect(mockToast.success).toHaveBeenCalledWith(
      "properties.mediaAnimation.toastApplied",
      {
        interpolation: { name: "Slide In Left" },
      },
    );
  });

  it("filters presets using favorites toggle button", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MediaAnimationSection
        selectedClip={sampleClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Filter by favorites before any favorite exists
    const favButton = screen.getByRole("button", { name: /Favorites/i });
    expect(favButton).toBeDefined();

    // Preset "Slide In Left" is initially visible
    expect(screen.getByText("Slide In Left")).toBeDefined();

    // Click favorites toggle
    fireEvent.click(favButton);

    // "Slide In Left" is not in favorites, so it should be filtered out
    expect(screen.queryByText("Slide In Left")).toBeNull();

    // Toggle off favorites filter
    fireEvent.click(favButton);
    expect(screen.getByText("Slide In Left")).toBeDefined();
  });
});
