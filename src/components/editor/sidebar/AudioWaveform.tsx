import React from "react";
import { Music } from "lucide-react";

interface AudioWaveformProps {
  audioElement?: HTMLAudioElement | null;
  isPlaying: boolean;
  coverImage?: string;
  audioName?: string;
  className?: string;
}

// Audio preview placeholder - blurred artwork background with centered artwork or music icon
export const AudioWaveform: React.FC<AudioWaveformProps> = ({ isPlaying, coverImage, audioName, className = "" }) => {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Full-screen blurred background */}
      <div className="absolute inset-0 overflow-hidden">
        {coverImage ? (
          <>
            {/* Full-size blurred artwork background */}
            <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl" />
            {/* Dark vignette overlay */}
            <div className="absolute inset-0 bg-background/60" />
          </>
        ) : (
          /* Solid dark background if no artwork */
          <div className="absolute inset-0 bg-linear-to-br from-background to-card" />
        )}
      </div>

      {/* Content layer */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-12 px-12 py-8">
        {/* Top: Album artwork or music icon */}
        <div className="shrink-0">
          {coverImage ? (
            <img src={coverImage} alt={audioName || "Album artwork"} className="w-52 h-52 rounded-md shadow-(--elev-shadow) ring-1 ring-border object-cover" />
          ) : (
            <div className="w-80 h-80 rounded-3xl bg-card/50 backdrop-blur-sm flex items-center justify-center ring-1 ring-border">
              <Music className="w-32 h-32 text-muted-foreground" strokeWidth={1.5} />
            </div>
          )}
        </div>
      </div>

      {/* Playing indicator */}
      {isPlaying && (
        <div className="absolute top-2 right-2 z-20">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/20 backdrop-blur-sm ring-1 ring-accent/30  animate-pulse">
            <div className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-[10px] font-medium text-accent">Playing</span>
          </div>
        </div>
      )}
    </div>
  );
};
