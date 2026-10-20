import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus, ScanSearch } from "lucide-react";
import { getViewportController } from "@/core/interactions";
import { useViewportState } from "@/hooks/useViewportController";
import { useClickOutside } from "@/hooks";
import { useI18n } from "@/i18n";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;

/**
 * Preview-only magnification. It owns no project state: it changes the shared
 * viewport signal, leaving clip transforms and export output untouched.
 */
export const PreviewZoomControl: React.FC = () => {
  const viewport = useViewportState();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setIsOpen(false), { enabled: isOpen });

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const setZoom = (zoom: number) => getViewportController().setZoom(zoom);
  const reset = () => getViewportController().reset();
  const zoomPercent = Math.round(viewport.zoom * 100);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
          isOpen || viewport.zoom !== 1 || viewport.panX !== 0 || viewport.panY !== 0
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-primary hover:bg-white/6"
        }`}
        title={t("preview.zoom.control")}
        aria-label={t("preview.zoom.control")}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <ScanSearch className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1.5 flex w-56 items-center gap-2 rounded-xl border border-border bg-surface-floating/95 px-3 py-2.5 text-text-primary shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
          role="dialog"
          aria-label={t("preview.zoom.control")}
        >
          <button
            type="button"
            onClick={() => setZoom(viewport.zoom - ZOOM_STEP)}
            disabled={viewport.zoom <= ZOOM_MIN}
            title={t("preview.zoom.out")}
            aria-label={t("preview.zoom.out")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-primary hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={viewport.zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-raised outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
            aria-label={t("preview.zoom.level")}
          />
          <button
            type="button"
            onClick={() => setZoom(viewport.zoom + ZOOM_STEP)}
            disabled={viewport.zoom >= ZOOM_MAX}
            title={t("preview.zoom.in")}
            aria-label={t("preview.zoom.in")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-primary hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={reset}
            title={t("preview.zoom.fit")}
            aria-label={t("preview.zoom.fit")}
            className="min-w-10 rounded px-1 py-1 text-[10px] font-mono text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            {zoomPercent}%
          </button>
        </div>
      )}
    </div>
  );
};
