import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditingActions } from "@/core/interactions";
import { useSplitMode } from "../useSplitMode";

vi.mock("@/core/interactions", () => ({
  EditingActions: { splitAtPosition: vi.fn() },
}));

function addTimelineClip(): HTMLElement {
  const container = document.createElement("div");
  container.id = "timeline-tracks-container";
  const clip = document.createElement("div");
  clip.setAttribute("data-clip-id", "clip-dynamic-7");
  clip.setAttribute("data-clip-start", "3");
  clip.setAttribute("data-clip-duration", "5");
  clip.getBoundingClientRect = () => ({ left: 10, width: 100, top: 0, right: 110, bottom: 20, height: 20, x: 10, y: 0, toJSON: () => ({}) });
  container.appendChild(clip);
  document.body.appendChild(container);
  return clip;
}

describe("useSplitMode localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("reports localized success while preserving the split time", () => {
    const clip = addTimelineClip();
    const onMessage = vi.fn();
    vi.mocked(EditingActions.splitAtPosition).mockReturnValue({ success: true });
    renderHook(() => useSplitMode({ enabled: true, onMessage }));

    fireEvent.pointerDown(clip, { button: 0, pointerType: "mouse", clientX: 60 });

    expect(EditingActions.splitAtPosition).toHaveBeenCalledWith("clip-dynamic-7", 5.5);
    expect(onMessage).toHaveBeenCalledWith("片段已在 5.50 秒处拆分");
  });

  it("uses the localized failure fallback", () => {
    const clip = addTimelineClip();
    const onMessage = vi.fn();
    vi.mocked(EditingActions.splitAtPosition).mockReturnValue({ success: false });
    renderHook(() => useSplitMode({ enabled: true, onMessage }));

    fireEvent.pointerDown(clip, { button: 0, pointerType: "mouse", clientX: 60 });

    expect(onMessage).toHaveBeenCalledWith("拆分失败");
  });
});
