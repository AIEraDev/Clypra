/**
 * FilmstripCache.test.ts — RAF batching tests
 *
 * Verifies that artifact updates are batched per frame to prevent rerender storms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpatialTier, VelocityState } from "../types";
import type { RenderEpochId } from "../types";

// Mock the native FrameRequest transport before importing FilmstripCache.
const mockRequestNativeFilmstripArtifacts = vi.fn();
const mockRequestProgressiveTiers = mockRequestNativeFilmstripArtifacts;
vi.mock("../transport", () => ({
  requestFilmstripArtifacts: mockRequestNativeFilmstripArtifacts,
}));

// Import AFTER mock is registered
const { FilmstripCache } = await import("../FilmstripCache");

const eid = (s: string) => s as RenderEpochId;
const emitArtifact = (handler: unknown, artifact: unknown) => {
  if (typeof handler === "function") {
    (handler as (a: unknown) => void)(artifact);
  }
};

describe("FilmstripCache RAF Batching", () => {
  let cache: InstanceType<typeof FilmstripCache>;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    cache = new FilmstripCache(100);
    rafCallbacks = new Map();
    nextRafId = 1;

    // Mock RAF
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });

    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });

    mockRequestNativeFilmstripArtifacts.mockClear();
  });

  afterEach(() => {
    cache.dispose();
    vi.unstubAllGlobals();
  });

  function flushRaf() {
    const callbacks = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    callbacks.forEach((cb) => cb(performance.now()));
  }

  function makeArtifact(timestampMs: number, spatialTier = SpatialTier.L1) {
    return {
      frameId: `f-${timestampMs}`,
      contentHash: `h-${timestampMs}`,
      spatialTier,
      bitmap: { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap,
      width: 80,
      height: 45,
      timestampMs,
      epochId: eid("epoch-1"),
      source: "fresh-decode" as const,
    };
  }

  it("batches multiple artifacts into single update per frame", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestNativeFilmstripArtifacts.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 10,
      clipStartTime: 0,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 30,
      onUpdate,
    });

    // Deliver 3 artifacts rapidly
    emitArtifact(capturedOnArtifact, makeArtifact(1000));
    emitArtifact(capturedOnArtifact, makeArtifact(2000));
    emitArtifact(capturedOnArtifact, makeArtifact(3000));

    // Should NOT have called onUpdate yet (waiting for RAF)
    expect(onUpdate).not.toHaveBeenCalled();

    // Flush RAF
    flushRaf();

    // Should have called onUpdate ONCE with all 3 artifacts
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ timestampMs: 1000 }), expect.objectContaining({ timestampMs: 2000 }), expect.objectContaining({ timestampMs: 3000 })]));
  });

  it("deduplicates artifacts by timestamp during batch", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 10,
      clipStartTime: 0,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 30,
      onUpdate,
    });

    // Deliver same timestamp at different tiers
    const artifact1 = makeArtifact(1000, SpatialTier.L0);
    const artifact2 = makeArtifact(1000, SpatialTier.L1);

    emitArtifact(capturedOnArtifact, artifact1);
    emitArtifact(capturedOnArtifact, artifact2);

    flushRaf();

    // Should have called onUpdate once with only the higher tier
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const artifacts = onUpdate.mock.calls[0][0];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].spatialTier).toBe(SpatialTier.L1);

    // Lower tier bitmap should be closed
    expect(artifact1.bitmap.close).toHaveBeenCalled();
  });

  it("cancels pending RAF on dispose", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 10,
      clipStartTime: 0,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 30,
      onUpdate,
    });

    const artifact = makeArtifact(1000);
    emitArtifact(capturedOnArtifact, artifact);

    // Dispose before RAF flush
    cache.dispose();

    // Flush RAF (should be no-op)
    flushRaf();

    // Should NOT have called onUpdate
    expect(onUpdate).not.toHaveBeenCalled();

    // Pending artifact bitmap should be closed
    expect(artifact.bitmap.close).toHaveBeenCalled();
  });

  it("cleans up pending artifacts on clip invalidation", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 10,
      clipStartTime: 0,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 30,
      onUpdate,
    });

    const artifact = makeArtifact(1000);
    emitArtifact(capturedOnArtifact, artifact);

    // Invalidate clip before RAF flush
    cache.invalidateClip("clip-1");

    // Flush RAF
    flushRaf();

    // Should NOT have called onUpdate
    expect(onUpdate).not.toHaveBeenCalled();

    // Pending artifact bitmap should be closed
    expect(artifact.bitmap.close).toHaveBeenCalled();
  });
});

describe("FilmstripCache Aggressive Cheating", () => {
  let cache: InstanceType<typeof FilmstripCache>;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    cache = new FilmstripCache(100);
    rafCallbacks = new Map();
    nextRafId = 1;

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });

    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });

    mockRequestProgressiveTiers.mockClear();
  });

  afterEach(() => {
    cache.dispose();
    vi.unstubAllGlobals();
  });

  function flushRaf() {
    const callbacks = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    callbacks.forEach((cb) => cb(performance.now()));
  }

  function makeArtifact(timestampMs: number, spatialTier = SpatialTier.L1) {
    return {
      frameId: `f-${timestampMs}`,
      contentHash: `h-${timestampMs}`,
      spatialTier,
      bitmap: { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap,
      width: 80,
      height: 45,
      timestampMs,
      epochId: eid("epoch-1"),
      source: "fresh-decode" as const,
    };
  }

  it("shows stale tiles during fast scroll without requesting", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    // First request at stable velocity — populates tile cache
    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1, // 5s interval
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    // Deliver artifacts to populate tile cache
    emitArtifact(capturedOnArtifact, makeArtifact(0));
    emitArtifact(capturedOnArtifact, makeArtifact(5000));
    emitArtifact(capturedOnArtifact, makeArtifact(10000));
    flushRaf();

    // Now set fast velocity and request again (simulating scroll)
    cache.setVelocityState(VelocityState.Fast);
    onUpdate.mockClear();
    mockRequestProgressiveTiers.mockClear();

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 100, // Slightly different viewport
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    // During fast scroll, should show cached tiles immediately (no RAF wait needed)
    expect(onUpdate).toHaveBeenCalled();
    // Should NOT have made a new request since all tiles are cached
    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it("does not re-request tiles already resident in the tile cache", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    const firstCall = mockRequestProgressiveTiers.mock.calls[0][0];
    for (const timestampMs of firstCall.timestampsMs) {
      emitArtifact(capturedOnArtifact, makeArtifact(timestampMs));
    }
    flushRaf();

    mockRequestProgressiveTiers.mockClear();
    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-2"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it("requests missing tiles during fast scroll when not all cached", () => {
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation(() => vi.fn());

    // Fast velocity, no prior cache
    cache.setVelocityState(VelocityState.Fast);

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    // Not all cached, so should still request
    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(1);
    // But should also have called onUpdate with whatever is available (empty)
    expect(onUpdate).toHaveBeenCalled();
  });

  it("skips aggressive cheating at stable velocity", () => {
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    const onUpdate = vi.fn();

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    // Stable velocity
    cache.setVelocityState(VelocityState.Stable);

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 30,
      clipStartTime: 0,
      clipWidthPx: 1500,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 50,
      onUpdate,
    });

    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(1);
    // Should request normally, not show stale tiles
  });

  it("handles splitting a clip correctly without blank frames or request starvation", () => {
    const onUpdate1 = vi.fn();
    const onUpdate2 = vi.fn();
    let capturedOnArtifact1: ((artifact: any) => void) | null = null;
    let capturedOnArtifact2: ((artifact: any) => void) | null = null;

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      if (opts.clipId === "clip-1") {
        capturedOnArtifact1 = opts.onArtifact;
      } else if (opts.clipId === "clip-2") {
        capturedOnArtifact2 = opts.onArtifact;
      }
      return vi.fn();
    });

    // 1. Initial request for clip-1 (0 to 60s)
    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 60,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 600,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate: onUpdate1,
    });

    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(1);

    // 2. Split occurs:
    // Left clip (clip-1) is trimmed: trimIn=0, trimOut=30, clipStartTime=0, clipWidthPx=300
    // Right clip (clip-2) is created: trimIn=30, trimOut=60, clipStartTime=30, clipWidthPx=300
    mockRequestProgressiveTiers.mockClear();

    // Request left clip-1 (same epochId, updated bounds)
    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 30,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate: onUpdate1,
    });

    // Request right clip-2 (new epochId, since it has a different clipId)
    cache.requestFilmstrip({
      clipId: "clip-2",
      videoPath: "/test.mp4",
      trimIn: 30,
      trimOut: 60,
      duration: 60,
      clipStartTime: 30,
      clipWidthPx: 300,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-2"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate: onUpdate2,
    });

    // Both should trigger new requests
    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(2);
  });

  it("reuses matching artifacts and disposes non-matching ones during split/trim", () => {
    const onUpdate = vi.fn();
    let capturedOnArtifact: ((artifact: any) => void) | null = null;

    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    // 1. Initial request for clip-1 (0 to 60s)
    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 60,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 600,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate,
    });

    const art0 = makeArtifact(0);
    const art5 = makeArtifact(5000);
    const art10 = makeArtifact(10000);
    const art15 = makeArtifact(15000);
    const art20 = makeArtifact(20000);
    const art25 = makeArtifact(25000);
    const art30 = makeArtifact(30000);

    emitArtifact(capturedOnArtifact, art0);
    emitArtifact(capturedOnArtifact, art5);
    emitArtifact(capturedOnArtifact, art10);
    emitArtifact(capturedOnArtifact, art15);
    emitArtifact(capturedOnArtifact, art20);
    emitArtifact(capturedOnArtifact, art25);
    emitArtifact(capturedOnArtifact, art30);

    flushRaf();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toHaveLength(7);

    // 2. Trim/Split occurs:
    mockRequestProgressiveTiers.mockClear();
    onUpdate.mockClear();

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 17,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 170,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate,
    });

    // Expect a new request to be started
    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(1);

    // Matching tiles: 0s, 5s, 10s, 15s (kept)
    expect(art0.bitmap.close).not.toHaveBeenCalled();
    expect(art5.bitmap.close).not.toHaveBeenCalled();
    expect(art10.bitmap.close).not.toHaveBeenCalled();
    expect(art15.bitmap.close).not.toHaveBeenCalled();

    // Non-matching tiles: 20s, 25s, 30s are kept in global tileCache, so they are not closed
    expect(art20.bitmap.close).not.toHaveBeenCalled();
    expect(art25.bitmap.close).not.toHaveBeenCalled();
    expect(art30.bitmap.close).not.toHaveBeenCalled();

    // Verify cache entry contains kept artifacts immediately
    const artifacts = cache.getArtifacts("clip-1");
    expect(artifacts).toHaveLength(4);
    expect(artifacts.map(a => a.timestampMs)).toEqual([0, 5000, 10000, 15000]);
  });

  it("shares cached tiles globally across clips referencing the same videoPath", () => {
    const onUpdate1 = vi.fn();
    const onUpdate2 = vi.fn();

    // 1. Request for clip-1 on videoPath "/test.mp4"
    let capturedOnArtifact: ((artifact: any) => void) | null = null;
    mockRequestProgressiveTiers.mockImplementation((opts: any) => {
      capturedOnArtifact = opts.onArtifact;
      return vi.fn();
    });

    cache.requestFilmstrip({
      clipId: "clip-1",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 60,
      clipStartTime: 0,
      clipWidthPx: 100,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-1"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate: onUpdate1,
    });

    const art5 = {
      frameId: "f-5",
      contentHash: "h-5",
      spatialTier: SpatialTier.L1,
      bitmap: { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap,
      width: 80,
      height: 45,
      timestampMs: 5000,
      epochId: eid("epoch-1"),
      source: "fresh-decode" as const,
    };

    emitArtifact(capturedOnArtifact, art5);
    flushRaf();

    // 2. Request for clip-2 (new clip ID) on same videoPath "/test.mp4"
    mockRequestProgressiveTiers.mockClear();
    cache.requestFilmstrip({
      clipId: "clip-2",
      videoPath: "/test.mp4",
      trimIn: 0,
      trimOut: 10,
      duration: 60,
      clipStartTime: 10,
      clipWidthPx: 100,
      spatialTier: SpatialTier.L1,
      epochId: eid("epoch-2"),
      viewportScrollLeft: 0,
      viewportWidth: 1920,
      pixelsPerSecond: 10,
      onUpdate: onUpdate2,
    });

    // Verify clip-2 received the cached artifact from tileCache instantly
    expect(onUpdate2).toHaveBeenCalled();
    const resolvedArtifacts = onUpdate2.mock.calls[0][0];
    expect(resolvedArtifacts).toHaveLength(1);
    expect(resolvedArtifacts[0].timestampMs).toBe(5000);
  });
});
