/**
 * ClipFilmstrip — Phase 3 refactor
 *
 * Pure canvas consumer. Zero orchestration logic.
 * All extraction, epoch management, and scheduling is handled by:
 *   useFilmstrip()     → requests artifacts via RenderRuntime + transport layer
 *   RasterSurface      → draws ImageBitmaps onto canvas (zero browser resampling)
 *
 * This component:
 *   - Renders a <canvas> backed by RasterSurface
 *   - Progressive rendering: shows frames as they arrive, not all-at-once
 *   - Keeps previous committed pixels visible during epoch transitions (zoom)
 */

import { useEffect, useLayoutEffect, useRef, useMemo, useState } from "react";
import { platform } from "@/core/platform";
import { cn } from "@/lib/utils";
import {
  createRasterSurface,
  type AnyRasterSurface,
} from "@/lib/renderEngine/webglRasterSurface";
import { useFilmstrip } from "@/lib/filmstrip/useFilmstrip";
import { useRenderRuntime } from "@/hooks/useRenderRuntime";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import {
  getFilmstripRenderWindow,
  getFilmstripTileWidthForTier,
} from "@/lib/filmstrip/filmstripLayout";
import { generateViewportTileAddresses } from "@/lib/filmstrip/filmstripTiers";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";
import { useTimelineStore } from "@/store/timelineStore";
import type { Clip, MediaAsset } from "@/types";
import type { RenderEpochId, SpatialTier } from "@/lib/renderEngine/types";
import {
  startMetricsFlushLoop,
  recordPaintCommit,
} from "@/lib/renderEngine/filmstripMetrics";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

/**
 * No-op kept for test compatibility.
 */
export function clearFilmstripFrameCache(): void {}

type FilmstripRenderWindow = ReturnType<typeof getFilmstripRenderWindow>;

function areRenderWindowsEqual(
  a: FilmstripRenderWindow | undefined,
  b: FilmstripRenderWindow,
): boolean {
  return (
    !!a &&
    a.leftPx === b.leftPx &&
    a.widthPx === b.widthPx &&
    a.trimIn === b.trimIn &&
    a.trimOut === b.trimOut &&
    a.isVisible === b.isVisible
  );
}

/** Resolve a media source path without double-converting already-converted URLs. */
function resolveMediaSrc(path: string): string {
  if (!path) return "";
  if (
    path.startsWith("data:") ||
    path.startsWith("asset://") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("blob:")
  ) {
    return path;
  }
  return platform.convertFileSrc(path);
}

export interface ClipFilmstripProps {
  clip: Clip;
  mediaAsset: MediaAsset;
  clipWidthPx: number;
  pixelsPerSecond: number;
  stripHeightPx?: number;
  className?: string;
}

