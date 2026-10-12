import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { AddClipCommand } from "@/core/history/commands";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";
import type { MediaAsset, Track } from "@/types";

describe("VFR Jitter Fixture & Timeline Source-Time Regression", () => {
  const fixturePath = "tests/fixtures/vfr_jitter.mp4";

  const videoTrack: Track = {
    id: "track-v1",
    name: "Video 1",
    type: "video",
    locked: false,
    muted: false,
    visible: true,
    height: 80,
  };

  beforeEach(() => {
    useTimelineStore.setState({
      clips: [],
      tracks: [videoTrack],
      gaps: [],
      epoch: 0,
      _batchDepth: 0,
    });
    useHistoryStore.getState().clear();
  });

  it("creates a timeline clip from the VFR fixture asset and maps monotonic source time", () => {
    const vfrAsset: MediaAsset = {
      id: "asset-vfr-1",
      name: "vfr_jitter.mp4",
      path: fixturePath,
      type: "video",
      duration: 0.8,
      width: 640,
      height: 360,
      size: 9604,
      streams: [
        {
          index: 0,
          type: "video",
          codec: "h264",
          width: 640,
          height: 360,
        },
      ],
    };

    const clip = createClipFromAsset({
      asset: vfrAsset,
      trackId: "track-v1",
      startTime: 1.0,
      width: 1920,
      height: 1080,
      fitMode: "contain",
    });

    expect(clip.mediaId).toBe("asset-vfr-1");
    expect(clip.startTime).toBe(1.0);
    expect(clip.duration).toBeCloseTo(0.8);
    expect(clip.trimIn).toBe(0);
    expect(clip.trimOut).toBeCloseTo(0.8);

    // Verify source time resolution across playback positions
    const times = [1.0, 1.2, 1.4, 1.6, 1.8];
    const sourceTimes = times.map((t) => resolveClipSourceTime(clip, t, { clampToRange: true }).sourceTime);

    // Source times must be strictly increasing
    for (let i = 1; i < sourceTimes.length; i++) {
      expect(sourceTimes[i]).toBeGreaterThan(sourceTimes[i - 1]);
    }
    expect(sourceTimes[0]).toBeCloseTo(0.0);
    expect(sourceTimes[sourceTimes.length - 1]).toBeCloseTo(0.8);

    // Out of bounds clamping
    const beforeClip = resolveClipSourceTime(clip, 0.5, { clampToRange: true }).sourceTime;
    expect(beforeClip).toBe(0.0);

    const afterClip = resolveClipSourceTime(clip, 2.5, { clampToRange: true }).sourceTime;
    expect(afterClip).toBeCloseTo(0.8);
  });

  it("adds VFR clip through AddClipCommand and maintains gap engine invariants", () => {
    const vfrAsset: MediaAsset = {
      id: "asset-vfr-2",
      name: "vfr_jitter.mp4",
      path: fixturePath,
      type: "video",
      duration: 0.8,
      width: 640,
      height: 360,
      size: 9604,
    };

    const clip = createClipFromAsset({
      asset: vfrAsset,
      trackId: "track-v1",
      startTime: 0.5, // starts at 0.5s -> introduces a gap from 0 to 0.5s
      width: 1920,
      height: 1080,
    });

    useHistoryStore.getState().execute(new AddClipCommand(clip));

    const state = useTimelineStore.getState();
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].id).toBe(clip.id);

    // Sync gaps to compute gaps for track
    state.detectAndSyncGaps("track-v1");
    const updatedState = useTimelineStore.getState();

    // Verify gaps: track starts with a 0.5s gap before the clip
    const trackGaps = updatedState.gaps.filter((g) => g.trackId === "track-v1");
    expect(trackGaps.length).toBe(1);
    expect(trackGaps[0].startTime).toBe(0);
    expect(trackGaps[0].duration).toBeCloseTo(0.5);

    // Invariant: no gap overlaps the active clip
    for (const gap of trackGaps) {
      const gapEnd = gap.startTime + gap.duration;
      const clipEnd = clip.startTime + clip.duration;
      const overlaps = gap.startTime < clipEnd && gapEnd > clip.startTime;
      expect(overlaps).toBe(false);
    }

    // Undo should restore clean state
    useHistoryStore.getState().undo();
    const stateAfterUndo = useTimelineStore.getState();
    expect(stateAfterUndo.clips.length).toBe(0);
  });
});
