import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { MediaCard } from "../MediaCard";
import type { MediaAsset } from "@/types";

describe("MediaCard Offline State", () => {
  const baseAsset: MediaAsset = {
    id: "asset-offline",
    name: "missing_video.mp4",
    path: "/Volumes/Disconnected/missing_video.mp4",
    type: "video",
    duration: 10,
    width: 1920,
    height: 1080,
    size: 1000,
  };

  it("does not render OFFLINE badge when isMissing is false or undefined", () => {
    render(
      <DndProvider backend={HTML5Backend}>
        <MediaCard
          asset={{ ...baseAsset, isMissing: false }}
          isSelected={false}
          isUsedInTimeline={false}
          onClick={vi.fn()}
          onContextMenu={vi.fn()}
          onAddToTimeline={vi.fn()}
        />
      </DndProvider>
    );

    expect(screen.queryByTestId("media-offline-badge")).toBeNull();
  });

  it("renders OFFLINE badge when isMissing is true", () => {
    render(
      <DndProvider backend={HTML5Backend}>
        <MediaCard
          asset={{ ...baseAsset, isMissing: true }}
          isSelected={false}
          isUsedInTimeline={false}
          onClick={vi.fn()}
          onContextMenu={vi.fn()}
          onAddToTimeline={vi.fn()}
        />
      </DndProvider>
    );

    const badge = screen.getByTestId("media-offline-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("OFFLINE");
  });
});
