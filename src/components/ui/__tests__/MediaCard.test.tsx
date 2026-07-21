import React from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaCard } from "../MediaCard";

vi.mock("react-dnd", () => ({
  useDrag: () => [{ isDragging: false }, () => undefined],
}));

vi.mock("@/core/platform", () => ({
  platform: {
    convertFileSrc: (path: string) => path,
  },
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: () => ({ previewAsset: vi.fn() }),
}));

describe("MediaCard localization", () => {
  test("keeps the asset name unchanged and localizes status, tooltip, and ARIA", () => {
    const onAddToTimeline = vi.fn();
    render(
      <MediaCard
        asset={{
          id: "remote-01",
          name: "RAW_夜景 / Night Shot.MOV",
          path: "https://cdn.example/RAW_夜景.MOV",
          posterFrame: "https://cdn.example/poster_RAW.jpg",
          type: "video",
          duration: 12,
        }}
        isSelected={false}
        isUsedInTimeline
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        onAddToTimeline={onAddToTimeline}
      />,
    );

    expect(screen.getByText("RAW_夜景 / Night Shot.MOV")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "RAW_夜景 / Night Shot.MOV" })).toHaveAttribute("src", "https://cdn.example/poster_RAW.jpg");
    expect(screen.getByText("已添加")).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "添加到轨道" });
    expect(addButton).toHaveAttribute("title", "添加到轨道");
    fireEvent.click(addButton);
    expect(onAddToTimeline).toHaveBeenCalledOnce();
  });
});
