import {
  hideNativeSurface,
  isTauriRuntime,
} from "@/lib/platform/tauri";
import { tracePlayback } from "@/core/playback/playbackTrace";

// Native surface commands address one process-global child window in the Tauri
// host. Keep lifecycle operations ordered across React mounts and project
// transitions so a stale cleanup cannot hide a newly opened project's surface.
let nativeSurfaceOperationTail: Promise<void> = Promise.resolve();

interface SurfaceReadinessState {
  generation: number;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
  ready: boolean;
}

export interface NativeSurfaceReadinessToken {
  projectId: string;
  generation: number;
}

let surfaceGeneration = 0;
const surfaceReadiness = new Map<string, SurfaceReadinessState>();

export function enqueueNativeSurfaceOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const next = nativeSurfaceOperationTail.then(operation, operation);
  nativeSurfaceOperationTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Wait until all earlier native surface operations finish, then hide the
 * process-global surface. Project close uses this before releasing session
 * resources; preview cleanup uses the same queue.
 */
export function hideNativeSurfaceWhenIdle(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return enqueueNativeSurfaceOperation(() => hideNativeSurface());
}

export function resetNativeSurfaceReadiness(projectId: string): void {
  const previous = surfaceReadiness.get(projectId);
  if (previous && !previous.settled) {
    previous.reject(new Error("Native preview surface initialization was superseded"));
  }

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  // A surface can be superseded during the placeholder-to-editor handoff.
  // Keep the rejection observable to explicit waiters without allowing a
  // stale internal generation to produce an unhandled Promise rejection.
  void promise.catch(() => undefined);
  surfaceReadiness.set(projectId, {
    generation: ++surfaceGeneration,
    promise,
    resolve,
    reject,
    settled: false,
    ready: false,
  });
  tracePlayback("surface-readiness-reset", { projectId });
}

export function ensureNativeSurfaceReadiness(projectId: string): void {
  const state = surfaceReadiness.get(projectId);
  if (!state || (state.settled && !state.ready)) {
    resetNativeSurfaceReadiness(projectId);
  }
}

export function isNativeSurfaceReady(projectId: string): boolean {
  const state = surfaceReadiness.get(projectId);
  return Boolean(state?.settled && state.ready);
}

export function waitForNativeSurfaceReady(projectId: string): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  let state = surfaceReadiness.get(projectId);
  if (!state) {
    resetNativeSurfaceReadiness(projectId);
    state = surfaceReadiness.get(projectId);
  }
  return state?.promise ?? Promise.resolve();
}

export function claimNativeSurfaceReadiness(
  projectId: string,
): NativeSurfaceReadinessToken {
  let state = surfaceReadiness.get(projectId);
  if (!state) {
    resetNativeSurfaceReadiness(projectId);
    state = surfaceReadiness.get(projectId);
  }
  return { projectId, generation: state?.generation ?? 0 };
}

function getCurrentReadinessState(
  token: NativeSurfaceReadinessToken,
): SurfaceReadinessState | null {
  const state = surfaceReadiness.get(token.projectId);
  return state && state.generation === token.generation ? state : null;
}

export function markNativeSurfaceReady(
  token: NativeSurfaceReadinessToken,
): void {
  const state = getCurrentReadinessState(token);
  if (!state || state.settled) return;
  state.settled = true;
  state.ready = true;
  state.resolve();
  tracePlayback("surface-ready", {
    projectId: token.projectId,
    generation: token.generation,
  });
}

export function failNativeSurfaceReadiness(
  token: NativeSurfaceReadinessToken,
  error: unknown,
): void {
  const state = getCurrentReadinessState(token);
  if (!state || state.settled) return;
  state.settled = true;
  state.reject(error);
  tracePlayback("surface-error", {
    projectId: token.projectId,
    generation: token.generation,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function invalidateNativeSurfaceReadiness(
  token: NativeSurfaceReadinessToken,
): void {
  const state = getCurrentReadinessState(token);
  if (!state || state.settled) return;
  state.settled = true;
  state.reject(new Error("Native preview surface was unmounted"));
}

export function releaseNativeSurfaceReadiness(
  token: NativeSurfaceReadinessToken,
): void {
  const state = getCurrentReadinessState(token);
  if (!state) return;
  if (!state.settled) {
    state.settled = true;
    state.reject(new Error("Native preview surface was released"));
  }
  surfaceReadiness.delete(token.projectId);
  tracePlayback("surface-released", {
    projectId: token.projectId,
    generation: token.generation,
  });
}

export function clearNativeSurfaceReadiness(projectId: string): void {
  const state = surfaceReadiness.get(projectId);
  if (state && !state.settled) {
    state.settled = true;
    state.reject(new Error("Native preview surface was closed"));
  }
  surfaceReadiness.delete(projectId);
  tracePlayback("surface-cleared", { projectId });
}
