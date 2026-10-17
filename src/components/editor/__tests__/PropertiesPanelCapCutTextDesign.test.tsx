import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PropertiesPanel } from "../PropertiesPanel";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { TextClip, Track, Project } from "@/types";
import { evaluateTimelineScene } from "@/core/evaluation/evaluator";

const mockTextClip: TextClip = {
  id: "test-text-capcut",
  kind: "text",
  trackId: "track-overlay-1",
  mediaId: "",
  startTime: 0,
  duration: 5,
  trimIn: 0,
  trimOut: 5,
  x: 100,
  y: 200,
  width: 400,
  height: 120,
  opacity: 1,
  rotation: 0,
  aspectRatioLocked: false,
  text: "Default Text\ndjdn",
  fontFamily: "Inter Variable",
  fontSize: 15,
  fontWeight: "bold",
  fontStyle: "normal",
  textDecoration: "none",
  textTransform: "none",
  color: "#ffffff",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
  paddingX: 16,
  paddingY: 16,
};

const mockTrack: Track = {
  id: "track-overlay-1",
  name: "Overlay",
  type: "video",
  locked: false,
  muted: false,
  visible: true,
  volume: 1,
  height: 64,
};

const mockProject: Project = {
  id: "test-project-1",
  name: "Test Project",
  duration: 10,
  frameRate: 30,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("CapCut Parity Text Property Panel", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      clips: [mockTextClip],
      tracks: [mockTrack],
      transitions: [],
    });
    useUIStore.setState({
      selectedClipIds: ["test-text-capcut"],
      selectedTransitionId: null,
    });
  });

  it("renders CapCut primary top navigation tabs: Text, Animation, Tracking, Text to speech, AI avatars", () => {
    render(<PropertiesPanel />);

    // Text tab
    expect(screen.getByRole("button", { name: /^Text$/i })).toBeDefined();

    // Animation tab
    expect(screen.getByRole("button", { name: /Animation/i })).toBeDefined();

    // Tracking tab
    expect(screen.getByRole("button", { name: /Tracking/i })).toBeDefined();

    // Text to speech tab
    expect(screen.getByRole("button", { name: /Text to speech/i })).toBeDefined();

    // AI avatars tab
    expect(screen.getByRole("button", { name: /AI avatars/i })).toBeDefined();
  });

  it("switches to Animation, Tracking, Text to Speech, and AI Avatars tabs properly", () => {
    render(<PropertiesPanel />);

    // Switch to Animation tab
    fireEvent.click(screen.getByRole("button", { name: /Animation/i }));
    expect(screen.getByText("Motion & Animation")).toBeDefined();
    expect(screen.getByText("In (Build-In)")).toBeDefined();

    // Switch to Tracking tab
    fireEvent.click(screen.getByRole("button", { name: /Tracking/i }));
    expect(screen.getByText("Motion Tracking")).toBeDefined();
    expect(screen.getByText("Start Tracking")).toBeDefined();

    // Switch to Text to speech tab
    fireEvent.click(screen.getByRole("button", { name: /Text to speech/i }));
    expect(screen.getByText(/Source Text/i)).toBeDefined();
    expect(screen.getByText("Generate Speech Audio")).toBeDefined();

    // Switch to AI avatars tab
    fireEvent.click(screen.getByRole("button", { name: /AI avatars/i }));
    expect(screen.getByText("AI Digital Presenter")).toBeDefined();
    expect(screen.getByText(/Choose Presenter/i)).toBeDefined();
    expect(screen.getByText("Generate AI Avatar Video")).toBeDefined();
  });

  it("renders CapCut Basic sub-tab with exact controls: textarea, Font, Font size, Pattern, Case, Color, Character, Line, and Save as preset", () => {
    render(<PropertiesPanel />);

    // Text tab should be active by default
    // Check sub-tabs: Basic, Bubble, Effects
    expect(screen.getByRole("button", { name: /^Basic$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Bubble$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Effects$/i })).toBeDefined();

    // Textarea displays clip content
    const textarea = screen.getByRole("textbox", { name: /Plain text content/i });
    expect((textarea as HTMLTextAreaElement).value).toBe("Default Text\ndjdn");

    // Font label & selector
    expect(screen.getByText("Font")).toBeDefined();

    // Font size label, range slider, stepper
    expect(screen.getByText("Font size")).toBeDefined();
    expect(screen.getAllByDisplayValue("15").length).toBeGreaterThanOrEqual(1);

    // Pattern label and B, U, I buttons
    expect(screen.getByText("Pattern")).toBeDefined();
    expect(screen.getByTitle("Bold")).toBeDefined();
    expect(screen.getByTitle("Underline")).toBeDefined();
    expect(screen.getByTitle("Italic")).toBeDefined();

    // Case label and TT, tt, Tt buttons
    expect(screen.getByText("Case")).toBeDefined();
    expect(screen.getByTitle("Uppercase (ALL CAPS)")).toBeDefined();
    expect(screen.getByTitle("Lowercase (all small)")).toBeDefined();
    expect(screen.getByTitle("Title Case (Capitalize Words)")).toBeDefined();

    // Color label and Keyframe diamond toggle
    expect(screen.getByText("Color")).toBeDefined();
    expect(screen.getByTitle(/Add keyframe for Text Color|Remove keyframe for Text Color/i)).toBeDefined();

    // Character and Line spacing
    expect(screen.getByText("Character")).toBeDefined();
    expect(screen.getByText("Line")).toBeDefined();

    // Save as preset button
    expect(screen.getByRole("button", { name: /Save as preset/i })).toBeDefined();
  });

  it("switches to Bubble and Effects sub-tabs", () => {
    render(<PropertiesPanel />);

    // Click Bubble sub-tab
    fireEvent.click(screen.getByRole("button", { name: /^Bubble$/i }));
    expect(screen.getByText("Speech Bubbles & Backgrounds")).toBeDefined();
    expect(screen.getByText("Speech Bubble")).toBeDefined();
    expect(screen.getByText("Dark Box")).toBeDefined();

    // Click Effects sub-tab
    fireEvent.click(screen.getByRole("button", { name: /^Effects$/i }));
    expect(screen.getByPlaceholderText("Search text effects...")).toBeDefined();
  });

  it("toggles Pattern buttons (Bold, Underline, Italic) and dispatches updates", async () => {
    render(<PropertiesPanel />);

    // Click Underline button
    const underlineBtn = screen.getByTitle("Underline");
    fireEvent.click(underlineBtn);

    // Allow debounce timer to flush
    await new Promise((r) => setTimeout(r, 200));

    // Verify clip in store was updated with textDecoration: underline
    const updatedClip = useTimelineStore.getState().clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(updatedClip.textDecoration).toBe("underline");

    // Click Case TT button
    const uppercaseBtn = screen.getByTitle("Uppercase (ALL CAPS)");
    fireEvent.click(uppercaseBtn);

    await new Promise((r) => setTimeout(r, 200));

    const updatedClip2 = useTimelineStore.getState().clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(updatedClip2.textTransform).toBe("uppercase");
  });

  it("evaluates text clip with textTransform in evaluator", () => {
    const uppercaseClip: TextClip = {
      ...mockTextClip,
      text: "hello world",
      textTransform: "uppercase",
      textDecoration: "underline",
    };

    const scene = evaluateTimelineScene(
      1.0,
      [uppercaseClip],
      [mockTrack],
      [],
      mockProject,
      [],
    );

    const textLayer = scene.visualLayers.find((l) => l.layerType === "text") as any;
    expect(textLayer).toBeDefined();
    expect(textLayer.text).toBe("HELLO WORLD");
    expect(textLayer.textTransform).toBe("uppercase");
    expect(textLayer.textDecoration).toBe("underline");
  });
});
