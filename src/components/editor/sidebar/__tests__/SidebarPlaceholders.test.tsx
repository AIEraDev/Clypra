import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { Sidebar } from "../Sidebar";

// Mock heavier tabs to keep tests focused on placeholder routing
vi.mock("../tabs/MediaTab", () => ({
  MediaTab: () => <div data-testid="real-media-tab">Real Media Tab</div>,
}));

vi.mock("../tabs/AudioTab", () => ({
  AudioTab: () => <div data-testid="real-audio-tab">Real Audio Tab</div>,
}));

vi.mock("../tabs/TextTab", () => ({
  TextTab: () => <div data-testid="real-text-tab">Real Text Tab</div>,
}));

vi.mock("../tabs/CaptionsTab", () => ({
  CaptionsTab: () => <div data-testid="real-captions-tab">Real Captions Tab</div>,
}));

vi.mock("../tabs/SmartOverlaysTab", () => ({
  SmartOverlaysTab: () => <div data-testid="real-smart-overlays-tab">Real Smart Overlays Tab</div>,
}));

describe("Sidebar FeaturePlaceholders Integration", () => {
  it("renders real MediaTab when initial tab is media", () => {
    render(<Sidebar initialTab="media" />);
    expect(screen.getByTestId("real-media-tab")).toBeDefined();
    expect(screen.queryByText("Stickers are on the way")).toBeNull();
  });

  it("renders stickers placeholder when Stickers tab is clicked", () => {
    render(<Sidebar initialTab="media" />);
    const stickersTabButton = screen.getByRole("button", { name: /stickers/i });
    fireEvent.click(stickersTabButton);

    expect(screen.getByText("Stickers are on the way")).toBeDefined();
    expect(
      screen.getByText("Add animated stickers and emojis to your clips."),
    ).toBeDefined();
    expect(screen.queryByTestId("real-media-tab")).toBeNull();
  });

  it("renders effects placeholder when Effects tab is clicked", () => {
    render(<Sidebar initialTab="media" />);
    const effectsTabButton = screen.getByRole("button", { name: /effects/i });
    fireEvent.click(effectsTabButton);

    expect(screen.getByText("Effects are in development")).toBeDefined();
    expect(
      screen.getByText("Apply visual effects to clips and tracks."),
    ).toBeDefined();
  });

  it("renders filters placeholder when Filters tab is clicked", () => {
    render(<Sidebar initialTab="media" />);
    const filtersTabButton = screen.getByRole("button", { name: /filters/i });
    fireEvent.click(filtersTabButton);

    expect(screen.getByText("Filters are in development")).toBeDefined();
    expect(
      screen.getByText("Colour looks you can apply in one click."),
    ).toBeDefined();
  });

  it("renders transitions placeholder when Transitions tab is clicked", () => {
    render(<Sidebar initialTab="media" />);
    const transitionsTabButton = screen.getByRole("button", { name: /transitions/i });
    fireEvent.click(transitionsTabButton);

    expect(screen.getByText("More transitions are coming")).toBeDefined();
    expect(screen.getByText("Smooth cuts between clips.")).toBeDefined();
  });

  it("renders captions placeholder when Captions tab is clicked", () => {
    render(<Sidebar initialTab="media" />);
    const captionsTabButton = screen.getByRole("button", { name: /captions/i });
    fireEvent.click(captionsTabButton);

    expect(screen.getByText("Captions are planned")).toBeDefined();
    expect(
      screen.getByText("Generate and style subtitles for your video."),
    ).toBeDefined();
    expect(screen.queryByTestId("real-captions-tab")).toBeNull();
  });

  it("keeps functional tabs active (Media, Audio, Text)", () => {
    render(<Sidebar initialTab="media" />);

    // Audio
    const audioTabButton = screen.getByRole("button", { name: /audio/i });
    fireEvent.click(audioTabButton);
    expect(screen.getByTestId("real-audio-tab")).toBeDefined();

    // Text
    const textTabButton = screen.getByRole("button", { name: /text/i });
    fireEvent.click(textTabButton);
    expect(screen.getByTestId("real-text-tab")).toBeDefined();
  });
});
