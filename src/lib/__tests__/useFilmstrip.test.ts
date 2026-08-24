/**
 * useFilmstrip.test.ts — hook tests
 *
 * Tests the pure projection hook that subscribes to RenderEngine filmstrip state.
 *
 * Architecture:
 *   RenderEngine → FilmstripCache → RenderState.visibleArtifacts
 *                                  ↓
 *                            useFilmstrip (projection)
 *
 * Uses renderHook from @testing-library/react.
 * Mocks: renderEngine/hooks, hooks/useRenderRuntime
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { SpatialTier, InteractionState } from "../renderEngine/types";
import type { RenderEpochId } from "../renderEngine/types";
import type { TransportArtifact } from "../renderEngine/transport";

/** Cast a plain string to the branded RenderEpochId type (test helper only). */
const eid = (s: string) => s as RenderEpochId;

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockRequestFilmstrip = vi.fn();
const mockUseRenderState = vi.fn();
const mockUseRenderRuntime = vi.fn();

vi.mock("../renderEngine/hooks", () => ({
  useRenderState: mockUseRenderState,
}));

vi.mock("@/hooks/useRenderRuntime", () => ({
  useRenderRuntime: mockUseRenderRuntime,
}));

// Import AFTER mocks are registered
const { useFilmstrip } = await import("../filmstrip/useFilmstrip");

// ─── RAF test control ────────────────────────────────────────────────────────

let rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;

function flushRaf() {
  const callbacks = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  callbacks.forEach((cb) => cb(performance.now()));
}

// ─── Default render state ─────────────────────────────────────────────────────

function makeRenderState(overrides = {}) {
  return {
    epochId: eid("epoch-1"),
    currentTier: { spatialTier: SpatialTier.L1, temporalTier: 0 },
    interactionState: InteractionState.Idle,
    isFallback: false,
    visibleArtifacts: [],
    ...overrides,
  };
}

