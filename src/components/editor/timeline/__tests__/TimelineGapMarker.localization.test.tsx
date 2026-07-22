import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GapIndicator } from "../GapIndicator";
import { TimelineRuler } from "../TimelineRuler";
import { useTimelineStore } from "@/store/timelineStore";
import type { Gap } from "@/types/gap";

vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({ frameRate: 30 }),
}));

const makeGap = (type: string, source: string, protectedGap = false): Gap => ({
  id: `gap-${type}-${source}`,
  trackId: "track-1",
  startTime: 2,
  duration: 3,
  type: type as Gap["type"],
  source: source as Gap["source"],
  protected: protectedGap,
});

const openGapMenu = (gap: Gap) => {
  const { container } = render(<GapIndicator gap={gap} pixelsPerSecond={100} />);
  fireEvent.contextMenu(container.querySelector(`[data-gap-id="${gap.id}"]`)!);
};

describe("GapIndicator localization", () => {
  it.each([
    ["manual", "user-insert", "手动", "用户插入"],
    ["auto", "clip-drag", "自动", "片段拖动"],
    ["protected", "clip-delete", "已保护", "删除片段"],
    ["manual", "imported", "手动", "已导入"],
    ["auto", "unknown", "自动", "未知"],
  ])("localizes known %s and %s values without changing their stored values", (type, source, expectedType, expectedSource) => {
    const gap = makeGap(type, source);
    openGapMenu(gap);

    expect(screen.getByText(`类型：${expectedType}`)).toBeInTheDocument();
    expect(screen.getByText(`来源：${expectedSource}`)).toBeInTheDocument();
    expect(gap).toMatchObject({ type, source });
  });

  it.each(["custom-value", "constructor", "toString", "__proto__"])("preserves the unknown gap value %s verbatim", (value) => {
    const gap = makeGap(value, value);
    openGapMenu(gap);

    expect(screen.getByText(`类型：${value}`)).toBeInTheDocument();
    expect(screen.getByText(`来源：${value}`)).toBeInTheDocument();
    expect(gap).toMatchObject({ type: value, source: value });
  });

  it.each([
    [false, "保护间隙"],
    [true, "取消保护间隙"],
  ])("localizes gap actions and details when protected is %s", (protectedGap, protectionLabel) => {
    openGapMenu(makeGap("manual", "user-insert", protectedGap));

    expect(screen.getByRole("button", { name: /删除间隙/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: protectionLabel })).toBeInTheDocument();
    expect(screen.getByText("时长：3:00")).toBeInTheDocument();
    expect(screen.getByText("开始：2:00")).toBeInTheDocument();
    expect(screen.getByText(",")).toBeInTheDocument();
  });
});

describe("TimelineRuler marker localization", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;

    useTimelineStore.setState({
      markers: [{ id: "marker-raw-id", time: 1, name: "  客户 Marker  ", color: "custom-color" }],
      epoch: 0,
    });
  });

  it("preserves custom marker data while localizing the marker editor UI", () => {
    const { container } = render(<TimelineRuler pixelsPerSecond={100} scrollLeft={0} />);

    const markerPin = container.querySelector('[title="  客户 Marker  "]');
    expect(markerPin).toHaveAttribute("title", "  客户 Marker  ");
    fireEvent.click(markerPin!);
    const input = screen.getByPlaceholderText("标记名称…");

    expect(input).toHaveValue("  客户 Marker  ");
    expect(useTimelineStore.getState().markers[0].color).toBe("custom-color");
    ["紫色", "蓝色", "绿色", "黄色", "红色"].forEach((title) => {
      expect(screen.getByTitle(title)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute("title", "删除标记");

    fireEvent.change(input, { target: { value: "  新 Marker 名称  " } });
    fireEvent.blur(input);
    expect(useTimelineStore.getState().markers[0].name).toBe("  新 Marker 名称  ");

    fireEvent.click(screen.getByTitle("蓝色"));
    expect(useTimelineStore.getState().markers[0].color).toBe("blue");

    fireEvent.click(container.querySelector('[title="  新 Marker 名称  "]')!);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(useTimelineStore.getState().markers).toEqual([]);
  });
});
