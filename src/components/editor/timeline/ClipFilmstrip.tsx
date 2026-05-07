import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePathForTauriInvoke } from "../../../lib/tauri";
import { getDensityForZoom, generateTimestampGrid, getIntervalForDensity } from "../../../lib/timelineUtils";
import { cn } from "@/lib/utils";
import { DensityLevel } from "../../../types";
import type { Clip, MediaAsset, ThumbnailTile } from "../../../types";

/** Paths that must use poster tiling, not ffmpeg filmstrip (still images / mis-typed video). */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

/**
 * No-op kept for test compatibility. The timestamp-based architecture no longer
 * uses an in-memory frame cache — cache management is handled by the Rust backend.
 */
export function clearFilmstripFrameCache(): void {
  // intentional no-op
}

export interface ClipFilmstripProps {
  clip: Clip;
  mediaAsset: MediaAsset;
  clipWidthPx: number;
  pixelsPerSecond: number;
  stripHeightPx?: number;
  className?: string;
}

/**
 * ClipFilmstrip renders a filmstrip of thumbnail tiles for a video clip.
 *
 * Architecture overview:
 * - **Density bucket system**: Zoom level maps to one of four extraction densities
 *   (Low/Medium/High/Ultra). Transitions between buckets are debounced 250ms to
 *   avoid excessive re-extraction during rapid zoom.
 * - **Timestamp grid**: Frames are requested by globally-aligned timestamps rather
 *   than frame counts, so the cache remains valid across zoom changes within a bucket.
 * - **Fallback chain**: Tiles are pre-populated with poster frames immediately.
 *   Real thumbnails stream in via a Tauri channel and replace poster tiles as they
 *   arrive. The backend applies Ultra → High → Medium → Low → Poster fallback.
 * - **Streaming channel**: `get_thumbnails_for_timestamps` returns cached hits
 *   synchronously (< 5ms) and streams extracted frames as they complete. The channel
 *   stays open after the command returns; cleanup sets `cancelled` to drop stale msgs.
 */
