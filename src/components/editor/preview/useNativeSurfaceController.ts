import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackClock } from "@/core/playback/PlaybackClock";
import {
  getNativePreviewSurfaceGeometry,
  getNativeGpuStatus,
  isTauriRuntime,
  listenForGpuFailed,
  listenForGpuReady,
  markGpuAwaited,
  onNativePreviewWindowMoved,
} from "@/lib/platform/tauri";
import {
  EMBEDDED_PREVIEW_ONLY,
  type NativeSurfaceGeometry,
} from "@/lib/platform/nativeCore";
import {
  claimNativeSurfaceReadiness,
  configureNativeSurface,
  failNativeSurfaceReadiness,
  isNativeSurfaceRequestSuperseded,
  markNativeSurfaceReady,
  releaseNativeSurface,
  releaseNativeSurfaceReadiness,
} from "@/core/runtime/nativeSurfaceLifecycle";
import { appLifecycleCoordinator } from "@/core/runtime/AppLifecycleCoordinator";
import { tracePlayback } from "@/core/playback/playbackTrace";

interface NativeSurfaceControllerOptions {
  projectId: string | undefined;
  clock: PlaybackClock;
  viewportReady: boolean;
  onSurfaceReady: () => void;
}

/**
 * Owns the retained desktop preview surface lifecycle.
 *
 * The program preview's render loop only consumes the returned imperative
 * refs. Geometry, GPU readiness, and async surface transactions live here so
 * they cannot be accidentally restarted by UI state changes.
 */
