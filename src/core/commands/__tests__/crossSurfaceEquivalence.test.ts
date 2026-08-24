import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipCommands } from "../clipCommands";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { EditingActions } from "@/core/interactions";
import type { Clip, Track } from "@/types";

vi.mock("@/lib/toast", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

let currentMockTime = 5;
vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({ time: currentMockTime }),
}));

describe("Cross-Surface Equivalence Tests (Toolbar vs Keyboard vs Context Menu)", () => {
  const createInitialState = () => ({
    tracks: [
      { id: "track-1", type: "video" as const, name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
      { id: "track-2", type: "video" as const, name: "Video 2", muted: false, locked: false, visible: true, height: 68 },
    ] as Track[],
    clips: [
      {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "asset-1",
        startTime: 0,
        duration: 10, // 0..10
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        volume: 1.0,
      } as Clip,
      {
        id: "clip-2",
        trackId: "track-1",
        mediaId: "asset-2",
        startTime: 12,
        duration: 8, // 12..20
        trimIn: 0,
        trimOut: 8,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
        volume: 1.0,
      } as Clip,
    ] as Clip[],
  });

  beforeEach(() => {
    clipboardService.clear();
    currentMockTime = 5;
    const initial = createInitialState();
    useTimelineStore.setState({
      ...initial,
      gaps: [],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1200,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
    });
    useHistoryStore.getState().clear();
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
      selectedGapId: null,
      selectedTrackId: null,
    });
  });

  it("produces identical resulting timeline state when splitting via Context Menu vs EditingActions (Keyboard/Toolbar)", () => {
    // 1. Execute split via Context Menu Command
    const splitMenuCmd = clipCommands.find((c) => c.id === "clip.splitAtPlayhead")!;
    expect(splitMenuCmd).toBeDefined();

    const menuCtx = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
    };

    splitMenuCmd.execute(menuCtx);

    const stateAfterMenu = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trimIn: c.trimIn,
      trimOut: c.trimOut,
      trackId: c.trackId,
    }));
    const selectionAfterMenu = [...useUIStore.getState().selectedClipIds];

    // Reset to identical initial state
    const initial2 = createInitialState();
    useTimelineStore.setState({
      ...initial2,
      gaps: [],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1200,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
    });
    useHistoryStore.getState().clear();
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
      selectedGapId: null,
      selectedTrackId: null,
    });

    // 2. Execute split via EditingActions (which is what Cmd+K / S shortcut and Toolbar call)
    EditingActions.splitSelectedAtPlayhead(["clip-1"]);

    const stateAfterDirect = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trimIn: c.trimIn,
      trimOut: c.trimOut,
      trackId: c.trackId,
    }));
    const selectionAfterDirect = [...useUIStore.getState().selectedClipIds];

    // Assert absolute parity across timeline clips and selection
    expect(stateAfterMenu).toEqual(stateAfterDirect);
    expect(selectionAfterMenu.length).toBe(1);
    expect(selectionAfterDirect.length).toBe(1);
    expect(stateAfterMenu.length).toBe(3); // clip-2 (duration 8), plus 2 split clips (duration 5 each)
    const splitClips = stateAfterMenu.filter((c) => c.duration === 5);
    expect(splitClips.length).toBe(2);
    // Only the right split segment is selected in both cases
    const menuClips = useTimelineStore.getState().clips;
    expect(selectionAfterDirect.every((id) => menuClips.some((c) => c.id === id))).toBe(true);
  });

  it("produces identical resulting timeline state when performing Ripple Delete across surfaces", () => {
    // 1. Menu-triggered ripple delete
    const rippleDeleteCmd = clipCommands.find((c) => c.id === "clip.rippleDelete")!;
    const menuCtx = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
    };
    rippleDeleteCmd.execute(menuCtx);

    const clipsAfterMenu = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    // Reset
    const initial2 = createInitialState();
    useTimelineStore.setState({
      ...initial2,
      gaps: [],
    });
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
    });

    // 2. Keyboard / Toolbar triggered ripple delete
    EditingActions.deleteSelection(["clip-1"], false);

    const clipsAfterDirect = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    expect(clipsAfterMenu).toEqual(clipsAfterDirect);
    expect(clipsAfterMenu.length).toBe(1);
    expect(clipsAfterMenu[0].startTime).toBe(2); // clip-2 shifted from 12 by 10s ripple = 2s
  });

  it("produces identical resulting timeline state when performing Lift Delete across surfaces", () => {
    // 1. Menu-triggered lift delete
    const liftDeleteCmd = clipCommands.find((c) => c.id === "clip.delete")!;
    const menuCtx = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
    };
    liftDeleteCmd.execute(menuCtx);

    const clipsAfterMenu = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    // Reset
    const initial2 = createInitialState();
    useTimelineStore.setState({
      ...initial2,
      gaps: [],
    });
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
    });

    // 2. Keyboard Alt+Delete triggered lift delete
    EditingActions.deleteSelection(["clip-1"], true);

    const clipsAfterDirect = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    expect(clipsAfterMenu).toEqual(clipsAfterDirect);
    expect(clipsAfterMenu.length).toBe(1);
    expect(clipsAfterMenu[0].startTime).toBe(12); // untouched (gap left in place)
  });

  it("produces identical duplication results via Context Menu, Toolbar, and Keyboard Shortcut", () => {
    // 1. Context Menu Duplicate
    const dupCmd = clipCommands.find((c) => c.id === "clip.duplicate")!;
    const menuCtx = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
    };
    dupCmd.execute(menuCtx);

    const clipsAfterMenu = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    // Reset
    clipboardService.clear();
    const initial2 = createInitialState();
    useTimelineStore.setState({
      ...initial2,
      gaps: [],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1200,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
    });
    useHistoryStore.getState().clear();
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
      selectedGapId: null,
      selectedTrackId: null,
    });

    // 2. Toolbar / Keyboard Shortcut duplicate
    clipboardService.duplicateClips(["clip-1"]);

    const clipsAfterShortcut = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    expect(clipsAfterMenu).toEqual(clipsAfterShortcut);
    expect(clipsAfterMenu.length).toBe(3);
    expect(clipsAfterMenu[2].startTime).toBe(20); // Placed at 20 (after clip-2 at 12..20 to prevent overlap)
  });

  it("produces identical Copy & Paste results across context menu and keyboard shortcut surfaces", () => {
    // 1. Copy via menu, Paste via menu at playhead 25s
    currentMockTime = 25;
    const copyCmd = clipCommands.find((c) => c.id === "clip.copy")!;
    const pasteCmd = clipCommands.find((c) => c.id === "clip.paste")!;

    const menuCtx = {
      selectedClipIds: ["clip-1", "clip-2"],
      clickedClipId: "clip-1",
      playheadTime: 25,
      clips: useTimelineStore.getState().clips,
      tracks: useTimelineStore.getState().tracks,
    };
    copyCmd.execute(menuCtx);
    pasteCmd.execute(menuCtx);

    const clipsAfterMenu = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    // Reset
    clipboardService.clear();
    const initial2 = createInitialState();
    useTimelineStore.setState({
      ...initial2,
      gaps: [],
    });
    useUIStore.setState({
      selectedClipIds: ["clip-1", "clip-2"],
    });

    // 2. Copy via shortcut (Cmd+C), Paste via shortcut (Cmd+V) at 25s
    clipboardService.copyClips(["clip-1", "clip-2"]);
    clipboardService.pasteClips(25);

    const clipsAfterShortcut = useTimelineStore.getState().clips.map((c) => ({
      startTime: c.startTime,
      duration: c.duration,
      trackId: c.trackId,
    }));

    expect(clipsAfterMenu).toEqual(clipsAfterShortcut);
    expect(clipsAfterMenu.length).toBe(4);
    // Preserves relative offset between clip-1 (start 0) and clip-2 (start 12)
    // Pasted clip-1 at 25, Pasted clip-2 at 25 + 12 = 37
    expect(clipsAfterMenu[2].startTime).toBe(25);
    expect(clipsAfterMenu[3].startTime).toBe(37);
  });
});
