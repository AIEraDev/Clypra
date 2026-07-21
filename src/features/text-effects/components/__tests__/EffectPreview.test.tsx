import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EffectPreview } from "../EffectPreview";
import { useEffectsStore } from "../../store/effectsStore";

vi.mock("../../hooks/useEffectCanvas", () => ({
  useEffectCanvas: vi.fn(),
}));

describe("EffectPreview", () => {
  beforeEach(() => {
    useEffectsStore.setState({
      selectedEffect: {
        id: "remote-effect_RAW_01",
        name: "REMOTE Effect / 原始名_RAW",
        category: "3d",
        description: "REMOTE description 原样",
        tags: ["REMOTE_TAG"],
        font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
        fills: [],
        strokes: [],
        shadows: [],
      },
    });
  });

  it("localizes controls while preserving the entered text passed to apply", () => {
    const onApply = vi.fn();
    render(<EffectPreview onApply={onApply} />);

    const input = screen.getByPlaceholderText("请输入文字…");
    expect(screen.getByText("自定义文字")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Remote 输入_RAW" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    expect(onApply).toHaveBeenCalledWith(
      "Remote 输入_RAW",
      expect.objectContaining({ id: "remote-effect_RAW_01", name: "REMOTE Effect / 原始名_RAW" }),
    );
  });
});
