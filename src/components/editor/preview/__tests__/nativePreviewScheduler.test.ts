import { describe, expect, it, vi } from "vitest";
import type { NativeFrameRequest } from "@/lib/platform/nativeCore";
import {
  NativePreviewFrameScheduler,
  type NativePreviewFrame,
  type NativePreviewRequestSource,
} from "../nativePreviewScheduler";

function makeRequest(frameIndex: number): NativeFrameRequest {
  return {
    contractVersion: 1,
    requestId: `request-${frameIndex}`,
    frameTime: { frameIndex, ticks: frameIndex * 33_333, timescale: 1_000_000 },
    project: {
      schemaVersion: 1,
      projectRevision: "project:1",
      canvasWidth: 1,
      canvasHeight: 1,
      clearColor: [0, 0, 0, 1],
      videoLayers: [],
    },
    outputWidth: 1,
    outputHeight: 1,
    quality: "full",
    colorPolicy: {
      version: 1,
      workingSpace: "linear-rec709",
      outputFormat: "rgba8Srgb",
      toneMapHdrToSdr: true,
      displayProfile: "srgb-reference",
    },
    renderGraphVersion: 1,
  };
}

function makeSource(frameIndex: number, priority?: number): NativePreviewRequestSource {
  return {
    requestKey: `frame-${frameIndex}`,
    frameIndex,
    request: makeRequest(frameIndex),
    priority,
  };
}

function makeFrame(frameIndex: number): NativePreviewFrame {
  return {
    rgba: new Uint8Array([frameIndex, 0, 0, 255]).buffer,
    width: 1,
    height: 1,
  };
}

describe("NativePreviewFrameScheduler", () => {
  it("starts the visible request immediately even when prefetch is using its budget", async () => {
    const pending = new Map<number, (frame: NativePreviewFrame) => void>();
    const load = vi.fn((request: NativeFrameRequest) => new Promise<NativePreviewFrame>((resolve) => {
      pending.set(request.frameTime.frameIndex, resolve);
    }));
    const scheduler = new NativePreviewFrameScheduler({ load, maxInFlight: 1 });

    scheduler.prefetch([makeSource(1)]);
    const visible = scheduler.requestVisible(makeSource(0));

    expect(load).toHaveBeenCalledTimes(2);
    resolveFrame(pending, 0);

    await expect(visible).resolves.toEqual(makeFrame(0));
    scheduler.dispose();
  });

  it("drops queued lookahead from the previous visible target", async () => {
    const pending = new Map<number, (frame: NativePreviewFrame) => void>();
    const load = vi.fn((request: NativeFrameRequest) => new Promise<NativePreviewFrame>((resolve) => {
      pending.set(request.frameTime.frameIndex, resolve);
    }));
    const scheduler = new NativePreviewFrameScheduler({ load, maxInFlight: 1 });

    scheduler.prefetch([makeSource(1), makeSource(2)]);
    scheduler.setVisibleGeneration();
    scheduler.prefetch([makeSource(3)]);

    resolveFrame(pending, 1);
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(makeRequest(3)));
    expect(load).not.toHaveBeenCalledWith(makeRequest(2));

    resolveFrame(pending, 3);
    scheduler.dispose();
  });

  it("shares duplicate work and returns cached frames", async () => {
    const load = vi.fn(async (request: NativeFrameRequest) => makeFrame(request.frameTime.frameIndex));
    const scheduler = new NativePreviewFrameScheduler({ load, maxCacheEntries: 2 });
    const source = makeSource(4);

    const [first, second] = await Promise.all([
      scheduler.requestVisible(source),
      scheduler.requestVisible(source),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    await expect(scheduler.requestVisible(source)).resolves.toEqual(first);
    expect(load).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("keeps the cache bounded with least-recently-used eviction", async () => {
    const load = vi.fn(async (request: NativeFrameRequest) => makeFrame(request.frameTime.frameIndex));
    const scheduler = new NativePreviewFrameScheduler({ load, maxCacheEntries: 2 });

    await scheduler.requestVisible(makeSource(0));
    await scheduler.requestVisible(makeSource(1));
    await scheduler.requestVisible(makeSource(0));
    await scheduler.requestVisible(makeSource(2));
    await scheduler.requestVisible(makeSource(1));

    expect(load).toHaveBeenCalledTimes(4);
    scheduler.dispose();
  });
});

function resolveFrame(
  pending: Map<number, (frame: NativePreviewFrame) => void>,
  frameIndex: number,
): void {
  const resolve = pending.get(frameIndex);
  if (!resolve) throw new Error(`Frame ${frameIndex} is not pending`);
  pending.delete(frameIndex);
  resolve(makeFrame(frameIndex));
}
