import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, TransitionTimelineItem } from "@/types";
import { EmptyPropertiesState } from "../EmptyPropertiesState";
import { StickerSettingsSection } from "../StickerSettingsSection";
import { TransitionSection } from "../TransitionSection";

let timelineClips: Clip[] = [];

vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: (selector: (state: { clips: Clip[] }) => unknown) => selector({ clips: timelineClips }),
}));

const stickerClip = {
  id: "sticker-1",
  kind: "animated-overlay",
  trackId: "track-1",
  mediaId: "sticker-media",
  startTime: 0,
  duration: 3,
  trimIn: 0,
  trimOut: 3,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  stickerSettings: { speed: 1, loop: true },
} as Clip;

const transition: TransitionTimelineItem = {
  id: "transition-1",
  kind: "transition",
  type: "fade",
  fromItemId: "left",
  toItemId: "right",
  alignment: "center",
  easing: "linear",
  placement: {
    trackId: "track-1",
    startTime: 10,
    duration: 1,
    role: "effect",
    zIndex: 1,
  },
  effects: { effects: [], version: 0 },
};

describe("basic property section localization", () => {
  it("renders both localized empty-property states", () => {
    timelineClips = [];
    const { rerender } = render(<EmptyPropertiesState />);

    expect(screen.getByText("属性")).toBeInTheDocument();
    expect(screen.getByText("将媒体添加到时间线")).toBeInTheDocument();
    expect(screen.getByText("将媒体文件拖入媒体面板即可开始")).toBeInTheDocument();

    timelineClips = [stickerClip];
    rerender(<EmptyPropertiesState />);
    expect(screen.getByText("选择片段进行编辑")).toBeInTheDocument();
    expect(screen.getByText("点击时间线中的任意片段，查看并编辑其属性")).toBeInTheDocument();
  });

  it("localizes transition display names while preserving stable values and seconds", () => {
    const updateTransition = vi.fn();
    const removeTransition = vi.fn();
    const clearSelection = vi.fn();
    render(
      <TransitionSection
        selectedTransition={transition}
        updateTransition={updateTransition}
        removeTransition={removeTransition}
        clearSelection={clearSelection}
      />,
    );

    expect(screen.getByRole("button", { name: "转场设置" })).toBeInTheDocument();
    expect(screen.getByText("类型")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "淡入淡出" })).toHaveValue("fade");
    expect(screen.getByRole("option", { name: "溶解" })).toHaveValue("dissolve");
    expect(screen.getByRole("option", { name: "线性" })).toHaveValue("linear");
    expect(screen.getByRole("option", { name: "缓入缓出" })).toHaveValue("easeInOut");
    expect(screen.getByText("1.0s")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "dissolve" } });
    fireEvent.change(selects[1], { target: { value: "easeInOut" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });

    expect(updateTransition).toHaveBeenNthCalledWith(1, "transition-1", { type: "dissolve" });
    expect(updateTransition).toHaveBeenNthCalledWith(2, "transition-1", { easing: "easeInOut" });
    expect(updateTransition).toHaveBeenNthCalledWith(3, "transition-1", {
      placement: { ...transition.placement, startTime: 9.5, duration: 2 },
    });

    fireEvent.click(screen.getByRole("button", { name: "删除转场" }));
    expect(removeTransition).toHaveBeenCalledWith("transition-1");
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("localizes sticker controls while preserving speed multipliers and stored values", () => {
    const handleUpdate = vi.fn();
    render(<StickerSettingsSection selectedClip={stickerClip} handleUpdate={handleUpdate} />);

    expect(screen.getByRole("button", { name: "贴纸动画" })).toBeInTheDocument();
    expect(screen.getByText("速度")).toBeInTheDocument();
    expect(screen.getByText("循环动画")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1.0x" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已启用" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2.0x" }));
    expect(handleUpdate).toHaveBeenCalledWith("stickerSettings", { speed: 2, loop: true });

    fireEvent.click(screen.getByRole("button", { name: "已启用" }));
    expect(handleUpdate).toHaveBeenCalledWith("stickerSettings", { speed: 1, loop: false });
  });
});
