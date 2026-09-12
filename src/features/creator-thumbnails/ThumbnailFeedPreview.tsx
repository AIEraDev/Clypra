import React from "react";

interface ThumbnailFeedPreviewProps {
  previewDataUrl: string | null;
  videoTitle?: string;
  isPortrait?: boolean;
}

export const ThumbnailFeedPreview: React.FC<ThumbnailFeedPreviewProps> = ({
  previewDataUrl,
  videoTitle = "My Incredible Video",
  isPortrait = false,
}) => {
  if (!previewDataUrl) return null;

  return (
    <div className="flex flex-col gap-4 p-4 bg-neutral-950/80 rounded-xl border border-neutral-800">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Feed Legibility Simulation
        </label>
        <span className="text-[11px] text-neutral-400">
          Verify text readable at small scale
        </span>
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        {/* Desktop / Large Feed Preview (320px) */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-mono text-neutral-400">
            Feed View (320px)
          </span>
          <div
            className="flex flex-col gap-2 p-2 rounded-xl bg-neutral-900 border border-neutral-800 shadow-md"
            style={{ width: isPortrait ? "180px" : "320px" }}
          >
            <div
              className="relative overflow-hidden rounded-lg bg-black flex items-center justify-center"
              style={{
                aspectRatio: isPortrait ? "9/16" : "16/9",
              }}
            >
              <img
                src={previewDataUrl}
                alt="Feed Preview"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 right-1 px-1 py-0.2 bg-black/80 text-[10px] font-mono text-white rounded">
                12:40
              </span>
            </div>
            <div className="flex gap-2 items-start mt-0.5">
              <div className="w-6 h-6 rounded-full bg-neutral-700 flex-shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-neutral-200 truncate leading-tight">
                  {videoTitle}
                </span>
                <span className="text-[10px] text-neutral-400 leading-tight mt-0.5">
                  Clypra Studio • 142K views
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar / Mobile Feed Preview (168px) */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-mono text-neutral-400">
            Sidebar / Mobile (168px)
          </span>
          <div
            className="flex gap-2 p-2 rounded-xl bg-neutral-900 border border-neutral-800 shadow-md"
            style={{ width: isPortrait ? "140px" : "260px" }}
          >
            <div
              className="relative overflow-hidden rounded-md bg-black flex-shrink-0"
              style={{
                width: isPortrait ? "60px" : "120px",
                aspectRatio: isPortrait ? "9/16" : "16/9",
              }}
            >
              <img
                src={previewDataUrl}
                alt="Sidebar Preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col min-w-0 justify-center">
              <span className="text-[11px] font-medium text-neutral-200 line-clamp-2 leading-tight">
                {videoTitle}
              </span>
              <span className="text-[9px] text-neutral-400 mt-1">
                48K views
              </span>
            </div>
          </div>
        </div>

        {/* Micro / Compact Preview (120px) */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-mono text-neutral-400">
            Compact (120px)
          </span>
          <div
            className="overflow-hidden rounded-md border border-neutral-800 shadow-sm"
            style={{
              width: isPortrait ? "80px" : "120px",
              aspectRatio: isPortrait ? "9/16" : "16/9",
            }}
          >
            <img
              src={previewDataUrl}
              alt="Micro Preview"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
