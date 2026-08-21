import React from "react";
import { cn } from "@/lib/utils";

interface VideoSourcePreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  poster?: string;
  onLoadedData?: () => void;
  onCanPlay?: () => void;
  onError?: () => void;
  className?: string;
}

export const VideoSourcePreview: React.FC<VideoSourcePreviewProps> = ({
  videoRef,
  src,
  poster,
  onLoadedData,
  onCanPlay,
  onError,
  className,
}) => {
  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      onLoadedData={onLoadedData}
      onCanPlay={onCanPlay}
      onError={onError}
      className={cn(
        "w-full h-full object-contain shadow-[0_0_40px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black",
        className
      )}
      playsInline
      preload="auto"
    />
  );
};
