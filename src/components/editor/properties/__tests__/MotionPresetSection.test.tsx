import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionPresetSection } from "../shared/MotionPresetSection";
import type { TextClip } from "@/types";
import type { RemoteTextAnimationPreset } from "@/features/text-animations/animationCatalog";

const mockPresets: RemoteTextAnimationPreset[] = [
  {
    id: "typewriter",
    name: "Typewriter",
    phase: "in",
    category: "in",
    subCategory: "Basic",
    tags: ["text", "typing"],
    description: "Typewriter text reveal",
    defaultDuration: 0.8,
    icon: "Type",
    minDuration: 0.2,
    maxDuration: 3,
    previewLoopDuration: 1.2,
    tracks: [
      { property: "opacity", keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 1 }] },
    ],
  },
  {
    id: "slide-up",
    name: "Slide Up",
    phase: "in",
    category: "in",
    subCategory: "Motion",
    tags: ["slide", "up"],
    description: "Slide up into view",
    defaultDuration: 0.5,
    icon: "ArrowUp",
    minDuration: 0.1,
    maxDuration: 2,
    previewLoopDuration: 1.2,
    tracks: [
      { property: "translateY", keyframes: [{ progress: 0, value: 50 }, { progress: 1, value: 0 }] },
    ],
  },
  {
    id: "zoom-in",
    name: "Zoom In",
    phase: "in",
    category: "in",
    subCategory: "Motion",
    tags: ["zoom", "scale"],
    description: "Zoom in from center",
    defaultDuration: 0.5,
    icon: "Maximize",
    minDuration: 0.1,
    maxDuration: 2,
    previewLoopDuration: 1.2,
    tracks: [
      { property: "scale", keyframes: [{ progress: 0, value: 0.5 }, { progress: 1, value: 1 }] },
    ],
  },
  {
    id: "glitch-in",
    name: "Glitch In",
    phase: "in",
    category: "in",
    subCategory: "Glitch",
    tags: ["glitch", "digital"],
    description: "Digital glitch entrance",
    defaultDuration: 0.6,
    icon: "Zap",
    minDuration: 0.2,
    maxDuration: 2,
    previewLoopDuration: 1.2,
    tracks: [
      { property: "opacity", keyframes: [{ progress: 0, value: 0 }, { progress: 1, value: 1 }] },
    ],
  },
  {
    id: "flip-in",
    name: "Flip In",
    phase: "in",
    category: "in",
    subCategory: "3D",
    tags: ["flip", "3d"],
    description: "3D flip card",
    defaultDuration: 0.6,
    icon: "RotateCw",
    minDuration: 0.2,
    maxDuration: 2,
    previewLoopDuration: 1.2,
    tracks: [
      { property: "rotation", keyframes: [{ progress: 0, value: 90 }, { progress: 1, value: 0 }] },
    ],
  },
  {
    id: "wave",
    name: "Wave",
    phase: "loop",
    category: "loop",
    subCategory: "Motion",
    tags: ["wave", "ocean"],
    description: "Gentle wave motion",
    defaultDuration: 1.0,
    icon: "Activity",
    minDuration: 0.5,
    maxDuration: 5,
    previewLoopDuration: 1.0,
    tracks: [
      { property: "translateY", keyframes: [{ progress: 0, value: 0 }, { progress: 0.5, value: -10 }, { progress: 1, value: 0 }] },
    ],
  },
  {
    id: "float",
    name: "Float",
    phase: "loop",
    category: "loop",
    subCategory: "Motion",
    tags: ["float", "hover"],
    description: "Hovering floating motion",
    defaultDuration: 1.5,
    icon: "Wind",
    minDuration: 0.5,
    maxDuration: 5,
    previewLoopDuration: 1.5,
    tracks: [
      { property: "translateY", keyframes: [{ progress: 0, value: 0 }, { progress: 0.5, value: -5 }, { progress: 1, value: 0 }] },
    ],
  },
  {
    id: "pulse",
    name: "Pulse",
    phase: "loop",
    category: "loop",
    subCategory: "Basic",
    tags: ["pulse", "scale"],
    description: "Rhythmic pulse",
    defaultDuration: 0.8,
    icon: "Heart",
    minDuration: 0.4,
    maxDuration: 4,
    previewLoopDuration: 0.8,
    tracks: [
      { property: "scale", keyframes: [{ progress: 0, value: 1 }, { progress: 0.5, value: 1.05 }, { progress: 1, value: 1 }] },
    ],
  },
];

