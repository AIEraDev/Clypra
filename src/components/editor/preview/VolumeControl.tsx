import React, { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX, Volume1 } from "lucide-react";

interface VolumeControlProps {
  isMuted: boolean;
  setIsMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  volume: number;
  setVolume: (volume: number) => void;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  isMuted,
  setIsMuted,
  volume,
  setVolume,
}) => {
  const [showPopup, setShowPopup] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowPopup(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setShowPopup(false);
    }, 250);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 5 : -5;
    const newVol = Math.max(0, Math.min(100, (isMuted ? 0 : volume) + delta));
    if (isMuted && newVol > 0) setIsMuted(false);
    setVolume(newVol);
  };

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div
      className="relative flex items-center gap-1 shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => setIsMuted((m) => !m)}
        onWheel={handleWheel}
        className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={isMuted ? "Unmute" : `Mute (${volume}%) • Scroll to adjust`}
        aria-label={isMuted ? "Unmute audio" : "Mute audio"}
      >
        <VolumeIcon className="w-3.5 h-3.5" />
      </button>

      {/* Inline slider when container is wide enough (>= 440px) */}
      <div className="hidden @[440px]:flex items-center">
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={(e) => {
            if (isMuted) setIsMuted(false);
            setVolume(Number(e.target.value));
          }}
          className="w-12 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer"
          title={`Volume: ${volume}%`}
        />
      </div>

      {/* Compact floating popover slider on narrow containers (< 440px) */}
      {showPopup && (
        <div
          className="@[440px]:hidden absolute bottom-full right-0 mb-2 px-2.5 py-2 bg-surface-elevated/95 border border-white/10 backdrop-blur-md rounded-xl shadow-2xl flex items-center gap-2 z-50 animate-in fade-in zoom-in-95 duration-100"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              if (isMuted) setIsMuted(false);
              setVolume(Number(e.target.value));
            }}
            className="w-16 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer"
            title={`Volume: ${volume}%`}
          />
          <span className="text-[10px] text-text-muted font-mono w-7 text-right select-none">
            {isMuted ? "0%" : `${volume}%`}
          </span>
        </div>
      )}
    </div>
  );
};
