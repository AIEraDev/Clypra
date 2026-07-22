import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextClip } from "@/types";
import type { TextEffectDefinition } from "@/features/text-effects/types/types";
import { ENTRANCE_PRESETS, EXIT_PRESETS } from "@/lib/text/textAnimation";
import { EffectStylePanel } from "../EffectStylePanel";
import { TextAnimationControls } from "../TextAnimationControls";
import { TextModeSelector } from "../TextModeSelector";

const clip = {
  kind: "text",
  duration: 4,
  entranceAnimation: { type: "fade", duration: 0.5, easing: "ease-in" },
  exitAnimation: { type: "slide-left", duration: 0.6, easing: "ease-out" },
} as TextClip;

describe("text animation and mode localization", () => {
  it("localizes preset names while preserving animation contracts", () => {
    expect(ENTRANCE_PRESETS.map(({ name, type, easing }) => ({ name, type, easing }))).toEqual([
      { name: "无", type: "none", easing: "linear" },
      { name: "淡入", type: "fade", easing: "ease-in" },
      { name: "向上滑入", type: "slide-up", easing: "ease-out" },
      { name: "向下滑入", type: "slide-down", easing: "ease-out" },
      { name: "向左滑入", type: "slide-left", easing: "ease-out" },
      { name: "向右滑入", type: "slide-right", easing: "ease-out" },
      { name: "缩放", type: "scale", easing: "ease-out" },
      { name: "放大", type: "zoom-in", easing: "ease-out" },
    ]);
    expect(EXIT_PRESETS[EXIT_PRESETS.length - 1]).toMatchObject({ name: "缩小", type: "zoom-out", easing: "ease-in" });
  });

  it("localizes animation controls while preserving values and seconds", () => {
    const handleUpdate = vi.fn();
    render(<TextAnimationControls clip={clip} handleUpdate={handleUpdate} handleUpdateMultiple={vi.fn()} />);

    expect(screen.getByRole("button", { name: "文字动画" })).toBeInTheDocument();
    expect(screen.getByText("入场")).toBeInTheDocument();
    expect(screen.getAllByText("时长")).toHaveLength(2);
    expect(screen.getAllByText("缓动")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "淡入" })).toHaveValue("fade");
    expect(screen.getAllByRole("option", { name: "缓入" })[0]).toHaveValue("ease-in");
    expect(screen.getByText("0.5s")).toBeInTheDocument();
    expect(screen.getByText("动画将在播放时预览")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "slide-right" } });
    expect(handleUpdate).toHaveBeenCalledWith("entranceAnimation", {
      type: "slide-right",
      duration: 0.6,
      easing: "ease-out",
    });
  });

  it("shows Chinese mode names and returns the original mode IDs", () => {
    const onSwitch = vi.fn();
    render(<TextModeSelector mode="plain" onSwitch={onSwitch} />);

    fireEvent.click(screen.getByRole("button", { name: "文字效果" }));
    fireEvent.click(screen.getByRole("button", { name: "模板" }));

    expect(screen.getByRole("button", { name: "纯文本" })).toBeInTheDocument();
    expect(onSwitch).toHaveBeenNthCalledWith(1, "effect");
    expect(onSwitch).toHaveBeenNthCalledWith(2, "template");
  });
});

describe("effect style localization", () => {
  it("keeps dynamic names raw, localizes known categories, and labels icon buttons", () => {
    render(
      <EffectStylePanel
        effectId="raw-effect-id"
        effectDefinition={{ name: "Raw Effect Name", category: "neon" } as TextEffectDefinition}
        onDetach={vi.fn()}
        onChangeEffect={vi.fn()}
        isModified
      />,
    );

    expect(screen.getByText("Raw Effect Name")).toBeInTheDocument();
    expect(screen.getByText("霓虹效果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更换文字效果" })).toHaveAttribute("title", "更换文字效果");
    expect(screen.getByRole("button", { name: "分离效果（保留当前样式）" })).toHaveAttribute("title", "分离效果（保留当前样式）");
    expect(screen.getByText("提示：编辑下方的字体排印或颜色将与预设效果分离。")).toBeInTheDocument();
  });

  it.each(["unknown-category", "constructor", "toString", "__proto__"])("falls back safely for category %s", (category) => {
    const { unmount } = render(
      <EffectStylePanel
        effectId="raw-effect-id"
        effectDefinition={{ name: "Raw Effect Name", category } as TextEffectDefinition}
        onDetach={vi.fn()}
        onChangeEffect={vi.fn()}
        isModified={false}
      />,
    );

    expect(screen.getByText(`${category}效果`)).toBeInTheDocument();
    unmount();
  });

  it("keeps an effect ID raw and uses the localized custom fallback", () => {
    render(<EffectStylePanel effectId="raw-effect-id" onDetach={vi.fn()} onChangeEffect={vi.fn()} isModified={false} />);

    expect(screen.getByText("raw-effect-id")).toBeInTheDocument();
    expect(screen.getByText("自定义效果")).toBeInTheDocument();
  });
});
