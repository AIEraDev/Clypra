import { useEffect, useState, useRef } from "react";
import { getThumbnailEngine, THUMBNAIL_WIDTH } from "../utils/ThumbnailEngine";
import { useTimelineStore } from "../store/timelineStore";

interface Thumbnail {
  time: number;
  dataUrl: string;
}

interface UseThumbnailEngineOptions {
  videoPath: string;
  clipStartTime: number;
  clipEndTime: number;
}

/**
 * Calculate zoom level from pixelsPerSecond (base = 100px/sec = 1x zoom)
 */
function calculateZoom(pxPerSec: number): number {
  return pxPerSec / 100;
}

/**
 * Hook for zoom-adaptive thumbnail sampling
 *
 * Returns thumbnails at fixed 80px width, with time density controlled by zoom
 */
export function useThumbnailEngine(options: UseThumbnailEngineOptions) {
  const { videoPath, clipStartTime, clipEndTime } = options;
  const pxPerSec = useTimelineStore((state) => state.pxPerSec);
  const scrollLeft = useTimelineStore((state) => state.scrollLeft);

  // Calculate zoom from pxPerSec
  const zoom = calculateZoom(pxPerSec);

  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const engineRef = useRef(getThumbnailEngine());
  const zoomRef = useRef(zoom);

  // Calculate visible time range
  const visibleStart = scrollLeft / pxPerSec;
  const visibleEnd = (scrollLeft + 2000) / pxPerSec; // Assume 2000px viewport

  // Generate thumbnails when zoom or visibility changes
  useEffect(() => {
    if (!videoPath) return;

    const engine = engineRef.current;
    let cancelled = false;

    // Check if zoom changed significantly (regenerate if so)
    const zoomChanged = Math.abs(zoom - zoomRef.current) > 0.1;
    zoomRef.current = zoom;

    if (zoomChanged) {
      setLoading(true);
    }

    const generateThumbs = async () => {
      try {
        const results = await engine.generateThumbnails(videoPath, clipStartTime, clipEndTime, zoom, visibleStart, visibleEnd);

        if (!cancelled) {
          setThumbnails(results);
          setLoading(false);
        }
      } catch (error) {
        console.error("[useThumbnailEngine] Generation failed:", error);
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    // Debounce generation
    const timeoutId = setTimeout(generateThumbs, 100);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [videoPath, clipStartTime, clipEndTime, zoom, visibleStart, visibleEnd, pxPerSec]);

  // Get time per thumbnail for positioning
  const timePerThumbnail = engineRef.current.getTimePerThumbnail(zoom);

  return {
    thumbnails,
    loading,
    timePerThumbnail,
    thumbnailWidth: THUMBNAIL_WIDTH,
    zoom,
  };
}
