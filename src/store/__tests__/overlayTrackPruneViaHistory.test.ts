/**
 * Repro test: Deleting an overlay clip via EditingActions (full history path)
 * should also remove the now-empty overlay track.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";
import { useUIStore } from "../uiStore";
import { EditingActions } from "@/core/interactions/EditingActions";
import type { SmartOverlayClip, Track } from "@/types";

describe("Overlay track auto-prune via EditingActions (full history path)", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useUIStore.setState({ selectedClipIds: [], selectedGapId: null, selectedTrackId: null });

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
      name: "Smart Overlays",
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
      content: { type: "stat", data: { value: "+142%", label: "Growth" } },
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
      gaps: [],
      transitions: [],
      mainVideoTrackId: "v1-main",
      epoch: 0,
    });
  });

  it("removes empty overlay track when last clip deleted via EditingActions (Delete key path)", () => {
    // Simulate selecting the overlay clip
    useUIStore.setState({ selectedClipIds: ["clip-overlay-1"] });

    expect(useTimelineStore.getState().tracks).toHaveLength(2);

    // Simulate the Delete key handler: EditingActions.deleteSelection(selectedClipIds, false)
    EditingActions.deleteSelection(["clip-overlay-1"], false);

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "clip-overlay-1")).toBeUndefined();
    // Overlay track must be auto-pruned
    expect(state.tracks.find((t) => t.id === "overlay-track-2")).toBeUndefined();
    // Main video track must remain
    expect(state.tracks.find((t) => t.id === "v1-main")).toBeDefined();
  });

  it("removes empty overlay track when deleted via lift (alt+delete path)", () => {
    useUIStore.setState({ selectedClipIds: ["clip-overlay-1"] });

    expect(useTimelineStore.getState().tracks).toHaveLength(2);

    EditingActions.deleteSelection(["clip-overlay-1"], true); // lift = true

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "clip-overlay-1")).toBeUndefined();
    expect(state.tracks.find((t) => t.id === "overlay-track-2")).toBeUndefined();
    expect(state.tracks.find((t) => t.id === "v1-main")).toBeDefined();
  });

  it("removes top video overlay track when its last image/video clip is deleted (reproducing user case)", () => {
    // Top overlay video track at index 0, main video track at index 1
    const overlayVideoTrack: Track = {
      id: "overlay-video-track",
      name: "Overlay Video",
      type: "video",
      muted: false,
      locked: false,
      visible: true,
      height: 60,
    };

    const mainVideoTrack: Track = {
      id: "v1-main",
      name: "Main Video Track",
      type: "video",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const audioTrack: Track = {
      id: "a1-main",
      name: "Audio Track",
      type: "audio",
      muted: false,
      locked: false,
      visible: true,
      height: 60,
    };

    const imageClip = {
      id: "clip-image-1",
      trackId: "overlay-video-track",
      mediaId: "m-image",
      name: "favicon.png",
      kind: "video" as const,
      startTime: 2,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const mainClip = {
      id: "clip-main-1",
      trackId: "v1-main",
      mediaId: "m-video",
      name: "Antler.mp4",
      kind: "video" as const,
      startTime: 0,
      duration: 89,
      trimIn: 0,
      trimOut: 89,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const audioClip = {
      id: "clip-audio-1",
      trackId: "a1-main",
      mediaId: "m-audio",
      name: "voice.mp3",
      kind: "audio" as const,
      startTime: 0,
      duration: 85,
      trimIn: 0,
      trimOut: 85,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 1,
      rotation: 0,
    };

    useTimelineStore.setState({
      tracks: [overlayVideoTrack, mainVideoTrack, audioTrack],
      clips: [imageClip, mainClip, audioClip],
      gaps: [],
      transitions: [],
      mainVideoTrackId: "v1-main",
      epoch: 0,
    });

    expect(useTimelineStore.getState().tracks).toHaveLength(3);

    // Delete the image clip on the top overlay video track
    EditingActions.deleteSelection(["clip-image-1"], false);

    const state = useTimelineStore.getState();
    expect(state.clips.find((c) => c.id === "clip-image-1")).toBeUndefined();
    // Top overlay video track MUST be auto-pruned
    expect(state.tracks.find((t) => t.id === "overlay-video-track")).toBeUndefined();
    // Main video track and audio track MUST remain
    expect(state.tracks.find((t) => t.id === "v1-main")).toBeDefined();
    expect(state.tracks.find((t) => t.id === "a1-main")).toBeDefined();
    expect(state.tracks).toHaveLength(2);
    expect(state.mainVideoTrackId).toBe("v1-main");
  });
});

