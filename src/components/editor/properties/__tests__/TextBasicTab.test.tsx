import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextBasicTab } from "../text/tabs/TextBasicTab";
import type { TextClip } from "@/types";

// Mock i18n
vi.mock("@/i18n", () => {
  const dict: Record<string, string> = {
    "properties.stroke.title": "Stroke",
    "properties.stroke.reset": "Reset stroke",
    "properties.background.title": "Background",
    "properties.background.reset": "Reset background",
  };
  return {
    useI18n: () => ({
      t: (key: string) => dict[key] || key,
    }),
    useTranslation: () => ({
      t: (key: string) => dict[key] || key,
    }),
  };
});

// Mock PlaybackClock
vi.mock("@/core/playback/PlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 0,
    seek: vi.fn(),
  }),
}));

// Mock Project Store
vi.mock("@/store/projectStore", () => ({
  useProjectStore: vi.fn((selector) => {
    const state = {
      project: { canvasWidth: 1920, canvasHeight: 1080 },
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// Mock FontLoader
vi.mock("@/core/fonts/FontLoader", () => ({
  getFontLoader: () => ({
    prewarmRemainingFontsOnIdle: vi.fn(),
  }),
}));

// Mock NativeFontRegistry
vi.mock("@/core/fonts/nativeFontRegistry", () => ({
  getBundledNativeFontIds: () => ["inter variable", "roboto"],
  prewarmNativeFontsOnIdle: vi.fn(),
}));

// Mock ColorPicker
vi.mock("@clypra/ui-color-picker", () => ({
  ClypraColorPicker: () => <div data-testid="color-picker-mock" />,
}));

describe("TextBasicTab Suite", () => {
  const baseTextClip: TextClip = {
    id: "text-clip-1",
    kind: "text",
    trackId: "track-t1",
    mediaId: "text-media",
    text: "Sample Heading",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 100,
    y: 100,
    width: 400,
    height: 120,
    fontSize: 48,
    fontFamily: "Inter Variable",
    fontWeight: 400,
    fontStyle: "normal",
    color: "#ffffff",
    align: "center",
    valign: "middle",
    paddingX: 0,
    paddingY: 0,
    letterSpacing: 0,
    lineHeight: 1.2,
    opacity: 1,
    rotation: 0,
    stroke: { color: "#000000", width: 0 },
    background: null as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof TextBasicTab>> = {}) => {
    const handleUpdate = vi.fn();
    const handleCustomStyleUpdate = vi.fn();
    const handleUpdateMultiple = vi.fn();

    render(
      <TextBasicTab
        textClip={baseTextClip}
        newPresetName=""
        currentWeight={400}
        effectiveFontStyle="normal"
        effectiveLetterSpacing={0}
        effectiveLineHeight={1.2}
        applyToAll={false}
        setApplyToAll={vi.fn()}
        alignExpanded={true}
        setAlignExpanded={vi.fn()}
        strokeExpanded={true}
        setStrokeExpanded={vi.fn()}
        shadowExpanded={false}
        setShadowExpanded={vi.fn()}
        backgroundExpanded={true}
        setBackgroundExpanded={vi.fn()}
        handleUpdate={handleUpdate}
        handleCustomStyleUpdate={handleCustomStyleUpdate}
        handleUpdateMultiple={handleUpdateMultiple}
        savePreset={vi.fn()}
        {...props}
      />,
    );

    return { handleUpdate, handleCustomStyleUpdate, handleUpdateMultiple };
  };

  it("renders font selector, font size, pattern buttons, and alignment options", () => {
    renderComponent();

    expect(screen.getByText("Font")).toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("Pattern")).toBeInTheDocument();
    expect(screen.getByText("Alignments")).toBeInTheDocument();
  });

  it("updates font size via number input", () => {
    const { handleCustomStyleUpdate } = renderComponent();

    const sizeInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(sizeInput, { target: { value: "64" } });

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("fontSize", 64);
  });

  it("toggles bold font weight between 700 and 400", () => {
    const { handleCustomStyleUpdate } = renderComponent({ currentWeight: 400 });

    const boldBtn = screen.getByRole("button", { name: "B" });
    fireEvent.click(boldBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("fontWeight", 700);
  });

  it("toggles underline text decoration", () => {
    const { handleCustomStyleUpdate } = renderComponent();

    const underlineBtn = screen.getByRole("button", { name: "U" });
    fireEvent.click(underlineBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("textDecoration", "underline");
  });

  it("toggles italic font style", () => {
    const { handleCustomStyleUpdate } = renderComponent({ effectiveFontStyle: "normal" });

    const italicBtn = screen.getByRole("button", { name: "I" });
    fireEvent.click(italicBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("fontStyle", "italic");
  });

  it("toggles uppercase text transform", () => {
    const { handleCustomStyleUpdate } = renderComponent();

    const uppercaseBtn = screen.getByRole("button", { name: "TT" });
    fireEvent.click(uppercaseBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("textTransform", "uppercase");
  });

  it("dispatches horizontal alignment updates", () => {
    const { handleUpdate } = renderComponent();

    const leftAlignBtn = screen.getByRole("button", { name: "Align left" });
    fireEvent.click(leftAlignBtn);
    expect(handleUpdate).toHaveBeenCalledWith("align", "left");
  });

  it("dispatches vertical alignment updates", () => {
    const { handleUpdate } = renderComponent();

    const topAlignBtn = screen.getByRole("button", { name: "Align top" });
    fireEvent.click(topAlignBtn);
    expect(handleUpdate).toHaveBeenCalledWith("valign", "top");
  });

  it("resets stroke settings on stroke reset button click", () => {
    const { handleCustomStyleUpdate } = renderComponent();

    const resetStrokeBtn = screen.getByRole("button", { name: "Reset stroke" });
    fireEvent.click(resetStrokeBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("stroke", {
      color: "#000000",
      width: 40,
    });
  });

  it("resets background settings on background reset button click", () => {
    const { handleCustomStyleUpdate } = renderComponent();

    const resetBgBtn = screen.getByRole("button", { name: "Reset background" });
    fireEvent.click(resetBgBtn);

    expect(handleCustomStyleUpdate).toHaveBeenCalledWith("background", {
      color: "#000000",
      opacity: 100,
      borderRadius: 0,
      padding: 8,
      height: 14,
      width: 14,
      yOffset: 50,
      style: "rectangle",
    });
  });
});
