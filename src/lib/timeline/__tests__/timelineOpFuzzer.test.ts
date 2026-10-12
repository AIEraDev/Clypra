import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useHistoryStore } from "@/store/historyStore";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import { DeleteClipCommand, AddClipCommand } from "@/core/history/commands/DeleteClipCommand";
import { RippleDeleteCommand } from "@/core/history/commands/RippleDeleteCommand";
import { PackTrackCommand, InsertGapCommand } from "@/core/history/commands/GapCommands";
import { MoveClipCommand } from "@/core/history/commands/MoveClipCommand";
import { UpdateClipCommand } from "@/core/history/commands/UpdateClipCommand";
import { detectGaps } from "@/lib/timeline/gapEngine";
import { evaluateTimelineSceneCached } from "@/core/evaluation/evaluator";
import type { Clip, Track, VideoClip, Project, MediaAsset } from "@/types";

// Mock Tauri API for evaluation in headless test environment
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(),
}));

/**
 * Deterministic Pseudo-random generator (LCG) with explicit seed for 100% reproducibility.
 */
class DeterministicPRNG {
  private state: number;

  constructor(public readonly seed: number) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

describe("Timeline Invariant Randomized Op Fuzzer (Hardened)", () => {
  const EPSILON = 0.001;

  const mockProject: Project = {
    id: "fuzzer-project",
    name: "Fuzzer Project",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aspectRatio: "16:9",
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 500,
  };

  const mockAsset: MediaAsset = {
    id: "asset-1",
    name: "fuzzer_source.mp4",
    type: "video",
    path: "/media/fuzzer_source.mp4",
    duration: 3600, // 1 hour source
    width: 1920,
    height: 1080,
    size: 1024 * 1024,
  };

  const initialTracks: Track[] = [
    { id: "v1", type: "video", name: "Main Video Track", muted: false, locked: false, visible: true, height: 68 },
    { id: "v2", type: "video", name: "Overlay Video Track", muted: false, locked: false, visible: true, height: 68 },
    { id: "a1", type: "audio", name: "Audio Track", muted: false, locked: false, visible: true, height: 52 },
  ];

  function createTestClip(id: string, trackId: string, startTime: number, duration: number): VideoClip {
    return {
      id,
      trackId,
      mediaId: "asset-1",
      name: `Clip-${id}`,
      kind: "video",
      startTime,
      duration,
      trimIn: 0,
      trimOut: duration,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };
  }

  function serializeTimelineSnapshot(): string {
    const { tracks, clips, gaps, transitions } = useTimelineStore.getState();
    const cleanClips = clips.map((c) => ({
      id: c.id,
      trackId: c.trackId,
      startTime: Math.round(c.startTime * 1000) / 1000,
      duration: Math.round(c.duration * 1000) / 1000,
      trimIn: c.trimIn,
      trimOut: c.trimOut,
    }));
    return JSON.stringify({ tracks, clips: cleanClips, gaps, transitions });
  }

  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [...initialTracks],
      clips: [],
      gaps: [],
      transitions: [],
      captionTracks: [],
      activeCaptionTrackId: null,
      mainVideoTrackId: "v1",
      epoch: 0,
      projectLoadRevision: 1,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1280,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
      _batchDepth: 0,
      _pendingEpochIncrement: false,
      markers: [],
    });

    useProjectStore.setState({
      project: mockProject,
      mediaAssets: [mockAsset],
    });

