import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import { useTimelineStore } from "@/store/timelineStore";
import type { TimelineMarker } from "@/types";
import { t, type MessageKey } from "@/i18n";

interface TimelineRulerProps {
  pixelsPerSecond: number;
  scrollLeft: number;
}

/**
 * CapCut-style timeline ruler with Timeline Marker support.
 *
 * Markers:
 *   - Press M to add at playhead
 *   - Double-click ruler to add at that position
 *   - Drag marker pin horizontally to reposition
 *   - Click pin to open popover (rename, recolor, delete)
 */

// ── Interval table ──────────────────────────────────────────────────────
const INTERVAL_TABLE: [number, number][] = [
  [60, 6],
  [30, 6],
  [15, 5],
  [10, 5],
  [5, 5],
  [3, 3],
  [2, 4],
  [1, 5],
];

const MIN_LABEL_GAP_PX = 80;

const MARKER_COLORS: { titleKey: MessageKey; value: string; css: string }[] = [
  { titleKey: "timeline.marker.color.purple", value: "purple", css: "#a855f7" },
  { titleKey: "timeline.marker.color.blue",   value: "blue",   css: "#3b82f6" },
  { titleKey: "timeline.marker.color.green",  value: "green",  css: "#22c55e" },
  { titleKey: "timeline.marker.color.yellow", value: "yellow", css: "#eab308" },
  { titleKey: "timeline.marker.color.red",    value: "red",    css: "#ef4444" },
];

function markerCss(color: string): string {
  return MARKER_COLORS.find((c) => c.value === color)?.css ?? "#a855f7";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Marker Pin ──────────────────────────────────────────────────────────

interface MarkerPinProps {
  marker: TimelineMarker;
  pixelsPerSecond: number;
  scrollLeft: number;
  onSelect: (markerId: string) => void;
  onDragEnd: (markerId: string, newTime: number) => void;
  selected: boolean;
}

const MarkerPin: React.FC<MarkerPinProps> = ({
  marker,
  pixelsPerSecond,
  scrollLeft,
  onSelect,
  onDragEnd,
  selected,
}) => {
  const color = markerCss(marker.color);
  const x = Math.round(marker.time * pixelsPerSecond) - scrollLeft;

  // Drag logic
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dragging.current = true;
      dragStartX.current = e.clientX;
      dragStartTime.current = marker.time;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const dx = ev.clientX - dragStartX.current;
        const dt = dx / pixelsPerSecond;
        const newTime = Math.max(0, dragStartTime.current + dt);
        // Live visual update via a CSS custom property on the element
        pin.current?.style.setProperty("--dx", `${Math.round(newTime * pixelsPerSecond) - scrollLeft}px`);
      };

      const onUp = (ev: MouseEvent) => {
        if (!dragging.current) return;
        dragging.current = false;
        const dx = ev.clientX - dragStartX.current;
        const dt = dx / pixelsPerSecond;
        const newTime = Math.max(0, dragStartTime.current + dt);
        onDragEnd(marker.id, newTime);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [marker.id, marker.time, pixelsPerSecond, scrollLeft, onDragEnd],
  );

  const pin = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(marker.id);
    },
    [marker.id, onSelect],
  );

  return (
    <div
      ref={pin}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      title={marker.name}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        transform: "translateX(-50%)",
        cursor: "grab",
        zIndex: selected ? 20 : 10,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "auto",
      }}
    >
      {/* Diamond flag head */}
      <div
        style={{
          width: 10,
          height: 10,
          background: color,
          transform: "rotate(45deg)",
          borderRadius: 2,
          boxShadow: selected ? `0 0 0 2px white, 0 0 0 3px ${color}` : `0 1px 3px rgba(0,0,0,0.4)`,
          transition: "box-shadow 0.1s",
        }}
      />
      {/* Stem */}
      <div
        style={{
          width: 1.5,
          height: 14,
          background: color,
          opacity: 0.85,
        }}
      />
    </div>
  );
};

// ── Marker Popover ─────────────────────────────────────────────────────

interface MarkerPopoverProps {
  marker: TimelineMarker;
  x: number; // ruler-relative left px
  onClose: () => void;
  onUpdate: (updates: Partial<TimelineMarker>) => void;
  onDelete: () => void;
}

const MarkerPopover: React.FC<MarkerPopoverProps> = ({ marker, x, onClose, onUpdate, onDelete }) => {
  const [name, setName] = useState(marker.name);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const commitName = () => {
    if (name.trim() && name !== marker.name) {
      onUpdate({ name });
    }
  };

  // Keep popover from overflowing the right edge — clamp to 220px card width
  const CARD_W = 220;
  const adjustedX = Math.max(0, Math.min(x - CARD_W / 2, (window.innerWidth || 1200) - CARD_W - 8));

  return (
    <div
      ref={popoverRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 28,
        left: adjustedX,
        width: CARD_W,
        zIndex: 50,
        background: "var(--color-surface, #1a1a2e)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {/* Time label */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}>
        {formatTime(marker.time)}
      </div>

      {/* Name input */}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commitName(); onClose(); }
          if (e.key === "Escape") onClose();
          e.stopPropagation();
        }}
        placeholder={t("timeline.marker.namePlaceholder")}
        style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 5,
          color: "#fff",
          fontSize: 12,
          padding: "4px 7px",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />

      {/* Color palette */}
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {MARKER_COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => onUpdate({ color: c.value })}
            title={t(c.titleKey)}
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: c.css,
              border: marker.color === c.value ? "2px solid #fff" : "2px solid transparent",
              cursor: "pointer",
              flexShrink: 0,
              transition: "transform 0.1s",
              transform: marker.color === c.value ? "scale(1.2)" : "scale(1)",
            }}
          />
        ))}
        <div style={{ flex: 1 }} />
        {/* Delete */}
        <button
          onClick={onDelete}
          title={t("timeline.marker.deleteTitle")}
          style={{
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#ef4444",
            borderRadius: 4,
            fontSize: 10,
            padding: "2px 7px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {t("timeline.marker.delete")}
        </button>
      </div>
    </div>
  );
};

