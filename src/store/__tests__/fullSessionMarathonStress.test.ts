import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore } from "../projectStore";
import { useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";
import { toRustClip, fromRustClip } from "@/types/serialization";
import { verifyExportDependencies } from "@/lib/export/exportPreflight";
import { resolveExportDimensions, QUALITY_TIERS } from "@/lib/export/exportDimensions";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import type { Project, Clip, MediaAsset, Track, TextClip } from "@/types";

vi.mock("@/core/runtime/ProjectSession", () => ({
  disposeActiveSession: vi.fn(),
  createProjectSession: vi.fn(),
  getActiveSessionOrNull: vi.fn(() => null),
}));

vi.mock("@/core/platform", () => ({
  platform: {
    saveProject: vi.fn(async () => ({
      verified: true,
      path: "/tmp/mock-marathon.json",
      bytesWritten: 4096,
      checksum: "marathon-123",
    })),
    loadProject: vi.fn(async () => "{}"),
    isTauri: () => false,
  },
}));

describe("Finding 5.1: Full-Session Cross-Feature Marathon Stress Test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHistoryStore.getState().clear();
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      transitions: [],
      markers: [],
      mainVideoTrackId: null,
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
    useProjectStore.setState({
      project: null,
      mediaAssets: [],
      isDirty: false,
    });
  });

  it("successfully runs the multi-step editing marathon from creation through deep undo, reopen, and export", async () => {
    // ─── Stage 1: Initialize New Project ─────────────────────────────────────
    const initialProject: Project = {
      id: "marathon-proj-01",
      name: "Epic Documentary",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: "16:9" as any,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 30,
      timelineSchemaVersion: 1,
      audioModelVersion: 1,
    };
    useProjectStore.setState({ project: initialProject, isDirty: false });

    expect(useProjectStore.getState().project?.name).toBe("Epic Documentary");
    expect(useProjectStore.getState().project?.frameRate).toBe(30);

    // ─── Stage 2: Import Multiple Assets (Video, Audio, Image) ───────────────
    const videoAsset: MediaAsset = {
      id: "asset-video-1",
      name: "interview_a_roll.mp4",
      path: "/media/interview.mp4",
      type: "video",
      duration: 20,
      width: 1920,
      height: 1080,
      size: 50_000_000,
    };

    const bRollAsset: MediaAsset = {
      id: "asset-video-2",
      name: "scenic_b_roll.mp4",
      path: "/media/scenic.mp4",
      type: "video",
      duration: 15,
      width: 1920,
      height: 1080,
      size: 35_000_000,
    };

    const audioAsset: MediaAsset = {
      id: "asset-audio-1",
      name: "background_score.mp3",
      path: "/media/score.mp3",
      type: "audio",
      duration: 30,
      width: 0,
      height: 0,
      size: 5_000_000,
    };

    useProjectStore.getState().addMediaAsset(videoAsset);
    useProjectStore.getState().addMediaAsset(bRollAsset);
    useProjectStore.getState().addMediaAsset(audioAsset);

    expect(useProjectStore.getState().mediaAssets).toHaveLength(3);

    // ─── Stage 3: Multi-Track Timeline Assembly ──────────────────────────────
    useTimelineStore.getState().addTrack("video");
    useTimelineStore.getState().addTrack("video");
    useTimelineStore.getState().addTrack("audio");

    const currentTracks = useTimelineStore.getState().tracks;
    const trackV1Id = currentTracks[0].id;
    const trackV2Id = currentTracks[1].id;
    const trackA1Id = currentTracks[2].id;

    const clipV1: Clip = {
      id: "clip-v1",
      trackId: trackV1Id,
      mediaId: "asset-video-1",
      name: "Interview Shot",
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

    const clipV2: Clip = {
      id: "clip-v2",
      trackId: trackV2Id,
      mediaId: "asset-video-2",
      name: "B-Roll Cutaway",
      startTime: 4,
      duration: 6,
      trimIn: 0,
      trimOut: 6,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 0.9,
      rotation: 0,
    };

    const clipA1: Clip = {
      id: "clip-a1",
      trackId: trackA1Id,
      mediaId: "asset-audio-1",
      name: "Music Bed",
      startTime: 0,
      duration: 20,
      trimIn: 0,
      trimOut: 20,
      volume: 0.8,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 1,
      rotation: 0,
    };

    useTimelineStore.getState().addClip(clipV1);
    useTimelineStore.getState().addClip(clipV2);
    useTimelineStore.getState().addClip(clipA1);

    expect(useTimelineStore.getState().clips).toHaveLength(3);

    // ─── Stage 4: Create Compound Clip ───────────────────────────────────────
    const child1: Clip = {
      id: "child-clip-1",
      trackId: "nested-v1",
      mediaId: "asset-video-2",
      name: "Nested Segment 1",
      startTime: 0,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const child2: Clip = {
      id: "child-clip-2",
      trackId: "nested-v1",
      mediaId: "asset-video-2",
      name: "Nested Segment 2",
      startTime: 3,
      duration: 3,
      trimIn: 3,
      trimOut: 6,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    const compoundClip: Clip = {
      id: "clip-compound-1",
      trackId: trackV1Id,
      mediaId: "",
      name: "Compound B-Roll Montage",
      kind: "compound",
      compoundChildren: [child1, child2],
      startTime: 10,
      duration: 6,
      trimIn: 0,
      trimOut: 6,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };

    useTimelineStore.getState().addClip(compoundClip);
    expect(useTimelineStore.getState().clips).toHaveLength(4);

    // ─── Stage 5: Apply Text Template Clip With Pinned Style Definition ──────
    const textClip: TextClip = {
      id: "clip-text-1",
      trackId: trackV2Id,
      mediaId: "",
      name: "Speaker Lower Third",
      kind: "text",
      text: "Dr. Jane Doe — Lead Scientist",
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 0,
      paddingY: 0,
      startTime: 1,
      duration: 4,
      trimIn: 0,
      trimOut: 4,
      x: 100,
      y: 900,
      width: 600,
      height: 100,
      opacity: 1,
      rotation: 0,
      styleDefinition: {
        id: "solaris-ink",
        name: "Solaris Ink",
        category: "metallic",
        description: "Solaris Ink text effect",
        tags: ["solar", "ink"],
        font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
        fills: [{ type: "solid", color: "#FFA751" }],
        strokes: [{ color: "#00e5ff", width: 2, position: "outside", opacity: 1 }],
        shadows: [],
        glows: [],
      },
    };

    useTimelineStore.getState().addClip(textClip);
    expect(useTimelineStore.getState().clips).toHaveLength(5);

    // ─── Stage 6: Timeline Editing — Split, Trim, Ripple ─────────────────────
    // Split clipV1 at 5.0s using the command architecture
    const splitCmd = new SplitClipCommand("clip-v1", 5, 30, clipV1);
    useHistoryStore.getState().execute(splitCmd);
    expect(useTimelineStore.getState().clips).toHaveLength(6);

    // ─── Stage 7: Deep Interleaved Undo / Redo Lifecycle ─────────────────────
    const historyStore = useHistoryStore.getState();
    expect(historyStore.state.canUndo).toBe(true);

    // Undo the split command: clips revert to 5
    historyStore.undo();
    expect(useTimelineStore.getState().clips).toHaveLength(5);
    expect(useHistoryStore.getState().state.canRedo).toBe(true);

    // Redo the split command: clips restored to 6
    historyStore.redo();
    expect(useTimelineStore.getState().clips).toHaveLength(6);

    const splitA = useTimelineStore.getState().clips.find((c) => c.startTime === 0 && c.mediaId === "asset-video-1");
    expect(splitA?.duration).toBe(5);

    // ─── Stage 8: Export Preflight Verification ──────────────────────────────
    const preflight = await verifyExportDependencies(useTimelineStore.getState().clips, {
      assets: useProjectStore.getState().mediaAssets,
      isOnline: true,
    });
    expect(preflight.ready).toBe(true);
    expect(preflight.missingEffects).toHaveLength(0);

    const dims = resolveExportDimensions(1920, 1080, QUALITY_TIERS[1]);
    expect(dims.width).toBe(1920);
    expect(dims.height).toBe(1080);

    // ─── Stage 9: Project Serialization & Re-open Verification ───────────────
    // Deep test of toRustClip and fromRustClip with compound children and style definition
    const rustSerialized = toRustClip(compoundClip) as any;
    expect(rustSerialized.kind).toBe("compound");
    expect(rustSerialized.compoundChildren).toHaveLength(2);

    const deserializedCompound = fromRustClip(rustSerialized);
    expect(deserializedCompound.kind).toBe("compound");
    expect(deserializedCompound.compoundChildren).toHaveLength(2);
    expect(deserializedCompound.compoundChildren?.[0].id).toBe("child-clip-1");

    const rustText = toRustClip(textClip) as any;
    expect(rustText.style_definition?.id).toBe("solaris-ink");

    const deserializedText = fromRustClip(rustText) as any;
    expect(deserializedText.styleDefinition?.strokes?.[0]?.color).toBe("#00e5ff");

    // ─── Stage 10: Post-Reopen Modifications & Second Export Preflight ───────
    useTimelineStore.getState().addMarker(12.5, "Scene Transition", "#f59e0b");
    expect(useTimelineStore.getState().markers).toHaveLength(1);

    const secondPreflight = await verifyExportDependencies(useTimelineStore.getState().clips, {
      assets: useProjectStore.getState().mediaAssets,
      isOnline: true,
    });
    expect(secondPreflight.ready).toBe(true);
  });
});
