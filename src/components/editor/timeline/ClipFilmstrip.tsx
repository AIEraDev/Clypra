import { useEffect, useMemo, useRef, useState } from "react";
import { extractFilmstripFrames } from "../../../lib/tauri";
import { cn } from "@/lib/utils";
import type { Clip, MediaAsset } from "../../../types";

const FILMSTRIP_DEBOUNCE_MS = 90;
/** Filmstrip tile width in CSS px (CapCut-style fixed columns). */
const CELL_WIDTH_PX = 40;
const FRAME_COUNT_MIN = 4;
/** Backend `extract_filmstrip_frames` rejects frame_count > 100. */
const FRAME_COUNT_MAX = 100;
/** Bump when extraction or layout changes so stale cached strips are not reused. */
const FILMSTRIP_CACHE_VERSION = 3;

type LoadState = "idle" | "loading" | "ready" | "error";

const frameCache = new Map<string, string[]>();

/** Clears the in-memory filmstrip cache (e.g. between Vitest cases). */
export function clearFilmstripFrameCache(): void {
  frameCache.clear();
}

function cacheKeyFor(
  mediaId: string,
  trimIn: number,
  trimOut: number,
  frameCount: number,
  ppsRounded: number,
  thumbW: number,
  thumbH: number,
): string {
  return `${FILMSTRIP_CACHE_VERSION}:${mediaId}:${trimIn}:${trimOut}:${frameCount}:${ppsRounded}:${thumbW}x${thumbH}`;
}

export interface ClipFilmstripProps {
  clip: Clip;
  mediaAsset: MediaAsset;
  clipWidthPx: number;
  pixelsPerSecond: number;
  stripHeightPx?: number;
  className?: string;
}

export function ClipFilmstrip({ clip, mediaAsset, clipWidthPx, pixelsPerSecond, stripHeightPx = 32, className }: ClipFilmstripProps) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const effectGen = useRef(0);

  const frameCount = useMemo(() => {
    const raw = Math.ceil(clipWidthPx / CELL_WIDTH_PX);
    return Math.min(FRAME_COUNT_MAX, Math.max(FRAME_COUNT_MIN, raw || FRAME_COUNT_MIN));
  }, [clipWidthPx]);

  const ppsRounded = Math.round(pixelsPerSecond * 100) / 100;
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  /** Decode thumbs at ~one tile wide × DPR (matches on-screen ~40px column). */
  const thumbW = useMemo(() => {
    const w = Math.ceil(CELL_WIDTH_PX * dpr);
    return Math.max(48, Math.min(160, w));
  }, [dpr]);
  const thumbH = useMemo(() => Math.max(32, Math.ceil(stripHeightPx * dpr)), [stripHeightPx, dpr]);

  const cacheKey = useMemo(
    () => cacheKeyFor(mediaAsset.id, clip.trimIn, clip.trimOut, frameCount, ppsRounded, thumbW, thumbH),
    [mediaAsset.id, clip.trimIn, clip.trimOut, frameCount, ppsRounded, thumbW, thumbH],
  );

  useEffect(() => {
    const gen = ++effectGen.current;
    let cancelled = false;

    const cached = frameCache.get(cacheKey);
    if (cached && cached.length > 0) {
      setUrls(cached);
      setLoadState("ready");
      return () => {
        cancelled = true;
      };
    }

    if (!mediaAsset.path) {
      setUrls([]);
      setLoadState("error");
      return () => {
        cancelled = true;
      };
    }

    setLoadState("loading");

    const timer = window.setTimeout(() => {
      extractFilmstripFrames(mediaAsset.path, frameCount, thumbW, thumbH, clip.trimIn, clip.trimOut)
        .then((frames) => {
          if (cancelled || gen !== effectGen.current) return;
          if (!frames.length) {
            setLoadState("error");
            setUrls([]);
            return;
          }
          frameCache.set(cacheKey, frames);
          setUrls(frames);
          setLoadState("ready");
        })
        .catch(() => {
          if (cancelled || gen !== effectGen.current) return;
          setLoadState("error");
          setUrls([]);
        });
    }, FILMSTRIP_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cacheKey, mediaAsset.path, frameCount, thumbW, thumbH, clip.trimIn, clip.trimOut]);

  const poster = mediaAsset.posterFrame;

  const shellClass = cn(
    "w-full overflow-hidden rounded-[2px] border border-black/20",
    loadState === "ready" && urls.length > 0 ? "flex min-h-0 flex-row bg-[#0c2730]/40" : "",
    loadState !== "ready" || urls.length === 0 ? "relative" : "",
    className,
  );

  if (loadState === "ready" && urls.length > 0) {
    return (
      <div data-testid="clip-filmstrip" className={shellClass} style={{ height: stripHeightPx }}>
        {urls.map((src, i) => (
          <div
            key={`${cacheKey}-${i}`}
            className="h-full shrink-0 overflow-hidden"
            style={{ width: CELL_WIDTH_PX }}
          >
            <img src={src} alt="" className="block h-full w-full object-cover object-center select-none" draggable={false} />
          </div>
        ))}
      </div>
    );
  }

  if (poster) {
    return (
      <div
        data-testid={loadState === "loading" ? "clip-filmstrip-loading" : "clip-filmstrip-fallback"}
        className={cn("relative overflow-hidden rounded-[2px] border border-black/20", className)}
        style={{ height: stripHeightPx }}
      >
        <img src={poster} alt="" className="absolute inset-0 block h-full w-full object-cover object-center select-none" draggable={false} />
        {loadState === "loading" && <div className="absolute inset-0 animate-pulse bg-[#0c2730]/55" aria-hidden />}
      </div>
    );
  }

  return (
    <div
      data-testid={loadState === "loading" ? "clip-filmstrip-loading" : "clip-filmstrip-empty"}
      className={cn("w-full rounded-[2px] bg-[#0c2730]/60", loadState === "loading" && "animate-pulse", className)}
      style={{ height: stripHeightPx }}
    />
  );
}
