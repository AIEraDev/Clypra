export interface CoalescedFrameQueue<T> {
  push(event: T): void;
  flush(): T | null;
  cancel(): void;
  dispose(): void;
}

/**
 * Latest-pointer-wins scheduling for high-frequency editor gestures.
 * Consumers perform their actual preview update in `onFrame`; this utility
 * never writes a store, history entry, or IPC request by itself.
 */
export function createLatestFrameQueue<T>(
  onFrame: (event: T) => void,
): CoalescedFrameQueue<T> {
  let pending: T | null = null;
  let rafId: number | null = null;
  let disposed = false;

  const run = () => {
    rafId = null;
    if (disposed) return;
    const event = pending;
    pending = null;
    if (event) onFrame(event);
  };

  return {
    push(event) {
      if (disposed) return;
      pending = event;
      if (rafId === null) rafId = requestAnimationFrame(run);
    },
    flush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const event = pending;
      pending = null;
      if (event && !disposed) onFrame(event);
      return event;
    },
    cancel() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = null;
    },
    dispose() {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pending = null;
    },
  };
}

export type CoalescedPointerDrag = CoalescedFrameQueue<PointerEvent>;

export function createCoalescedPointerDrag(
  onFrame: (event: PointerEvent) => void,
): CoalescedPointerDrag {
  return createLatestFrameQueue(onFrame);
}
