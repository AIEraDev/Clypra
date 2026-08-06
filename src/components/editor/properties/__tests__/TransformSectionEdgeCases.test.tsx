import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransformSection } from "../TransformSection";
import type { Clip } from "@/types";

const baseClip: Clip = {
  id: "clip-1",
  trackId: "track-1",
  mediaId: "media-1",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: true,
  sourceAspectRatio: 16 / 9,
};

describe("TransformSection Edge Cases & Boundary Handling", () => {
  it("invokes handleUpdate when Conform Mode select is changed", () => {
    const handleUpdate = vi.fn();
    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip={true}
        handleUpdate={handleUpdate}
        handleUpdateMultiple={vi.fn()}
        handleApplyFit={vi.fn()}
        canvasWidth={1920}
        canvasHeight={1080}
      />
    );

    // Expand accordion section
    fireEvent.click(screen.getByText("Transform"));

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "fill" } });

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(handleUpdate).toHaveBeenCalledWith("conform", expect.objectContaining({ mode: "fill" }));
  });

  it("invokes handleUpdateMultiple when Center on Canvas button is clicked", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip={true}
        handleUpdate={vi.fn()}
        handleUpdateMultiple={handleUpdateMultiple}
        handleApplyFit={vi.fn()}
        canvasWidth={1920}
        canvasHeight={1080}
      />
    );

    // Expand accordion section
    fireEvent.click(screen.getByText("Transform"));

    const centerBtn = screen.getByRole("button", { name: /center/i });
    fireEvent.click(centerBtn);

    expect(handleUpdateMultiple).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it("toggles aspect ratio lock state when Locked/Free button is clicked", () => {
    const handleUpdate = vi.fn();
    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip={true}
        handleUpdate={handleUpdate}
        handleUpdateMultiple={vi.fn()}
        handleApplyFit={vi.fn()}
      />
    );

    // Expand accordion section
    fireEvent.click(screen.getByText("Transform"));

    const lockButton = screen.getByRole("button", { name: /locked|free/i });
    fireEvent.click(lockButton);

    expect(handleUpdate).toHaveBeenCalledWith("aspectRatioLocked", false);
  });
});
