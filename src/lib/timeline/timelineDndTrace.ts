export function traceTimelineDnd(event: string, details?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[TimelineDnD] ${event}`, details ?? {});
}
