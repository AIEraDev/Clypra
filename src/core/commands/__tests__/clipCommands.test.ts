import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipCommands } from "../clipCommands";
import type { ClipCommandContext } from "../types";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, Track } from "@/types";

vi.mock("@/lib/toast", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({ time: 5 }),
}));

describe("clipCommands registry", () => {
  const sampleTracks: Track[] = [
    { id: "track-v1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
    { id: "track-v2-locked", type: "video", name: "Video 2 (Locked)", muted: false, locked: true, visible: true, height: 68 },
  ];

  const sampleClips: Clip[] = [
    {
      id: "clip-1",
      trackId: "track-v1",
      mediaId: "asset-1",
      startTime: 2,
      duration: 10, // 2s to 12s
      trimIn: 0,
      trimOut: 10,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    },
    {
      id: "clip-2",
      trackId: "track-v1",
      startTime: 15,
      duration: 5, // 15s to 20s
      trimIn: 0,
      trimOut: 5,
      mediaId: "asset-2",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    },
    {
      id: "clip-locked",
      trackId: "track-v2-locked",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      mediaId: "asset-3",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1.0,
    },
  ];

  beforeEach(() => {
    clipboardService.clear();
    useTimelineStore.setState({
      tracks: sampleTracks,
      clips: sampleClips,
      gaps: [],
      transitions: [],
      mainVideoTrackId: "track-v1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1200,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
    });
    useUIStore.setState({
      selectedClipIds: ["clip-1"],
      selectedGapId: null,
      selectedTrackId: null,
    });
  });

  it("evaluates clip.splitAtPlayhead correctly when playhead is inside vs outside clip", () => {
    const splitCmd = clipCommands.find((c) => c.id === "clip.splitAtPlayhead")!;
    expect(splitCmd).toBeDefined();

    // Playhead at 5s is inside clip-1 (2s..12s)
    const ctxInside: ClipCommandContext = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(splitCmd.isEnabled(ctxInside)).toBe(true);

    // Playhead at 14s is outside clip-1 (2s..12s) and clip-2 (15s..20s)
    const ctxOutside: ClipCommandContext = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 14,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(splitCmd.isEnabled(ctxOutside)).toBe(false);
    expect(splitCmd.disabledReason?.(ctxOutside)).toBe("Playhead is outside clip bounds");

    // Clip on locked track
    const ctxLocked: ClipCommandContext = {
      selectedClipIds: ["clip-locked"],
      clickedClipId: "clip-locked",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(splitCmd.isEnabled(ctxLocked)).toBe(false);
    expect(splitCmd.disabledReason?.(ctxLocked)).toBe("Clip is on a locked track");
  });

  it("evaluates clip.swap correctly: only enabled when exactly 2 clips are selected", () => {
    const swapCmd = clipCommands.find((c) => c.id === "clip.swap")!;
    expect(swapCmd).toBeDefined();

    const ctxOne: ClipCommandContext = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(swapCmd.isVisible(ctxOne)).toBe(false);
    expect(swapCmd.isEnabled(ctxOne)).toBe(false);

    const ctxTwo: ClipCommandContext = {
      selectedClipIds: ["clip-1", "clip-2"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(swapCmd.isVisible(ctxTwo)).toBe(true);
    expect(swapCmd.isEnabled(ctxTwo)).toBe(true);

    const ctxThree: ClipCommandContext = {
      selectedClipIds: ["clip-1", "clip-2", "clip-locked"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };
    expect(swapCmd.isVisible(ctxThree)).toBe(false);
    expect(swapCmd.isEnabled(ctxThree)).toBe(false);
  });

  it("evaluates clip.toggleMute and resets volume", () => {
    const muteCmd = clipCommands.find((c) => c.id === "clip.toggleMute")!;
    const ctx: ClipCommandContext = {
      selectedClipIds: ["clip-1"],
      clickedClipId: "clip-1",
      playheadTime: 5,
      clips: sampleClips,
      tracks: sampleTracks,
    };

    muteCmd.execute(ctx);
    const mutedClip = useTimelineStore.getState().clips.find((c) => c.id === "clip-1")!;
    expect(mutedClip.volume).toBe(0);

    muteCmd.execute(ctx);
    const unmutedClip = useTimelineStore.getState().clips.find((c) => c.id === "clip-1")!;
    expect(unmutedClip.volume).toBe(1.0);
  });

  it("handles copy, cut, paste, duplicate round-trip via clipboardService", () => {
    expect(clipboardService.hasClips()).toBe(false);

    // Copy clip-1
    clipboardService.copyClips(["clip-1"]);
    expect(clipboardService.hasClips()).toBe(true);
    expect(clipboardService.getClipCount()).toBe(1);

    // Paste at 25s
    const pastedIds = clipboardService.pasteClips(25, "track-v1");
    expect(pastedIds.length).toBe(1);
    const pasted = useTimelineStore.getState().clips.find((c) => c.id === pastedIds[0])!;
    expect(pasted).toBeDefined();
    expect(pasted.startTime).toBe(25);
    expect(pasted.duration).toBe(10);

    // Duplicate clip-2
    const dupIds = clipboardService.duplicateClips(["clip-2"]);
    expect(dupIds.length).toBe(1);
    const duplicated = useTimelineStore.getState().clips.find((c) => c.id === dupIds[0])!;
    expect(duplicated).toBeDefined();
    expect(duplicated.startTime).toBe(20); // clip-2 start (15) + duration (5) = 20
  });

  it("preserves full clip metadata through copy/paste and duplicate", () => {
    const audioTrack: Track = { id: "track-a1", type: "audio", name: "Audio", muted: false, locked: false, visible: true, height: 52 };
    const detachedAudio: Clip & { futureMetadata?: { preserve: boolean } } = {
      ...sampleClips[0],
      id: "detached-audio",
      trackId: audioTrack.id,
      kind: "audio",
      audioPath: "/media/source.mp4",
      detachedFromClipId: "clip-1",
      futureMetadata: { preserve: true },
    };
    const compound: Clip = {
      ...sampleClips[0],
      id: "compound-1",
      kind: "compound",
      mediaId: "compound-compound-1",
      name: "Compound (2 clips)",
      compoundPreview: "data:image/png;base64,preview",
      compoundChildren: [
        { ...sampleClips[0], id: "child-1", startTime: 0, duration: 2 },
        { ...sampleClips[1], id: "child-2", startTime: 4, duration: 1 },
      ],
    };

    useTimelineStore.setState({
      tracks: [...sampleTracks, audioTrack],
      clips: [detachedAudio, compound],
    });

    clipboardService.copyClips([detachedAudio.id]);
    const pastedAudioId = clipboardService.pasteClips(25, audioTrack.id)[0];
    const pastedAudio = useTimelineStore.getState().clips.find((clip) => clip.id === pastedAudioId) as Clip & { futureMetadata?: { preserve: boolean } };
    expect(pastedAudio).toMatchObject({
      kind: "audio",
      audioPath: "/media/source.mp4",
      detachedFromClipId: "clip-1",
      futureMetadata: { preserve: true },
    });

    clipboardService.copyClips([compound.id]);
    const pastedCompoundId = clipboardService.pasteClips(40, "track-v1")[0];
    const pastedCompound = useTimelineStore.getState().clips.find((clip) => clip.id === pastedCompoundId)!;
    expect(pastedCompound).toMatchObject({
      kind: "compound",
      compoundPreview: "data:image/png;base64,preview",
    });
    expect(pastedCompound.compoundChildren?.map((child) => child.id)).toEqual(["child-1", "child-2"]);

    const duplicatedAudioId = clipboardService.duplicateClips([detachedAudio.id])[0];
    const duplicatedAudio = useTimelineStore.getState().clips.find((clip) => clip.id === duplicatedAudioId)!;
    expect(duplicatedAudio).toMatchObject({
      kind: "audio",
      audioPath: "/media/source.mp4",
      detachedFromClipId: "clip-1",
      futureMetadata: { preserve: true },
    });
  });
});
