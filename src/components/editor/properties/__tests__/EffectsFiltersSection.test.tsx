import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip } from "@/types";
import { EffectsFiltersSection } from "../EffectsFiltersSection";

vi.mock("../primitives/PropertySlider", () => ({
  PropertySlider: ({
    label,
    value,
    suffix,
    onChange,
  }: {
    label: string;
    value: number;
    suffix?: string;
    onChange: (value: number) => void;
  }) => (
    <label>
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>{suffix}</span>
    </label>
  ),
}));

const clip: Clip = {
  id: "clip-1",
  trackId: "track-1",
  mediaId: "media-1",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  opacity: 1,
  rotation: 0,
  filter: { id: "filter_RAW_01", name: "REMOTE Filter / RAW", intensity: 0.8 },
  effects: [
    {
      id: "instance_RAW_01",
      effectId: "effect_RAW_01",
      type: "effect",
      renderer: "renderer_RAW_01",
      params: {},
      name: "REMOTE Effect / RAW",
      startTime: 0,
      duration: 5,
      intensity: 0.6,
    },
  ],
};

describe("EffectsFiltersSection localization", () => {
  it("localizes static UI while preserving dynamic names, units, stable IDs, and numeric callbacks", () => {
    const handleUpdate = vi.fn();
    render(<EffectsFiltersSection selectedClip={clip} handleUpdate={handleUpdate} />);

    expect(screen.getByText("已应用滤镜")).toBeInTheDocument();
    expect(screen.getByText("视频效果")).toBeInTheDocument();
    expect(screen.getByText("色彩滤镜")).toBeInTheDocument();
    expect(screen.getByText("渲染效果")).toBeInTheDocument();
    expect(screen.getByText("REMOTE Filter / RAW")).toBeInTheDocument();
    expect(screen.getByText("REMOTE Effect / RAW")).toBeInTheDocument();
    expect(screen.getAllByText("强度")).toHaveLength(2);
    expect(screen.getAllByText("%")).toHaveLength(2);

    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "55" } });
    expect(handleUpdate).toHaveBeenLastCalledWith("filter", {
      id: "filter_RAW_01",
      name: "REMOTE Filter / RAW",
      intensity: 0.55,
    });

    fireEvent.change(sliders[1], { target: { value: "25" } });
    expect(handleUpdate).toHaveBeenLastCalledWith("effects", [
      expect.objectContaining({ id: "instance_RAW_01", effectId: "effect_RAW_01", intensity: 0.25 }),
    ]);

    fireEvent.click(screen.getByTitle("删除效果"));
    expect(handleUpdate).toHaveBeenLastCalledWith("effects", undefined);

    fireEvent.click(screen.getByTitle("删除滤镜"));
    expect(handleUpdate).toHaveBeenLastCalledWith("filter", undefined);
  });
});
