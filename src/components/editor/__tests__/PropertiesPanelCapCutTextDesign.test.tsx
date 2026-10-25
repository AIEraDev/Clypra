import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PropertiesPanel } from "../properties/core/PropertiesPanel";
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

  it("renders CapCut primary top navigation tabs: Text, Animation, Tracking, Text to speech, AI avatars (and excludes top Transform tab)", () => {
    render(<PropertiesPanel />);

    // Text tab
    expect(screen.getByRole("button", { name: /^Text$/i })).toBeDefined();

    // Animation tab
    expect(screen.getByRole("button", { name: /Animation/i })).toBeDefined();

    // Tracking tab
    expect(screen.getByRole("button", { name: /Tracking/i })).toBeDefined();

    // Text to speech tab
    expect(
      screen.getByRole("button", { name: /Text to speech/i }),
    ).toBeDefined();

    // AI avatars tab
    expect(screen.getByRole("button", { name: /AI avatars/i })).toBeDefined();

    // Top Transform tab is excluded for text clips
    expect(screen.queryByRole("button", { name: /^Transform$/i })).toBeNull();
  });

  it("switches to Animation, Tracking, Text to Speech, and AI Avatars tabs properly", () => {
    render(<PropertiesPanel />);

    // Switch to Animation tab
    fireEvent.click(screen.getByRole("button", { name: /Animation/i }));
    expect(screen.getByText("Motion & Animation")).toBeDefined();
    expect(screen.getByText("In")).toBeDefined();

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
    // Check sub-tabs: Basic, Bubble (Effects removed)
    expect(screen.getByRole("button", { name: /^Basic$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Bubble$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Effects$/i })).toBeNull();

    // Textarea displays clip content
    const textarea = screen.getByRole("textbox", {
      name: /Plain text content/i,
    });
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
    expect(screen.getAllByText("Color").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByTitle(
        /Add keyframe for Text Color|Remove keyframe for Text Color/i,
      ),
    ).toBeDefined();

    // Character and Line spacing
    expect(screen.getByText("Character")).toBeDefined();
    expect(screen.getByText("Line")).toBeDefined();

    // Save as preset button
    expect(
      screen.getByRole("button", { name: /Save as preset/i }),
    ).toBeDefined();
  });

  it("switches between Basic and Bubble sub-tabs while preserving sticky header textarea", async () => {
    render(<PropertiesPanel />);

    // Initially in Basic: textarea is present in sticky header
    expect(screen.getByLabelText("Plain text content")).toBeDefined();

    // Click Bubble sub-tab
    fireEvent.click(screen.getByRole("button", { name: /^Bubble$/i }));

    // Verify Sticky Header with textarea is preserved across tab switch!
    expect(screen.getByLabelText("Plain text content")).toBeDefined();

    // Verify Bubble section header and category filter
    expect(screen.getByText("Speech Bubbles")).toBeDefined();
    expect(screen.getByTitle("Filter by category")).toBeDefined();
    expect(screen.getByPlaceholderText("Search text bubbles...")).toBeDefined();

    // Verify authentic CapCut bubble preset cards
    expect(screen.getByTitle("None")).toBeDefined();
    expect(screen.getByTitle("Torn Paper")).toBeDefined();
    expect(screen.getByTitle("Lined Notebook")).toBeDefined();
    expect(screen.getByTitle("Comic BAM Burst")).toBeDefined();

    // Verify preset cards render on HTML5 Canvas rather than HTML document elements
    const presetCanvases = document.querySelectorAll(
      'canvas[data-bubble-preset-canvas="true"]',
    );
    expect(presetCanvases.length).toBeGreaterThan(5);

    // Apply Torn Paper preset
    fireEvent.click(screen.getByTitle("Torn Paper"));
    await new Promise((r) => setTimeout(r, 100));

    let clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.background).toBeDefined();
    expect(clip.background?.bubblePresetId).toBe("bubble-paper-torn");
    expect(clip.color).toBe("#ef4444");

    // Click None preset to reset
    fireEvent.click(screen.getByTitle("None"));
    await new Promise((r) => setTimeout(r, 100));

    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.background).toBeUndefined();

    // Effects sub-tab must NOT exist
    expect(screen.queryByRole("button", { name: /^Effects$/i })).toBeNull();

    // Switch back to Basic sub-tab
    fireEvent.click(screen.getByRole("button", { name: /^Basic$/i }));
    expect(screen.getByLabelText("Plain text content")).toBeDefined();
  });

  it("toggles Pattern buttons (Bold, Underline, Italic) and dispatches updates", async () => {
    render(<PropertiesPanel />);

    // Click Underline button
    const underlineBtn = screen.getByTitle("Underline");
    fireEvent.click(underlineBtn);

    // Allow debounce timer to flush
    await new Promise((r) => setTimeout(r, 200));

    // Verify clip in store was updated with textDecoration: underline
    const updatedClip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(updatedClip.textDecoration).toBe("underline");

    // Click Case TT button
    const uppercaseBtn = screen.getByTitle("Uppercase (ALL CAPS)");
    fireEvent.click(uppercaseBtn);

    await new Promise((r) => setTimeout(r, 200));

    const updatedClip2 = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
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

    const textLayer = scene.visualLayers.find(
      (l) => l.layerType === "text",
    ) as any;
    expect(textLayer).toBeDefined();
    expect(textLayer.text).toBe("HELLO WORLD");
    expect(textLayer.textTransform).toBe("uppercase");
    expect(textLayer.textDecoration).toBe("underline");
  });

  it("renders PRESET STYLE section with visual preset cards grid", () => {
    render(<PropertiesPanel />);

    // Section title
    expect(screen.getByText("PRESET STYLE")).toBeDefined();

    // Reset button (None)
    expect(screen.getByTitle("None")).toBeDefined();

    // Specific CapCut-parity presets rendered directly in responsive grid
    expect(screen.getByTitle("White with Black Outline")).toBeDefined();
    expect(screen.getByTitle("Yellow with Black Outline")).toBeDefined();
    expect(screen.getByTitle("Yellow Badge")).toBeDefined();
    expect(screen.getByTitle("Neon Pink Glow")).toBeDefined();
    expect(screen.getByTitle("Black with White Outline")).toBeDefined();
    expect(screen.getByTitle("White Badge with Purple Text")).toBeDefined();
    expect(screen.getByTitle("Black with Green 3D Extrusion")).toBeDefined();
    expect(screen.getByTitle("Neon Green Glow")).toBeDefined();
  });

  it("applies a preset style instantly updating color, stroke, shadow, and background", async () => {
    render(<PropertiesPanel />);

    // Click "Yellow with Black Outline"
    const yellowOutlineBtn = screen.getByTitle("Yellow with Black Outline");
    fireEvent.click(yellowOutlineBtn);

    await new Promise((r) => setTimeout(r, 200));

    const clipAfterStroke = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clipAfterStroke.color).toBe("#ffe600");
    expect(clipAfterStroke.stroke).toEqual({ color: "#000000", width: 3 });

    // Click "Yellow Badge"
    const yellowBadgeBtn = screen.getByTitle("Yellow Badge");
    fireEvent.click(yellowBadgeBtn);

    await new Promise((r) => setTimeout(r, 200));

    const clipAfterBadge = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clipAfterBadge.color).toBe("#000000");
    expect(clipAfterBadge.background).toEqual({
      color: "#ffd000",
      padding: 8,
      borderRadius: 6,
    });

    // Click "None" (Reset)
    const resetBtn = screen.getByTitle("None");
    fireEvent.click(resetBtn);

    await new Promise((r) => setTimeout(r, 200));

    const clipAfterReset = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clipAfterReset.color).toBe("#ffffff");
    expect(clipAfterReset.stroke).toBeUndefined();
    expect(clipAfterReset.shadow).toBeUndefined();
    expect(clipAfterReset.background).toBeUndefined();
  });

  it("renders CapCut Transform section under preset in Basic tab with full controls and alignment toolbar", () => {
    render(<PropertiesPanel />);

    // Transform accordion header & reset
    expect(screen.getByText("Transform")).toBeDefined();
    expect(screen.getByTitle("Reset transform")).toBeDefined();

    // Scale controls
    expect(screen.getByText("Scale")).toBeDefined();
    expect(screen.getByText("Uniform scale")).toBeDefined();

    // Position controls
    expect(screen.getByText("Position")).toBeDefined();
    expect(screen.getByText("X")).toBeDefined();
    expect(screen.getByText("Y")).toBeDefined();

    // Plane rotation controls
    expect(screen.getByText("Plane rotation")).toBeDefined();
    expect(screen.getByTitle("Drag to rotate")).toBeDefined();

    // Docked canvas alignment toolbar buttons
    expect(screen.getByTitle("Align left")).toBeDefined();
    expect(screen.getByTitle("Align center horizontally")).toBeDefined();
    expect(screen.getByTitle("Align right")).toBeDefined();
    expect(screen.getByTitle("Align top")).toBeDefined();
    expect(screen.getByTitle("Align center vertically")).toBeDefined();
    expect(screen.getByTitle("Align bottom")).toBeDefined();
    expect(screen.getByTitle("Distribute horizontally")).toBeDefined();
    expect(screen.getByTitle("Distribute vertically")).toBeDefined();
  });

  it("handles canvas alignment clicks and updates clip coordinates in store", async () => {
    render(<PropertiesPanel />);

    // Click "Align left" (|←)
    const alignLeftBtn = screen.getByTitle("Align left");
    fireEvent.click(alignLeftBtn);

    await new Promise((r) => setTimeout(r, 100));
    let clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.x).toBe(0);

    // Click "Align center horizontally" (┼) -> (1920 - 400) / 2 = 760
    const alignCenterXBtn = screen.getByTitle("Align center horizontally");
    fireEvent.click(alignCenterXBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.x).toBe(760);

    // Click "Align top" (╤)
    const alignTopBtn = screen.getByTitle("Align top");
    fireEvent.click(alignTopBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.y).toBe(0);

    // Click "Align center vertically" (+) -> (1080 - 120) / 2 = 480
    const alignCenterYBtn = screen.getByTitle("Align center vertically");
    fireEvent.click(alignCenterYBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.y).toBe(480);
  });

  it("resets transform properties when clicking reset button", async () => {
    render(<PropertiesPanel />);

    // Click Reset Transform button
    const resetBtn = screen.getByTitle("Reset transform");
    fireEvent.click(resetBtn);

    await new Promise((r) => setTimeout(r, 100));
    const clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.rotation).toBe(0);
    expect((clip as any).scale).toBe(1);
    expect(clip.width).toBe(400);
  });

  it("renders CapCut Stroke section with enable checkbox, color, thickness slider & stepper, and keyframe navigation", () => {
    render(<PropertiesPanel />);

    // Stroke accordion header & controls
    expect(screen.getByText("Stroke")).toBeDefined();
    expect(screen.getByTitle("Enable stroke")).toBeDefined();
    expect(screen.getByTitle("Reset stroke")).toBeDefined();
    expect(screen.getByText("Thickness")).toBeDefined();
  });

  it("toggles and updates Stroke properties in store", async () => {
    render(<PropertiesPanel />);

    // Toggle Stroke enable checkbox
    const enableStrokeBtn = screen.getByTitle("Enable stroke");
    fireEvent.click(enableStrokeBtn);

    await new Promise((r) => setTimeout(r, 100));
    let clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.stroke).toBeDefined();
    expect(clip.stroke?.width).toBe(40);

    // Reset stroke
    const resetStrokeBtn = screen.getByTitle("Reset stroke");
    fireEvent.click(resetStrokeBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.stroke).toEqual({ color: "#000000", width: 40 });
  });

  it("renders CapCut Background section with style cards, color, opacity, rounded rectangle, height, width, and y-offset", () => {
    render(<PropertiesPanel />);

    // Background accordion header & controls
    expect(screen.getByText("Background")).toBeDefined();
    expect(screen.getByTitle("Enable background")).toBeDefined();
    expect(screen.getByTitle("Reset background")).toBeDefined();

    // Style selector cards
    expect(screen.getByTitle("Rectangle")).toBeDefined();
    expect(screen.getByTitle("Split lines")).toBeDefined();

    // Sliders & inputs
    expect(screen.getByText("Opacity")).toBeDefined();
    expect(screen.getByText("Rounded rectangle")).toBeDefined();
    expect(screen.getByText("Height")).toBeDefined();
    expect(screen.getByText("Width")).toBeDefined();
    expect(screen.getByText("Y-offset")).toBeDefined();
  });

  it("toggles and updates Background properties in store", async () => {
    render(<PropertiesPanel />);

    // Toggle Background enable checkbox
    const enableBgBtn = screen.getByTitle("Enable background");
    fireEvent.click(enableBgBtn);

    await new Promise((r) => setTimeout(r, 100));
    let clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.background).toBeDefined();

    // Click "Split lines" card
    const splitLinesBtn = screen.getByTitle("Split lines");
    fireEvent.click(splitLinesBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect((clip.background as any)?.style).toBe("split");

    // Click "Rectangle" card
    const rectBtn = screen.getByTitle("Rectangle");
    fireEvent.click(rectBtn);

    await new Promise((r) => setTimeout(r, 100));
    clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect((clip.background as any)?.style).toBe("rectangle");
  });

  it("CLY-BUG-003: applying a bubble preset clears styleId and styleDefinition so bubble renders", async () => {
    useTimelineStore.setState({
      clips: [
        {
          ...mockTextClip,
          styleId: "neon-glow",
          styleDefinition: { id: "neon-glow" } as any,
        } as TextClip,
      ],
      tracks: [mockTrack],
      transitions: [],
    });

    render(<PropertiesPanel />);

    const bubbleTab = screen.getByRole("button", { name: /bubble/i });
    fireEvent.click(bubbleTab);

    const tornPaperBtn = screen.getByTitle("Torn Paper");
    fireEvent.click(tornPaperBtn);

    await new Promise((r) => setTimeout(r, 50));
    const clip = useTimelineStore
      .getState()
      .clips.find((c) => c.id === "test-text-capcut") as TextClip;
    expect(clip.background?.bubblePresetId).toBe("bubble-paper-torn");
    expect(clip.styleId).toBeUndefined();
    expect((clip as any).styleDefinition).toBeUndefined();
  });
});
