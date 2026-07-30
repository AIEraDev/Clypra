import React, { useEffect, useState, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";

interface AudioMasterVUMeterProps {
  isPlaying?: boolean;
}

export const AudioMasterVUMeter: React.FC<AudioMasterVUMeterProps> = ({ isPlaying = false }) => {
  const [masterVolume, setMasterVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [leftLevel, setLeftLevel] = useState(0);  // 0.0 to 1.0
  const [rightLevel, setRightLevel] = useState(0); // 0.0 to 1.0

  const animFrameRef = useRef<number | null>(null);

  // Simulated audio meter level bounce during playback (or hook into AnalyserNode)
  useEffect(() => {
    if (!isPlaying) {
      setLeftLevel(0);
      setRightLevel(0);
      return;
    }

    let lTarget = 0.65;
    let rTarget = 0.60;

    const tick = () => {
      // Add realistic audio signal variations
      lTarget = Math.max(0.1, Math.min(0.95, lTarget + (Math.random() - 0.5) * 0.25));
      rTarget = Math.max(0.1, Math.min(0.95, rTarget + (Math.random() - 0.5) * 0.25));

      const volMultiplier = isMuted ? 0 : masterVolume;
      setLeftLevel(lTarget * volMultiplier);
      setRightLevel(rTarget * volMultiplier);

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, isMuted, masterVolume]);

  const effectiveVol = isMuted ? 0 : masterVolume;

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface-base/80 border border-white/10 rounded-md backdrop-blur-sm select-none">
      {/* Mute button */}
      <button
        onClick={() => setIsMuted(!isMuted)}
        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors cursor-pointer"
        title={isMuted ? "Unmute Master" : "Mute Master"}
      >
        {isMuted || masterVolume === 0 ? (
          <VolumeX className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
        )}
      </button>

      {/* Dual Channel VU Meter */}
      <div className="flex flex-col gap-1 w-20">
        {/* Left Channel */}
        <div className="flex items-center gap-1 h-1.5">
          <span className="text-[8px] font-mono text-text-muted w-2">L</span>
          <div className="flex-1 h-full bg-surface-raised rounded-full overflow-hidden flex">
            <div
              className="h-full transition-all duration-75 ease-out rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-red-500"
              style={{ width: `${Math.round(leftLevel * 100)}%` }}
            />
          </div>
        </div>

        {/* Right Channel */}
        <div className="flex items-center gap-1 h-1.5">
          <span className="text-[8px] font-mono text-text-muted w-2">R</span>
          <div className="flex-1 h-full bg-surface-raised rounded-full overflow-hidden flex">
            <div
              className="h-full transition-all duration-75 ease-out rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-red-500"
              style={{ width: `${Math.round(rightLevel * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Master Volume Slider */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={effectiveVol}
        onChange={(e) => {
          setMasterVolume(parseFloat(e.target.value));
          if (isMuted) setIsMuted(false);
        }}
        className="w-14 h-1 accent-emerald-400 bg-surface-raised rounded appearance-none cursor-pointer"
        title={`Master Volume: ${Math.round(effectiveVol * 100)}%`}
      />
    </div>
  );
};
