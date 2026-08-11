import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import type { SmartOverlayClip, Track } from "@/types";

describe("Overlay Track Auto-Pruning & Primary Track Protection", () => {
  beforeEach(() => {
    const mainVideoTrack: Track = {
      id: "v1-main",
      name: "Main Video Track",
      type: "video",
      muted: false,
      locked: false,
      visible: true,
      height: 68,
    };

    const overlayTrack: Track = {
      id: "overlay-track-2",
      name: "Secondary Smart Overlay Track",
      type: "animated-overlay",
      muted: false,
      locked: false,
      visible: true,
      height: 52,
    };

    const mainClip = {
      id: "clip-main-1",
      trackId: "v1-main",
      mediaId: "m1",
      name: "Main Video",
      kind: "video" as const,
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const overlayClip: SmartOverlayClip = {
      id: "clip-overlay-1",
      trackId: "overlay-track-2",
      mediaId: "",
      name: "Stat Overlay",
      kind: "smart-overlay",
      overlayType: "stat",
      startTime: 1,
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
        data: { value: "+142%", label: "Growth" },
      },
      style: {
        presetId: "hormozi-green",
        layout: "lower-third",
        fontFamily: "Inter",
        fontSize: 24,
        textColor: "#ffffff",
        highlightColor: "#00ff00",
        cardBackgroundColor: "rgba(0,0,0,0.8)",
        cardOpacity: 0.85,
        animationStyle: "scale-pop",
      },



    };

    useTimelineStore.setState({
      tracks: [mainVideoTrack, overlayTrack],
      clips: [mainClip, overlayClip],
      mainVideoTrackId: "v1-main",
    });
  });

  it("auto-deletes empty secondary animated-overlay track when its last clip is removed", () => {
    const store = useTimelineStore.getState();
    expect(store.tracks.length).toBe(2);

    // Delete overlay clip
    store.removeClip("clip-overlay-1");

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "clip-overlay-1")).toBeUndefined();
    // Secondary overlay track should be auto-pruned
    expect(state.tracks.find((t) => t.id === "overlay-track-2")).toBeUndefined();
    // Primary video track must remain preserved
    expect(state.tracks.find((t) => t.id === "v1-main")).toBeDefined();
  });

  it("preserves main video track even if all clips are deleted from it", () => {
    const store = useTimelineStore.getState();

    // Delete main clip
    store.removeClip("clip-main-1");

    const state = useTimelineStore.getState();
    // Main video track must NOT be auto-deleted
    expect(state.tracks.find((t) => t.id === "v1-main")).toBeDefined();
  });
});
