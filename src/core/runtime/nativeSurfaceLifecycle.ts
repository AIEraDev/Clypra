import {
  hideNativeSurface,
  isTauriRuntime,
  probeNativeSurface,
  resizeNativeSurface,
} from "@/lib/platform/tauri";
import { tracePlayback } from "@/core/playback/playbackTrace";
import type {
  NativeSurfaceGeometry,
  NativeSurfaceProbe,
} from "@/lib/platform/nativeCore";
import { EMBEDDED_PREVIEW_ONLY } from "@/lib/platform/nativeCore";

// Native surface commands address one process-global child window in the Tauri
// host. Keep lifecycle operations ordered across React mounts and project
// transitions so a stale cleanup cannot hide a newly opened project's surface.
let nativeSurfaceOperationTail: Promise<void> = Promise.resolve();
let nativeSurfaceOwner: string | null = null;
let nativeSurfaceGeometryKey = "";
let nativeSurfaceConfigured = false;
let nativeSurfaceRevision = 0;
let nativeSurfaceProbe: NativeSurfaceProbe | null = null;

function getGeometryKey(geometry: NativeSurfaceGeometry): string {
  return [
    geometry.xPhysical,
    geometry.yPhysical,
    geometry.widthPhysical,
    geometry.heightPhysical,
    geometry.devicePixelRatio,
  ].join(":");
}

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

export interface NativeSurfaceConfiguration {
  ownerProjectId: string;
  revision: number;
  geometryKey: string;
  probe: NativeSurfaceProbe;
}

export function isNativeSurfaceRequestSuperseded(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Native surface geometry request was superseded"
  );
}

/**
 * Configure the process-global native surface as one transaction.
 *
 * A preview component must not independently hide, resize, or probe this
 * surface. Those operations are global and React effects can outlive the
 * component that scheduled them. The coordinator owns the surface identity
 * and serializes the complete hide -> configure -> ready transaction.
 */
export function configureNativeSurface(
  ownerProjectId: string,
  geometry: NativeSurfaceGeometry,
): Promise<NativeSurfaceConfiguration> {
  const requestedRevision = ++nativeSurfaceRevision;
  const requestedGeometryKey = getGeometryKey(geometry);

  if (!isTauriRuntime()) {
    return Promise.reject(
      new Error("Native surface requires the Tauri runtime"),
    );
  }

  return enqueueNativeSurfaceOperation(async () => {
    if (requestedRevision !== nativeSurfaceRevision) {
      throw new Error("Native surface geometry request was superseded");
    }

    if (
      nativeSurfaceConfigured &&
      nativeSurfaceOwner === ownerProjectId &&
      nativeSurfaceGeometryKey === requestedGeometryKey &&
      nativeSurfaceProbe
    ) {
      return {
        ownerProjectId,
        revision: requestedRevision,
        geometryKey: requestedGeometryKey,
        probe: nativeSurfaceProbe,
      };
    }

    // A geometry update must not blank the retained frame. The native surface
    // remains visible while the OS moves/resizes it; the operation lane keeps
    // the resize ahead of the next presentation. Only a new owner requires a
    // hide before the initial configure.
    const ownerChanged =
      nativeSurfaceConfigured && nativeSurfaceOwner !== ownerProjectId;
    if (ownerChanged || !nativeSurfaceConfigured) {
      await hideNativeSurface().catch(() => undefined);
    }
    const probe =
      nativeSurfaceConfigured && !ownerChanged
        ? await resizeNativeSurface(geometry)
        : await probeNativeSurface(geometry);

    if (!nativeSurfaceConfigured || ownerChanged) {
      await hideNativeSurface().catch(() => undefined);
    }

    nativeSurfaceOwner = ownerProjectId;
    nativeSurfaceGeometryKey = requestedGeometryKey;
    nativeSurfaceConfigured = true;
    nativeSurfaceProbe = probe;

    return {
      ownerProjectId,
      revision: requestedRevision,
      geometryKey: requestedGeometryKey,
      probe,
    };
  });
}

