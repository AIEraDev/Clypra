import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackPushBridge } from "../playbackPushBridge";

const makePacket = (generation: bigint, deliverySeq: bigint, frameId: bigint) => {
  const bytes = new ArrayBuffer(52 + 4);
  const view = new DataView(bytes);
  view.setUint32(0, 0x4350_4652, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 52, true);
  view.setBigUint64(8, generation, true);
  view.setBigUint64(16, deliverySeq, true);
  view.setBigUint64(24, frameId, true);
  view.setBigUint64(32, 1_000n, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 4, true);
  return bytes;
};

describe("PlaybackPushBridge", () => {
  let painted: bigint[];
  let watermarks: Array<{ generation: bigint; consumedDeliverySeq: bigint }>;
  let stalls: number;

  beforeEach(() => {
    vi.useFakeTimers();
    painted = [];
    watermarks = [];
    stalls = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
  });

  afterEach(() => vi.useRealTimers());

  const bridge = (options: Partial<ConstructorParameters<typeof PlaybackPushBridge>[0]> = {}) =>
    new PlaybackPushBridge({
      paint: (packet) => painted.push(packet.frameId),
      reportWatermark: (watermark) =>
        watermarks.push({
          generation: watermark.generation,
          consumedDeliverySeq: watermark.consumedDeliverySeq,
        }),
      onReceiverIdle: () => { stalls += 1; },
      ...options,
    });

  it("rejects a late packet from an old generation", () => {
    const receiver = bridge();
    receiver.beginGeneration(7n);
    expect(receiver.receive(makePacket(6n, 9n, 99n))).toBe(false);
    expect(painted).toEqual([]);
    expect(watermarks).toEqual([]);
  });

  it("cannot overwrite an exact frame after its generation bump", () => {
    const receiver = bridge();
    receiver.beginGeneration(1n);
    receiver.beginGeneration(2n); // exact seek owns generation 2.
    expect(receiver.receive(makePacket(1n, 1n, 10n))).toBe(false);
    expect(receiver.receive(makePacket(2n, 1n, 20n))).toBe(true);
    expect(painted).toEqual([20n]);
  });

  it("reports the first accepted packet immediately and then batches every two frames", () => {
    const receiver = bridge();
    receiver.beginGeneration(4n);
    receiver.receive(makePacket(4n, 3n, 100n));
    receiver.receive(makePacket(4n, 4n, 101n));
    receiver.receive(makePacket(4n, 5n, 102n));
    expect(watermarks).toEqual([
      { generation: 4n, consumedDeliverySeq: 3n },
      { generation: 4n, consumedDeliverySeq: 4n },
    ]);
  });

  it("flushes a single pending watermark after 100 ms", () => {
    const receiver = bridge({ watermarkFrameInterval: 99 });
    receiver.beginGeneration(6n);
    receiver.receive(makePacket(6n, 9n, 20n)); // immediate acknowledgement
    vi.advanceTimersByTime(100);
    receiver.receive(makePacket(6n, 10n, 21n));
    expect(watermarks).toEqual([
      { generation: 6n, consumedDeliverySeq: 9n },
      { generation: 6n, consumedDeliverySeq: 10n },
    ]);
  });

  it("preserves non-contiguous delivery and frame identities after supersession", () => {
    const receiver = bridge();
    receiver.beginGeneration(8n);
    receiver.receive(makePacket(8n, 41n, 101n));
    receiver.receive(makePacket(8n, 53n, 144n));
    expect(painted).toEqual([101n, 144n]);
    expect(watermarks[watermarks.length - 1]).toEqual({ generation: 8n, consumedDeliverySeq: 53n });
  });

  it("reports receiver idle after 500 ms and a later packet resumes cleanly", () => {
    const receiver = bridge();
    receiver.beginGeneration(9n);
    vi.advanceTimersByTime(500);
    expect(stalls).toBe(1);
    receiver.receive(makePacket(9n, 8n, 99n));
    expect(watermarks[watermarks.length - 1]).toEqual({ generation: 9n, consumedDeliverySeq: 8n });
    vi.advanceTimersByTime(499);
    expect(stalls).toBe(1);
  });

  it("does not reset watermark or flow control state when beginGeneration is called repeatedly with the same active generation", () => {
    const receiver = bridge({ watermarkFrameInterval: 2 });
    receiver.beginGeneration(10n);
    receiver.receive(makePacket(10n, 1n, 100n)); // 1st frame accepted, reports immediate watermark
    expect(watermarks.length).toBe(1);

    // Redundant call with same active generation during playback must not wipe tracking
    receiver.beginGeneration(10n);
    receiver.receive(makePacket(10n, 2n, 101n)); // 2nd frame accepted, triggers 2-frame interval watermark
    expect(watermarks.length).toBe(2);
    expect(watermarks[1]).toEqual({ generation: 10n, consumedDeliverySeq: 2n });
    expect(painted).toEqual([100n, 101n]);
  });

  it("drops packets when stopped and resumes cleanly after beginGeneration", () => {
    const receiver = bridge();
    receiver.beginGeneration(11n);
    receiver.receive(makePacket(11n, 1n, 200n));
    expect(painted).toEqual([200n]);

    receiver.stop();
    expect(receiver.receive(makePacket(11n, 2n, 201n))).toBe(false);
    expect(painted).toEqual([200n]); // 201n was rejected while stopped

    receiver.beginGeneration(11n); // Re-activate same generation
    expect(receiver.receive(makePacket(11n, 3n, 202n))).toBe(true);
    expect(painted).toEqual([200n, 202n]);
  });
});
