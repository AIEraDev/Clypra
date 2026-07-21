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
  it("localizes transform controls while preserving center, fit, flip, and unit behavior", () => {
    const handleUpdate = vi.fn();
    const handleUpdateMultiple = vi.fn();

    render(
      <TransformSection
        selectedClip={baseClip}
        isVisualClip
        handleUpdate={handleUpdate}
        handleUpdateMultiple={handleUpdateMultiple}
        handleApplyFit={vi.fn()}
        canvasWidth={1920}
        canvasHeight={1080}
      />,
    );

    expect(screen.getByText("变换")).toBeInTheDocument();
    expect(screen.getByText("适配模式")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "适应" })).toHaveValue("fit");
    expect(screen.getByRole("option", { name: "填充" })).toHaveValue("fill");
    expect(screen.getByText("位置")).toBeInTheDocument();
    expect(screen.getByText("尺寸")).toBeInTheDocument();
    expect(screen.getByText("不透明度")).toBeInTheDocument();
    expect(screen.getAllByText("100%")).toHaveLength(2);
    expect(screen.getAllByText("0px")).toHaveLength(2);
    expect(screen.getByText("0°")).toBeInTheDocument();
    expect(screen.getByText("0.00s")).toBeInTheDocument();
    expect(screen.getByText("5.00s")).toBeInTheDocument();
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "居中" }));

    expect(handleUpdate).not.toHaveBeenCalled();
    expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
    expect(handleUpdateMultiple).toHaveBeenCalledWith({ x: 800, y: 450 });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fill" } });
    expect(handleUpdate).toHaveBeenLastCalledWith("conform", expect.objectContaining({ mode: "fill" }));

    fireEvent.click(screen.getByRole("button", { name: "水平" }));
    expect(handleUpdate).toHaveBeenLastCalledWith("width", -320);
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
