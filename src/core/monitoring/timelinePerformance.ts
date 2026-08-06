/**
 * Timeline Performance Tracking
 *
 * Focused logging for timeline-specific operations.
 * Enable via localStorage: localStorage.setItem('debug:timeline-perf', 'true')
 */

const STORAGE_KEY = "debug:timeline-perf";

export function isTimelinePerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function enableTimelinePerf(): void {
  localStorage.setItem(STORAGE_KEY, "true");
  console.log("✅ Timeline performance logging enabled");
}

export function disableTimelinePerf(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log("❌ Timeline performance logging disabled");
}

interface TimelinePerfEntry {
  operation: string;
  startTime: number;
  metadata?: Record<string, any>;
}

const activeOperations = new Map<string, TimelinePerfEntry>();

/**
 * Start tracking a timeline operation
 */
export function timelineStart(operation: string, metadata?: Record<string, any>): void {
  if (!isTimelinePerfEnabled()) return;

  const key = `${operation}-${Date.now()}`;
  activeOperations.set(key, {
    operation,
    startTime: performance.now(),
    metadata,
  });

  const metaStr = metadata ? ` - ${JSON.stringify(metadata)}` : "";
  console.log(`⏱️ [Timeline] ${operation} started${metaStr}`);
}

/**
 * End tracking a timeline operation
 */
export function timelineEnd(operation: string, result?: Record<string, any>): void {
  if (!isTimelinePerfEnabled()) return;

  // Find the most recent matching operation
  let matchKey: string | undefined;
  for (const [key, entry] of activeOperations.entries()) {
    if (entry.operation === operation) {
      matchKey = key;
    }
  }

  if (!matchKey) {
    console.warn(`⚠️ [Timeline] No active operation found: ${operation}`);
    return;
  }

  const entry = activeOperations.get(matchKey)!;
  const duration = performance.now() - entry.startTime;
  activeOperations.delete(matchKey);

  const emoji = duration < 16 ? "✅" : duration < 50 ? "⚠️" : "🔴";
  const severity = duration < 16 ? "Fast" : duration < 50 ? "Slow" : "Very Slow";
  const resultStr = result ? ` - ${JSON.stringify(result)}` : "";

  console.log(`${emoji} [Timeline] ${operation} completed in ${duration.toFixed(2)}ms (${severity})${resultStr}`);
}

/**
 * Log a timeline event
 */
export function timelineLog(message: string, data?: any): void {
  if (!isTimelinePerfEnabled()) return;

  const dataStr = data ? ` - ${JSON.stringify(data)}` : "";
  console.log(`📊 [Timeline] ${message}${dataStr}`);
}

// Console helpers
if (typeof window !== "undefined") {
  (window as any).__timelinePerf = {
    enable: enableTimelinePerf,
    disable: disableTimelinePerf,
    isEnabled: isTimelinePerfEnabled,
  };
}
