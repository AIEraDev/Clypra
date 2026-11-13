/**
 * Project-backed word-highlight caption preview.
 *
 * CaptionCue.words is the canonical timing source. The overlay is deliberately
 * a preview surface; timeline TextClips remain the source used by normal
 * rendering and export when this overlay is disabled.
 */
import React, { useEffect, useState } from "react";
import { getPlaybackClock } from "@/core/playback";
import { useCaptionStore } from "@/store/captionStore";
import { useTimelineStore } from "@/store/timelineStore";
import { secondsToTicks, type CaptionCue, type CaptionTrack, type SubtitleSegment } from "@/types/captions";

interface CaptionFrameState {
  cueId: string | null;
  legacySegmentId: number | null;
  wordIndex: number;
}

const EMPTY_FRAME: CaptionFrameState = {
  cueId: null,
  legacySegmentId: null,
  wordIndex: -1,
};

export const KaraokeCaptions: React.FC = () => {
  const captionTracks = useTimelineStore((state) => state.captionTracks);
  const segments = useCaptionStore((state) => state.segments);
  const legacyStyle = useCaptionStore((state) => state.karaokeStyle);
  const [frame, setFrame] = useState<CaptionFrameState>(EMPTY_FRAME);

  useEffect(() => {
    let rafId: number | null = null;
    let disposed = false;

    const tick = () => {
      if (disposed) return;

      const nowTicks = secondsToTicks(getPlaybackClock().time);
      const tracks = useTimelineStore.getState().captionTracks;
      let activeTrack: CaptionTrack | undefined;
      let activeCue: CaptionCue | undefined;

      for (const track of tracks) {
        if (!track.visible) continue;
        const cue = track.cues.find(
          (candidate) =>
            nowTicks >= candidate.startTicks && nowTicks < candidate.endTicks,
        );
        if (cue) {
          activeTrack = track;
          activeCue = cue;
          break;
        }
      }

      if (activeTrack && activeCue) {
        const cueOffsetTicks = nowTicks - activeCue.startTicks;
        const wordIndex = activeCue.words?.findIndex(
          (word) =>
            cueOffsetTicks >= word.startOffsetTicks &&
            cueOffsetTicks < word.endOffsetTicks,
        ) ?? -1;
        setFrame((previous) =>
          previous.cueId === activeCue!.id &&
          previous.legacySegmentId === null &&
          previous.wordIndex === wordIndex
            ? previous
            : { cueId: activeCue!.id, legacySegmentId: null, wordIndex },
        );
      } else {
        // Backward compatibility for projects/sessions that still populate the
        // legacy transient Whisper segment store instead of CaptionTrack.cues.
        const legacySegments = useCaptionStore.getState().segments;
        const nowMs = nowTicks / 1000;
        const activeSegment = legacySegments.find(
          (segment) => nowMs >= segment.startMs && nowMs < segment.endMs,
        );
        if (activeSegment) {
          const wordIndex = activeSegment.words.findIndex(
            (word) => nowMs >= word.startMs && nowMs < word.endMs,
          );
          setFrame((previous) =>
            previous.legacySegmentId === activeSegment.id &&
            previous.cueId === null &&
            previous.wordIndex === wordIndex
              ? previous
              : { cueId: null, legacySegmentId: activeSegment.id, wordIndex },
          );
        } else {
          setFrame((previous) =>
            previous.cueId === null && previous.legacySegmentId === null
              ? previous
              : EMPTY_FRAME,
          );
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const activeTrack = captionTracks.find(
    (track) =>
      track.visible && track.cues.some((cue) => cue.id === frame.cueId),
  );
  const activeCue = activeTrack?.cues.find((cue) => cue.id === frame.cueId);
  const activeSegment: SubtitleSegment | undefined =
    frame.legacySegmentId === null
      ? undefined
      : segments.find((segment) => segment.id === frame.legacySegmentId);

  if (!activeCue && !activeSegment) return null;

  const preset = activeTrack?.preset;
  const wordStyle = preset?.wordHighlight;
  const textStyle = activeTrack?.defaultStyle;
  const words = activeCue?.words;
  const text = activeCue?.text ?? activeSegment?.text ?? "";
  const activeColor = wordStyle?.activeColor ?? legacyStyle.activeColor;
  const spokenColor = wordStyle?.spokenColor ?? legacyStyle.spokenColor;
  const upcomingColor = wordStyle?.upcomingColor ?? legacyStyle.upcomingColor;
  const position = preset?.position ?? legacyStyle.position;
  const positionClass =
    position === "top"
      ? "top-12"
      : position === "middle"
        ? "top-1/2 -translate-y-1/2"
        : "bottom-14";
  const maxWidthPercent = preset?.maxWidthPercent ?? 80;
  const highlightMode = wordStyle?.mode ?? "current";
  const scale = wordStyle?.activeScale ?? (legacyStyle.enableScalePop ? 1.12 : 1);
  const glowColor = wordStyle?.glowColor ?? legacyStyle.glowColor;
  const glowBlur = wordStyle?.glowBlur ?? 10;
  const background = textStyle?.background;
  const stroke = textStyle?.stroke;
  const shadow = textStyle?.shadow;
  const isLegacy = !activeTrack;

  const fontSize = textStyle?.fontSize ?? legacyStyle.fontSize;
  const fontFamily = textStyle?.fontFamily ?? legacyStyle.fontFamily;
  const fontWeight = textStyle?.fontWeight ?? legacyStyle.fontWeight;
  const color = textStyle?.color ?? legacyStyle.spokenColor;
  const transform = preset?.textTransform ?? legacyStyle.textTransform ?? "none";
  const align = textStyle?.align ?? "center";
  const lineHeight = textStyle?.lineHeight ?? 1.2;

  const renderWords = words?.length
    ? words.map((word, index) => {
        const isActive = index === frame.wordIndex;
        const isSpoken = index < frame.wordIndex;
        const wordColor = isActive
          ? activeColor
          : isSpoken && highlightMode === "cumulative"
            ? activeColor
            : isSpoken
              ? spokenColor
              : upcomingColor;
        const glowEnabled =
          isActive &&
          Boolean(glowColor) &&
          (wordStyle ? (wordStyle.glowBlur ?? 0) > 0 : legacyStyle.enableGlow);
        return (
          <span
            key={`${activeCue?.id ?? activeSegment?.id}-${index}`}
            style={{
              display: "inline-block",
              margin: "0 0.12em",
              color: wordColor,
              transform: isActive ? `scale(${scale})` : "scale(1)",
              filter: glowEnabled ? `drop-shadow(0 0 ${glowBlur}px ${glowColor})` : "none",
              transition: "color 60ms ease-out, transform 60ms ease-out, filter 60ms ease-out",
            }}
          >
            {word.word}
          </span>
        );
      })
    : null;

  const legacyWords = activeSegment?.words;
  const renderLegacyWords = legacyWords?.length
    ? legacyWords.map((word, index) => {
        const isActive = index === frame.wordIndex;
        const isSpoken = index < frame.wordIndex;
        return (
          <span
            key={`${activeSegment.id}-${index}`}
            style={{
              display: "inline-block",
              margin: "0 0.12em",
              color: isActive ? activeColor : isSpoken ? spokenColor : upcomingColor,
              transform: isActive && legacyStyle.enableScalePop ? "scale(1.12)" : "scale(1)",
              filter: isActive && legacyStyle.enableGlow
                ? `drop-shadow(0 0 10px ${legacyStyle.glowColor})`
                : "none",
              transition: "color 60ms ease-out, transform 60ms ease-out, filter 60ms ease-out",
            }}
          >
            {word.word}
          </span>
        );
      })
    : null;

  const boxBackground =
    background?.color ?? (isLegacy ? legacyStyle.backgroundColor : "transparent");

  return (
    <div
      aria-hidden="true"
      className={`absolute left-0 right-0 flex justify-center pointer-events-none z-50 ${positionClass}`}
      style={{ padding: "0 24px" }}
    >
      <div
        style={{
          background: boxBackground,
          borderRadius: background?.borderRadius ?? (isLegacy ? 14 : 0),
          padding: background?.padding
            ? `${background.padding}px ${background.padding * 2}px`
            : "12px 24px",
          maxWidth: `${Math.max(50, Math.min(96, maxWidthPercent))}%`,
          textAlign: align,
          WebkitTextStroke: stroke ? `${stroke.width}px ${stroke.color}` : undefined,
          textShadow: shadow
            ? `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`
            : undefined,
        }}
      >
        <p
          style={{
            fontFamily,
            fontSize,
            fontWeight,
            color,
            textTransform: transform,
            lineHeight,
            letterSpacing: textStyle?.letterSpacing,
            margin: 0,
            whiteSpace: "pre-wrap",
          }}
        >
          {renderWords ?? renderLegacyWords ?? text}
        </p>
      </div>
    </div>
  );
};
