import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PropertyPanelHeader from "../core/PropertyPanelHeader";
import type { TextPropertyTab, VideoPropertyTab, ImagePropertyTab, AudioPropertyTab } from "../types";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "properties.tabs.text": "Text",
        "properties.tabs.animation": "Animation",
        "properties.tabs.video": "Video",
        "properties.tabs.audio": "Audio",
        "properties.tabs.image": "Image",
        "properties.tabs.basic": "Basic",
        "properties.tabs.speed": "Speed",
        "properties.tabs.adjust": "Adjust",
        "properties.tabs.voiceChanger": "Voice changer",
      };
      return dict[key] || key;
    },
  }),
}));

describe("PropertyPanelHeader: Text Template & Clip Kind Tab Suite", () => {
  it("renders Text and Animation tabs and sets active tab to 'text' for text-template clips", () => {
    let activeTab: TextPropertyTab | null = null;
    const setActiveTab = vi.fn((tab) => {
      activeTab = tab;
    });

    const { rerender } = render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="text-template"
        activePropertyTab={activeTab}
        setActivePropertyTab={setActiveTab}
      />,
    );

    // Initial effect sets activePropertyTab
    expect(setActiveTab).toHaveBeenCalledWith("text");

    // Re-render with activePropertyTab now populated as in real parent
    rerender(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="text-template"
        activePropertyTab="text"
        setActivePropertyTab={setActiveTab}
      />,
    );

    // Verify tabs are rendered
    const textTabButton = screen.getByRole("button", { name: /^Text$/i });
    const animationTabButton = screen.getByRole("button", { name: /^Animation$/i });
    expect(textTabButton).toBeInTheDocument();
    expect(animationTabButton).toBeInTheDocument();

    // Clicking animation tab calls setActivePropertyTab with "animation"
    fireEvent.click(animationTabButton);
    expect(setActiveTab).toHaveBeenCalledWith("animation");
  });

  it("renders standard text tabs for plain text clips", () => {
    const setActiveTab = vi.fn();
    render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="text"
        activePropertyTab="text"
        setActivePropertyTab={setActiveTab}
      />,
    );

    expect(screen.getByRole("button", { name: /^Text$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Animation$/i })).toBeInTheDocument();
  });

  it("renders video tabs including audio when hasAudioTrack=true", () => {
    const setActiveTab = vi.fn();
    render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="video"
        activePropertyTab="video"
        setActivePropertyTab={setActiveTab}
        hasAudioTrack={true}
      />,
    );

    expect(screen.getByRole("button", { name: /^Video$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Audio$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Speed$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Adjust$/i })).toBeInTheDocument();
  });

  it("omits audio tab when video has no audio track (hasAudioTrack=false)", () => {
    const setActiveTab = vi.fn();
    render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="video"
        activePropertyTab="video"
        setActivePropertyTab={setActiveTab}
        hasAudioTrack={false}
      />,
    );

    expect(screen.getByRole("button", { name: /^Video$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Audio$/i })).not.toBeInTheDocument();
  });

  it("renders audio tabs (Basic, Speed, Voice changer) for audio clips", () => {
    const setActiveTab = vi.fn();
    render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="audio"
        activePropertyTab="basic"
        setActivePropertyTab={setActiveTab}
      />,
    );

    expect(screen.getByRole("button", { name: /^Basic$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Speed$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Voice changer$/i })).toBeInTheDocument();
  });

  it("renders image tabs (Image, Animation, Adjust) for image clips", () => {
    const setActiveTab = vi.fn();
    render(
      <PropertyPanelHeader
        collapsed={false}
        clipKind="image"
        activePropertyTab="image"
        setActivePropertyTab={setActiveTab}
      />,
    );

    expect(screen.getByRole("button", { name: /^Image$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Animation$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Adjust$/i })).toBeInTheDocument();
  });
});
