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
    expect(screen.getByText("Motion & Animation")).toBeDefined();
    expect(screen.getByText("In")).toBeDefined();
    expect(screen.getByText("Out")).toBeDefined();
    expect(screen.getByText("Loop")).toBeDefined();

    // Verify legacy TextAnimationControls is NOT rendered
    expect(screen.queryByText("Entrance Animation")).toBeNull();
    expect(screen.queryByText("Exit Animation")).toBeNull();
  });

  it("renders TransformSection with spatial keyframe controls when switching to Transform tab", () => {
    render(<PropertiesPanel />);

    // Click "Transform" tab
    const transformTabButton = screen.getByRole("button", {
      name: /Transform/i,
    });
    expect(transformTabButton).toBeDefined();
    fireEvent.click(transformTabButton);

    // Verify Transform section is present with keyframe nav controls
    expect(screen.getByText("Position")).toBeDefined();
    expect(screen.getByText("Size")).toBeDefined();
    expect(screen.getByText("Rotation")).toBeDefined();
    expect(screen.getByText("Opacity")).toBeDefined();
    expect(screen.getByTitle("Toggle Timeline Keyframe Lanes")).toBeDefined();

    // Keyframe diamond toggle buttons exist for transform properties
    const keyframeToggles = screen.getAllByTitle(/keyframe for/i);
    expect(keyframeToggles.length).toBeGreaterThanOrEqual(4);
  });
});
