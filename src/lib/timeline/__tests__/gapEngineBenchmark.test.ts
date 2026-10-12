import { describe, it, expect } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import type { Clip } from "@/types";

describe("Gap Detection Batching Benchmark", () => {
  function createBenchClip(id: string, trackId: string, startTime: number, duration: number): Clip {
    return {
      id,
      trackId,
      name: id,
      mediaId: "asset-1",
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

  function resetStore() {
    useTimelineStore.setState({
      clips: [],
      gaps: [],
      tracks: [
        { id: "track-v1", name: "V1", type: "video", height: 72, locked: false, muted: false, solo: false, visible: true },
      ],
      _batchDepth: 0,
      _pendingEpochIncrement: false,
    });
  }

  function measureClipsAddition(numClips: number) {
    // 1. Unbatched: adding clips one by one with _batchDepth = 0
    resetStore();
    const store = useTimelineStore.getState();
    const startUnbatched = performance.now();
    for (let i = 0; i < numClips; i++) {
      store.addClip(createBenchClip(`clip-bench-${i}`, "track-v1", i * 3.0, 2.0));
    }
    const endUnbatched = performance.now();
    const unbatchedMs = endUnbatched - startUnbatched;
    const finalState = useTimelineStore.getState();
    const unbatchedGaps = finalState.gaps.length;

    // 2. Batched: adding clips inside withBatch
    resetStore();
    const startBatched = performance.now();
    store.withBatch(() => {
      for (let i = 0; i < numClips; i++) {
        store.addClip(createBenchClip(`clip-bench-${i}`, "track-v1", i * 3.0, 2.0));
      }
    });
    const endBatched = performance.now();
    const batchedMs = endBatched - startBatched;
    const batchedGaps = useTimelineStore.getState().gaps.length;

    return { numClips, unbatchedMs, batchedMs, unbatchedGaps, batchedGaps };
  }

  it("benchmarks 50-clip and 200-clip insertion with and without batching", () => {
    // Warmup
    measureClipsAddition(10);

    const res50 = measureClipsAddition(50);
    const res200 = measureClipsAddition(200);

    console.log("\n=======================================================");
    console.log("       GAP SYNCHRONIZATION BATCHING BENCHMARK          ");
    console.log("=======================================================");
    console.log(`[50-Clip Paste / Multi-add]:`);
    console.log(`  Unbatched: ${res50.unbatchedMs.toFixed(2)} ms (Gaps detected: ${res50.unbatchedGaps})`);
    console.log(`  Batched:   ${res50.batchedMs.toFixed(2)} ms (Gaps detected: ${res50.batchedGaps})`);
    console.log(`  Speedup:   ${(res50.unbatchedMs / res50.batchedMs).toFixed(2)}x faster`);
    console.log(`-------------------------------------------------------`);
    console.log(`[200-Clip Timeline Multi-add]:`);
    console.log(`  Unbatched: ${res200.unbatchedMs.toFixed(2)} ms (Gaps detected: ${res200.unbatchedGaps})`);
    console.log(`  Batched:   ${res200.batchedMs.toFixed(2)} ms (Gaps detected: ${res200.batchedGaps})`);
    console.log(`  Speedup:   ${(res200.unbatchedMs / res200.batchedMs).toFixed(2)}x faster`);
    console.log("=======================================================\n");

    expect(res50.batchedGaps).toBe(res50.unbatchedGaps);
    expect(res200.batchedGaps).toBe(res200.unbatchedGaps);
    expect(res50.batchedMs).toBeLessThan(res50.unbatchedMs);
    expect(res200.batchedMs).toBeLessThan(res200.unbatchedMs);
  });
});
