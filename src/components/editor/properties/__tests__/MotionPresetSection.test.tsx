import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionPresetSection } from "../shared/MotionPresetSection";
import type { TextClip } from "@/types";

const mockClip: TextClip = {
  id: "clip-test-1",
  kind: "text",
  trackId: "track-1",
  mediaId: "",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 100,
  y: 200,
  width: 400,
  height: 120,
  rotation: 0,
  opacity: 1,
  text: "Title Animation",
  fontFamily: "Inter Variable",
  fontSize: 48,
  color: "#ffffff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  paddingX: 16,
  paddingY: 16,
  motion: {},
};

describe("MotionPresetSection CapCut Parity & Kinematics", () => {
  it("renders In, Out, and Loop segmented tabs and defaults to In", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    expect(screen.getByRole("tab", { name: /In/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Out/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Loop/i })).toBeDefined();

    // In is active by default, showing starter presets
    expect(screen.getByText("None")).toBeDefined();
    expect(screen.getByText("Typewriter")).toBeDefined();
    expect(screen.getByText("Slide Up")).toBeDefined();
    expect(screen.getByText("Zoom In")).toBeDefined();
  });

  it("selects a preset and compiles motion keyframes", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Click "Typewriter" preset
    const typewriterCard = screen.getByText("Typewriter");
    fireEvent.click(typewriterCard);

    expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
    const payload = handleUpdateMultiple.mock.calls[0][0];
    expect(payload.motion.inPreset).toBe("typewriter");
    expect(payload.visualKeyframes).toBeDefined();
    expect(payload.visualKeyframes.opacity).toBeDefined();
  });

  it("filters presets using search bar", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    const searchInput = screen.getByPlaceholderText(
      /People are searching Typewriter/i,
    );
    expect(searchInput).toBeDefined();

    // Filter to "Glitch"
    fireEvent.change(searchInput, { target: { value: "Glitch" } });

    expect(screen.getByText("Glitch In")).toBeDefined();
    expect(screen.queryByText("Slide Up")).toBeNull();
    expect(screen.queryByText("Typewriter")).toBeNull();
  });

  it("filters presets using category pills", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Click "3D" pill
    const threeDPill = screen.getByText("3D");
    fireEvent.click(threeDPill);

    expect(screen.getByText("Flip In")).toBeDefined();
    expect(screen.queryByText("Typewriter")).toBeNull();
  });

  it("renders pinned duration bar with stepper and slider when preset is active", () => {
    const handleUpdateMultiple = vi.fn();
    const clipWithMotion: TextClip = {
      ...mockClip,
      motion: {
        inPreset: "slide-up",
        inDuration: 0.5,
      },
    };

    render(
      <MotionPresetSection
        selectedClip={clipWithMotion}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Duration bar is visible
    expect(screen.getByText("Duration")).toBeDefined();
    expect(screen.getByText("0.5s")).toBeDefined();

    // Click up arrow to step duration
    const slider = screen.getByRole("slider");
    expect(slider).toBeDefined();
    fireEvent.change(slider, { target: { value: "0.8" } });

    expect(handleUpdateMultiple).toHaveBeenCalled();
    const lastCall =
      handleUpdateMultiple.mock.calls[
        handleUpdateMultiple.mock.calls.length - 1
      ][0];
    expect(lastCall.motion.inDuration).toBe(0.8);
  });

  it("switches to Loop tab and provides speed and intensity controls", () => {
    const handleUpdateMultiple = vi.fn();
    const clipWithLoop: TextClip = {
      ...mockClip,
      motion: {
        loopPreset: "wave",
        loopSpeed: 1.0,
        loopIntensity: 1.0,
      },
    };

    render(
      <MotionPresetSection
        selectedClip={clipWithLoop}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Switch to Loop tab
    const loopTab = screen.getByRole("tab", { name: /Loop/i });
    fireEvent.click(loopTab);

    // Verify Loop presets are listed
    expect(screen.getByText("Wave")).toBeDefined();
    expect(screen.getByText("Float")).toBeDefined();
    expect(screen.getByText("Pulse")).toBeDefined();

    // Verify speed & intensity controls
    expect(screen.getByText("Speed")).toBeDefined();
    expect(screen.getByText("Intensity")).toBeDefined();
  });
});
