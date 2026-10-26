import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioBasicTab } from "../audio/tabs/AudioBasicTab";
import type { Clip } from "@/types";

let mockClockTime = 0;
vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: mockClockTime,
    seek: vi.fn(),
  }),
}));

vi.mock("@/core/playback/PlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: mockClockTime,
    seek: vi.fn(),
  }),
}));

describe("AudioBasicTab Suite", () => {
  const baseClip: Clip = {
    id: "audio-clip-1",
    kind: "audio",
    trackId: "track-a1",
    mediaId: "media-a1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    opacity: 1,
    rotation: 0,
    volume: 0.8,
    fadeIn: 1.5,
    fadeOut: 2.0,
    audio: {
      audioModelVersion: 1,
      origin: "standalone",
      linkState: "linked",
      gainDb: 0,
      pan: 0.2,
      muted: false,
      volumeKeyframes: [],
      fadeIn: { duration: 1.5, curve: "linear" },
      fadeOut: { duration: 2.0, curve: "linear" },
      channelConfig: { mode: "auto", downmix: "auto" },
      speed: { preservePitch: true },
    },
  };

  beforeEach(() => {
    mockClockTime = 0;
    vi.clearAllMocks();
  });

  it("renders volume, fade in, fade out, and pan controls with initialized values", () => {
    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={vi.fn()} />);

    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("Fade in")).toBeInTheDocument();
    expect(screen.getByText("Fade out")).toBeInTheDocument();
    expect(screen.getByText("Pan")).toBeInTheDocument();

    const volumeInput = screen.getByRole("spinbutton", { name: "Volume" });
    expect((volumeInput as HTMLInputElement).value).toBe("100"); // gainDb 0 is unity (100%)
  });

  it("updates volume when numeric input or slider changes", () => {
    const handleUpdate = vi.fn();
    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getByRole("spinbutton", { name: "Volume" });
    fireEvent.focus(volumeInput);
    fireEvent.change(volumeInput, { target: { value: "65" } });
    fireEvent.blur(volumeInput);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 0.65);
  });

  it("toggles mute between 0 and 1.0", () => {
    const handleUpdate = vi.fn();
    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const muteBtn = screen.getByRole("button", { name: "Mute" });
    fireEvent.click(muteBtn);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 0);
  });

  it("resets volume to 1.0 (unity) on reset volume click", () => {
    const handleUpdate = vi.fn();
    render(
      <AudioBasicTab
        selectedClip={{ ...baseClip, volume: 0.4 }}
        handleUpdate={handleUpdate}
      />,
    );

    const resetBtn = screen.getByRole("button", { name: "Reset volume" });
    fireEvent.click(resetBtn);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 1.0);
  });

  it("resets fade in and fade out to 0 on reset click", () => {
    const handleUpdate = vi.fn();
    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const resetFadeInBtn = screen.getByRole("button", { name: "Reset fade in" });
    fireEvent.click(resetFadeInBtn);
    expect(handleUpdate).toHaveBeenCalledWith("fadeIn", 0);

    const resetFadeOutBtn = screen.getByRole("button", { name: "Reset fade out" });
    fireEvent.click(resetFadeOutBtn);
    expect(handleUpdate).toHaveBeenCalledWith("fadeOut", 0);
  });

  it("adjusts stereo pan and resets to 0 on reset pan click", () => {
    const handleUpdate = vi.fn();
    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const panInput = screen.getByRole("spinbutton", { name: "Pan" });
    fireEvent.focus(panInput);
    fireEvent.change(panInput, { target: { value: "-45" } });
    fireEvent.blur(panInput);

    expect(handleUpdate).toHaveBeenCalledWith("pan", -0.45);

    const resetPanBtn = screen.getByRole("button", { name: "Reset pan" });
    fireEvent.click(resetPanBtn);

    expect(handleUpdate).toHaveBeenCalledWith("pan", 0);
  });

  it("toggles volume keyframe at the current playhead position", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 2.5;

    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const addKeyframeBtn = screen.getByRole("button", {
      name: "Add keyframe for Volume",
    });
    fireEvent.click(addKeyframeBtn);

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    const [prop, keyframes] = handleUpdate.mock.calls[0];
    expect(prop).toBe("volumeKeyframes");
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].time).toBe(2.5);
  });
});
