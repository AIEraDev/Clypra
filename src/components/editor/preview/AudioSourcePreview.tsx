import React from "react";
import { AudioWaveform } from "../sidebar/AudioWaveform";
import { cn } from "@/lib/utils";

interface AudioSourcePreviewProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  src: string;
  isPlaying: boolean;
  coverImage?: string;
  audioName: string;
  className?: string;
}

export const AudioSourcePreview: React.FC<AudioSourcePreviewProps> = ({
  audioRef,
  src,
  isPlaying,
  coverImage,
  audioName,
  className,
}) => {
  return (
    <div className={cn("w-full h-full flex items-center justify-center relative", className)}>
      <AudioWaveform
        audioElement={audioRef.current}
        isPlaying={isPlaying}
        coverImage={coverImage}
        audioName={audioName}
        className="w-full h-full"
      />
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        style={{ display: "none" }}
      />
    </div>
  );
};
