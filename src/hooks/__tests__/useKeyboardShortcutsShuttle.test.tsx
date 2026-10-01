import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";
import { useUIStore } from "@/store/uiStore";
import { useProjectStore } from "@/store/projectStore";
import * as PlaybackClockModule from "@/hooks/usePlaybackClock";

describe("useKeyboardShortcuts - J/K/L Shuttle Transport", () => {
  let mockPlay: ReturnType<typeof vi.fn>;
  let mockPause: ReturnType<typeof vi.fn>;
  let mockSetSpeed: ReturnType<typeof vi.fn>;
  let mockSeek: ReturnType<typeof vi.fn>;
  let mockTogglePlayback: ReturnType<typeof vi.fn>;
  let mockClock: {
    state: "playing" | "paused" | "stopped";
    speed: number;
    time: number;
    duration: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPlay = vi.fn(() => {
      mockClock.state = "playing";
    });
    mockPause = vi.fn(() => {
      mockClock.state = "paused";
    });
    mockSetSpeed = vi.fn((speed: number) => {
      mockClock.speed = speed;
    });
    mockSeek = vi.fn((time: number) => {
      mockClock.time = time;
    });
    mockTogglePlayback = vi.fn();

    mockClock = {
      state: "paused",
      speed: 1.0,
      time: 10.0,
      duration: 100.0,
    };

    vi.spyOn(PlaybackClockModule, "useTransportControls").mockReturnValue({
      play: mockPlay,
      pause: mockPause,
      setSpeed: mockSetSpeed,
      seek: mockSeek,
      stop: vi.fn(),
      togglePlayback: mockTogglePlayback,
      beginScrub: vi.fn(),
      updateScrub: vi.fn(),
      endScrub: vi.fn(),
      setActiveContext: vi.fn(),
    } as any);

    vi.spyOn(PlaybackClockModule, "getPlaybackClock").mockReturnValue(mockClock as any);
    useUIStore.setState({ previewMode: "program" });
    useProjectStore.setState({ project: { id: "p1", name: "Test", frameRate: 30, duration: 100 } as any });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pressing L while paused sets speed to 1x and starts playback", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true }));

    expect(mockSetSpeed).toHaveBeenCalledWith(1.0);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("pressing L while playing accelerates from 1x to 2x, then 4x", () => {
    mockClock.state = "playing";
    mockClock.speed = 1.0;
    renderHook(() => useKeyboardShortcuts());

    // First L press -> 2x
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true }));
    expect(mockSetSpeed).toHaveBeenCalledWith(2.0);

    // Second L press -> 4x
    mockClock.speed = 2.0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true }));
    expect(mockSetSpeed).toHaveBeenCalledWith(4.0);
  });

  it("pressing K pauses playback and resets speed to 1x", () => {
    mockClock.state = "playing";
    mockClock.speed = 4.0;
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true }));

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockSetSpeed).toHaveBeenCalledWith(1.0);
  });

  it("pressing J while playing decelerates: 4x -> 2x -> 1x -> pause", () => {
    mockClock.state = "playing";
    mockClock.speed = 4.0;
    renderHook(() => useKeyboardShortcuts());

    // J at 4x -> 2x
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));
    expect(mockSetSpeed).toHaveBeenCalledWith(2.0);

    // J at 2x -> 1x
    mockClock.speed = 2.0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));
    expect(mockSetSpeed).toHaveBeenCalledWith(1.0);

    // J at 1x -> pause + reset
    mockClock.speed = 1.0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockSetSpeed).toHaveBeenCalledWith(1.0);
  });

  it("pressing J while paused steps backward 1 frame", () => {
    mockClock.state = "paused";
    mockClock.time = 10.0;
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));

    expect(mockSeek).toHaveBeenCalledWith(
      expect.closeTo(10.0 - 1 / 30, 4),
      expect.objectContaining({ mode: "frameStep" })
    );
  });

  it("holding K and pressing L jogs forward 1 frame", () => {
    mockClock.state = "paused";
    mockClock.time = 10.0;
    renderHook(() => useKeyboardShortcuts());

    // Press down K
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true }));
    // Press L while K is down
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true }));

    expect(mockSeek).toHaveBeenCalledWith(
      expect.closeTo(10.0 + 1 / 30, 4),
      expect.objectContaining({ mode: "frameStep" })
    );
  });

  it("holding K and pressing J jogs backward 1 frame", () => {
    mockClock.state = "paused";
    mockClock.time = 10.0;
    renderHook(() => useKeyboardShortcuts());

    // Press down K
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true }));
    // Press J while K is down
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));

    expect(mockSeek).toHaveBeenCalledWith(
      expect.closeTo(10.0 - 1 / 30, 4),
      expect.objectContaining({ mode: "frameStep" })
    );
  });

  it("does not trigger J/K/L shuttle when typing in input", () => {
    renderHook(() => useKeyboardShortcuts());

    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true });
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);

    expect(mockPlay).not.toHaveBeenCalled();
    expect(mockSetSpeed).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("does not trigger J/K/L shuttle when Cmd/Ctrl modifier is held", () => {
    renderHook(() => useKeyboardShortcuts());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    expect(mockSetSpeed).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", ctrlKey: true, bubbles: true }));
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