const useAnimationPhaseMock = vi.fn((phase: string, _enabled?: boolean) => ({
  presets: mockPresets.filter((p) => p.phase === phase),
  status: "ready",
}));

vi.mock("@/features/text-animations/animationCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/text-animations/animationCatalog")>();
  return {
    ...actual,
    useAnimationPhase: (phase: string, enabled?: boolean) =>
      useAnimationPhaseMock(phase, enabled),
    useTextAnimationCatalog: () => ({
      presets: mockPresets,
      phases: {
        in: { presets: mockPresets.filter((p) => p.phase === "in"), status: "ready" },
        out: { presets: mockPresets.filter((p) => p.phase === "out"), status: "ready" },
        loop: { presets: mockPresets.filter((p) => p.phase === "loop"), status: "ready" },
      },
      status: "ready",
    }),
  };
});

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
    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(1);
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

  it("clears legacy entranceAnimation and exitAnimation when compiling motion presets on a text clip", () => {
    const handleUpdateMultiple = vi.fn();
    const clipWithLegacyAnimations: TextClip = {
      ...mockClip,
      entranceAnimation: { type: "slide-up", duration: 0.5, easing: "ease-out" },
      exitAnimation: { type: "slide-down", duration: 0.5, easing: "ease-in" },
    };

    render(
      <MotionPresetSection
        selectedClip={clipWithLegacyAnimations}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    const typewriterCard = screen.getByText("Typewriter");
    fireEvent.click(typewriterCard);

    expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
    const payload = handleUpdateMultiple.mock.calls[0][0];
    expect(payload.motion.inPreset).toBe("typewriter");
    expect(payload.entranceAnimation).toBeUndefined();
    expect(payload.exitAnimation).toBeUndefined();
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

  it("filters presets using favorites toggle", () => {
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Filter by favorites before any favorite exists
    const favButton = screen.getByRole("button", { name: /Favorites/i });
    fireEvent.click(favButton);

    // None card is always present, but no preset cards match favorites
    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Slide Up")).toBeNull();
    expect(screen.queryByText("Typewriter")).toBeNull();

    // Toggle off favorites filter
    fireEvent.click(favButton);
    expect(screen.getByText("Typewriter")).toBeDefined();
    expect(screen.getByText("Slide Up")).toBeDefined();
  });

  it("keeps all three tab grids mounted in DOM with CSS visibility toggling", () => {
    const handleUpdateMultiple = vi.fn();
    const { container } = render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Check containers: one has 'contents', two have 'hidden'
    const contentsContainers = container.querySelectorAll(".contents");
    const hiddenContainers = container.querySelectorAll(".hidden");
    expect(contentsContainers.length).toBe(1);
    expect(hiddenContainers.length).toBe(2);

    // Switch to Out tab
    const outTab = screen.getByRole("tab", { name: /Out/i });
    fireEvent.click(outTab);

    // Still exactly 1 contents and 2 hidden
    const updatedContents = container.querySelectorAll(".contents");
    const updatedHidden = container.querySelectorAll(".hidden");
    expect(updatedContents.length).toBe(1);
    expect(updatedHidden.length).toBe(2);
  });

  it("delegates duration adjustment to panel footer and respects controlled tab props", () => {
    const handleUpdateMultiple = vi.fn();
    const onTabChange = vi.fn();
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
        activeTab="in"
        onTabChange={onTabChange}
      />,
    );

    // Duration is now rendered in the sticky footer of PropertiesPanel, not inlined in the section
    expect(screen.queryByText("Duration")).toBeNull();

    // Clicking out tab calls onTabChange
    const outButton = screen.getByRole("tab", { name: "Out" });
    fireEvent.click(outButton);
    expect(onTabChange).toHaveBeenCalledWith("out");
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

  it("only enables useAnimationPhase for tabs that have been visited (lazy gating)", () => {
    useAnimationPhaseMock.mockClear();
    const handleUpdateMultiple = vi.fn();
    render(
      <MotionPresetSection
        selectedClip={mockClip}
        handleUpdateMultiple={handleUpdateMultiple}
      />,
    );

    // Initial render: 'in' is enabled (true), while 'out' and 'loop' were not visited (false)
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("in", true);
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("out", false);
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("loop", false);

    useAnimationPhaseMock.mockClear();

    // Click Out tab
    const outTab = screen.getByRole("tab", { name: /Out/i });
    fireEvent.click(outTab);

    // Now 'in' remains enabled (true) and 'out' became enabled (true); 'loop' is still unvisited (false)
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("in", true);
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("out", true);
    expect(useAnimationPhaseMock).toHaveBeenCalledWith("loop", false);
  });
});
