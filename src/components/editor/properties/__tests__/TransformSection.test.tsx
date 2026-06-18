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
  x: 100,
  y: 120,
  width: 320,
  height: 180,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: true,
  sourceAspectRatio: 16 / 9,
};

describe("TransformSection", () => {
  it("batches center-on-canvas into one transform update", () => {
    const handleUpdate = vi.fn();
    const handleUpdateMultiple = vi.fn();

    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip={false}
        handleUpdate={handleUpdate}
        handleUpdateMultiple={handleUpdateMultiple}
        handleApplyFit={vi.fn()}
        canvasWidth={1920}
        canvasHeight={1080}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /center/i }));

    expect(handleUpdate).not.toHaveBeenCalled();
    expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
    expect(handleUpdateMultiple).toHaveBeenCalledWith({ x: 800, y: 450 });
  });

  it("batches aspect-locked width changes into one transform update", () => {
    const handleUpdate = vi.fn();
    const handleUpdateMultiple = vi.fn();

    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip={false}
        handleUpdate={handleUpdate}
        handleUpdateMultiple={handleUpdateMultiple}
        handleApplyFit={vi.fn()}
      />,
    );

    const widthInput = screen.getAllByRole("spinbutton")[2];
    fireEvent.change(widthInput, { target: { value: "640" } });

    expect(handleUpdate).not.toHaveBeenCalled();
    expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
    expect(handleUpdateMultiple).toHaveBeenCalledWith({ width: 640, height: 360 });
  });

  it("displays legacy percent opacity as a normalized percent", () => {
    render(
      <TransformSection
        selectedClip={{ ...baseClip, opacity: 100 }}
        isVisualClip={false}
        handleUpdate={vi.fn()}
        handleUpdateMultiple={vi.fn()}
        handleApplyFit={vi.fn()}
      />,
    );

    const spinbuttonValues = screen.getAllByRole("spinbutton").map((input) => (input as HTMLInputElement).value);
    expect(spinbuttonValues).toContain("100");
    expect(spinbuttonValues).not.toContain("10000");
  });
});
