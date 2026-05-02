import React from "react";
import { usePlayback } from "../../../hooks/usePlayback";

interface TimelineRulerProps {
  pixelsPerSecond: number;
  scrollLeft: number;
  onSeek: (time: number) => void;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ pixelsPerSecond, scrollLeft, onSeek }) => {
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

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, x / pixelsPerSecond);
    onSeek(time);
  };

  return (
    <div className="relative h-8 bg-[#171a1f] border-b border-[#2c2f34] select-none overflow-hidden" onClick={handleRulerClick}>
      {markers.map((time) => {
        const isMajor = Math.round((time / markerInterval) % 4) === 0;
        const x = time * pixelsPerSecond;
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
