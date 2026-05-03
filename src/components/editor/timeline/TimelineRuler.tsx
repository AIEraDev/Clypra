import React from "react";
import { usePlayback } from "../../../hooks/usePlayback";

interface TimelineRulerProps {
  pixelsPerSecond: number;
  scrollLeft: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ pixelsPerSecond, scrollLeft }) => {
  const { frameRate } = usePlayback();

  const getMarkerInterval = () => {
    if (pixelsPerSecond < 50) return 5;
    if (pixelsPerSecond < 200) return 0.5;
    if (pixelsPerSecond < 500) return 0.5;
    return 10 / frameRate;
  };

  const markerInterval = getMarkerInterval();
  const startTime = scrollLeft / pixelsPerSecond;
  const visibleRange = 1200 / pixelsPerSecond;
  const endTime = startTime + visibleRange;

  const markers = [];
  for (let time = Math.floor(startTime / markerInterval) * markerInterval; time < endTime; time += markerInterval) {
    markers.push(time);
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className="relative h-8 bg-[#171a1f] border-b border-[#2c2f34] select-none overflow-hidden">
      {markers.map((time) => {
        const isMajor = Math.round((time / markerInterval) % 4) === 0;
        // ✅ Round to avoid subpixel rendering issues
        const x = Math.round(time * pixelsPerSecond);
        return (
          <div
            key={time}
            style={{
              position: "absolute",
              left: `${x}px`,
              top: 0,
              height: "100%",
              userSelect: "none",
            }}
            className="group"
          >
            <div className={`w-px ${isMajor ? "h-4 bg-[#3c424c]" : "h-2 bg-[#333941]"} mt-0`} />
            {isMajor && <span className="absolute top-4 left-1 text-[10px] leading-none text-[#7f8894] group-hover:text-[#d0d6de]">{formatTime(time)}</span>}
          </div>
        );
      })}
    </div>
  );
};
