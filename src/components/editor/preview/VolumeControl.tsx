import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { t } from "@/i18n";

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
    <>
      <button
        onClick={() => setIsMuted((m) => !m)}
        className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer"
        title={isMuted ? t("editor.preview.volume.unmute") : t("editor.preview.volume.mute")}
        aria-label={isMuted ? t("editor.preview.volume.unmuteAudio") : t("editor.preview.volume.muteAudio")}
      >
        {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>

      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        aria-label={t("editor.preview.volume.label")}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-16 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer"
      />
    </>
  );
};
