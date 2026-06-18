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
 *   - Falls back to posterFrame <img> while artifacts load
 *   - Falls back to an empty div if no posterFrame available
 *   - Dims slightly during ballistic scroll (ISM hint)
 */

import { useEffect, useRef, useMemo } from "react";
import { platform } from "@/core/platform";
import { cn } from "@/lib/utils";
import { createRasterSurface, type AnyRasterSurface } from "@/lib/renderEngine/webglRasterSurface";
import { useFilmstrip } from "@/lib/filmstrip/useFilmstrip";
import { getFilmstripTileWidthForTier } from "@/lib/filmstrip/filmstripLayout";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";
import type { Clip, MediaAsset } from "@/types";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

/**
 * No-op kept for test compatibility.
 */
export function clearFilmstripFrameCache(): void {}

/** Resolve a media source path without double-converting already-converted URLs. */
function resolveMediaSrc(path: string): string {
  if (path.startsWith("data:") || path.startsWith("asset://") || path.startsWith("http://") || path.startsWith("https://")) {
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
  viewportScrollLeft?: number;
  viewportWidth?: number;
}

export function ClipFilmstrip({ clip, mediaAsset, clipWidthPx, pixelsPerSecond, stripHeightPx = 40, className, viewportScrollLeft = 0, viewportWidth = 1200 }: ClipFilmstripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<AnyRasterSurface | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const cachedImageRef = useRef<HTMLImageElement | null>(null);

  const isVideoSource = useMemo(() => {
    const path = mediaAsset.path ?? "";
    return mediaAsset.type === "video" && path.length > 0 && !IMAGE_EXT.test(path);
  }, [mediaAsset.type, mediaAsset.path]);

  const videoPath = isVideoSource && mediaAsset.path ? normalizePathForTauriInvoke(mediaAsset.path) : "";

  // ── Filmstrip data (pure projection from RenderEngine) ─────────────────────
  const { artifacts, isFallback, interactionState, spatialTier } = useFilmstrip({
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
    enabled: isVideoSource && !!videoPath && !!mediaAsset.duration,
  });

  const tileWidthPx = useMemo(() => {
    return getFilmstripTileWidthForTier(spatialTier);
  }, [spatialTier]);

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
      clipWidthPx,
      stripHeightPx,
      dpr,
      tileWidthPx,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
    };

    if (artifacts.length > 0) {
      surface.drawFilmstrip(artifacts, layout);
    } else {
      surface.drawPlaceholder(layout);
    }
  }, [artifacts, clipWidthPx, stripHeightPx, tileWidthPx, clip.trimIn, clip.trimOut, clip.id]);

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
      const w = Math.max(1, clipWidthPx);
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
    if (cachedImageRef.current?.src === src && cachedImageRef.current.complete && cachedImageRef.current.naturalWidth > 0) {
      drawTiles(cachedImageRef.current);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      cachedImageRef.current = img;
      drawTiles(img);
    };
    img.onerror = () => {
      console.error("[ClipFilmstrip] Failed to load image:", src);
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [mediaAsset.type, mediaAsset.path, mediaAsset.posterFrame, clipWidthPx, stripHeightPx]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Video filmstrip — canvas surface
  if (isVideoSource) {
    return (
      <div data-testid="clip-filmstrip" className={cn("relative overflow-hidden rounded-[2px] border border-timeline-filmstrip-border bg-timeline-filmstrip-bg", className)} style={{ height: stripHeightPx, width: "100%", opacity: 1, transition: "opacity 80ms linear" }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
        {/* Poster overlay while artifacts load — fades out once canvas has content */}
        {isFallback && mediaAsset.posterFrame && (
          <img
            src={resolveMediaSrc(mediaAsset.posterFrame)}
            alt=""
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              pointerEvents: "none",
            }}
            draggable={false}
          />
        )}
      </div>
    );
  }

  // Image asset — tiled canvas rendering (one decoded bitmap, many timeline tiles)
  if (mediaAsset.type === "image" && (mediaAsset.posterFrame || mediaAsset.path)) {
    return (
      <div data-testid="clip-filmstrip-image" className={cn("relative overflow-hidden rounded-[2px] border border-timeline-filmstrip-border", className)} style={{ height: stripHeightPx, width: "100%" }}>
        <canvas ref={imageCanvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      </div>
    );
  }

  // Empty placeholder
  return <div data-testid="clip-filmstrip-empty" className={cn("w-full rounded-[2px] bg-timeline-filmstrip-empty", className)} style={{ height: stripHeightPx }} />;
}
