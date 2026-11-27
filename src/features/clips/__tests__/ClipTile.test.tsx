import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ClipTile } from "../components/ClipTile";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import type { ClipItem } from "../types";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function makeClip(overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    id: "clip-1",
    title: "Crowd Applause",
    category: "applause",
    tags: ["clap", "cheer"],
    durationSec: 4.2,
    width: 640,
    height: 360,
    posterUrl: "https://cdn.example.com/applause.webp",
    previewUrl: "https://cdn.example.com/applause-preview.mp4",
    fileUrl: "https://cdn.example.com/applause.mp4",
    sha256: "a".repeat(64),
    bytes: 2048,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Clip Creator",
      sourceUrl: "https://example.com/clip",
      releaseOnFile: true,
    },
    ...overrides,
  };
}

function renderTile(props: Partial<React.ComponentProps<typeof ClipTile>> = {}) {
  const clip = props.clip ?? makeClip();
  return render(
    <TooltipProvider>
      <ClipTile
        clip={clip}
        isHovered={false}
        onHoverStart={vi.fn()}
        onHoverEnd={vi.fn()}
        onAddToTimeline={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("ClipTile", () => {
  beforeEach(() => {
    useClipDownloadStore.setState({ downloads: {} });
  });

  it("renders poster image by default and not video", () => {
    const { container } = renderTile();
    const img = screen.getByAltText("Crowd Applause") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain("applause.webp");
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("4s")).toBeTruthy();
  });

  it("renders muted looping video when hovered", () => {
    const { container } = renderTile({ isHovered: true });
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.src).toContain("applause-preview.mp4");
  });

  it("calls hover callbacks and onAddToTimeline", () => {
    const onHoverStart = vi.fn();
    const onHoverEnd = vi.fn();
    const onAddToTimeline = vi.fn();
    const clip = makeClip();

    renderTile({ clip, onHoverStart, onHoverEnd, onAddToTimeline });

    const tile = screen.getByRole("button", { name: "Crowd Applause" });
    fireEvent.mouseEnter(tile);
    expect(onHoverStart).toHaveBeenCalledWith("clip-1");

    fireEvent.mouseLeave(tile);
    expect(onHoverEnd).toHaveBeenCalledWith("clip-1");

    const addBtn = screen.getByRole("button", { name: "clips.addToTimeline" });
    fireEvent.click(addBtn);
    expect(onAddToTimeline).toHaveBeenCalledWith(clip);
  });

  it("shows download progress overlay when downloading", () => {
    useClipDownloadStore.setState({
      downloads: {
        "clip-1": {
          clipId: "clip-1",
          status: "downloading",
          progress: 65,
        },
      },
    });
    renderTile();
    expect(screen.getByTestId("clip-downloading-overlay")).toBeTruthy();
    expect(screen.getByText("65%")).toBeTruthy();
  });

  it("shows error indicator when download fails", () => {
    useClipDownloadStore.setState({
      downloads: {
        "clip-1": {
          clipId: "clip-1",
          status: "error",
          progress: 0,
          error: "Hash mismatch",
        },
      },
    });
    renderTile();
    const err = screen.getByTestId("clip-error-indicator");
    expect(err).toBeTruthy();
    expect(err.getAttribute("title")).toBe("Hash mismatch");
  });
});