export function useNativeSurfaceController({
  projectId,
  clock,
  viewportReady,
  onSurfaceReady,
}: NativeSurfaceControllerOptions) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpuReady, setGpuReady] = useState(!isTauriRuntime());
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  const targetRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const configuredRef = useRef(false);
  const geometrySettledRef = useRef(false);
  const readyRevisionRef = useRef(0);

  const targetCallback = useCallback((node: HTMLDivElement | null) => {
    targetRef.current = node;
    setTarget(node);
  }, []);

  // GPU initialization is process-wide and may lag the WebView on Windows.
  // Listen for the event and retain a small polling fallback for an event that
  // fired before this component mounted.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void markGpuAwaited();

    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const clearPoll = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const fail = (reason: string) => {
      const message = `GPU initialization failed: ${reason}`;
      errorRef.current = message;
      setError(message);
      clearPoll();
    };
    const checkNow = () => {
      void getNativeGpuStatus()
        .then((status) => {
          if (disposed) return;
          if (status.state === "ready") {
            setGpuReady(true);
            clearPoll();
          } else if (status.state === "failed") {
            fail(status.failureReason || "Unknown failure");
          }
        })
        .catch(() => undefined);
    };

    checkNow();
    pollTimer = setInterval(checkNow, 150);
    let unlistenReady: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;
    void listenForGpuReady(() => {
      if (!disposed) {
        setGpuReady(true);
        clearPoll();
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenReady = unlisten;
    });
    void listenForGpuFailed((reason) => {
      if (!disposed) fail(reason);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenFailed = unlisten;
    });

    return () => {
      disposed = true;
      clearPoll();
      unlistenReady?.();
      unlistenFailed?.();
    };
  }, []);

  useEffect(() => {
    // A Tauri child window cannot be kept within the editor on every desktop
    // compositor (notably Wayland). The visible preview is therefore always
    // the canvas in the main WebView. Do not even create/configure the legacy
    // native child surface: a hidden window can still be surfaced by platform
    // activation or space/full-screen transitions.
    if (EMBEDDED_PREVIEW_ONLY) return;

    const initialTarget = targetRef.current || target;
    if (
      !isTauriRuntime() ||
      !projectId ||
      !initialTarget ||
      !viewportReady ||
      !gpuReady
    ) {
      return;
    }

    const readinessToken = claimNativeSurfaceReadiness(projectId);
    let active = true;
    let syncInFlight = false;
    let syncRequested = false;
    let appliedGeometryKey = "";
    const geometryKey = (geometry: NativeSurfaceGeometry) =>
      [
        geometry.xPhysical,
        geometry.yPhysical,
        geometry.widthPhysical,
        geometry.heightPhysical,
        geometry.devicePixelRatio,
      ].join(":");

    const syncSurface = () => {
      syncRequested = true;
      if (syncInFlight) return;
      syncInFlight = true;
      errorRef.current = null;
      setError(null);
      void (async () => {
        try {
          while (active && syncRequested) {
            syncRequested = false;
            const currentTarget = targetRef.current || target;
            if (!currentTarget) break;
            const geometry = await getNativePreviewSurfaceGeometry(currentTarget);
            if (!active) break;
            const nextGeometryKey = geometryKey(geometry);
            if (nextGeometryKey === appliedGeometryKey && configuredRef.current) {
              continue;
            }
            await configureNativeSurface(projectId, geometry);
            if (!active) break;
            configuredRef.current = true;
            appliedGeometryKey = nextGeometryKey;
            geometrySettledRef.current = true;
            readyRef.current = true;
            errorRef.current = null;
            setError(null);
            setReady(true);
            markNativeSurfaceReady(readinessToken);
            readyRevisionRef.current += 1;
            onSurfaceReady();

            tracePlayback("surface-geometry-sync", {
              projectId,
              xPhysical: geometry.xPhysical,
              yPhysical: geometry.yPhysical,
              widthPhysical: geometry.widthPhysical,
              heightPhysical: geometry.heightPhysical,
              dpr: geometry.devicePixelRatio,
              isPlaying: clock.state === "playing",
            });
          }
        } catch (caught) {
          if (isNativeSurfaceRequestSuperseded(caught)) return;
          configuredRef.current = false;
          geometrySettledRef.current = false;
          if (active) {
            const message = caught instanceof Error ? caught.message : String(caught);
            errorRef.current = message;
            readyRef.current = false;
            setError(message);
            setReady(false);
            failNativeSurfaceReadiness(readinessToken, caught);
          }
        } finally {
          syncInFlight = false;
          if (active && syncRequested) syncSurface();
        }
      })();
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const requestSync = (immediate = false) => {
      if (immediate || clock.state === "playing") {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = null;
        syncSurface();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (active) syncSurface();
      }, 100);
    };

    requestSync(true);
    const handleWindowResize = () => requestSync(false);
    let unlistenWindowMoved: (() => void | Promise<void>) | null = null;
    void onNativePreviewWindowMoved(() => requestSync(clock.state === "playing"))
      .then((unlisten) => {
        if (active) unlistenWindowMoved = unlisten;
        else void Promise.resolve(unlisten()).catch(() => undefined);
      })
      .catch(() => undefined);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => requestSync(false))
        : null;
    resizeObserver?.observe(initialTarget);
    window.addEventListener("resize", handleWindowResize);
    const unsubscribeClockSync = clock.subscribe((snapshot) => {
      if (snapshot.state === "playing") requestSync(true);
    });
    const unsubscribeLifecycle = appLifecycleCoordinator.onForegroundWakeup(() => {
      if (active) requestSync(true);
    });

    return () => {
      active = false;
      unsubscribeLifecycle();
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeClockSync();
      resizeObserver?.disconnect();
      if (unlistenWindowMoved) {
        void Promise.resolve(unlistenWindowMoved()).catch(() => undefined);
      }
      window.removeEventListener("resize", handleWindowResize);
      configuredRef.current = false;
      geometrySettledRef.current = false;
      readyRef.current = false;
      errorRef.current = null;
      setError(null);
      setReady(false);
      releaseNativeSurfaceReadiness(readinessToken);
      void releaseNativeSurface(projectId).catch(() => undefined);
    };
  }, [clock, gpuReady, onSurfaceReady, projectId, target, viewportReady]);

  return {
    ready,
    error,
    targetCallback,
    readyRef,
    errorRef,
    configuredRef,
    geometrySettledRef,
    readyRevisionRef,
  };
}
