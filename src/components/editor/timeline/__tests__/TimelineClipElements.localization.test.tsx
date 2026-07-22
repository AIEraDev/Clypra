import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioEnvelopeEditor } from "../AudioEnvelopeEditor";
import { ClipDragLayer } from "../ClipDragLayer";
import { TimelineWaveform } from "../TimelineWaveform";
import { TransitionIndicator } from "../TransitionIndicator";
import type { Clip, TransitionTimelineItem } from "@/types";

const mocks = vi.hoisted(() => ({
  dragLayer: { isDragging: true, currentOffset: { x: 120, y: 80 } },
  dragState: { draggingClip: null as any, grabOffsetX: 10, grabOffsetY: 5 },
  timeline: { pixelsPerSecond: 100, updateClip: vi.fn(), updateTransition: vi.fn() },
  project: { mediaAssets: [] as any[] },
  ui: { selectedTransitionId: null as string | null, selectTransition: vi.fn() },
  history: { execute: vi.fn() },
  invoke: vi.fn(),
}));

vi.mock("react-dnd", () => ({
  useDragLayer: () => mocks.dragLayer,
}));

vi.mock("@/store/dragStateStore", () => ({
  useDragStateStore: () => mocks.dragState,
}));

vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: (selector?: (state: typeof mocks.timeline) => unknown) => selector ? selector(mocks.timeline) : mocks.timeline,
}));

vi.mock("@/store/projectStore", () => ({
  useProjectStore: () => mocks.project,
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: (selector: (state: typeof mocks.ui) => unknown) => selector(mocks.ui),
}));

vi.mock("@/store/historyStore", () => ({
  useHistoryStore: () => mocks.history,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/core/platform", () => ({
  platform: { convertFileSrc: (path: string) => path },
}));

vi.mock("@/lib/platform/tauri", () => ({
  normalizePathForTauriInvoke: (path: string) => path,
}));

const createClip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip-audio",
  trackId: "track-1",
  mediaId: "media-1",
  startTime: 0,
  duration: 1,
  trimIn: 0,
  trimOut: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  ...overrides,
});

const createTransition = (type: string, id = "transition-original-id"): TransitionTimelineItem => ({
  id,
  kind: "transition",
  type: type as TransitionTimelineItem["type"],
  placement: { trackId: "track-1", startTime: 9.75, duration: 0.5, role: "effect", zIndex: 1 },
  effects: { effects: [], version: 1 },
  fromItemId: "from-original-id",
  toItemId: "to-original-id",
  alignment: "center",
  easing: "linear" as TransitionTimelineItem["easing"],
});

const transitionClips = {
  fromClip: { id: "from-original-id", startTime: 5, duration: 5 },
  toClip: { id: "to-original-id", startTime: 10, duration: 5 },
};

describe("timeline clip element localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dragLayer.isDragging = true;
    mocks.dragLayer.currentOffset = { x: 120, y: 80 };
    mocks.dragState.draggingClip = createClip();
    mocks.project.mediaAssets = [];
    mocks.ui.selectedTransitionId = null;
    mocks.invoke.mockRejectedValue(new Error("backend unavailable"));
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it("localizes the drag fallback and duration", () => {
    render(<ClipDragLayer />);

    expect(screen.getByText("片段")).toBeInTheDocument();
    expect(screen.getByText("1.0 秒")).toBeInTheDocument();
  });

  it("preserves the dragged media asset name", () => {
    mocks.project.mediaAssets = [{ id: "media-1", name: "客户 Clip.wav", type: "audio" }];

    render(<ClipDragLayer />);

    expect(screen.getByText("客户 Clip.wav")).toBeInTheDocument();
  });

  it("localizes audio envelope titles", () => {
    render(<AudioEnvelopeEditor clip={createClip({ volume: 0.5, fadeIn: 0.5, fadeOut: 0.4 })} clipWidthPx={100} pixelsPerSecond={100} />);

    expect(screen.getByTitle("淡入：0.5 秒")).toBeInTheDocument();
    expect(screen.getByTitle("淡出：0.4 秒")).toBeInTheDocument();
    expect(screen.getByTitle("双击重置音量")).toBeInTheDocument();
  });

  it.each([
    ["fadeIn", "淡入：0.5 秒", { clientX: 0, clientY: 0 }, { clientX: 25, clientY: 0 }, 0.6, "淡入：0.5 秒"],
    ["fadeOut", "淡出：0.4 秒", { clientX: 25, clientY: 0 }, { clientX: 0, clientY: 0 }, 0.5, "淡出：0.4 秒"],
    ["volume", "双击重置音量", { clientX: 0, clientY: 20 }, { clientX: 0, clientY: 12 }, 0.75, "音量：50%"],
  ] as const)("keeps the %s update payload and localizes its active label", (property, title, pointerDown, pointerMove, expectedValue, activeLabel) => {
    render(<AudioEnvelopeEditor clip={createClip({ volume: 0.5, fadeIn: 0.5, fadeOut: 0.4 })} clipWidthPx={100} pixelsPerSecond={100} />);

    const handle = screen.getByTitle(title);
    fireEvent.pointerDown(handle, { pointerId: 1, ...pointerDown });
    expect(screen.getByText(activeLabel)).toBeInTheDocument();

    fireEvent.pointerMove(handle.parentElement!, { pointerId: 1, ...pointerMove });
    expect(mocks.timeline.updateClip).toHaveBeenLastCalledWith("clip-audio", { [property]: expectedValue });
  });

  it("localizes the waveform error title", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<TimelineWaveform audioPath="/客户/audio.wav" clipWidthPx={100} duration={1} />);

    await waitFor(() => expect(screen.getByTitle("波形不可用")).toBeInTheDocument());
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it.each([
    ["fade", "淡入淡出转场（0.50 秒）"],
    ["dissolve", "溶解转场（0.50 秒）"],
    ["canvas", "画布转场（0.50 秒）"],
  ])("localizes the known %s transition title", (type, expected) => {
    render(<TransitionIndicator transition={createTransition(type)} pixelsPerSecond={100} {...transitionClips} />);

    expect(screen.getByTitle(expected)).toBeInTheDocument();
  });

  it.each(["custom-spin", "constructor", "toString", "__proto__"])("preserves the unknown transition type %s", (type) => {
    render(<TransitionIndicator transition={createTransition(type)} pixelsPerSecond={100} {...transitionClips} />);

    expect(screen.getByTitle(`${type}转场（0.50 秒）`)).toBeInTheDocument();
  });

  it("localizes the selected duration and preserves transition IDs during select and update", () => {
    const transition = createTransition("fade");
    mocks.ui.selectedTransitionId = transition.id;
    render(<TransitionIndicator transition={transition} pixelsPerSecond={100} {...transitionClips} />);

    const indicator = screen.getByTitle("淡入淡出转场（0.50 秒）");
    expect(screen.getByText("0.50 秒")).toBeInTheDocument();

    fireEvent.pointerDown(indicator, { button: 0, pointerType: "mouse", pointerId: 7, clientX: 100 });
    act(() => fireEvent.pointerMove(document, { pointerId: 7, clientX: 150 }));

    expect(mocks.ui.selectTransition).toHaveBeenCalledWith("transition-original-id");
    expect(mocks.timeline.updateTransition).toHaveBeenCalledWith("transition-original-id", {
      placement: { ...transition.placement, duration: 1, startTime: 9.5 },
    });
  });
});
