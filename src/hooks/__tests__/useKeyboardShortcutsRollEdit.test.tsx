import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";
import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { EditingActions } from "@/core/interactions/EditingActions";
import * as PlaybackClockModule from "@/hooks/usePlaybackClock";
import type { Clip } from "@/types";

const makeClip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  trackId: "track-1",
  mediaId: `media-${id}`,
  name: id,
  startTime,
  duration,
  trimIn: 0,
  trimOut: duration,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  opacity: 1,
  rotation: 0,
});

describe("useKeyboardShortcuts - Roll Edit Shortcuts", () => {
  let rollEditSpy: ReturnType<typeof vi.spyOn>;
  let rollEdgeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(PlaybackClockModule, "useTransportControls").mockReturnValue({
      play: vi.fn(),
      pause: vi.fn(),
      setSpeed: vi.fn(),
      seek: vi.fn(),
      stop: vi.fn(),
      togglePlayback: vi.fn(),
      beginScrub: vi.fn(),
      updateScrub: vi.fn(),
      endScrub: vi.fn(),
      setActiveContext: vi.fn(),
    } as any);

    vi.spyOn(PlaybackClockModule, "getPlaybackClock").mockReturnValue({
      state: "paused",
      speed: 1.0,
      time: 10.0,
      duration: 100.0,
    } as any);

    rollEditSpy = vi.spyOn(EditingActions, "rollEdit").mockReturnValue({ success: true, deltaApplied: 0.1 });
    rollEdgeSpy = vi.spyOn(EditingActions, "rollClipEdge").mockReturnValue({ success: true, deltaApplied: 0.1 });

    const c1 = makeClip("c1", 0, 10);
    const c2 = makeClip("c2", 10, 10);

    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
      clips: [c1, c2],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });

    useUIStore.setState({
      selectedClipIds: ["c1"],
      previewMode: "program",
    });
    useProjectStore.setState({
      project: { id: "p1", name: "Test", frameRate: 30, duration: 100 } as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pressing N + ArrowRight rolls selected clip cut point 1 frame right", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(rollEdgeSpy).toHaveBeenCalledTimes(1);
    expect(rollEdgeSpy).toHaveBeenCalledWith("c1", "outgoing", 1 / 30);
  });

  it("pressing N + Shift + ArrowLeft rolls selected clip cut point 10 frames left", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", shiftKey: true, bubbles: true }));

    expect(rollEdgeSpy).toHaveBeenCalledTimes(1);
    expect(rollEdgeSpy).toHaveBeenCalledWith("c1", "outgoing", -10 / 30);
  });

  it("pressing N + ArrowRight with 2 adjacent clips selected triggers rollEdit on both", () => {
    useUIStore.setState({ selectedClipIds: ["c1", "c2"] });
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(rollEditSpy).toHaveBeenCalledTimes(1);
    expect(rollEditSpy).toHaveBeenCalledWith("c1", "c2", 1 / 30);
  });

  it("does not trigger roll edit when typing in an input element", () => {
    renderHook(() => useKeyboardShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(rollEdgeSpy).not.toHaveBeenCalled();
    expect(rollEditSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
