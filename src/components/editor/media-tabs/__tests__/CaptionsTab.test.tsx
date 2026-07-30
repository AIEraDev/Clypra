import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CaptionsTab } from "../CaptionsTab";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("CaptionsTab Component Integration Tests", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-text-1", type: "text", name: "Auto Captions", height: 40, locked: false, visible: true, muted: false } as any,
      ],
      clips: [
        {
          id: "caption-clip-1",
          kind: "text",
          trackId: "track-text-1",
          startTime: 0,
          duration: 3,
          trimIn: 0,
          trimOut: 3,
          text: "Hello World Caption",
        } as any,
      ],
    });

    useProjectStore.setState({
      project: {
        id: "proj-1",
        name: "Test Project",
        createdAt: 1000,
        updatedAt: 1000,
        frameRate: 30,
        canvasWidth: 1920,
        canvasHeight: 1080,
        mediaAssets: [],
        clips: [],
        tracks: [],
      } as any,
    });
  });

  it("renders caption clips and batch style buttons", () => {
    render(<CaptionsTab />);

    expect(screen.getByText("Import Subtitles")).toBeDefined();
    expect(screen.getByText("Export SRT")).toBeDefined();
    expect(screen.getByText(/Batch Style Presets/)).toBeDefined();
    expect(screen.getByText("Welcome to Clypra Studio")).toBeDefined();
  });

  it("adds manual caption clip on button click", () => {
    render(<CaptionsTab />);

    const addButton = screen.getByText("Add Manual Caption");
    fireEvent.click(addButton);

    const clips = useTimelineStore.getState().clips;
    expect(clips.length).toBe(2);
  });

  it("applies batch style preset to all caption clips", () => {
    render(<CaptionsTab />);

    const yellowPresetBtn = screen.getByText("Classic Yellow Bold");
    fireEvent.click(yellowPresetBtn);

    const clip = useTimelineStore.getState().clips.find((c) => c.id === "caption-clip-1") as any;
    expect(clip.fillColor).toBe("#FFE600");
    expect(clip.strokeColor).toBe("#000000");
  });
});