/** Serialize a frame presentation behind surface configuration/release. */
export function presentOnNativeSurface<T>(
  ownerProjectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return enqueueNativeSurfaceOperation(async () => {
    if (!nativeSurfaceConfigured || nativeSurfaceOwner !== ownerProjectId) {
      throw new Error(
        "Native preview surface is not configured for this project",
      );
    }
    return operation();
  });
}

/** Release ownership only after all prior presents have completed. */
export function releaseNativeSurface(ownerProjectId: string): Promise<void> {
  nativeSurfaceRevision += 1;
  if (!isTauriRuntime()) return Promise.resolve();
  return enqueueNativeSurfaceOperation(async () => {
    if (nativeSurfaceOwner !== ownerProjectId) return;
    await hideNativeSurface().catch(() => undefined);
    nativeSurfaceOwner = null;
    nativeSurfaceGeometryKey = "";
    nativeSurfaceConfigured = false;
    nativeSurfaceProbe = null;
  });
}

export function resetNativeSurfaceReadiness(projectId: string): void {
  const previous = surfaceReadiness.get(projectId);
  if (previous && !previous.settled) {
    previous.reject(
      new Error("Native preview surface initialization was superseded"),
    );
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
}

export function ensureNativeSurfaceReadiness(projectId: string): void {
  if (EMBEDDED_PREVIEW_ONLY) return;
  const state = surfaceReadiness.get(projectId);
  if (!state || (state.settled && !state.ready)) {
    resetNativeSurfaceReadiness(projectId);
  }
}

export function isNativeSurfaceReady(projectId: string): boolean {
  if (EMBEDDED_PREVIEW_ONLY) return true;
  const state = surfaceReadiness.get(projectId);
  return Boolean(state?.settled && state.ready);
}

export async function waitForNativeSurfaceReady(
  projectId: string,
  timeoutMs = 3000,
): Promise<void> {
  // The main WebView canvas needs no second-window startup handshake.
  if (EMBEDDED_PREVIEW_ONLY) return;
  if (!isTauriRuntime()) return;
  let state = surfaceReadiness.get(projectId);
  if (!state) {
    resetNativeSurfaceReadiness(projectId);
    state = surfaceReadiness.get(projectId);
  }
  if (!state || (state.settled && state.ready)) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[nativeSurfaceLifecycle] Native preview surface readiness timed out after ${timeoutMs}ms for project ${projectId}. Proceeding gracefully with editor load.`,
      );
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([state.promise, timeoutPromise]);
  } catch (error) {
    console.warn(
      `[nativeSurfaceLifecycle] Native preview surface readiness reported an error during load:`,
      error,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
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
}

export function failNativeSurfaceReadiness(
  token: NativeSurfaceReadinessToken,
  error: unknown,
): void {
  const state = getCurrentReadinessState(token);
  if (!state || state.settled) return;
  state.settled = true;
  state.reject(error);
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
}

export function clearNativeSurfaceReadiness(projectId: string): void {
  const state = surfaceReadiness.get(projectId);
  if (state && !state.settled) {
    state.settled = true;
    state.reject(new Error("Native preview surface was closed"));
  }
  surfaceReadiness.delete(projectId);
}

/**
 * Reset all process-global native surface coordinator state.
 * Called on project close to ensure the next opened project undergoes a
 * completely clean surface configuration transaction.
 */
export function resetGlobalNativeSurfaceCoordinator(): void {
  nativeSurfaceOwner = null;
  nativeSurfaceGeometryKey = "";
  nativeSurfaceConfigured = false;
  nativeSurfaceRevision = 0;
  nativeSurfaceProbe = null;
  for (const [projectId, state] of surfaceReadiness.entries()) {
    if (!state.settled) {
      state.settled = true;
      state.reject(new Error("Native preview surface coordinator was reset"));
    }
  }
  surfaceReadiness.clear();
}
