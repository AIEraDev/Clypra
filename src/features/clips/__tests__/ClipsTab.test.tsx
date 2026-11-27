import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ClipsTab } from "../components/ClipsTab";
import { ClipsApi } from "../api/clipsApi";
import { useClipUiStore, ALL_CLIP_CATEGORY } from "../store/clipUiStore";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import type { ClipItem } from "../types";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function makeClip(id: string, overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    id,
    title: `Clip ${id}`,
    category: "laughing",
    tags: ["funny"],
    durationSec: 3,
    width: 640,
    height: 360,
    posterUrl: `https://cdn.example.com/${id}.webp`,
    previewUrl: `https://cdn.example.com/${id}-preview.mp4`,
    fileUrl: `https://cdn.example.com/${id}.mp4`,
    sha256: "b".repeat(64),
    bytes: 1024,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Author",
      sourceUrl: "https://example.com",
      releaseOnFile: true,
    },
    ...overrides,
  };
}

function renderTab(props: React.ComponentProps<typeof ClipsTab> = {}) {
  return render(
    <TooltipProvider>
      <ClipsTab {...props} />
    </TooltipProvider>,
  );
}

describe("ClipsTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useClipUiStore.setState({
      activeCategory: ALL_CLIP_CATEGORY,
      searchQuery: "",
      hoveredClipId: null,
    });
    useClipDownloadStore.setState({ downloads: {} });
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
  });

  it("shows loading state then renders clip tiles", async () => {
    const sample = [
      makeClip("1", { title: "Laughing Hard", category: "laughing" }),
      makeClip("2", { title: "Goal Celebration", category: "football", tags: ["soccer"] }),
    ];
    vi.spyOn(ClipsApi, "getClipsIndex").mockResolvedValue(sample);

    renderTab();
    expect(screen.getByText("clips.loading")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Laughing Hard")).toBeTruthy();
      expect(screen.getByText("Goal Celebration")).toBeTruthy();
    });
  });

  it("filters by search query (title and tags) and category", async () => {
    const sample = [
      makeClip("1", { title: "Laughing Hard", category: "laughing", tags: ["lol"] }),
      makeClip("2", { title: "Goal Celebration", category: "football", tags: ["soccer"] }),
    ];
    vi.spyOn(ClipsApi, "getClipsIndex").mockResolvedValue(sample);
    vi.spyOn(ClipsApi, "getClipsByCategory").mockResolvedValue([sample[1]]);

    renderTab();
    await waitFor(() => expect(screen.getByText("Laughing Hard")).toBeTruthy());

    // Search by tag
    const searchInput = screen.getByPlaceholderText("clips.search");
    fireEvent.change(searchInput, { target: { value: "soccer" } });
    expect(screen.queryByText("Laughing Hard")).toBeNull();
    expect(screen.getByText("Goal Celebration")).toBeTruthy();

    // Clear search and switch category pill
    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "clips.category.football" }));

    await waitFor(() => {
      expect(ClipsApi.getClipsByCategory).toHaveBeenCalledWith("football");
      expect(screen.getByText("Goal Celebration")).toBeTruthy();
    });
  });

  it("shows empty state when no clips match", async () => {
    vi.spyOn(ClipsApi, "getClipsIndex").mockResolvedValue([]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("clips.empty.title")).toBeTruthy();
    });
  });

  it("shows offline state when offline and no clips available", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    vi.spyOn(ClipsApi, "getClipsIndex").mockResolvedValue([]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("clips.offline")).toBeTruthy();
    });
  });

  it("shows error state when API rejects", async () => {
    vi.spyOn(ClipsApi, "getClipsIndex").mockRejectedValue(
      new Error("Server 500"),
    );
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("clips.error.title")).toBeTruthy();
    });
  });

  it("renders cleanly at narrow, medium, and wide panel widths", async () => {
    const sample = [makeClip("1"), makeClip("2"), makeClip("3")];
    vi.spyOn(ClipsApi, "getClipsIndex").mockResolvedValue(sample);

    for (const width of [220, 320, 480]) {
      const { container, unmount } = render(
        <div style={{ width }}>
          <TooltipProvider>
            <ClipsTab />
          </TooltipProvider>
        </div>,
      );
      await waitFor(() => {
        expect(container.querySelectorAll("img").length).toBe(3);
      });
      unmount();
    }
  });
});