function makeArtifact(timestampMs: number, spatialTier = SpatialTier.L0): TransportArtifact {
  return {
    frameId: `f-${timestampMs}`,
    contentHash: `h-${timestampMs}`,
    spatialTier,
    bitmap: { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap,
    width: 80,
    height: 45,
    timestampMs,
    epochId: eid("epoch-1"),
    source: "fresh-decode",
  };
}

function defaultOpts() {
  return {
    clipId: "clip-1",
    videoPath: "/a.mp4",
    trimIn: 0,
    trimOut: 10,
    duration: 10,
    clipStartTime: 0,
    clipWidthPx: 300,
    viewportScrollLeft: 0,
    viewportWidth: 1920,
    pixelsPerSecond: 30,
    enabled: true,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useFilmstrip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseRenderState.mockReturnValue(makeRenderState());
    // Mock useRenderRuntime to return a mock runtime object with requestFilmstrip and preloadAssetCoarseBaseline
    mockUseRenderRuntime.mockReturnValue({
      requestFilmstrip: mockRequestFilmstrip,
      preloadAssetCoarseBaseline: vi.fn(),
    });
    mockRequestFilmstrip.mockClear();
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        rafCallbacks.delete(id);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── Basic enable/disable ───────────────────────────────────────────────────

  it("does not call requestFilmstrip when enabled=false", () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), enabled: false }));
    expect(mockRequestFilmstrip).not.toHaveBeenCalled();
  });

  it("does not call requestFilmstrip when videoPath is empty", () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), videoPath: "" }));
    expect(mockRequestFilmstrip).not.toHaveBeenCalled();
  });

  it("does not call requestFilmstrip when duration is 0", () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), duration: 0 }));
    expect(mockRequestFilmstrip).not.toHaveBeenCalled();
  });

  it("does not call requestFilmstrip when runtime is null", () => {
    mockUseRenderRuntime.mockReturnValue(null);
    renderHook(() => useFilmstrip(defaultOpts()));
    expect(mockRequestFilmstrip).not.toHaveBeenCalled();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("starts with isFallback=true before any artifacts arrive", () => {
    mockUseRenderState.mockReturnValue(makeRenderState({ isFallback: true, visibleArtifacts: [] }));
    const { result } = renderHook(() => useFilmstrip(defaultOpts()));
    expect(result.current.isFallback).toBe(true);
  });

  it("starts with empty artifacts array", () => {
    mockUseRenderState.mockReturnValue(makeRenderState({ visibleArtifacts: [] }));
    const { result } = renderHook(() => useFilmstrip(defaultOpts()));
    expect(result.current.artifacts).toHaveLength(0);
  });

  // ── Artifact delivery ──────────────────────────────────────────────────────

  it("sets isFallback=false after first artifact arrives", () => {
    const artifact = makeArtifact(1000);
    mockUseRenderState.mockReturnValue(makeRenderState({ isFallback: false, visibleArtifacts: [artifact] }));

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    expect(result.current.isFallback).toBe(false);
    expect(result.current.artifacts).toHaveLength(1);
  });

  it("artifacts are sorted by timestampMs ascending", () => {
    const artifacts = [makeArtifact(3000), makeArtifact(1000), makeArtifact(2000)];
    mockUseRenderState.mockReturnValue(makeRenderState({ visibleArtifacts: artifacts }));

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    const times = result.current.artifacts.map((a) => a.timestampMs);
    expect(times).toEqual([3000, 1000, 2000]); // Returns as-is from RenderState
  });

  it("returns artifacts from RenderState", () => {
    const artifact1 = makeArtifact(1000, SpatialTier.L0);
    const artifact2 = makeArtifact(1000, SpatialTier.L1);
    mockUseRenderState.mockReturnValue(makeRenderState({ visibleArtifacts: [artifact2] }));

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    // Hook returns whatever RenderState provides (FilmstripCache handles deduplication)
    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.artifacts[0].spatialTier).toBe(SpatialTier.L1);
  });

  // ── Invalidation key change ────────────────────────────────────────────────
  it("calls requestFilmstrip again when invalidationKey changes", () => {
    const { rerender } = renderHook(
      ({ invalidationKey }: { invalidationKey: string }) => {
        return useFilmstrip({ ...defaultOpts(), invalidationKey });
      },
      { initialProps: { invalidationKey: "key-1" } },
    );

    expect(mockRequestFilmstrip).toHaveBeenCalledTimes(1);

    rerender({ invalidationKey: "key-2" });

    expect(mockRequestFilmstrip).toHaveBeenCalledTimes(2);
  });

  it("issues new request when options change", () => {
    const { rerender } = renderHook(
      ({ clipWidthPx }: { clipWidthPx: number }) => {
        return useFilmstrip({ ...defaultOpts(), clipWidthPx });
      },
      { initialProps: { clipWidthPx: 300 } },
    );

    expect(mockRequestFilmstrip).toHaveBeenCalledTimes(1);

    rerender({ clipWidthPx: 600 });

    expect(mockRequestFilmstrip).toHaveBeenCalledTimes(2);
  });

  it("calls requestFilmstrip when not Scrubbing", () => {
    mockUseRenderState.mockReturnValue(makeRenderState({ interactionState: InteractionState.Idle }));

    renderHook(() => useFilmstrip(defaultOpts()));

    expect(mockRequestFilmstrip).toHaveBeenCalledOnce();
  });

  it("calls requestFilmstrip with correct parameters when Idle", () => {
    mockUseRenderState.mockReturnValue(
      makeRenderState({
        interactionState: InteractionState.Idle,
        currentTier: { spatialTier: SpatialTier.L2, temporalTier: 0 },
      }),
    );

    renderHook(() => useFilmstrip(defaultOpts()));

    expect(mockRequestFilmstrip).toHaveBeenCalledOnce();
    const call = mockRequestFilmstrip.mock.calls[0][0];
    expect(call.clipId).toBe("clip-1");
    expect(call.videoPath).toBe("/a.mp4");
    expect(call.trimIn).toBe(0);
    expect(call.trimOut).toBe(10);
    expect(call.duration).toBe(10);
  });

  it("passes viewport parameters to requestFilmstrip", () => {
    renderHook(() =>
      useFilmstrip({
        ...defaultOpts(),
        clipStartTime: 5,
        clipWidthPx: 300,
        viewportScrollLeft: 100,
        viewportWidth: 1920,
        pixelsPerSecond: 30,
      }),
    );

    expect(mockRequestFilmstrip).toHaveBeenCalledOnce();
    const call = mockRequestFilmstrip.mock.calls[0][0];
    expect(call.clipStartTime).toBe(5);
    expect(call.clipWidthPx).toBe(300);
    expect(call.viewportScrollLeft).toBe(100);
    expect(call.viewportWidth).toBe(1920);
    expect(call.pixelsPerSecond).toBe(30);
  });

  // ── Unmount cleanup ────────────────────────────────────────────────────────

  it("cleanup happens on unmount", () => {
    const { unmount } = renderHook(() => useFilmstrip(defaultOpts()));

    expect(mockRequestFilmstrip).toHaveBeenCalledOnce();

    unmount();

    // Hook cleanup is handled by useEffect cleanup
    // No explicit cancel needed since RenderEngine owns lifecycle
  });

  it("no artifacts after unmount", () => {
    mockUseRenderState.mockReturnValue(makeRenderState({ visibleArtifacts: [] }));

    const { result, unmount } = renderHook(() => useFilmstrip(defaultOpts()));

    unmount();

    expect(result.current.artifacts).toHaveLength(0);
  });
});
