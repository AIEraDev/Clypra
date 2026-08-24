/**
 * Metadata for a transport request. The clock remains the authoritative time
 * signal; this controller gives asynchronous preview work a stable identity so
 * obsolete decode results can never win a race with a newer seek.
 */
export type SeekMode = "playback" | "scrub" | "seek" | "frameStep";
export type SeekQuality = "full" | "half" | "quarter" | "proxy";

export interface SeekIntentInput {
  time: number;
  mode: SeekMode;
  velocityPxPerSecond?: number;
  quality?: SeekQuality;
  targetFrame?: number;
}

export interface SeekIntent extends SeekIntentInput {
  generation: number;
  requestId: string;
  issuedAtMs: number;
  velocityPxPerSecond: number;
  quality: SeekQuality;
}

export type SeekIntentListener = (intent: SeekIntent) => void;

export function qualityForScrubVelocity(velocityPxPerSecond: number): SeekQuality {
  const velocity = Math.abs(Number.isFinite(velocityPxPerSecond) ? velocityPxPerSecond : 0);
  if (velocity >= 2_400) return "quarter";
  if (velocity >= 900) return "half";
  return "full";
}

/**
 * Latest-request-wins controller shared by transport input and asynchronous
 * preview consumers. It deliberately contains no React or renderer state.
 */
export class SeekController {
  private generation = 0;
  private currentIntent: SeekIntent | null = null;
  private listeners = new Set<SeekIntentListener>();
  private disposed = false;

  request(input: SeekIntentInput): SeekIntent {
    if (this.disposed) {
      throw new Error("SeekController is disposed");
    }

    const velocity = Number.isFinite(input.velocityPxPerSecond)
      ? input.velocityPxPerSecond ?? 0
      : 0;
    const quality = input.quality ?? (
      input.mode === "scrub" ? qualityForScrubVelocity(velocity) : "full"
    );
    const intent: SeekIntent = {
      ...input,
      generation: ++this.generation,
      requestId: `seek-${this.generation}`,
      issuedAtMs: performance.now(),
      velocityPxPerSecond: velocity,
      quality,
    };
    this.currentIntent = intent;
    this.listeners.forEach((listener) => listener(intent));
    return intent;
  }

  invalidate(): number {
    if (this.disposed) return this.generation;
    this.generation += 1;
    this.currentIntent = null;
    return this.generation;
  }

  getGeneration(): number {
    return this.generation;
  }

  getCurrent(): SeekIntent | null {
    return this.currentIntent;
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  subscribe(listener: SeekIntentListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.currentIntent = null;
    this.listeners.clear();
  }
}
