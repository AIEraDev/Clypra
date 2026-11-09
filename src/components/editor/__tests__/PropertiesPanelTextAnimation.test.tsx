import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PropertiesPanel } from "../properties/core/PropertiesPanel";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { TextClip } from "@/types";

const mockTextClip: TextClip = {
  id: "test-text-1",
  kind: "text",
  trackId: "track-overlay-1",
  mediaId: "",
  startTime: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 4,
  x: 100,
  y: 200,
  width: 400,
  height: 120,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: false,
  text: "Hello Clypra Keyframes",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 48,
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#ffffff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
  paddingX: 16,
  paddingY: 16,
};

describe("PropertiesPanel text clip animation and transform keyframe integration", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      clips: [mockTextClip],
      tracks: [
        {
          id: "track-overlay-1",
          name: "Overlay",
          type: "video",
          locked: false,
          muted: false,
          visible: true,
          volume: 1,
          height: 64,
        },
      ],
      transitions: [],
    });
    useUIStore.setState({
      selectedClipIds: ["test-text-1"],
      selectedTransitionId: null,
    });
  });

  it("renders MotionPresetSection on the Animation tab instead of legacy TextAnimationControls", () => {
    render(<PropertiesPanel />);

    // Initially on "Text Style" tab
    expect(
      screen.getAllByText("Hello Clypra Keyframes").length,
    ).toBeGreaterThanOrEqual(1);

    // Click "Animation" tab
    const animationTabButton = screen.getByRole("button", {
      name: /Animation/i,
    });
    expect(animationTabButton).toBeDefined();
    fireEvent.click(animationTabButton);

    // Verify MotionPresetSection is rendered
    expect(screen.getByText("In")).toBeDefined();
    expect(screen.getByText("Out")).toBeDefined();
    expect(screen.getByText("Loop")).toBeDefined();

    // Verify legacy TextAnimationControls is NOT rendered
    expect(screen.queryByText("Entrance Animation")).toBeNull();
    expect(screen.queryByText("Exit Animation")).toBeNull();
  });

  it("renders TextTransformSection with spatial controls on Text Style tab", () => {
    render(<PropertiesPanel />);

    // Verify Transform section is present directly within Text Style tab (Basic sub-tab)
    expect(screen.getByText("Transform")).toBeDefined();
    expect(screen.getByText("Scale")).toBeDefined();
    expect(screen.getByText("Position")).toBeDefined();
    expect(screen.getByText("Plane rotation")).toBeDefined();
  });

  it("renders sticky duration footer in PropertiesPanel when text clip has an active in-preset", () => {
    useTimelineStore.setState({
      clips: [
        {
          ...mockTextClip,
          motion: {
            inPreset: "anim-in-flip-in",
            inDuration: 0.6,
          },
        },
      ],
    });

    render(<PropertiesPanel />);

    // Click "Animation" tab
    const animationTabButton = screen.getByRole("button", {
      name: /Animation/i,
    });
    fireEvent.click(animationTabButton);

    // Verify the sticky duration control is rendered in the footer
    expect(screen.getByText("Duration")).toBeDefined();
    expect(screen.getByText("0.6s")).toBeDefined();

    // Verify stepping duration updates the pill in UI
    const plusButton = screen.getByRole("button", {
      name: "Increase duration",
    });
    fireEvent.click(plusButton);
    expect(screen.getByText("0.7s")).toBeDefined();
  });

  it("hides sticky duration footer when text clip has no active animation preset on selected tab", () => {
    useTimelineStore.setState({
      clips: [
        {
          ...mockTextClip,
          motion: {
            inPreset: "none",
          },
        },
      ],
    });

    render(<PropertiesPanel />);

    // Click "Animation" tab
    const animationTabButton = screen.getByRole("button", {
      name: /Animation/i,
    });
    fireEvent.click(animationTabButton);

    // Verify duration is NOT rendered
    expect(screen.queryByText("Duration")).toBeNull();
  });
});
