import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GapIndicator } from "../GapIndicator";
import { TimelineRuler } from "../TimelineRuler";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Gap } from "@/types/gap";

vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({ frameRate: 30 }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  beforeEach(() => {
    useUIStore.setState({ selectedGapId: null });
  });

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

  it("exposes the gap as a keyboard-operable button without changing its ID", async () => {
    const user = userEvent.setup();
    const gap = makeGap("manual", "user-insert");
    render(<GapIndicator gap={gap} pixelsPerSecond={100} />);

    const gapButton = screen.getByRole("button", { name: `选择间隙 ${gap.id}` });
    gapButton.focus();
    await user.keyboard("{Enter}");
    expect(useUIStore.getState().selectedGapId).toBe(gap.id);

    useUIStore.setState({ selectedGapId: null });
    gapButton.focus();
    await user.keyboard(" ");
    expect(useUIStore.getState().selectedGapId).toBe(gap.id);
  });
});

describe("TimelineRuler marker localization", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });

    useTimelineStore.setState({
      markers: [{ id: "marker-raw-id", time: 1, name: "  客户 Marker  ", color: "custom-color" }],
      epoch: 0,
    });
  });

  const openMarkerEditor = async () => {
    const user = userEvent.setup();
    render(<TimelineRuler pixelsPerSecond={100} scrollLeft={0} />);
    const markerPin = screen.getByRole("button", { name: "选择标记 客户 Marker" });
    expect(markerPin).toHaveAttribute("title", "  客户 Marker  ");
    await user.click(markerPin);
    return { user, markerPin };
  };

  it("keeps the marker editor open while clicking its input and color palette", async () => {
    const { user } = await openMarkerEditor();
    const input = screen.getByPlaceholderText("标记名称…");

    expect(useTimelineStore.getState().markers[0].color).toBe("custom-color");
    ["紫色", "蓝色", "绿色", "黄色", "红色"].forEach((title) => {
      expect(screen.getByTitle(title)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute("title", "删除标记");

    await user.click(input);
    expect(screen.getByPlaceholderText("标记名称…")).toBeInTheDocument();
    await user.click(screen.getByTitle("蓝色"));
    expect(useTimelineStore.getState().markers[0].color).toBe("blue");
    expect(screen.getByPlaceholderText("标记名称…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(useTimelineStore.getState().markers).toEqual([]);
  });

  it("commits an empty marker name verbatim", async () => {
    const updateMarker = vi.spyOn(useTimelineStore.getState(), "updateMarker");
    const { user } = await openMarkerEditor();
    const input = screen.getByPlaceholderText("标记名称…");

    await user.clear(input);
    await user.tab();

    expect(updateMarker).toHaveBeenCalledWith("marker-raw-id", { name: "" });
    expect(useTimelineStore.getState().markers[0].name).toBe("");
  });

  it("commits a whitespace-only marker name verbatim", async () => {
    const updateMarker = vi.spyOn(useTimelineStore.getState(), "updateMarker");
    const { user } = await openMarkerEditor();
    const input = screen.getByPlaceholderText("标记名称…");

    await user.clear(input);
    await user.type(input, "   ");
    await user.tab();

    expect(updateMarker).toHaveBeenCalledWith("marker-raw-id", { name: "   " });
    expect(useTimelineStore.getState().markers[0].name).toBe("   ");
  });

  it("opens the marker editor with Enter and Space", async () => {
    const { user, markerPin } = await openMarkerEditor();

    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("标记名称…")).not.toBeInTheDocument();

    markerPin.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByPlaceholderText("标记名称…")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    markerPin.focus();
    await user.keyboard(" ");
    expect(screen.getByPlaceholderText("标记名称…")).toBeInTheDocument();
  });
});
