/**
 * Phase 2 Audio-Sync Timeline Tracing — INVESTIGATION ONLY
 * 
 * Captures a monotonic play-start timeline for root-cause investigation.
 * All instrumentation gated behind `(window as any).__CLYPRA_AUDIO_TRACE === true`.
 * 
 * **REMOVE BEFORE PHASE 6** — This is investigation code only, not production.
 */

export interface AudioTraceEvent {
  id: string;
  timestamp: number; // performance.now()
  label: string;
  data?: Record<string, any>;
}

// INVESTIGATION ONLY — remove before Phase 6
function isTraceEnabled(): boolean {
  return (window as any).__CLYPRA_AUDIO_TRACE === true;
}

// INVESTIGATION ONLY — remove before Phase 6
function ensureTraceLog(): AudioTraceEvent[] {
  if (!isTraceEnabled()) return [];
  if (!(window as any).__CLYPRA_AUDIO_TRACE_LOG) {
    (window as any).__CLYPRA_AUDIO_TRACE_LOG = [];
  }
  return (window as any).__CLYPRA_AUDIO_TRACE_LOG;
}

// INVESTIGATION ONLY — remove before Phase 6
export function traceAudioEvent(
  id: string,
  label: string,
  data?: Record<string, any>
): void {
  if (!isTraceEnabled()) return; // Zero overhead when disabled
  const log = ensureTraceLog();
  log.push({
    id,
    timestamp: performance.now(),
    label,
    data: data || {},
  });
}

// INVESTIGATION ONLY — remove before Phase 6
export function dumpAudioTrace(): void {
  if (!isTraceEnabled()) {
    console.warn("[AudioTrace] Tracing is disabled. Set (window as any).__CLYPRA_AUDIO_TRACE = true to enable.");
    return;
  }
  const log = (window as any).__CLYPRA_AUDIO_TRACE_LOG || [];
  if (log.length === 0) {
    console.log("[AudioTrace] No events captured.");
    return;
  }
  
  const t0 = log[0]?.timestamp || 0;
  console.table(
    log.map((event: AudioTraceEvent) => ({
      id: event.id,
      "Δt (ms)": (event.timestamp - t0).toFixed(2),
      label: event.label,
      ...event.data,
    }))
  );
  console.log(`[AudioTrace] Total events: ${log.length}, duration: ${(log[log.length - 1].timestamp - t0).toFixed(2)} ms`);
}

// INVESTIGATION ONLY — remove before Phase 6
export function clearAudioTrace(): void {
  if (!isTraceEnabled()) return;
  (window as any).__CLYPRA_AUDIO_TRACE_LOG = [];
}

// Expose dump/clear to window for easy console access
if (typeof window !== "undefined") {
  (window as any).dumpAudioTrace = dumpAudioTrace;
  (window as any).clearAudioTrace = clearAudioTrace;
}
