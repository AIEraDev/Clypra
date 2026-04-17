/**
 * TimelineContainer - Main container component that wires all timeline components together
 *
 * This component serves as the integration point for:
 * - Timeline store state management
 * - Keyboard shortcuts
 * - Playhead synchronization with video player
 * - Canvas-based video preview (CanvasRenderer)
 * - All child timeline components
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLORS } from "../../../constants/colors";
import { VIDEO_CONFIG } from "../../../constants/config";
import { clamp, fileBasename } from "../../../lib/utils";
import { getAudioWaveformPeaks } from "../../../lib/tauri";
import { formatTime } from "../utils/timeFormat";
import { CoordinateSystem } from "../utils/coordinateSystem";
import { useFilmstrip } from "../hooks/useFilmstrip";
import { useTimelineStore } from "../store/timelineStore";
import { useTimelineKeyboardShortcuts, type ToolMode } from "../hooks/useTimelineKeyboardShortcuts";
import { Waveform } from "./Waveform";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineTrackHeaders } from "./TimelineTrackHeaders";
import { TimeRuler } from "./TimeRuler";
import { ScreenReaderAnnouncer } from "./ScreenReaderAnnouncer";

export interface TimelineContainerProps {
  /** Video duration in seconds */
  duration: number;
  /** Trim start time in seconds */
  trimStart: number;
  /** Trim end time in seconds */
  trimEnd: number;
  /** Current playhead position in seconds */
  playhead: number;
  /** Callback to seek video to a specific time */
  onSeek: (time: number) => void;
  /** Video URL for filmstrip generation */
  videoUrl: string | null;
  /** Source file path for waveform generation */
  sourcePath: string | null;
  /** Reference to video element for play/pause control */
  videoRef?: React.RefObject<HTMLVideoElement>;
}

/**
 * TimelineContainer component
 *
 * Integrates all timeline components and manages:
 * - Store state synchronization
 * - Keyboard shortcuts
 */
