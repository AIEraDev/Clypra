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

  // ── Regression: fade max uses dynamic per-fade formula (not blunt duration/2) ──
  // Before fix: maxFadeSeconds = min(10, duration/2) — same cap for both fades.
  // After fix:  maxFadeIn = min(10, duration - fadeOut)  — grows as fadeOut shrinks.
  //             maxFadeOut = min(10, duration - fadeIn)

  it("[REGRESSION] displays fadeIn clamped to duration minus current fadeOut (not duration/2)", () => {
    // 10s clip, fadeIn=7s, fadeOut=0 → maxFadeIn = min(10, 10-0) = 10 → shows 7.0
    // Old formula: min(10, 10/2) = 5 → would have clamped to 5.0 (mismatch)
    render(
      <AudioSection
        selectedClip={
          {
            ...baseAudioClip,
            duration: 10,
            trimOut: 10,
            fadeIn: 7,
            fadeOut: 0,
          } as Clip
        }
        handleUpdate={vi.fn()}
      />,
    );

    const fadeInInput = screen.getAllByRole(
      "spinbutton",
    )[1] as HTMLInputElement;
    expect(parseFloat(fadeInInput.value)).toBeCloseTo(7, 1);
  });

  it("[REGRESSION] fadeIn and fadeOut caps are independent — each accounts for the other", () => {
    // 10s clip, fadeIn=3, fadeOut=0 → maxFadeOut = min(10, 10-3) = 7
    // Old formula: min(10, 10/2) = 5 → would cap maxFadeOut at 5
    const handleUpdate = vi.fn();
    render(
      <AudioSection
        selectedClip={
          {
            ...baseAudioClip,
            duration: 10,
            trimOut: 10,
            fadeIn: 3,
            fadeOut: 6,
          } as Clip
        }
        handleUpdate={handleUpdate}
      />,
    );

    // fadeOut=6 should display as 6, not be clamped to 5 (old formula)
    const fadeOutInput = screen.getAllByRole(
      "spinbutton",
    )[2] as HTMLInputElement;
    expect(parseFloat(fadeOutInput.value)).toBeCloseTo(6, 1);
  });

  it("[REGRESSION] fades are still clamped to prevent overlap on a short clip", () => {
    // 2s clip, fadeIn=4, fadeOut=3:
    // rawFadeIn=4, rawFadeOut=3 — both already exceed duration=2 individually.
    // maxFadeIn  = min(10, max(0, 2 - 3)) = 0
    // maxFadeOut = min(10, max(0, 2 - 4)) = 0
    // Both clamp to 0 because neither fits without the other already consuming
    // all available time. This is correct — no overlap is possible.
    render(
      <AudioSection
        selectedClip={{ ...baseAudioClip, fadeIn: 4, fadeOut: 3 } as Clip}
        handleUpdate={vi.fn()}
      />,
    );

    const fadeInInput = screen.getAllByRole(
      "spinbutton",
    )[1] as HTMLInputElement;
    const fadeOutInput = screen.getAllByRole(
      "spinbutton",
    )[2] as HTMLInputElement;
    expect(parseFloat(fadeInInput.value)).toBeCloseTo(0, 1);
    expect(parseFloat(fadeOutInput.value)).toBeCloseTo(0, 1);
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

    render(
      <AudioSection selectedClip={clipWithKf} handleUpdate={handleUpdate} />,
    );

    const volumeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(volumeInput, { target: { value: "75" } });
    fireEvent.blur(volumeInput);

    // Must update volumeKeyframes, NOT plain volume
    const kfCall = handleUpdate.mock.calls.find(
      ([prop]) => prop === "volumeKeyframes",
    );
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

    render(
      <AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />,
    );

    const volumeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(volumeInput, { target: { value: "40" } });
    fireEvent.blur(volumeInput);

    expect(handleUpdate).toHaveBeenCalledWith("volume", 0.4);
    const kfCall = handleUpdate.mock.calls.find(
      ([prop]) => prop === "volumeKeyframes",
    );
    expect(kfCall).toBeUndefined();
  });
});