export function ClipFilmstrip({
  clip,
  mediaAsset,
  clipWidthPx,
  pixelsPerSecond,
  stripHeightPx = 40,
  className,
}: ClipFilmstripProps) {
  // PERF: Read viewport scroll state only in ClipFilmstrip (not in parent Clip component)
  // This prevents all clips from re-rendering on scroll - only filmstrips re-render
  const viewportScrollLeft = useTimelineStore((s) => s.scrollLeft);
  const viewportWidth = useTimelineStore((s) => s.viewportWidth);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<AnyRasterSurface | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const cachedImageRef = useRef<HTMLImageElement | null>(null);
  const committedFilmstripRef = useRef<{
    clipId: string;
    epochId: RenderEpochId;
    spatialTier: SpatialTier;
    signature: string;
    renderWindow: ReturnType<typeof getFilmstripRenderWindow>;
  } | null>(null);

  // PERF-5: Debounce image redraws during active resize to avoid canvas reallocation overhead
  const [debouncedClipWidthPx, setDebouncedClipWidthPx] = useState(clipWidthPx);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedClipWidthPx(clipWidthPx);
    }, 50);
    return () => clearTimeout(handler);
  }, [clipWidthPx]);

  const isVideoSource = useMemo(() => {
    const path = mediaAsset.path ?? "";
    return (
      mediaAsset.type === "video" && path.length > 0 && !IMAGE_EXT.test(path)
    );
  }, [mediaAsset.type, mediaAsset.path]);

  const runtime = useRenderRuntime();
  const videoPath =
    isVideoSource && mediaAsset.path
      ? normalizePathForTauriInvoke(mediaAsset.path)
      : "";
  const clockState = usePlaybackClock();
  const currentTime = clockState.time;
  const clipLocalPlayheadTime = currentTime - clip.startTime + clip.trimIn;
  const playheadTime =
    clipLocalPlayheadTime >= clip.trimIn &&
    clipLocalPlayheadTime <= clip.trimOut
      ? clipLocalPlayheadTime
      : clip.trimIn;

  // ── Filmstrip data (pure projection from RenderEngine) ─────────────────────
  const { artifacts, spatialTier, epochId } = useFilmstrip({
    clipId: clip.id,
    videoPath,
    trimIn: clip.trimIn,
    trimOut: clip.trimOut,
    duration: mediaAsset.duration ?? 0,
    clipStartTime: clip.startTime,
    clipWidthPx,
    viewportScrollLeft,
    viewportWidth,
    pixelsPerSecond,
    playheadTime,
    enabled: isVideoSource && !!videoPath && !!mediaAsset.duration,
  });

  const tileWidthPx = useMemo(() => {
    return getFilmstripTileWidthForTier(spatialTier);
  }, [spatialTier]);

  useEffect(() => {
    startMetricsFlushLoop(5000);
  }, []);

  // Keep the canvas bounded to the current viewport. At deep zoom the clip's
  // DOM width can be very large, but a full-clip canvas would exceed the
  // platform's device-pixel/GPU backing-store limit. The native tile request
  // remains viewport-bounded; this is only the presentation window.
  const renderWindow = useMemo(
    () =>
      getFilmstripRenderWindow({
        clipStartTime: clip.startTime,
        clipWidthPx,
        trimIn: clip.trimIn,
        trimOut: clip.trimOut,
        viewportScrollLeft,
        viewportWidth,
        pixelsPerSecond,
      }),
    [
      clip.startTime,
      clip.trimIn,
      clip.trimOut,
      clipWidthPx,
      pixelsPerSecond,
      viewportScrollLeft,
      viewportWidth,
    ],
  );

  const tileAddresses = useMemo(
    () =>
      generateViewportTileAddresses({
        clipId: clip.id,
        videoPath,
        zoomTier: spatialTier,
        trimIn: clip.trimIn,
        trimOut: clip.trimOut,
        clipStartTime: clip.startTime,
        clipWidthPx,
        viewportScrollLeft,
        viewportWidth,
        pixelsPerSecond,
        overscanFactor: 2.0,
        videoDuration: mediaAsset.duration ?? 0,
      }),
    [
      clip.id,
      videoPath,
      spatialTier,
      clip.trimIn,
      clip.trimOut,
      clip.startTime,
      clipWidthPx,
      viewportScrollLeft,
      viewportWidth,
      pixelsPerSecond,
      mediaAsset.duration,
    ],
  );

  const tileSignature = useMemo(
    () =>
      tileAddresses
        .map(
          (address) =>
            `${address.zoomTier}:${Math.round(address.timestamp * 1000)}`,
        )
        .join("|"),
    [tileAddresses],
  );

  // A reused Clip component must not briefly display the previous clip's committed pixels.
  useEffect(() => {
    committedFilmstripRef.current = null;
  }, [clip.id, videoPath]);

  // ── RasterSurface lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // DEFENSIVE: Only create surface if not already created
    if (!surfaceRef.current) {
      surfaceRef.current = createRasterSurface(canvas);
    }

    return () => {
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, []); // only on mount/unmount

  // ── Synchronous Backing-Store Synchronization (Bug A Fix) ────────────────
  // Immediately resize canvas.width/canvas.height in useLayoutEffect before the browser
  // paints, ensuring the physical buffer resolution matches CSS width * DPR.
  // This prevents the browser compositor from bilinearly stretching the old framebuffer.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!surfaceRef.current) {
      surfaceRef.current = createRasterSurface(canvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.round(renderWindow.widthPx * dpr));
    const targetH = Math.max(1, Math.round(stripHeightPx * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;

      const layout = {
        clipWidthPx: renderWindow.widthPx,
        stripHeightPx,
        dpr,
        tileWidthPx,
        trimIn: renderWindow.trimIn,
        trimOut: renderWindow.trimOut,
        tileAddresses,
        tileCache: runtime?.tileCache,
        clipId: clip.id,
        videoPath,
        pixelsPerSecond,
        renderWindowLeftPx: renderWindow.leftPx,
        clipTrimIn: clip.trimIn,
      };

      const currentEpochArtifacts = artifacts.filter(
        (artifact) =>
          (artifact.epochId === epochId ||
            artifact.epochId === ("epoch-preload" as RenderEpochId)) &&
          artifact.spatialTier === spatialTier,
      );

      const hasAnyCacheOrArtifacts =
        currentEpochArtifacts.length > 0 ||
        (runtime?.tileCache && runtime.tileCache.getStats().tileCount > 0);

      if (hasAnyCacheOrArtifacts) {
        surfaceRef.current?.drawFilmstrip(currentEpochArtifacts, layout);
      } else {
        surfaceRef.current?.drawPlaceholder({
          clipWidthPx: renderWindow.widthPx,
          stripHeightPx,
          dpr,
          tileWidthPx,
          trimIn: renderWindow.trimIn,
          trimOut: renderWindow.trimOut,
        });
      }
    }
  }, [
    renderWindow.widthPx,
    renderWindow.leftPx,
    stripHeightPx,
    tileWidthPx,
    renderWindow.trimIn,
    renderWindow.trimOut,
    tileAddresses,
    artifacts,
    epochId,
    spatialTier,
    clip.id,
    clip.trimIn,
    videoPath,
    pixelsPerSecond,
    runtime?.tileCache,
  ]);

  // ── Epoch Transition & Debounce Gating (Unconditional Escape Timer) ─────
  // Start the 120ms debounce threshold timer immediately upon epoch/spatialTier
  // change to ensure a bounded fallback commit even if decode is delayed.
  const [epochDebounceExpired, setEpochDebounceExpired] = useState(false);

  useEffect(() => {
    setEpochDebounceExpired(false);
    const timer = setTimeout(() => {
      setEpochDebounceExpired(true);
    }, 120); // 120ms bounded fallback escape window
    return () => clearTimeout(timer);
  }, [epochId, spatialTier]);

  // ── Draw filmstrip whenever artifacts or layout changes ───────────────────
  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;

    // DEFENSIVE: Wait for both canvas AND surface to be ready
    if (!canvas || !surface) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const layout = {
      clipWidthPx: renderWindow.widthPx,
      stripHeightPx,
      dpr,
      tileWidthPx,
      trimIn: renderWindow.trimIn,
      trimOut: renderWindow.trimOut,
      tileAddresses,
      tileCache: runtime?.tileCache,
      clipId: clip.id,
      videoPath,
      pixelsPerSecond,
      renderWindowLeftPx: renderWindow.leftPx,
      clipTrimIn: clip.trimIn,
    };

    const currentEpochArtifacts = artifacts.filter(
      (artifact) =>
        (artifact.epochId === epochId ||
          artifact.epochId === ("epoch-preload" as RenderEpochId)) &&
        artifact.spatialTier === spatialTier,
    );

    const hasAllTiles =
      tileAddresses.length > 0 &&
      tileAddresses.every((addr) =>
        currentEpochArtifacts.some(
          (art) => Math.abs(art.timestampMs - addr.timestamp * 1000) < 1,
        ),
      );

    const isReadyToCommit =
      hasAllTiles ||
      epochDebounceExpired ||
      (tileAddresses.length > 0 &&
        currentEpochArtifacts.length >= tileAddresses.length);

    const hasAnyCacheOrArtifacts =
      currentEpochArtifacts.length > 0 ||
      (runtime?.tileCache && runtime.tileCache.getStats().tileCount > 0);

    if (hasAnyCacheOrArtifacts) {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      surface.drawFilmstrip(currentEpochArtifacts, layout);
      if (t0 > 0) {
        recordPaintCommit(spatialTier, performance.now() - t0);
      }
      if (isReadyToCommit) {
        const previous = committedFilmstripRef.current;
        if (
          previous?.clipId !== clip.id ||
          previous.epochId !== epochId ||
          previous.spatialTier !== spatialTier ||
          previous.signature !== tileSignature ||
          !areRenderWindowsEqual(previous.renderWindow, renderWindow)
        ) {
          committedFilmstripRef.current = {
            clipId: clip.id,
            epochId,
            spatialTier,
            signature: tileSignature,
            renderWindow,
          };
        }
      }
    } else if (!committedFilmstripRef.current) {
      // Cold start: neutral placeholder
      surface.drawPlaceholder(layout);
    }
  }, [
    artifacts,
    renderWindow,
    stripHeightPx,
    tileWidthPx,
    tileAddresses,
    clip.id,
    epochId,
    spatialTier,
    tileSignature,
    epochDebounceExpired,
    runtime,
    videoPath,
  ]);

  // ── Image tile rendering (still-image clips) ──────────────────────────────
  useEffect(() => {
    if (mediaAsset.type !== "image") return;

    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    const src = resolveMediaSrc(mediaAsset.posterFrame || mediaAsset.path);

    const drawTiles = (img: HTMLImageElement) => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, debouncedClipWidthPx);
      const h = stripHeightPx;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Professional NLE: tile count derived from temporal width
      // Match CapCut's compact design with narrow tiles
      const TILE_WIDTH = 50;
      const tileCount = Math.max(1, Math.ceil(w / TILE_WIDTH));

      for (let i = 0; i < tileCount; i++) {
        const x = i * TILE_WIDTH;
        const tileW = Math.min(TILE_WIDTH, w - x);

        // Center-crop source rect to match tile aspect ratio
        const imgAspect = img.width / img.height;
        const tileAspect = tileW / h;

        let sx: number, sy: number, sWidth: number, sHeight: number;
        if (imgAspect > tileAspect) {
          sHeight = img.height;
          sWidth = img.height * tileAspect;
          sx = (img.width - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = img.width;
          sHeight = img.width / tileAspect;
          sx = 0;
          sy = (img.height - sHeight) / 2;
        }

        ctx.drawImage(img, sx, sy, sWidth, sHeight, x, 0, tileW, h);

        // Soft tile separator for visual rhythm
        if (i > 0) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
          ctx.fillRect(x, 0, 1, h);
        }
      }

      // Subtle overall darkening so clip text / overlays remain readable
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, w, h);
    };

    // Reuse cached image if same src already decoded
    if (
      cachedImageRef.current?.src === src &&
      cachedImageRef.current.complete &&
      cachedImageRef.current.naturalWidth > 0
    ) {
      drawTiles(cachedImageRef.current);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      cachedImageRef.current = img;
      drawTiles(img);
    };
    img.onerror = () => {};
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [
    mediaAsset.type,
    mediaAsset.path,
    mediaAsset.posterFrame,
    debouncedClipWidthPx,
    stripHeightPx,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Video filmstrip — canvas surface
  if (isVideoSource) {
    const visibleWindow = renderWindow;

    return (
      <div
        data-testid="clip-filmstrip"
        className={cn(
          "relative overflow-hidden rounded-xs border border-timeline-filmstrip-border bg-timeline-filmstrip-bg",
          className,
        )}
        style={{
          height: stripHeightPx,
          width: "100%",
          opacity: 1,
          transition: "opacity 80ms linear",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            left: `${visibleWindow.leftPx}px`,
            top: 0,
            display: "block",
            width: `${visibleWindow.widthPx}px`,
            height: "100%",
          }}
        />
      </div>
    );
  }

  // Image asset — tiled canvas rendering (one decoded bitmap, many timeline tiles)
  if (
    mediaAsset.type === "image" &&
    (mediaAsset.posterFrame || mediaAsset.path)
  ) {
    return (
      <div
        data-testid="clip-filmstrip-image"
        className={cn(
          "relative overflow-hidden rounded-xs border border-timeline-filmstrip-border",
          className,
        )}
        style={{ height: stripHeightPx, width: "100%" }}
      >
        <canvas
          ref={imageCanvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
      </div>
    );
  }

  // Empty placeholder
  return (
    <div
      data-testid="clip-filmstrip-empty"
      className={cn("w-full rounded-xs bg-timeline-filmstrip-empty", className)}
      style={{ height: stripHeightPx }}
    />
  );
}
