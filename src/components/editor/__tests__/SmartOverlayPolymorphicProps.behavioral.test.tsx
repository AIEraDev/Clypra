import React from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SmartOverlaysTab } from "../sidebar/tabs/SmartOverlaysTab";
import { useTimelineStore } from "@/store/timelineStore";
import type { SmartOverlayClip } from "@/types/smartOverlay";

beforeEach(() => {
  const statClip: SmartOverlayClip = {
    id: "clip-stat-active",
    kind: "smart-overlay",
    overlayType: "stat",
    trackId: "animated-overlay",
    mediaId: "",
    startTime: 0,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    content: {
      type: "stat",
      data: { value: "+142%", label: "Active Revenue Growth" },
    },
    style: {
      presetId: "test",
      layout: "center-card",
      fontFamily: "Inter Variable",
      fontSize: 32,
      textColor: "#FFFFFF",
      highlightColor: "#10B981",
      cardBackgroundColor: "rgba(10, 15, 26, 0.9)",
      cardOpacity: 0.9,
      animationStyle: "scale-pop",
    },
  };

  useTimelineStore.setState({
    clips: [statClip],
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

describe("SmartOverlayPolymorphicProps Behavioral Test", () => {
  it("renders specialized input controls matching the active clip's overlayType and updates clip state", () => {
    render(<SmartOverlaysTab />);

    expect(screen.getByText(/Customize \(STAT\)/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("+142%")).toBeInTheDocument();

    const valInput = screen.getByDisplayValue("+142%");
    fireEvent.change(valInput, { target: { value: "+250%" } });

    const updatedClip = useTimelineStore.getState().clips[0] as SmartOverlayClip;
    expect(updatedClip.content.type).toBe("stat");
    if (updatedClip.content.type === "stat") {
      expect(updatedClip.content.data.value).toBe("+250%");
    }
  });
});