export function ClipFilmstrip({ clip, mediaAsset, clipWidthPx: _clipWidthPx, pixelsPerSecond, stripHeightPx = 32, className }: ClipFilmstripProps) {
  /** Map from timestamp → tile (poster or real thumbnail). */
  const [tiles, setTiles] = useState<Map<number, ThumbnailTile>>(new Map());
  /** Active density bucket, updated after 250ms debounce at bucket boundaries. */
  const [currentDensity, setCurrentDensity] = useState<DensityLevel>(DensityLevel.Medium);
  /** Timer ref for 250ms debounce when zoom crosses a density bucket boundary. */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Globally-aligned timestamp grid for the current clip range and density.
   * Shared between the grid-generation effect and the channel effect so the
   * channel effect re-runs whenever the grid changes.
   */
  const [timestamps, setTimestamps] = useState<number[]>([]);

  const isVideoSource = useMemo(() => {
    const path = mediaAsset.path ?? "";
    return mediaAsset.type === "video" && path.length > 0 && !IMAGE_EXT.test(path);
  }, [mediaAsset.type, mediaAsset.path]);

  /**
   * Resolution tier derived from window.devicePixelRatio:
   *   - "1x" for DPR in [1.0, 1.5)  → extract at 80×60 px
   *   - "2x" for DPR ≥ 1.5          → extract at 160×120 px (Retina/HiDPI)
   *
   * Matches the backend ResolutionTier enum and cache key format.
   */
  const resolutionTier = typeof window !== "undefined" && window.devicePixelRatio >= 1.5 ? "2x" : "1x";
  const [thumbW, thumbH] = resolutionTier === "2x" ? [160, 120] : [80, 60];

  // ── Density bucket transition ──────────────────────────────────────────────
  // Debounce 250ms at bucket boundaries so rapid zoom doesn't trigger excessive
  // re-extraction. Zoom within the same bucket is instant (no debounce).
  useEffect(() => {
    const targetDensity = getDensityForZoom(pixelsPerSecond);

    if (targetDensity === currentDensity) {
      // Still in the same bucket — cancel any pending transition and do nothing.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return;
    }

    // Crossed a bucket boundary — reset the debounce window.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setCurrentDensity(targetDensity);
      debounceTimerRef.current = null;
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [pixelsPerSecond, currentDensity]);

  // ── Timestamp grid generation ──────────────────────────────────────────────
  // Regenerate the globally-aligned grid whenever clip range, density, or video
  // duration changes. Uses multiplication-based accumulation (not float addition)
  // to avoid drift at Ultra density (0.05s interval).
  // Pre-populates tiles with poster frames so the filmstrip is never blank.
  useEffect(() => {
    if (!mediaAsset.duration || !isVideoSource) {
      setTimestamps([]);
      setTiles(new Map());
      return;
    }

    const interval = getIntervalForDensity(currentDensity);
    const grid = generateTimestampGrid(clip.trimIn, clip.trimOut, interval, mediaAsset.duration);
    setTimestamps(grid);

    // Initialize tiles with poster frames so the filmstrip shows something immediately
    // while real thumbnails are being extracted in the background.
    if (mediaAsset.posterFrame) {
      const posterSrc = convertFileSrc(mediaAsset.posterFrame);
      const initialTiles = new Map<number, ThumbnailTile>(grid.map((time) => [time, { time, path: posterSrc, density: DensityLevel.Low }]));
      setTiles(initialTiles);
    } else {
      setTiles(new Map());
    }
  }, [clip.trimIn, clip.trimOut, currentDensity, mediaAsset.duration, mediaAsset.posterFrame, isVideoSource]);

  // ── Streaming thumbnail channel ────────────────────────────────────────────
  // Creates a Tauri channel and calls get_thumbnails_for_timestamps. The backend
  // sends cached hits immediately (< 5ms) then streams extracted frames as they
  // complete. The channel stays open after the command returns — cleanup sets
  // `cancelled` so stale messages from a previous density/clip are ignored.
  useEffect(() => {
    if (!isVideoSource || !mediaAsset.path || !mediaAsset.duration || timestamps.length === 0) {
      return;
    }

    let cancelled = false;
    const videoPath = normalizePathForTauriInvoke(mediaAsset.path);

    // One ThumbnailTile message per frame, in completion order (not time order).
    // The render step sorts by time before displaying.
    const channel = new Channel<ThumbnailTile>();
    channel.onmessage = (tile) => {
      if (cancelled) return;
      setTiles((prev) => {
        const next = new Map(prev);
        // Convert the raw filesystem path to an asset-protocol URL the browser can load.
        next.set(tile.time, { ...tile, path: convertFileSrc(tile.path) });
        return next;
      });
    };

    invoke("get_thumbnails_for_timestamps", {
      videoPath,
      timestamps,
      density: currentDensity,
      width: thumbW,
      height: thumbH,
      duration: mediaAsset.duration,
      onTile: channel,
    }).catch((err) => {
      if (cancelled) return;
      console.error("[ClipFilmstrip] get_thumbnails_for_timestamps failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [isVideoSource, mediaAsset.path, mediaAsset.duration, timestamps, currentDensity, thumbW, thumbH]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const interval = getIntervalForDensity(currentDensity);
  // tileWidth = pixelsPerSecond × interval
  // Example: Medium density (1s) at 100px/s → 100px wide tiles
  const tileWidth = pixelsPerSecond * interval;

  // Sort tiles by time — the channel delivers in completion order, not time order.
  const sortedTiles = Array.from(tiles.values()).sort((a, b) => a.time - b.time);

  const poster = mediaAsset.posterFrame;

  // Video source with tiles: render the timestamp-based filmstrip.
  if (isVideoSource && sortedTiles.length > 0) {
    return (
      <div data-testid="clip-filmstrip" className={cn("w-full overflow-hidden rounded-[2px] border border-black/20 bg-[#0c2730]/40", className)} style={{ height: stripHeightPx, display: "flex", overflow: "hidden" }}>
        {sortedTiles.map((tile) => (
          <img
            key={tile.time}
            src={tile.path}
            alt={`Frame at ${tile.time}s`}
            style={{
              width: tileWidth,
              height: stripHeightPx,
              objectFit: "cover",
              flexShrink: 0,
            }}
            draggable={false}
          />
        ))}
      </div>
    );
  }

  // Poster frame fallback (image assets or video before first grid is ready).
  if (poster) {
    return (
      <div data-testid="clip-filmstrip-fallback" className={cn("relative overflow-hidden rounded-[2px] border border-black/20", className)} style={{ height: stripHeightPx }}>
        <img src={poster} alt="" className="absolute inset-0 block h-full w-full object-cover object-center select-none" draggable={false} />
      </div>
    );
  }

  // Empty state — no poster and no tiles yet.
  return <div data-testid="clip-filmstrip-empty" className={cn("w-full rounded-[2px] bg-[#0c2730]/60", className)} style={{ height: stripHeightPx }} />;
}
