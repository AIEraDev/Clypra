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
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { createRasterSurface, type AnyRasterSurface } from "@/lib/renderEngine/webglRasterSurface";
import { useFilmstrip } from "@/lib/useFilmstrip";
import { getFilmstripTileWidthForTier } from "@/lib/filmstripLayout";
import { normalizePathForTauriInvoke } from "@/lib/tauri";
import type { Clip, MediaAsset } from "@/types";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

/**
 * No-op kept for test compatibility.
 */
export function clearFilmstripFrameCache(): void {}

export interface ClipFilmstripProps {
  clip: Clip;
  mediaAsset: MediaAsset;
  clipWidthPx: number;
  pixelsPerSecond: number;
  stripHeightPx?: number;
  className?: string;
}

export function ClipFilmstrip({ clip, mediaAsset, clipWidthPx, pixelsPerSecond, stripHeightPx = 40, className }: ClipFilmstripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<AnyRasterSurface | null>(null);

  const isVideoSource = useMemo(() => {
    const path = mediaAsset.path ?? "";
    return mediaAsset.type === "video" && path.length > 0 && !IMAGE_EXT.test(path);
  }, [mediaAsset.type, mediaAsset.path]);

  const videoPath = isVideoSource && mediaAsset.path ? normalizePathForTauriInvoke(mediaAsset.path) : "";

  // ── Filmstrip data (replaces all inline extraction orchestration) ─────────
  const { artifacts, isFallback, interactionState, spatialTier } = useFilmstrip({
    clipId: clip.id,
    videoPath,
    trimIn: clip.trimIn,
    trimOut: clip.trimOut,
    duration: mediaAsset.duration ?? 0,
    clipWidthPx,
    stripHeightPx,
    posterFrame: mediaAsset.posterFrame,
    enabled: isVideoSource && !!videoPath && !!mediaAsset.duration,
  });

  const tileWidthPx = useMemo(() => {
    return getFilmstripTileWidthForTier(spatialTier);
  }, [spatialTier]);

  // ── RasterSurface lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    surfaceRef.current = createRasterSurface(canvasRef.current);
    return () => {
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, []); // only on mount/unmount

  // ── Draw filmstrip whenever artifacts or layout changes ───────────────────
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const dpr = window.devicePixelRatio || 1;
    const layout = { clipWidthPx, stripHeightPx, dpr, tileWidthPx };

    if (artifacts.length > 0) {
      surface.drawFilmstrip(artifacts, layout);
    } else {
      surface.drawPlaceholder(layout);
    }
  }, [artifacts, clipWidthPx, stripHeightPx, tileWidthPx]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Video filmstrip — canvas surface
  if (isVideoSource) {
    return (
      <div data-testid="clip-filmstrip" className={cn("relative overflow-hidden rounded-[2px] border border-timeline-filmstrip-border bg-timeline-filmstrip-bg", className)} style={{ height: stripHeightPx, width: "100%", opacity: 1, transition: "opacity 80ms linear" }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
        {/* Poster overlay while artifacts load — fades out once canvas has content */}
        {isFallback && mediaAsset.posterFrame && (
          <img
            src={mediaAsset.posterFrame.startsWith("data:") ? mediaAsset.posterFrame : convertFileSrc(mediaAsset.posterFrame)}
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

  // Image asset — poster or direct path
  if (mediaAsset.posterFrame || mediaAsset.path) {
    const src = mediaAsset.posterFrame ? (mediaAsset.posterFrame.startsWith("data:") ? mediaAsset.posterFrame : convertFileSrc(mediaAsset.posterFrame)) : mediaAsset.path.startsWith("asset://") ? mediaAsset.path : convertFileSrc(mediaAsset.path);
    return (
      <div data-testid="clip-filmstrip-fallback" className={cn("relative overflow-hidden rounded-[2px] border border-timeline-filmstrip-border", className)} style={{ height: stripHeightPx, width: "100%" }}>
        <img src={src} alt="" className="absolute inset-0 block h-full w-full object-cover select-none" draggable={false} />
      </div>
    );
  }

  // Empty placeholder
  return <div data-testid="clip-filmstrip-empty" className={cn("w-full rounded-[2px] bg-timeline-filmstrip-empty", className)} style={{ height: stripHeightPx }} />;
}
