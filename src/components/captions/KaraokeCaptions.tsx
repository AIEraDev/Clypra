/**
 * KaraokeCaptions
 *
 * Animated word-by-word karaoke caption overlay synchronized with Clypra's
 * PlaybackClock. Uses a localized RAF loop that reads clock.time imperatively
 * to avoid React render storms, only triggering state updates when the active
 * sentence changes.
 *
 * Word-level highlight and glow animations are pure CSS transitions driven by
 * real-time math against the clock.
 */
import React, { useEffect, useRef, useState } from "react";
import { getPlaybackClock } from "@/core/playback";
import { useCaptionStore } from "@/store/captionStore";
import type { SubtitleSegment } from "@/types/captions";

export const KaraokeCaptions: React.FC = () => {
  const segments = useCaptionStore((s) => s.segments);
  const style = useCaptionStore((s) => s.karaokeStyle);

  const [activeSegment, setActiveSegment] = useState<SubtitleSegment | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (segments.length === 0) {
      setActiveSegment(null);
      return;
    }

    const updateCaptions = () => {
      const timeMs = getPlaybackClock().time * 1000;
      setCurrentTimeMs(timeMs);

      // Binary-search-style find: segments are ordered chronologically
      const current =
        segments.find((s) => timeMs >= s.startMs && timeMs <= s.endMs) ?? null;

      // Only trigger a React re-render when the active SENTENCE changes
      setActiveSegment((prev) =>
        prev?.id === current?.id ? prev : current,
      );

      rafRef.current = requestAnimationFrame(updateCaptions);
    };

    rafRef.current = requestAnimationFrame(updateCaptions);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [segments]);

  if (!activeSegment) return null;

  const positionClass =
    style.position === "top"
      ? "top-12"
      : style.position === "middle"
      ? "top-1/2 -translate-y-1/2"
      : "bottom-14";

  return (
    <div
      className={`absolute left-0 right-0 flex justify-center pointer-events-none z-50 ${positionClass}`}
      style={{ padding: "0 24px" }}
    >
      <div
        style={{
          background: style.backgroundColor,
          borderRadius: "14px",
          padding: "12px 24px",
          maxWidth: "80%",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            textTransform: style.textTransform ?? "uppercase",
            lineHeight: 1.25,
            margin: 0,
          }}
        >
          {activeSegment.words.map((wordObj, i) => {
            const isSpoken = currentTimeMs >= wordObj.startMs;
            const isActive =
              currentTimeMs >= wordObj.startMs &&
              currentTimeMs <= wordObj.endMs;

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  margin: "0 3px",
                  color: isActive
                    ? style.activeColor
                    : isSpoken
                    ? style.spokenColor
                    : style.upcomingColor,
                  transform: isActive && style.enableScalePop ? "scale(1.12)" : "scale(1)",
                  filter:
                    isActive && style.enableGlow
                      ? `drop-shadow(0 0 10px ${style.glowColor})`
                      : "none",
                  transition:
                    "color 60ms ease-out, transform 60ms ease-out, filter 60ms ease-out",
                  willChange: "color, transform, filter",
                }}
              >
                {wordObj.word}
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
};

export default KaraokeCaptions;
