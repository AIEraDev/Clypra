import React from "react";
import { Volume2, VolumeX } from "lucide-react";

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
  return (
    <div className="flex items-center gap-1 group/vol shrink-0">
      <button
        onClick={() => setIsMuted((m) => !m)}
        className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={isMuted ? "Unmute" : `Mute (${volume}%)`}
        aria-label={isMuted ? "Unmute audio" : "Mute audio"}
      >
        {isMuted || volume === 0 ? (
          <VolumeX className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <Volume2 className="w-3.5 h-3.5" />
        )}
      </button>

      <input
        type="range"
        min="0"
        max="100"
        value={isMuted ? 0 : volume}
        onChange={(e) => {
          if (isMuted) setIsMuted(false);
          setVolume(Number(e.target.value));
        }}
        className="w-12 sm:w-14 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer"
        title={`Volume: ${volume}%`}
      />
    </div>
  );
};
