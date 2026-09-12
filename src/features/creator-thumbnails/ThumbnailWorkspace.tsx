import React, { useState, useEffect } from "react";
import { useThumbnailWorkspace } from "./useThumbnailWorkspace";
import { ThumbnailPlatformPicker } from "./ThumbnailPlatformPicker";
import { ThumbnailFrameScrubber } from "./ThumbnailFrameScrubber";
import { ThumbnailOverlayEditor } from "./ThumbnailOverlayEditor";
import { ThumbnailFeedPreview } from "./ThumbnailFeedPreview";
import { ThumbnailVariantList } from "./ThumbnailVariantList";
import {
  X,
  Download,
  Eye,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface ThumbnailWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThumbnailWorkspace: React.FC<ThumbnailWorkspaceProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    project,
    activeVariant,
    variants,
    activeVariantId,
    setActiveVariantId,
    selectedLayerId,
    setSelectedLayerId,
    previewDataUrl,
    isRenderingFrame,
    isExporting,
    exportMessage,
    setTimestamp,
    syncToCurrentPlayhead,
    setPlatformPreset,
    addOverlayLayer,
    updateOverlayLayer,
    removeOverlayLayer,
    createNewVariant,
    deleteCurrentVariant,
    exportThumbnail,
  } = useThumbnailWorkspace();

  const [activeTab, setActiveTab] = useState<"compose" | "feed">("compose");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg">("png");

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPortrait =
    activeVariant.platformPreset.width < activeVariant.platformPreset.height;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 select-none animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-6xl h-[90vh] bg-neutral-950 border border-neutral-800/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-neutral-800/80 bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-100">
                  Thumbnail Generator
                </h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">
                  {project?.name || "Untitled Project"}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Zero-export frame compositing • Multi-variant design • Live feed check
              </p>
            </div>
          </div>

          {/* Center Tabs: Compose vs Feed Legibility */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("compose")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === "compose"
                  ? "bg-neutral-800 text-sky-400 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Compose
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("feed")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === "feed"
                  ? "bg-neutral-800 text-sky-400 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Feed Preview
            </button>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Main Interactive Preview Canvas Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-neutral-950/60 p-4 border-r border-neutral-800/80 overflow-y-auto">
            {activeTab === "compose" ? (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[380px] relative">
                {/* Resolution & Ratio Info Pill */}
                <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-neutral-900/90 text-neutral-300 border border-neutral-800 backdrop-blur-sm shadow-sm">
                    {activeVariant.platformPreset.width} ×{" "}
                    {activeVariant.platformPreset.height} (
                    {activeVariant.platformPreset.aspectRatioLabel})
                  </span>
                </div>

                {/* Canvas Display Viewport */}
                <div
                  className="relative rounded-xl overflow-hidden border border-neutral-800/80 shadow-2xl bg-[#09090b] flex items-center justify-center max-w-full max-h-[58vh]"
                  style={{
                    aspectRatio: `${activeVariant.platformPreset.width} / ${activeVariant.platformPreset.height}`,
                  }}
                >
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Thumbnail Preview"
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-8 text-neutral-500">
                      <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                      <span className="text-xs font-mono">
                        Rendering high-resolution frame...
                      </span>
                    </div>
                  )}

                  {isRenderingFrame && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-700 text-xs font-medium text-neutral-200 shadow-lg">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                        Rendering Frame...
                      </div>
                    </div>
                  )}
                </div>

                {/* Timeline Scrubber Component */}
                <div className="w-full max-w-2xl mt-4">
                  <ThumbnailFrameScrubber
                    durationSeconds={project?.duration || 10}
                    currentTimestampSeconds={activeVariant.timestampMs / 1000}
                    onSeek={setTimestamp}
                    onSyncPlayhead={syncToCurrentPlayhead}
                    isRendering={isRenderingFrame}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-start p-4">
                <ThumbnailFeedPreview
                  previewDataUrl={previewDataUrl}
                  videoTitle={project?.name || "My New Video"}
                  isPortrait={isPortrait}
                />
              </div>
            )}
          </div>

          {/* Right Sidebar: Controls & Inspector */}
          <div className="w-80 sm:w-96 flex flex-col bg-neutral-950 p-4 gap-4 overflow-y-auto">
            {/* Variants Manager */}
            <ThumbnailVariantList
              variants={variants}
              activeVariantId={activeVariantId}
              onSelectVariant={setActiveVariantId}
              onCreateVariant={createNewVariant}
              onDeleteVariant={deleteCurrentVariant}
              onUpdateVariant={(id, patch) => {
                const found = variants.find((v) => v.id === id);
                if (found) {
                  useThumbnailWorkspace;
                }
              }}
            />

            <hr className="border-neutral-800" />

            {/* Platform & Dimension Preset Picker */}
            <ThumbnailPlatformPicker
              currentPreset={activeVariant.platformPreset}
              onSelectPreset={setPlatformPreset}
            />

            <hr className="border-neutral-800" />

            {/* Overlay Layers Inspector */}
            <ThumbnailOverlayEditor
              layers={activeVariant.overlayLayers}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onAddLayer={addOverlayLayer}
              onUpdateLayer={updateOverlayLayer}
              onRemoveLayer={removeOverlayLayer}
            />
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-800/80 bg-neutral-900/60">
          <div className="flex items-center gap-2 min-w-0">
            {exportMessage && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{exportMessage}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Format Picker */}
            <div className="flex items-center bg-neutral-800 rounded-lg p-0.5 border border-neutral-700">
              <button
                type="button"
                onClick={() => setExportFormat("png")}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium ${
                  exportFormat === "png"
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                PNG
              </button>
              <button
                type="button"
                onClick={() => setExportFormat("jpeg")}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium ${
                  exportFormat === "jpeg"
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                JPEG
              </button>
            </div>

            {/* Export Button */}
            <button
              type="button"
              disabled={isExporting || !previewDataUrl}
              onClick={() => exportThumbnail(exportFormat, 95)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-neutral-950 font-semibold text-xs transition-all shadow-md shadow-sky-500/20 active:scale-95"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Export Thumbnail ({exportFormat.toUpperCase()})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
