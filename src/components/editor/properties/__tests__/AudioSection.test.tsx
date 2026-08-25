import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioSection } from "../AudioSection";
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
    render(<AudioSection selectedClip={{ ...baseAudioClip, fadeIn: 4, fadeOut: 3 } as Clip} handleUpdate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /fade/i }));

    const fadeInputs = screen.getAllByRole("spinbutton").slice(1);
    expect((fadeInputs[0] as HTMLInputElement).value).toBe("2.00");
    expect((fadeInputs[1] as HTMLInputElement).value).toBe("2.00");
  });

  it("writes fade values clamped to clip duration", () => {
    const handleUpdate = vi.fn();
    render(<AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: /fade/i }));
    const fadeInInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(fadeInInput, { target: { value: "4" } });

    expect(handleUpdate).toHaveBeenCalledWith("fadeIn", 2);
  });

  it("exposes editable volume automation in the property container", () => {
    const handleUpdate = vi.fn();
    render(<AudioSection selectedClip={{ ...baseAudioClip, volumeKeyframes: [{ id: "kf", time: 0.5, gain: 0.75 }] }} handleUpdate={handleUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: /volume automation/i }));
    fireEvent.change(screen.getByLabelText("Keyframe kf level"), { target: { value: "50" } });

    expect(handleUpdate).toHaveBeenCalledWith("volumeKeyframes", [{ id: "kf", time: 0.5, gain: 0.5 }]);
  });

  it("exposes channel routing and pitch preservation controls", () => {
    const handleUpdate = vi.fn();
    render(<AudioSection selectedClip={baseAudioClip} handleUpdate={handleUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: /channel & speed/i }));
    fireEvent.change(screen.getByLabelText("Channel mode"), { target: { value: "mono" } });
    fireEvent.click(screen.getByLabelText("Preserve pitch"));

    expect(handleUpdate).toHaveBeenCalledWith("audio", {
      channelConfig: { mode: "mono", downmix: "auto", channelMap: undefined },
    });
    expect(handleUpdate).toHaveBeenCalledWith("audio", { speed: { preservePitch: true } });
  });
});
