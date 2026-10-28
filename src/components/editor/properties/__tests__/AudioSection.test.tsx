import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AudioSection } from "../audio/sections/AudioSection";
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

const baseAudioClip: Clip = {
  id: "audio-1",
  kind: "audio",
  trackId: "track-1",
  mediaId: "audio-media",
  startTime: 0,
  duration: 2,
  trimIn: 0,
  trimOut: 2,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  volume: 1,
};

describe("AudioSection", () => {
  beforeEach(() => {
    mockClockTime = 0;
    vi.clearAllMocks();
  });

  it("displays fades clamped to clip duration", () => {
    render(
      <AudioSection
        selectedClip={{ ...baseAudioClip, fadeIn: 4, fadeOut: 3 } as Clip}
        handleUpdate={vi.fn()}
      />,
    );

    const fadeInputs = screen.getAllByRole("spinbutton").slice(1);
    expect((fadeInputs[0] as HTMLInputElement).value).toBe("2.00");
    expect((fadeInputs[1] as HTMLInputElement).value).toBe("2.00");
  });

  it("writes fade values clamped to clip duration", () => {
    const handleUpdate = vi.fn();
    render(
      <AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />,
    );

    const fadeInInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(fadeInInput, { target: { value: "4" } });
    fireEvent.blur(fadeInInput);

    expect(handleUpdate).toHaveBeenCalledWith("fadeIn", 2);
  });

  it("adjusts volume and toggles mute", () => {
    const handleUpdate = vi.fn();
    render(
      <AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />,
    );

    const volumeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(volumeInput, { target: { value: "50" } });
    fireEvent.blur(volumeInput);
    expect(handleUpdate).toHaveBeenCalledWith("volume", 0.5);

    const muteButton = screen.getByTitle("Mute");
    fireEvent.click(muteButton);
    expect(handleUpdate).toHaveBeenCalledWith("volume", 0);
  });

  it("writes fadeOut clamped to clip duration", () => {
    const handleUpdate = vi.fn();
    render(
      <AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />,
    );

    const fadeOutInput = screen.getAllByRole("spinbutton")[2];
    fireEvent.change(fadeOutInput, { target: { value: "3" } });
    fireEvent.blur(fadeOutInput);
    expect(handleUpdate).toHaveBeenCalledWith("fadeOut", 2);
  });

  // ── Regression: Defect 4 — AudioSection.handleVolumeChange keyframe-aware ─
  it("[REGRESSION] volume slider updates existing keyframe gain at playhead (AudioSection)", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 1; // localTime = 1 - 0 = 1

    const clipWithKf: Clip = {
      ...baseAudioClip,
      duration: 10,
      trimOut: 10,
      audio: {
        audioModelVersion: 1,
        origin: "standalone",
        linkState: "linked",
        gainDb: 0,
        pan: 0,
        muted: false,
        volumeKeyframes: [
          { id: "vkf-a", time: 1, gain: 0.9 },
          { id: "vkf-b", time: 5, gain: 0.3 },
        ],
        fadeIn: { duration: 0, curve: "linear" },
        fadeOut: { duration: 0, curve: "linear" },
        channelConfig: { mode: "auto", downmix: "auto" },
        speed: { preservePitch: true },
      },
    } as Clip;

    render(<AudioSection selectedClip={clipWithKf} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(volumeInput, { target: { value: "75" } });
    fireEvent.blur(volumeInput);

    // Must update volumeKeyframes, NOT plain volume
    const kfCall = handleUpdate.mock.calls.find(([prop]) => prop === "volumeKeyframes");
    expect(kfCall).toBeDefined();
    const updatedKfs = kfCall![1];
    const updatedKf = updatedKfs.find((k: any) => k.id === "vkf-a");
    expect(updatedKf).toBeDefined();
    expect(updatedKf.gain).toBeCloseTo(0.75, 5);
    // Other keyframe untouched
    expect(updatedKfs.find((k: any) => k.id === "vkf-b").gain).toBe(0.3);
  });

  it("[REGRESSION] volume slider writes plain volume when no keyframes exist (AudioSection)", () => {
    const handleUpdate = vi.fn();
    mockClockTime = 0.5;

    render(<AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />);

    const volumeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(volumeInput, { target: { value: "40" } });
    fireEvent.blur(volumeInput);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 0.4);
    const kfCall = handleUpdate.mock.calls.find(([prop]) => prop === "volumeKeyframes");
    expect(kfCall).toBeUndefined();
  });
});
