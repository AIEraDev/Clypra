import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { VolumeWaveform } from "../VolumeWaveform";
import * as useWaveformDataModule from "../useWaveformData";

describe("VolumeWaveform rendering and progressive retention", () => {
  let fillRectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];

  beforeEach(() => {
    fillRectCalls = [];
    vi.clearAllMocks();

    // Mock HTMLCanvasElement getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h });
      }),
      fillStyle: "",
    }) as any;
  });

  it("draws bars with uniform screen-space pitch across the full width without empty gaps", () => {
    vi.spyOn(useWaveformDataModule, "useWaveformData").mockReturnValue({
      waveformData: [
        { peak: 0.8, rms: 0.4 },
        { peak: 0.5, rms: 0.2 },
      ],
      isLoading: false,
      hasError: false,
    });

    // Render a 500px clip at zoom
    render(
      <VolumeWaveform
        audioPath="/media/test.mp3"
        clipWidthPx={500}
        duration={5}
        heightPx={40}
        alignment="bottom"
      />
    );

    expect(fillRectCalls.length).toBeGreaterThan(100);
    // Verify first bar is near start and last bar is near end (spans entire width)
    const firstX = fillRectCalls[0].x;
    const lastX = fillRectCalls[fillRectCalls.length - 1].x;
    expect(firstX).toBeLessThan(10);
    expect(lastX).toBeGreaterThan(480);

    // Verify distance between adjacent bars is uniform (~2.8px), not 70-120px
    const distance = fillRectCalls[1].x - fillRectCalls[0].x;
    expect(distance).toBeGreaterThanOrEqual(2.0);
    expect(distance).toBeLessThanOrEqual(4.0);
  });

  it("retains previously committed waveform data and does not blank out during loading transitions", () => {
    const mockUseWaveform = vi.spyOn(useWaveformDataModule, "useWaveformData");

    // Initially loaded with data
    mockUseWaveform.mockReturnValue({
      waveformData: [{ peak: 0.9, rms: 0.6 }],
      isLoading: false,
      hasError: false,
    });

    const { rerender } = render(
      <VolumeWaveform
        audioPath="/media/test.mp3"
        clipWidthPx={300}
        duration={3}
        heightPx={40}
      />
    );

    const initialDrawCount = fillRectCalls.length;
    expect(initialDrawCount).toBeGreaterThan(0);

    // Now transition to loading with empty waveformData (like during zoom change)
    fillRectCalls = [];
    mockUseWaveform.mockReturnValue({
      waveformData: [],
      isLoading: true,
      hasError: false,
    });

    rerender(
      <VolumeWaveform
        audioPath="/media/test.mp3"
        clipWidthPx={300}
        duration={3}
        heightPx={40}
      />
    );

    // Canvas must still draw the retained committed waveform rather than clearing to empty!
    expect(fillRectCalls.length).toBeGreaterThan(0);
    // Canvas opacity must remain 1 (not hidden)
    const canvas = screen.getByTestId("volume-waveform-canvas");
    expect(canvas.style.opacity).toBe("1");
    // Loading pulse overlay is NOT shown because active retained data is available
    expect(screen.queryByTestId("volume-waveform-loading")).toBeNull();
  });
});
