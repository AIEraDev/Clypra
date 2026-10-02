/**
 * JS half of the Phase 2b playback bridge.
 *
 * It deliberately owns only continuous-playback packets. Exact seek and scrub
 * stay on NativePreviewFrameScheduler, where request cancellation and exact
 * target identity are already enforced. `deliverySeq` is a transport counter;
 * `frameId` is render identity and may skip when Rust supersedes mailbox work.
 */
export type PlaybackPushWatermark = {
  generation: bigint;
  consumedDeliverySeq: bigint;
  paintedFrameId: bigint;
  t11EpochUs: bigint;
};

export type PlaybackPushPacket = {
  generation: bigint;
  deliverySeq: bigint;
  frameId: bigint;
  t8EpochUs: bigint;
  width: number;
  height: number;
  stride: number;
  pixels: Uint8ClampedArray;
};

export type PlaybackPushBridgeOptions = {
  /** Paint only a packet accepted for the current playback generation. */
  paint: (packet: PlaybackPushPacket) => void;
  /** Batched, out-of-band feedback. It must never gate packet receipt. */
  reportWatermark: (watermark: PlaybackPushWatermark) => void;
  /** Receiver-side silence only; Rust owns authoritative stream-stall state. */
  onReceiverIdle?: () => void;
  watermarkIntervalMs?: number;
  watermarkFrameInterval?: number;
  watchdogMs?: number;
};

const HEADER_BYTES = 52;
const MAGIC = 0x4350_4652;

function epochUs(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1_000));
}

export function parsePlaybackPushPacket(buffer: ArrayBuffer): PlaybackPushPacket {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("Push packet is shorter than its header");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== 1) {
    throw new Error("Unsupported push-bridge packet header");
  }
  const headerBytes = view.getUint16(6, true);
  const width = view.getUint32(40, true);
  const height = view.getUint32(44, true);
  const stride = view.getUint32(48, true);
  const requiredBytes = headerBytes + stride * height;
  if (headerBytes !== HEADER_BYTES || width === 0 || height === 0 || stride < width * 4 || buffer.byteLength < requiredBytes) {
    throw new Error("Malformed push-bridge frame layout");
  }
  return {
    generation: view.getBigUint64(8, true),
    deliverySeq: view.getBigUint64(16, true),
    frameId: view.getBigUint64(24, true),
    t8EpochUs: view.getBigUint64(32, true),
    width,
    height,
    stride,
    pixels: new Uint8ClampedArray(buffer, headerBytes, stride * height),
  };
}

/**
 * A generation-fenced receiver with batched watermark feedback. This class is
 * transport-agnostic: Channel, protocol long-poll, and shared buffers can all
 * feed `receive` without changing exact-frame code.
 */
export class PlaybackPushBridge {
  private generation = 0n;
  private acceptedInGeneration = 0;
  private lastConsumedDeliverySeq = 0n;
  private lastPaintedFrameId = 0n;
  private lastWatermarkAtMs = 0;
  private lastProgressAtMs = 0;
  private stopped = true;
  private watchdogTimer: number | null = null;
  private readonly watermarkIntervalMs: number;
  private readonly watermarkFrameInterval: number;
  private readonly watchdogMs: number;

  constructor(private readonly options: PlaybackPushBridgeOptions) {
    this.watermarkIntervalMs = Math.max(10, options.watermarkIntervalMs ?? 100);
    this.watermarkFrameInterval = Math.max(1, options.watermarkFrameInterval ?? 2);
    this.watchdogMs = Math.max(100, options.watchdogMs ?? 500);
  }

  /** Bump before clearing/presenting another mode; stale packets are ignored. */
  beginGeneration(generation: bigint): void {
    if (generation < this.generation) return;
    if (!this.stopped && generation === this.generation) return;
    this.generation = generation;
    this.acceptedInGeneration = 0;
    this.lastConsumedDeliverySeq = 0n;
    this.lastPaintedFrameId = 0n;
    this.lastProgressAtMs = performance.now();
    this.lastWatermarkAtMs = 0;
    this.stopped = false;
    this.armWatchdog();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdogTimer !== null) window.clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  receive(buffer: ArrayBuffer): boolean {
    if (this.stopped) return false;
    const packet = parsePlaybackPushPacket(buffer);
    // The mode fence is deliberately before paint: a late playback packet can
    // never overwrite an exact seek frame after its generation bump.
    if (packet.generation !== this.generation) return false;

    this.options.paint(packet);
    requestAnimationFrame(() => {
      if (this.stopped || packet.generation !== this.generation) return;
      this.lastConsumedDeliverySeq = packet.deliverySeq;
      this.lastPaintedFrameId = packet.frameId;
      this.acceptedInGeneration += 1;
      this.lastProgressAtMs = performance.now();
      const immediate = this.acceptedInGeneration === 1;
      if (
        immediate ||
        this.acceptedInGeneration % this.watermarkFrameInterval === 0 ||
        this.lastProgressAtMs - this.lastWatermarkAtMs >= this.watermarkIntervalMs
      ) {
        this.flushWatermark();
      }
    });
    return true;
  }

  flushWatermark(): void {
    if (this.stopped || this.lastConsumedDeliverySeq === 0n) return;
    this.lastWatermarkAtMs = performance.now();
    this.options.reportWatermark({
      generation: this.generation,
      consumedDeliverySeq: this.lastConsumedDeliverySeq,
      paintedFrameId: this.lastPaintedFrameId,
      t11EpochUs: epochUs(),
    });
  }

  private armWatchdog(): void {
    if (this.watchdogTimer !== null) window.clearInterval(this.watchdogTimer);
    this.watchdogTimer = window.setInterval(() => {
      if (this.stopped || performance.now() - this.lastProgressAtMs < this.watchdogMs) return;
      this.lastProgressAtMs = performance.now();
      // JS cannot know whether Rust has frames in flight. This is therefore
      // receiver silence, not a transport failure; the mailbox watchdog is
      // the sole authority for `stream_stall` telemetry.
      this.options.onReceiverIdle?.();
    }, this.watchdogMs);
  }
}
