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

  // ── Regression: Defect 4 — handleVolumeChange must be keyframe-aware ───────
  it("[REGRESSION] volume slider updates existing keyframe gain when keyframes exist at playhead", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 3; // localTime = 3 - 0 = 3

    const clipWithKf: Clip = {
      ...baseClip,
      audio: {
        ...baseClip.audio!,
        volumeKeyframes: [
          { id: "vkf-1", time: 3, gain: 0.8 },
          { id: "vkf-2", time: 7, gain: 0.4 },
        ],
      },
    } as Clip;

    render(<AudioBasicTab selectedClip={clipWithKf} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getByRole("spinbutton", { name: "Volume" });
    fireEvent.focus(volumeInput);
    fireEvent.change(volumeInput, { target: { value: "60" } });
    fireEvent.blur(volumeInput);

    // Must update volumeKeyframes, NOT the plain volume prop
    const calls = handleUpdate.mock.calls;
    const volumeKeyframesCall = calls.find(([prop]) => prop === "volumeKeyframes");
    expect(volumeKeyframesCall).toBeDefined();
    const updatedKfs = volumeKeyframesCall![1];
    // The keyframe at t=3 should have its gain updated to 0.6
    const updatedKf = updatedKfs.find((k: any) => k.id === "vkf-1");
    expect(updatedKf).toBeDefined();
    expect(updatedKf.gain).toBeCloseTo(0.6, 5);
    // The other keyframe must remain untouched
    const otherKf = updatedKfs.find((k: any) => k.id === "vkf-2");
    expect(otherKf.gain).toBe(0.4);
  });

  it("[REGRESSION] volume slider inserts a new keyframe when keyframes exist but playhead is between them", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 5; // localTime = 5 (between t=3 and t=7)

    const clipWithKf: Clip = {
      ...baseClip,
      audio: {
        ...baseClip.audio!,
        volumeKeyframes: [
          { id: "vkf-1", time: 3, gain: 0.8 },
          { id: "vkf-2", time: 7, gain: 0.4 },
        ],
      },
    } as Clip;

    render(<AudioBasicTab selectedClip={clipWithKf} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getByRole("spinbutton", { name: "Volume" });
    fireEvent.focus(volumeInput);
    fireEvent.change(volumeInput, { target: { value: "70" } });
    fireEvent.blur(volumeInput);

    const calls = handleUpdate.mock.calls;
    const volumeKeyframesCall = calls.find(([prop]) => prop === "volumeKeyframes");
    expect(volumeKeyframesCall).toBeDefined();
    const updatedKfs = volumeKeyframesCall![1];
    // Should have inserted a new keyframe at t=5
    expect(updatedKfs).toHaveLength(3);
    const newKf = updatedKfs.find((k: any) => Math.abs(k.time - 5) < 0.1);
    expect(newKf).toBeDefined();
    expect(newKf.gain).toBeCloseTo(0.7, 5);
  });

  it("[REGRESSION] volume slider writes plain clip.volume when no keyframes exist (no regression on no-KF path)", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 2;

    render(<AudioBasicTab selectedClip={baseClip} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getByRole("spinbutton", { name: "Volume" });
    fireEvent.focus(volumeInput);
    fireEvent.change(volumeInput, { target: { value: "50" } });
    fireEvent.blur(volumeInput);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 0.5);
    // Must NOT write to volumeKeyframes
    const kfCall = handleUpdate.mock.calls.find(([prop]) => prop === "volumeKeyframes");
    expect(kfCall).toBeUndefined();
  });
});