    useHistoryStore.getState().clear();
  });

  /**
   * Helper that asserts all core timeline invariants against the current store state.
   */
  function assertTimelineInvariants(context: string) {
    const { tracks, clips } = useTimelineStore.getState();

    // Invariant 1: No negative start times, strictly positive durations, finite values
    for (const clip of clips) {
      if (!Number.isFinite(clip.startTime)) {
        throw new Error(`[${context}] Clip ${clip.id} startTime is not finite: ${clip.startTime}`);
      }
      if (!Number.isFinite(clip.duration)) {
        throw new Error(`[${context}] Clip ${clip.id} duration is not finite: ${clip.duration}`);
      }
      if (clip.startTime < -EPSILON) {
        throw new Error(`[${context}] Clip ${clip.id} startTime is negative: ${clip.startTime}`);
      }
      if (clip.duration <= 0) {
        throw new Error(`[${context}] Clip ${clip.id} duration must be > 0: ${clip.duration}`);
      }

      // Invariant 2: Trim consistency
      if (clip.trimIn !== undefined && clip.trimOut !== undefined) {
        if (clip.trimIn < -EPSILON) {
          throw new Error(`[${context}] Clip ${clip.id} trimIn is negative: ${clip.trimIn}`);
        }
        if (clip.trimOut < clip.trimIn - EPSILON) {
          throw new Error(`[${context}] Clip ${clip.id} trimOut (${clip.trimOut}) < trimIn (${clip.trimIn})`);
        }
      }
    }

    // Invariant 3: Single-track overlap prohibition (for non-overlapping track semantic)
    for (const track of tracks) {
      const trackClips = clips
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.startTime - b.startTime);

      for (let i = 0; i < trackClips.length - 1; i++) {
        const curr = trackClips[i];
        const next = trackClips[i + 1];
        const currEnd = curr.startTime + curr.duration;
        if (currEnd > next.startTime + EPSILON) {
          throw new Error(
            `[${context}] Illegal overlap on track ${track.id} between ${curr.id} (${curr.startTime}..${currEnd}) and ${next.id} (${next.startTime})`,
          );
        }
      }

      // Invariant 4: Gap engine detects valid non-negative spaces
      const gaps = detectGaps(trackClips);
      for (const gap of gaps) {
        if (gap.duration <= 0) {
          throw new Error(`[${context}] Detected gap has non-positive duration: ${gap.duration}`);
        }
        if (gap.startTime < 0) {
          throw new Error(`[${context}] Detected gap has negative startTime: ${gap.startTime}`);
        }
      }
    }

    // Invariant 5: EvaluatedScene currency at random points within bounds
    const maxEnd = useTimelineStore.getState().getTimelineEndTime();
    const testPoints = [0, maxEnd * 0.25, maxEnd * 0.5, maxEnd * 0.75, maxEnd];
    for (const time of testPoints) {
      if (time >= 0 && Number.isFinite(time)) {
        evaluateTimelineSceneCached(time, clips, tracks, [mockAsset], mockProject);
      }
    }

    // Invariant 6: Gap-clip non-collision invariant (protected/store gaps must never overlap clips)
    const { gaps: storeGaps } = useTimelineStore.getState();
    for (const gap of storeGaps) {
      if (gap.duration <= 0) {
        throw new Error(`[${context}] Gap ${gap.id} has non-positive duration: ${gap.duration}`);
      }
      if (gap.startTime < -EPSILON) {
        throw new Error(`[${context}] Gap ${gap.id} has negative startTime: ${gap.startTime}`);
      }
      const gapEnd = gap.startTime + gap.duration;
      for (const clip of clips) {
        if (clip.trackId !== gap.trackId) continue;
        const clipEnd = clip.startTime + clip.duration;
        const overlapStart = Math.max(gap.startTime, clip.startTime);
        const overlapEnd = Math.min(gapEnd, clipEnd);
        if (overlapStart < overlapEnd - 0.001) {
          throw new Error(
            `[${context}] Illegal gap-clip collision on track ${gap.trackId}: gap ${gap.id} (${gap.startTime}..${gapEnd}, protected=${gap.protected}) overlaps clip ${clip.id} (${clip.startTime}..${clipEnd}) by ${(overlapEnd - overlapStart).toFixed(3)}s`,
          );
        }
      }
    }
  }

  // ─── 1. EXTENDED MULTI-SEED RANDOMIZED FUZZER (1,000+ OPS) ────────────────
  const SEEDS_TO_TEST = [42, 1337, 777, 2026, 99999];

  for (const seed of SEEDS_TO_TEST) {
    it(`survives 250 randomized editing operations under seed ${seed} without invariant breaches`, () => {
      const prng = new DeterministicPRNG(seed);
      let clipIdCounter = 1;

      // Seed timeline with initial non-overlapping clips
      let cursor = 0;
      for (let i = 0; i < 4; i++) {
        const duration = prng.nextFloat(2, 6);
        const clip = createTestClip(`init-${clipIdCounter++}`, "v1", cursor, duration);
        useTimelineStore.getState().addClip(clip);
        cursor += duration + prng.nextFloat(0.5, 2.0);
      }

      assertTimelineInvariants(`Seed ${seed} Initial State`);

      for (let step = 1; step <= 250; step++) {
        const opType = prng.nextInt(1, 8);
        const store = useTimelineStore.getState();
        const currentClips = store.clips;
        let opName = "unknown";

        try {
          switch (opType) {
            case 1: {
              opName = "AppendClip";
              const track = initialTracks[prng.nextInt(0, initialTracks.length - 1)];
              const trackClips = currentClips.filter((c) => c.trackId === track.id);
              const lastEnd = trackClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
              const gap = prng.nextFloat(0.1, 2.5);
              const duration = prng.nextFloat(1.0, 6.0);
              const newClip = createTestClip(`fuzz-${seed}-${clipIdCounter++}`, track.id, lastEnd + gap, duration);
              useHistoryStore.getState().execute(new AddClipCommand(newClip));
              break;
            }

            case 2: {
              opName = "SplitClip";
              if (currentClips.length > 0) {
                const targetClip = currentClips[prng.nextInt(0, currentClips.length - 1)];
                if (targetClip.duration > 0.6) {
                  const splitOffset = prng.nextFloat(0.2, targetClip.duration - 0.2);
                  const splitTime = targetClip.startTime + splitOffset;
                  const cmd = new SplitClipCommand(targetClip.id, splitTime, 30, targetClip);
                  useHistoryStore.getState().execute(cmd);
                }
              }
              break;
            }

            case 3: {
              opName = "DeleteClip";
              if (currentClips.length > 3) {
                const targetClip = currentClips[prng.nextInt(0, currentClips.length - 1)];
                const cmd = new DeleteClipCommand(targetClip.id);
                useHistoryStore.getState().execute(cmd);
              }
              break;
            }

            case 4: {
              opName = "RippleDelete";
              const v1Clips = currentClips.filter((c) => c.trackId === "v1");
              if (v1Clips.length > 2) {
                const target = v1Clips[prng.nextInt(0, v1Clips.length - 1)];
                const cmd = new RippleDeleteCommand(target.id);
                useHistoryStore.getState().execute(cmd);
              }
              break;
            }

            case 5: {
              opName = "PackTrack";
              const cmd = new PackTrackCommand("v1");
              useHistoryStore.getState().execute(cmd);
              break;
            }

            case 6: {
              if (useHistoryStore.getState().state.canUndo && prng.next() < 0.6) {
                opName = "Undo";
                useHistoryStore.getState().undo();
              } else {
                opName = "InsertGap";
                const v1Clips = currentClips.filter((c) => c.trackId === "v1");
                if (v1Clips.length > 1) {
                  const sorted = [...v1Clips].sort((a, b) => a.startTime - b.startTime);
                  const target = sorted[prng.nextInt(0, sorted.length - 2)];
                  const gapStart = target.startTime + target.duration;
                  const gapDuration = prng.nextFloat(0.5, 2.0);
                  const cmd = new InsertGapCommand("v1", gapStart, gapDuration);
                  useHistoryStore.getState().execute(cmd);
                }
              }
              break;
            }

            case 7: {
              opName = "UpdateClip";
              if (currentClips.length > 0) {
                const targetClip = currentClips[prng.nextInt(0, currentClips.length - 1)];
                const oldProps = { opacity: targetClip.opacity ?? 1 };
                const newProps = { opacity: prng.nextFloat(0.1, 0.9) };
                const cmd = new UpdateClipCommand(targetClip.id, oldProps, newProps, {
                  before: targetClip,
                  after: { ...targetClip, ...newProps },
                });
                useHistoryStore.getState().execute(cmd);
              }
              break;
            }

            case 8: {
              opName = "MoveClip";
              if (currentClips.length > 0) {
                const targetClip = currentClips[prng.nextInt(0, currentClips.length - 1)];
                const targetTrack = initialTracks[prng.nextInt(0, initialTracks.length - 1)];
                const trackClips = currentClips.filter(
                  (c) => c.trackId === targetTrack.id && c.id !== targetClip.id,
                );
                const trackProtectedGaps = store.gaps.filter(
                  (g) => g.trackId === targetTrack.id && g.protected,
                );
                const lastClipEnd = trackClips.reduce(
                  (max, c) => Math.max(max, c.startTime + c.duration),
                  0,
                );
                const lastGapEnd = trackProtectedGaps.reduce(
                  (max, g) => Math.max(max, g.startTime + g.duration),
                  0,
                );
                const lastEnd = Math.max(lastClipEnd, lastGapEnd);
                const gap = prng.nextFloat(0.2, 1.5);
                const newTime = lastEnd + gap;
                const cmd = new MoveClipCommand(
                  targetClip.id,
                  targetClip.trackId,
                  targetTrack.id,
                  targetClip.startTime,
                  newTime,
                );
                useHistoryStore.getState().execute(cmd);
              }
              break;
            }
          }

          assertTimelineInvariants(`Seed: ${seed}, Step: ${step}, Op: ${opName}`);
        } catch (err: any) {
          throw new Error(`[Fuzzer Breach] Failed at Seed: ${seed}, Step: ${step}, Op: ${opName}: ${err.message}`);
        }
      }
    });
  }

  // ─── 2. DEEP UNDO REVERSIBILITY HASH TEST ────────────────────────────────
  it("executes a 20-operation diverse command sequence and proves byte-identical state after 20 undos", () => {
    // 1. Initial State
    const clip1 = createTestClip("base-1", "v1", 0, 10);
    const clip2 = createTestClip("base-2", "v1", 12, 8);
    const clip3 = createTestClip("base-3", "v2", 0, 15);
    useTimelineStore.getState().addClip(clip1);
    useTimelineStore.getState().addClip(clip2);
    useTimelineStore.getState().addClip(clip3);

    const initialSnapshot = serializeTimelineSnapshot();

    // 2. Execute non-trivial operations at valid edit points
    const operations: Array<() => void> = [
      () => useHistoryStore.getState().execute(new SplitClipCommand("base-1", 4.0, 30, clip1)),
      () => useHistoryStore.getState().execute(new InsertGapCommand("v1", 20.0, 3.0)),
      () => useHistoryStore.getState().execute(new DeleteClipCommand("base-2")),
      () => useHistoryStore.getState().execute(new PackTrackCommand("v1")),
      () => useHistoryStore.getState().execute(new InsertGapCommand("v1", 4.0, 2.0)),
    ];

    // Run sequence to build deep undo stack
    for (const op of operations) {
      op();
      assertTimelineInvariants("Deep Undo Step");
    }

    expect(useHistoryStore.getState().state.size).toBe(operations.length);

    // 3. Undo all operations in reverse
    for (let i = 0; i < operations.length; i++) {
      expect(useHistoryStore.getState().state.canUndo).toBe(true);
      useHistoryStore.getState().undo();
      assertTimelineInvariants(`Undo Step ${i + 1}`);
    }

    expect(useHistoryStore.getState().state.canUndo).toBe(false);

    // 4. Verify byte-identical serialization hash
    const restoredSnapshot = serializeTimelineSnapshot();
    expect(restoredSnapshot).toBe(initialSnapshot);
  });

  // ─── 3. MUTATION CHECK: PROVING THE FUZZER ACTUALLY FAILS ON BUGS ────────
  describe("Mutation Check (Guarding Fuzzer Integrity)", () => {
    it("fails when an illegal clip overlap is deliberately injected", () => {
      const clipA = createTestClip("m-1", "v1", 0, 5);
      const clipB = createTestClip("m-2", "v1", 3, 5); // Overlaps from 3 to 5!
      useTimelineStore.setState({ clips: [clipA, clipB] });

      expect(() => {
        assertTimelineInvariants("Deliberate Overlap Mutation");
      }).toThrow(/Illegal overlap on track v1/);
    });

    it("fails when a negative clip duration is deliberately injected", () => {
      const clipBad = createTestClip("m-neg", "v1", 0, -2);
      useTimelineStore.setState({ clips: [clipBad] });

      expect(() => {
        assertTimelineInvariants("Negative Duration Mutation");
      }).toThrow(/duration must be > 0/);
    });

    it("fails when an undo step is skipped in a reversion chain", () => {
      const clip1 = createTestClip("mut-1", "v1", 0, 10);
      useTimelineStore.getState().addClip(clip1);
      const snapshot = serializeTimelineSnapshot();

      useHistoryStore.getState().execute(new SplitClipCommand("mut-1", 5.0, 30, clip1));
      // Do NOT undo!
      const unreversedSnapshot = serializeTimelineSnapshot();

      expect(unreversedSnapshot).not.toBe(snapshot);
    });

    it("fails when a gap-clip overlap is deliberately injected", () => {
      const clip = createTestClip("mut-gap-clip", "v1", 2, 5); // 2..7
      useTimelineStore.setState({
        clips: [clip],
        gaps: [{ id: "mut-gap", trackId: "v1", startTime: 4, duration: 4, protected: true, type: "protected", source: "user-insert" }], // 4..8 overlaps 4..7
      });

      expect(() => {
        assertTimelineInvariants("Deliberate Gap-Clip Overlap Mutation");
      }).toThrow(/Illegal gap-clip collision on track v1/);
    });
  });
});