export function TimelineContainer({ duration, trimStart, trimEnd, playhead, onSeek, videoUrl, sourcePath, videoRef }: TimelineContainerProps) {
  const [toolMode, setToolMode] = useState<ToolMode>("selection");
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(VIDEO_CONFIG.ZOOM.DEFAULT_PX_PER_SEC);
  const [snapMain, setSnapMain] = useState(true);
  const [snapAuto, setSnapAuto] = useState(true);
  const [snapLink, setSnapLink] = useState(true);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveLoading, setWaveLoading] = useState(false);

  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;

  const { stripUrl, loading: filmstripLoading } = useFilmstrip(videoUrl, duration);
  const { tracks, addTrack, setPlayhead: setStorePlayhead, setZoom, setScroll, setIsPlaying, isPlaying, playhead: storePlayhead } = useTimelineStore();

  // Create a stable play/pause toggle handler
  const handlePlayPauseToggle = useCallback(() => {
    const currentIsPlaying = useTimelineStore.getState().isPlaying;
    setIsPlaying(!currentIsPlaying);
  }, [setIsPlaying]);

  useTimelineKeyboardShortcuts({
    onPlayPauseToggle: handlePlayPauseToggle,
    toolMode,
    onToolModeChange: setToolMode,
    fps: VIDEO_CONFIG.FPS,
  });

  // Only sync when NOT playing (during playback, CanvasRenderer controls the playhead)
  useEffect(() => {
    if (!isPlaying) {
      setStorePlayhead(playhead);
    }
  }, [playhead, setStorePlayhead, isPlaying]);

  // Sync external playhead prop when store playhead changes during playback
  useEffect(() => {
    if (isPlaying && storePlayhead !== playhead) {
      onSeek(storePlayhead);
    }
  }, [storePlayhead, isPlaying, playhead, onSeek]);

  useEffect(() => {
    setZoom(pxPerSec);
  }, [pxPerSec, setZoom]);

  // Initialize sample tracks when video is loaded
  useEffect(() => {
    if (duration > 0 && tracks.size === 0) {
      // Add a text/captions track
      addTrack({
        id: "track-text-1",
        name: "Captions",
        type: "text",
        order: 0,
        height: 36,
        locked: false,
        visible: true,
        muted: false,
        color: "#ea580c",
      });

      // Add a video track
      addTrack({
        id: "track-video-1",
        name: "Main Video",
        type: "video",
        order: 1,
        height: 148,
        locked: false,
        visible: true,
        muted: false,
        color: "#1e40af",
      });
    }
  }, [duration, tracks.size, addTrack]);

  // Load waveform data
  useEffect(() => {
    if (!sourcePath) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    setWaveLoading(true);
    getAudioWaveformPeaks(sourcePath, VIDEO_CONFIG.WAVEFORM.DEFAULT_BUCKETS)
      .then((p) => {
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) setPeaks(null);
      })
      .finally(() => {
        if (!cancelled) setWaveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  /** Timeline width in px — maps 1:1 to duration at current zoom. */
  const contentW = useMemo(() => {
    if (duration <= 0) return 400;
    return Math.max(120, duration * pxPerSec);
  }, [duration, pxPerSec]);

  const timelinePx = duration * pxPerSec;

  /** X position in the timeline (px from t=0) using the wide content box — correct when scrolled. */
  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (duration <= 0) return;
      const content = timelineContentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const x = clientX - rect.left;
      const t = clamp(x / pxPerSec, 0, duration);
      onSeek(t);
    },
    [duration, onSeek, pxPerSec],
  );

  const onTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    if (e.button !== 0) return;
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Trackpad pinch zoom (Chrome / WebKit: wheel + ctrl). Zooms toward cursor; keeps time under pointer stable. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Get cursor position relative to scroll container
      const rect = el.getBoundingClientRect();
      const cursorX = clamp(e.clientX - rect.left, 0, rect.width);

      const factor = Math.exp(-e.deltaY * 0.009);

      const coords = new CoordinateSystem(pxPerSecRef.current);
      const { newPxPerSec, newScrollLeft } = coords.zoomToCursor(cursorX, el.scrollLeft, factor, VIDEO_CONFIG.ZOOM.MIN_PX_PER_SEC, VIDEO_CONFIG.ZOOM.MAX_PX_PER_SEC);

      // Update zoom level
      setPxPerSec(newPxPerSec);

      requestAnimationFrame(() => {
        const sc = scrollRef.current;
        if (!sc) return;
        sc.scrollLeft = clamp(newScrollLeft, 0, Math.max(0, sc.scrollWidth - sc.clientWidth));
        setScrollLeft(sc.scrollLeft);
        setScroll(sc.scrollLeft, sc.scrollTop);
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [duration, setScroll]);

  const onScrollPaneScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      setScrollLeft(el.scrollLeft);
      setScroll(el.scrollLeft, el.scrollTop);
    }
  }, [setScroll]);

  const debouncedScroll = useMemo(() => {
    let timeoutId: number | null = null;
    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      // Immediate update for scroll position (for playhead visibility)
      const el = scrollRef.current;
      if (el) {
        setScrollLeft(el.scrollLeft);
      }
      // Debounced update for store (reduces render frequency)
      timeoutId = window.setTimeout(() => {
        onScrollPaneScroll();
      }, 16); // ~60fps
    };
  }, [onScrollPaneScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    const x = playhead * pxPerSec;
    const vis = el.clientWidth;
    const left = el.scrollLeft;
    const margin = vis * 0.15;
    if (x < left + margin || x > left + vis - margin) {
      el.scrollLeft = clamp(x - vis / 2, 0, Math.max(0, el.scrollWidth - vis));
    }
  }, [playhead, pxPerSec, duration]);

  /** Keep overlay playhead aligned after zoom / layout. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) setScrollLeft(el.scrollLeft);
  }, [pxPerSec, contentW]);

  useEffect(() => {
    if (duration <= 0) return;
    const el = scrollRef.current;
    if (el) setScrollLeft(el.scrollLeft);
  }, [duration]);

  const name = fileBasename(sourcePath);
  const trimLen = Math.max(0, trimEnd - trimStart);

  if (duration <= 0) {
    return (
      <div className="flex flex-1 flex-col rounded-lg border" style={{ backgroundColor: COLORS.BG, borderColor: COLORS.BORDER }}>
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-sm text-zinc-500">Import a video to see the CapCut-style timeline (ruler, tracks, filmstrip, waveform).</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border overflow-x-visible overflow-y-hidden" style={{ backgroundColor: COLORS.BG, borderColor: COLORS.BORDER }} role="region" aria-label="Video timeline editor">
      {/* Screen reader announcements */}
      <ScreenReaderAnnouncer />

      <TimelineToolbar snapMain={snapMain} snapAuto={snapAuto} snapLink={snapLink} pxPerSec={pxPerSec} isPlaying={isPlaying} onPlayPauseToggle={handlePlayPauseToggle} onSnapMainToggle={() => setSnapMain((v) => !v)} onSnapAutoToggle={() => setSnapAuto((v) => !v)} onSnapLinkToggle={() => setSnapLink((v) => !v)} onZoomChange={setPxPerSec} minZoom={VIDEO_CONFIG.ZOOM.MIN_PX_PER_SEC} maxZoom={VIDEO_CONFIG.ZOOM.MAX_PX_PER_SEC} />

      <div className="flex min-h-0 flex-1">
        <TimelineTrackHeaders />

        {/* Scroll viewport + playhead overlay */}
        <div className="relative min-h-0 flex-1 overflow-x-visible overflow-y-hidden">
          <div ref={scrollRef} onScroll={debouncedScroll} className="min-h-0 h-full overflow-x-auto overflow-y-auto" style={{ backgroundColor: COLORS.BG }} data-timeline-scroll-area role="application" aria-label="Timeline tracks and clips">
            <div ref={timelineContentRef} className="relative cursor-crosshair" style={{ width: contentW, minHeight: 168 }} onPointerDown={onTimelinePointerDown} role="group" aria-label="Timeline content area">
              {/* Ruler */}
              <TimeRuler duration={duration} pxPerSec={pxPerSec} fps={VIDEO_CONFIG.FPS} />

              {/* Text / captions lane */}
              <div className="relative h-9 border-b" style={{ borderColor: COLORS.BORDER }}>
                <div
                  className="absolute top-0.5 flex h-[30px] cursor-grab items-center overflow-hidden rounded-sm px-2 text-[11px] font-medium text-white shadow-md"
                  style={{
                    left: trimStart * pxPerSec,
                    width: Math.max(8, (trimEnd - trimStart) * pxPerSec),
                    background: `linear-gradient(180deg, ${COLORS.TEXT_ORANGE} 0%, #9a3412 100%)`,
                  }}
                >
                  <span className="truncate font-mono opacity-90">A:</span>
                  <span className="ml-1 truncate opacity-95">Captions track (preview)</span>
                </div>
              </div>

              {/* Video + audio lane */}
              <div className="relative min-h-[132px] border-b" style={{ borderColor: COLORS.BORDER }}>
                {/* Outside trim — dimmed */}
                <div className="pointer-events-none absolute inset-y-1 left-0 bg-black/55" style={{ width: trimStart * pxPerSec }} />
                <div className="pointer-events-none absolute inset-y-1 right-0 bg-black/55" style={{ width: (duration - trimEnd) * pxPerSec }} />

                {/* Main clip */}
                <div
                  className="absolute inset-y-1 rounded-md shadow-lg ring-1 ring-white/10"
                  style={{
                    left: 0,
                    width: timelinePx,
                    backgroundColor: "#0f172a",
                  }}
                >
                  {/* Filmstrip */}
                  <div
                    className="relative h-[78px] overflow-hidden rounded-t-md"
                    style={{
                      backgroundImage: stripUrl ? `url(${stripUrl})` : undefined,
                      backgroundSize: "100% 100%",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "left center",
                      filter: filmstripLoading ? "brightness(0.55)" : undefined,
                    }}
                  >
                    <div className="absolute inset-0 bg-linear-to-b from-black/25 to-black/60" />
                    <div className="relative flex items-start justify-between gap-2 px-2 pt-1.5 text-[10px] font-medium text-white">
                      <span className="truncate drop-shadow-md">{name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-white/90 drop-shadow-md">{formatTime(trimLen)}</span>
                    </div>
                    {filmstripLoading && <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/70">Building filmstrip…</div>}
                  </div>

                  {/* Waveform */}
                  <div className="relative h-[52px] w-full overflow-hidden rounded-b-md">
                    {waveLoading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 text-[10px] text-emerald-200/85">Analyzing audio…</div>}
                    <Waveform peaks={peaks} width={Math.max(1, timelinePx)} height={52} className="block" />
                    {(!peaks || peaks.length === 0) && !waveLoading && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-teal-700/75">No audio or waveform unavailable</div>}
                  </div>

                  {/* Trim emphasis */}
                  <div
                    className="pointer-events-none absolute inset-0 rounded-md ring-1"
                    style={{
                      boxShadow: `inset 0 0 0 1px ${COLORS.VIDEO_TEAL}`,
                      opacity: 0.45,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Playhead: sibling of scroll area — not clipped by overflow-x on scroll */}
          <div className="pointer-events-none absolute inset-0 z-40 overflow-x-visible overflow-y-hidden" aria-label={`Playhead at ${formatTime(storePlayhead)}`} role="separator" aria-valuenow={storePlayhead} aria-valuemin={0} aria-valuemax={duration} aria-valuetext={`Playhead position: ${formatTime(storePlayhead)}`}>
            <div
              className="absolute bottom-0 top-0 flex -translate-x-1/2 justify-center overflow-visible"
              style={{
                left: storePlayhead * pxPerSec - scrollLeft,
                filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))",
              }}
            >
              <div className="relative flex h-full w-[13px] shrink-0 flex-col items-center overflow-visible">
                <svg width="13" height="11" viewBox="0 0 13 11" className="shrink-0 text-white" aria-hidden>
                  <path d="M6.5 0 L13 10.5 H0 Z" fill="currentColor" stroke="rgba(0,0,0,0.25)" strokeWidth="0.5" />
                </svg>
                <div
                  className="mt-0 min-h-0 w-[2px] flex-1 rounded-full"
                  style={{
                    background: "linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.82) 55%, rgba(255,255,255,0.55) 100%)",
                    boxShadow: "0 0 8px rgba(255,255,255,0.25)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