// ── Main component ──────────────────────────────────────────────────────

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ pixelsPerSecond, scrollLeft }) => {
  const clockState = usePlaybackClock();
  const frameRate = clockState.frameRate;
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  const { markers, addMarker, removeMarker, updateMarker } = useTimelineStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth || 1200);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Format label (00:SS) ────────────────────────────────────────────────
  const formatLabel = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, []);

  // ── Memoized tick generation ─────────────────────────────────────────────
  const ticks = useMemo(() => {
    const validPPS = typeof pixelsPerSecond === "number" && !isNaN(pixelsPerSecond) && pixelsPerSecond > 0 ? pixelsPerSecond : 50;
    const validScrollLeft = typeof scrollLeft === "number" && !isNaN(scrollLeft) ? scrollLeft : 0;
    const validViewportWidth = typeof viewportWidth === "number" && !isNaN(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1200;

    let majorInterval = INTERVAL_TABLE[INTERVAL_TABLE.length - 1][0];
    let minorDivisions = INTERVAL_TABLE[INTERVAL_TABLE.length - 1][1];

    for (let i = INTERVAL_TABLE.length - 1; i >= 0; i--) {
      const [interval, divisions] = INTERVAL_TABLE[i];
      if (interval * validPPS >= MIN_LABEL_GAP_PX) {
        majorInterval = interval;
        minorDivisions = divisions;
        break;
      }
    }

    const minorInterval = majorInterval / minorDivisions;
    const padPx = 60;
    const startTime = Math.max(0, (validScrollLeft - padPx) / validPPS);
    const endTime = (validScrollLeft + validViewportWidth + padPx) / validPPS;

    const result: { time: number; isMajor: boolean }[] = [];
    const firstTick = Math.floor(startTime / minorInterval) * minorInterval;

    if (minorInterval > 0 && !isNaN(minorInterval) && isFinite(startTime) && isFinite(endTime)) {
      let count = 0;
      for (let t = firstTick; t <= endTime && count < 2000; t += minorInterval) {
        const time = Math.round(t * 10000) / 10000;
        if (time < 0) continue;
        const isMajor =
          Math.abs(time % majorInterval) < minorInterval * 0.01 ||
          Math.abs((time % majorInterval) - majorInterval) < minorInterval * 0.01;
        result.push({ time, isMajor });
        count++;
      }
    }

    return result;
  }, [pixelsPerSecond, scrollLeft, viewportWidth]);

  // ── Double-click ruler to add marker ────────────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clickX = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, clickX / pixelsPerSecond);
      addMarker(time);
    },
    [pixelsPerSecond, scrollLeft, addMarker],
  );

  // ── Close popover when clicking background ────────────────────────────────
  const handleBackgroundClick = useCallback(() => {
    setSelectedMarkerId(null);
  }, []);

  const selectedMarker = markers.find((m) => m.id === selectedMarkerId);

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-visible"
      style={{
        height: 24,
        background: "var(--color-timeline-ruler-bg)",
        zIndex: 5,
      }}
      onDoubleClick={handleDoubleClick}
      onClick={handleBackgroundClick}
    >
      {/* ── Tick marks ── */}
      {ticks.map(({ time, isMajor }) => {
        const x = Math.round(time * pixelsPerSecond) - scrollLeft;
        return (
          <div
            key={time}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 1,
                height: isMajor ? 10 : 5,
                backgroundColor: isMajor ? "var(--color-timeline-ruler-tick-major)" : "var(--color-timeline-ruler-tick-minor)",
              }}
            />
            {isMajor && (
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 3,
                  fontSize: 10,
                  lineHeight: 1,
                  color: "var(--color-timeline-ruler-text)",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  userSelect: "none",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.02em",
                }}
              >
                {formatLabel(time)}
              </span>
            )}
          </div>
        );
      })}

      {/* ── Marker pins ── */}
      {markers.map((marker) => (
        <MarkerPin
          key={marker.id}
          marker={marker}
          pixelsPerSecond={pixelsPerSecond}
          scrollLeft={scrollLeft}
          selected={selectedMarkerId === marker.id}
          onSelect={(id) => setSelectedMarkerId((prev) => (prev === id ? null : id))}
          onDragEnd={(id, newTime) => updateMarker(id, { time: newTime })}
        />
      ))}

      {/* ── Marker popover ── */}
      {selectedMarker && (
        <MarkerPopover
          key={selectedMarker.id}
          marker={selectedMarker}
          x={Math.round(selectedMarker.time * pixelsPerSecond) - scrollLeft}
          onClose={() => setSelectedMarkerId(null)}
          onUpdate={(updates) => updateMarker(selectedMarker.id, updates)}
          onDelete={() => {
            removeMarker(selectedMarker.id);
            setSelectedMarkerId(null);
          }}
        />
      )}
    </div>
  );
};
