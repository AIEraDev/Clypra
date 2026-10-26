import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioSection } from "../audio/sections/AudioSection";
import type { Clip } from "@/types";

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
});
