import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SmartOverlaysTab } from "../sidebar/tabs/SmartOverlaysTab";
import { useTimelineStore } from "@/store/timelineStore";
import type { SmartOverlayClip } from "@/types/smartOverlay";

beforeEach(() => {
  useTimelineStore.setState({
    clips: [],
    tracks: [
      {
        id: "animated-overlay",
        name: "Smart Overlays",
        type: "animated-overlay",
        muted: false,
        locked: false,
        visible: true,
        height: 56,
      },
    ],
  });
});

describe("SmartOverlayAutoDetectWorkflow Behavioral Test", () => {
  it("auto-detects multiple intent categories from speech and assigns overlapping clips to separate secondary tracks", async () => {
    const onAddToTimeline = vi.fn();
    render(<SmartOverlaysTab onAddToTimeline={onAddToTimeline} />);

    expect(screen.getByText("Universal Smart Overlays")).toBeInTheDocument();

    const autoDetectBtn = screen.getByRole("button", { name: /Auto-Detect & Generate Overlays/i });
    fireEvent.click(autoDetectBtn);

    await waitFor(() => {
      const state = useTimelineStore.getState();
      expect(state.clips.length).toBeGreaterThanOrEqual(3);
    });

    const clips = useTimelineStore.getState().clips as SmartOverlayClip[];

    // Verify clips of varying categories exist
    const hasStat = clips.some((c) => c.overlayType === "stat");
    const hasQuote = clips.some((c) => c.overlayType === "quote");
    const hasComp = clips.some((c) => c.overlayType === "comparison");

    expect(hasStat).toBe(true);
    expect(hasQuote).toBe(true);
    expect(hasComp).toBe(true);

    // Verify multi-track separation for overlapping clips ("when time overlaps separate")
    const trackIds = new Set(clips.map((c) => c.trackId));
    expect(trackIds.size).toBeGreaterThanOrEqual(2);
  });
});
