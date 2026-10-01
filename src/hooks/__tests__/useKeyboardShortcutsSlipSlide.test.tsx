import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";
import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
import { EditingActions } from "@/core/interactions/EditingActions";
import * as PlaybackClockModule from "@/hooks/usePlaybackClock";

describe("useKeyboardShortcuts - Slip and Slide Shortcuts", () => {
  let slipSpy: ReturnType<typeof vi.spyOn>;
  let slideSpy: ReturnType<typeof vi.spyOn>;

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

    slipSpy = vi.spyOn(EditingActions, "slipClip").mockReturnValue({ success: true, newTrimIn: 1, newTrimOut: 5 });
    slideSpy = vi.spyOn(EditingActions, "slideClip").mockReturnValue({ success: true, deltaApplied: 0.1 });

    useUIStore.setState({
      selectedClipIds: ["test-clip-1"],
      previewMode: "program",
    });
    useProjectStore.setState({
      project: { id: "p1", name: "Test", frameRate: 30, duration: 100 } as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pressing Y + ArrowRight slips selected clip 1 frame forward", () => {
    renderHook(() => useKeyboardShortcuts());

    // Press Y down
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }));
    // Press ArrowRight
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(slipSpy).toHaveBeenCalledTimes(1);
    expect(slipSpy).toHaveBeenCalledWith("test-clip-1", 1 / 30);
  });

  it("pressing Y + Shift + ArrowLeft slips selected clip 10 frames backward", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", shiftKey: true, bubbles: true }));

    expect(slipSpy).toHaveBeenCalledTimes(1);
    expect(slipSpy).toHaveBeenCalledWith("test-clip-1", -10 / 30);
  });

  it("pressing U + ArrowRight slides selected clip 1 frame right", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", code: "KeyU", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(slideSpy).toHaveBeenCalledTimes(1);
    expect(slideSpy).toHaveBeenCalledWith("test-clip-1", 1 / 30);
  });

  it("pressing U + Shift + ArrowLeft slides selected clip 10 frames left", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", code: "KeyU", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", shiftKey: true, bubbles: true }));

    expect(slideSpy).toHaveBeenCalledTimes(1);
    expect(slideSpy).toHaveBeenCalledWith("test-clip-1", -10 / 30);
  });

  it("does not trigger slip or slide when multiple clips are selected", () => {
    useUIStore.setState({ selectedClipIds: ["c1", "c2"] });
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(slipSpy).not.toHaveBeenCalled();
    expect(slideSpy).not.toHaveBeenCalled();
  });

  it("does not trigger slip or slide when typing in an input element", () => {
    renderHook(() => useKeyboardShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));

    expect(slipSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
