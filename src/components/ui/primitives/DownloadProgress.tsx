/**
 * Download Progress Component
 * Shows download progress for audio library items
 */

import React from "react";
import { Download, CheckCircle, AlertCircle, X } from "lucide-react";
import type { DownloadState } from "@/features/audio-library/store/audioLibraryStore";

interface DownloadProgressProps {
  state: DownloadState;
  itemName?: string;
  onClose?: () => void;
  compact?: boolean;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({ state, itemName, onClose, compact = false }) => {
  if (compact) {
    // Compact inline version for AudioItem
    return (
      <div className="flex items-center gap-2 text-xs">
        {state.status === "downloading" && (
          <>
            <Download className="h-3 w-3 text-accent animate-pulse" />
            <span className="text-accent font-medium">{state.progress}%</span>
          </>
        )}
        {state.status === "completed" && (
          <>
            <CheckCircle className="h-3 w-3 text-green-400" />
            <span className="text-green-400 font-medium">Cached</span>
          </>
        )}
        {state.status === "error" && (
          <>
            <AlertCircle className="h-3 w-3 text-red-400" />
            <span className="text-red-400 font-medium">Failed</span>
          </>
        )}
      </div>
    );
  }

  // Full toast version
  return (
    <div className="bg-surface-raised border border-border rounded-lg shadow-lg p-4 min-w-[300px] max-w-[400px]">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {state.status === "downloading" && <Download className="h-4 w-4 text-accent animate-pulse shrink-0" />}
          {state.status === "completed" && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
          {state.status === "error" && <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <h4 className="text-sm font-semibold text-text-primary">
            {state.status === "downloading" && "Downloading Audio"}
            {state.status === "completed" && "Download Complete"}
            {state.status === "error" && "Download Failed"}
          </h4>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {itemName && <p className="text-xs text-text-muted mb-3 truncate">{itemName}</p>}

      {state.status === "downloading" && (
        <>
          <div className="w-full bg-surface rounded-full h-2 overflow-hidden mb-2">
            <div className="bg-accent h-full transition-all duration-300" style={{ width: `${state.progress}%` }} />
          </div>
          <p className="text-xs text-text-muted text-right">{state.progress}%</p>
        </>
      )}

      {state.status === "completed" && <p className="text-xs text-green-400">Audio ready for use</p>}

      {state.status === "error" && state.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  );
};

interface DownloadToastProps {
  downloads: DownloadState[];
  onClose?: (itemId: string) => void;
}

export const DownloadToast: React.FC<DownloadToastProps> = ({ downloads, onClose }) => {
  if (downloads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {downloads.map((download) => (
        <DownloadProgress key={download.itemId} state={download} onClose={onClose ? () => onClose(download.itemId) : undefined} />
      ))}
    </div>
  );
};
