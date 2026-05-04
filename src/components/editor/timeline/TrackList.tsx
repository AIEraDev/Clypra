import React, { useState } from "react";
import { Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, X } from "lucide-react";
import { useTimelineStore } from "../../../store/timelineStore";
import { useUIStore } from "../../../store/uiStore";

interface TrackListProps {
  onEditTrack?: (trackId: string) => void;
}

export const TrackList: React.FC<TrackListProps> = ({ onEditTrack }) => {
  const { tracks, removeTrack, toggleTrackLock, toggleTrackMute, toggleTrackVisibility } = useTimelineStore();
  const { selectedTrackId, selectTrack } = useUIStore();
  // const [editingId, setEditingId] = useState<string | null>(null);
  // const [editingName, setEditingName] = useState("");

  // const handleDoubleClick = (trackId: string, name: string) => {
  //   setEditingId(trackId);
  //   setEditingName(name);
  // };

  // const handleNameChange = (trackId: string, newName: string) => {
  //   setEditingId(null);
  //   onEditTrack?.(trackId);
  // };

  return (
    <div className="w-40 border-r border-[#2c2f34] flex flex-col bg-[#12171d]">
      <div className="h-8 px-3 border-b border-[#2c2f34] flex items-center shrink-0 panel-head">
        <span className="text-[11px] font-semibold tracking-wide text-[#88909a] uppercase">Track</span>
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-0">
        {tracks.map((track) => (
          <div key={track.id} className={`group border-b border-[#2b2f35] flex items-center gap-2 px-2 py-1 transition-colors ${selectedTrackId === track.id ? "bg-[#20252b]" : "hover:bg-[#1e2228]"}`} style={{ height: `${track.height}px` }} onClick={() => selectTrack(track.id)}>
            {/* {editingId === track.id ? (
              <input autoFocus type="text" value={editingName} onChange={(e) => setEditingName(e.target.value)} onBlur={() => handleNameChange(track.id, editingName)} onKeyPress={(e) => e.key === "Enter" && handleNameChange(track.id, editingName)} className="flex-1 bg-surface-raised border border-accent rounded px-1 py-0.5 text-xs text-text-primary focus:outline-none" />
            ) : (
              <div onDoubleClick={() => handleDoubleClick(track.id, track.name)} className="flex-1 text-[14px] font-medium text-[#d6d9de] truncate hover:text-cyan-300">
                {track.name}
              </div>
            )} */}

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackLock(track.id);
              }}
              className={`p-1 rounded transition-colors ${track.locked ? "bg-[#2a3038] text-white" : "hover:bg-[#2a3038] text-[#848c96]"}`}
              aria-label={track.locked ? "Unlock track" : "Lock track"}
            >
              {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackVisibility(track.id);
              }}
              className={`p-1 rounded transition-colors ${track.visible ? "hover:bg-[#2a3038] text-[#848c96]" : "bg-[#2a3038] text-white"}`}
              aria-label={track.visible ? "Hide track" : "Show track"}
            >
              {track.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackMute(track.id);
              }}
              className={`p-1 rounded transition-colors ${track.muted ? "bg-[#2a3038] text-white" : "hover:bg-[#2a3038] text-[#848c96]"}`}
              aria-label={track.muted ? "Unmute track" : "Mute track"}
            >
              {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTrack(track.id);
              }}
              className="p-1 hover:bg-danger/20 rounded transition-colors opacity-0 group-hover:opacity-100"
            >
              <X className="w-3 h-3 text-danger" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
