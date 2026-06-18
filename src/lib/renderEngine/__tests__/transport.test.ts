// @vitest-environment jsdom
/**
 * transport.test.ts — Phase 3 & 4 transport layer tests
 *
 * Tests epoch validation, cancel semantics, SAB detection,
 * progressive tier sequencing, and batch concurrency.
 *
 * Mocks:
 *   - @tauri-apps/api/core (Channel + invoke)
 *   - createImageBitmap (global)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerActiveEpoch, unregisterActiveEpoch, isEpochStillValid, requestRenderArtifacts, requestBatchArtifacts, requestProgressiveTiers, SAB_SUPPORTED, type BackendRenderArtifact, type TransportArtifact } from "../transport";
import { SpatialTier } from "../types";
import type { RenderEpochId } from "../types";

/** Cast a plain string to the branded RenderEpochId type (test helper only). */
const eid = (s: string) => s as RenderEpochId;

// ─── Browser API stubs ───────────────────────────────────────────────────────

// jsdom exposes SharedArrayBuffer but crossOriginIsolated is undefined/false.
// Explicitly set it to false so SAB_SUPPORTED evaluates to false at module load.
// This must be set BEFORE the transport module is imported.
vi.stubGlobal("crossOriginIsolated", false);

// Stub ImageData so rgbaToImageBitmap can construct it (jsdom may not have it)
if (typeof ImageData === "undefined") {
  vi.stubGlobal(
    "ImageData",
    class {
      readonly width: number;
      readonly height: number;
      readonly data: Uint8ClampedArray;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
  );
}

vi.stubGlobal(
  "createImageBitmap",
  vi.fn(async (imageData: { width: number; height: number }) => ({
    width: imageData.width,
    height: imageData.height,
    close: vi.fn(),
  })),
);

// ─── Tauri mock ───────────────────────────────────────────────────────────────

// Each Channel instance exposes `triggerMessage(msg)` so tests can push
// messages without relying on a shared handler array.
type ChannelHandler = (msg: BackendRenderArtifact) => void;

interface MockChannel {
  triggerMessage: (msg: BackendRenderArtifact) => void;
}

const { mockInvoke, channelInstances } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  channelInstances: [] as MockChannel[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class implements MockChannel {
    private _handler: ChannelHandler | null = null;
    set onmessage(fn: ChannelHandler) {
      this._handler = fn;
    }
    triggerMessage(msg: BackendRenderArtifact) {
      this._handler?.(msg);
    }
    constructor() {
      channelInstances.push(this);
    }
  },
  invoke: mockInvoke,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRawArtifact(overrides: Partial<BackendRenderArtifact> = {}): BackendRenderArtifact {
  return {
    frame_id: "f1",
    content_hash: "h1",
    spatial_tier: SpatialTier.L0,
    rgba_data: Array.from({ length: 160 * 90 * 4 }, () => 128),
    width: 160,
    height: 90,
    timestamp_ms: 1000,
    source: "fresh-decode",
    ...overrides,
  };
}

function resetTransportMocks() {
  channelInstances.length = 0;
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
}

// ─── Epoch Registry ───────────────────────────────────────────────────────────

describe("isEpochStillValid", () => {
  afterEach(() => {
    unregisterActiveEpoch("clip-1");
    unregisterActiveEpoch("clip-2");
  });

  it("returns false for an unregistered epoch", () => {
    expect(isEpochStillValid(eid("epoch-xyz"))).toBe(false);
  });

  it("returns true for a registered epoch", () => {
    registerActiveEpoch("clip-1", eid("epoch-abc"));
    expect(isEpochStillValid(eid("epoch-abc"))).toBe(true);
  });

  it("returns false after epoch is unregistered", () => {
    registerActiveEpoch("clip-1", eid("epoch-abc"));
    unregisterActiveEpoch("clip-1");
    expect(isEpochStillValid(eid("epoch-abc"))).toBe(false);
  });

  it("returns true when any clip still holds the epoch", () => {
    registerActiveEpoch("clip-1", eid("epoch-shared"));
    registerActiveEpoch("clip-2", eid("epoch-shared"));
    unregisterActiveEpoch("clip-1");
    expect(isEpochStillValid(eid("epoch-shared"))).toBe(true);
    unregisterActiveEpoch("clip-2");
    expect(isEpochStillValid(eid("epoch-shared"))).toBe(false);
  });

  it("new epoch invalidates old registration for same clip", () => {
    registerActiveEpoch("clip-1", eid("epoch-old"));
    registerActiveEpoch("clip-1", eid("epoch-new"));
    expect(isEpochStillValid(eid("epoch-old"))).toBe(false);
    expect(isEpochStillValid(eid("epoch-new"))).toBe(true);
  });
});

// ─── SAB Detection ────────────────────────────────────────────────────────────

describe("SAB_SUPPORTED", () => {
  it("is a boolean", () => {
    expect(typeof SAB_SUPPORTED).toBe("boolean");
  });

  it("is false when crossOriginIsolated is falsy (default jsdom state)", () => {
    // jsdom sets crossOriginIsolated = false by default, so our transport module
    // evaluates SAB_SUPPORTED to false. This verifies the crossOriginIsolated guard works.
    expect(SAB_SUPPORTED).toBe(false);
  });
});

// ─── requestRenderArtifacts ───────────────────────────────────────────────────

describe("requestRenderArtifacts", () => {
  beforeEach(resetTransportMocks);
  afterEach(() => unregisterActiveEpoch("clip-test"));

  it("delivers artifacts that pass epoch validation", async () => {
    registerActiveEpoch("clip-test", eid("epoch-1"));
    const received: TransportArtifact[] = [];

    requestRenderArtifacts({
      videoPath: "/a.mp4",
      timestampMs: 1000,
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-1"),
      clipId: "clip-test",
      onArtifact: (a) => received.push(a),
    });

    // Give the Channel constructor time to register
    await new Promise((r) => setTimeout(r, 0));
    // Trigger a channel message
    channelInstances[0]?.triggerMessage(makeRawArtifact());
    // Allow the async rgbaToImageBitmap to resolve
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].timestampMs).toBe(1000);
    expect(received[0].epochId).toBe("epoch-1");
  });

  it("drops artifacts after epoch becomes stale", async () => {
    registerActiveEpoch("clip-test", eid("epoch-stale"));
    const received: TransportArtifact[] = [];

    requestRenderArtifacts({
      videoPath: "/a.mp4",
      timestampMs: 1000,
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-stale"),
      clipId: "clip-test",
      onArtifact: (a) => received.push(a),
    });

    await new Promise((r) => setTimeout(r, 0));
    // Epoch changes BEFORE artifact arrives → drop
    registerActiveEpoch("clip-test", eid("epoch-new"));
    channelInstances[0]?.triggerMessage(makeRawArtifact());
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it("cancel() stops artifact delivery", async () => {
    registerActiveEpoch("clip-test", eid("epoch-2"));
    const received: TransportArtifact[] = [];

    const cancel = requestRenderArtifacts({
      videoPath: "/a.mp4",
      timestampMs: 1000,
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-2"),
      clipId: "clip-test",
      onArtifact: (a) => received.push(a),
    });

    await new Promise((r) => setTimeout(r, 0));
    cancel();
    channelInstances[0]?.triggerMessage(makeRawArtifact());
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it("calls onComplete when invoke resolves", async () => {
    registerActiveEpoch("clip-test", eid("epoch-3"));
    const onComplete = vi.fn();

    requestRenderArtifacts({
      videoPath: "/a.mp4",
      timestampMs: 1000,
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-3"),
      clipId: "clip-test",
      onArtifact: vi.fn(),
      onComplete,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

// ─── requestBatchArtifacts ────────────────────────────────────────────────────

describe("requestBatchArtifacts", () => {
  beforeEach(resetTransportMocks);
  afterEach(() => unregisterActiveEpoch("clip-batch"));

  it("calls onComplete once after all timestamps finish", async () => {
    registerActiveEpoch("clip-batch", eid("epoch-b"));
    const onComplete = vi.fn();

    requestBatchArtifacts({
      videoPath: "/a.mp4",
      timestampsMs: [1000, 2000, 3000],
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-b"),
      clipId: "clip-batch",
      onArtifact: vi.fn(),
      onComplete,
      concurrency: 3,
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("cancel stops all in-flight requests", async () => {
    registerActiveEpoch("clip-batch", eid("epoch-c"));
    const received: TransportArtifact[] = [];

    const cancel = requestBatchArtifacts({
      videoPath: "/a.mp4",
      timestampsMs: [1000, 2000],
      spatialTiers: [SpatialTier.L0],
      epochId: eid("epoch-c"),
      clipId: "clip-batch",
      onArtifact: (a) => received.push(a),
      concurrency: 2,
    });

    await new Promise((r) => setTimeout(r, 0));
    cancel();
    for (const ch of channelInstances) {
      ch.triggerMessage(makeRawArtifact());
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(0);
  });
});

// ─── requestProgressiveTiers ──────────────────────────────────────────────────

describe("requestProgressiveTiers", () => {
  beforeEach(resetTransportMocks);
  afterEach(() => unregisterActiveEpoch("clip-prog"));

  it("delivers L0 then L1 in sequence", async () => {
    registerActiveEpoch("clip-prog", eid("epoch-p"));
    const tiersSeen: SpatialTier[] = [];

    requestProgressiveTiers({
      videoPath: "/a.mp4",
      timestampsMs: [1000],
      startTier: SpatialTier.L0,
      targetTier: SpatialTier.L1,
      epochId: eid("epoch-p"),
      clipId: "clip-prog",
      onArtifact: (a) => tiersSeen.push(a.spatialTier),
    });

    // L0 batch: one Channel created, trigger its message
    await new Promise((r) => setTimeout(r, 0));
    channelInstances[0]?.triggerMessage(makeRawArtifact({ spatial_tier: SpatialTier.L0 }));
    // Allow L0 ImageBitmap + invoke resolve → L1 batch starts
    await new Promise((r) => setTimeout(r, 30));
    // L1 batch: second Channel
    channelInstances[1]?.triggerMessage(makeRawArtifact({ spatial_tier: SpatialTier.L1, width: 240, height: 135 }));
    await new Promise((r) => setTimeout(r, 20));

    expect(tiersSeen).toContain(SpatialTier.L0);
    expect(tiersSeen).toContain(SpatialTier.L1);
  });

  it("cancel before L1 prevents L1 delivery", async () => {
    registerActiveEpoch("clip-prog", eid("epoch-q"));
    const tiersSeen: SpatialTier[] = [];

    const cancel = requestProgressiveTiers({
      videoPath: "/a.mp4",
      timestampsMs: [1000],
      startTier: SpatialTier.L0,
      targetTier: SpatialTier.L1,
      epochId: eid("epoch-q"),
      clipId: "clip-prog",
      onArtifact: (a) => tiersSeen.push(a.spatialTier),
    });

    await new Promise((r) => setTimeout(r, 0));
    channelInstances[0]?.triggerMessage(makeRawArtifact({ spatial_tier: SpatialTier.L0 }));
    await new Promise((r) => setTimeout(r, 10));
    cancel(); // cancel before L1 batch begins
    await new Promise((r) => setTimeout(r, 30));

    expect(tiersSeen.filter((t) => t === SpatialTier.L1)).toHaveLength(0);
  });

  it("stops at L0 when startTier === targetTier (single invoke call)", async () => {
    registerActiveEpoch("clip-prog", eid("epoch-r"));
    const onComplete = vi.fn();

    requestProgressiveTiers({
      videoPath: "/a.mp4",
      timestampsMs: [1000],
      startTier: SpatialTier.L0,
      targetTier: SpatialTier.L0,
      epochId: eid("epoch-r"),
      clipId: "clip-prog",
      onArtifact: vi.fn(),
      onComplete,
    });

    await new Promise((r) => setTimeout(r, 30));
    // Only 1 invoke call (for L0 batch), not 2
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
