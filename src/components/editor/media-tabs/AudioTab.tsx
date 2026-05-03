import React, { useState } from "react";
import { Search, Play, Plus, Heart } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import type { TabProps } from "./types";

export const AudioTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<"effects" | "music">("effects");

  // Dummy sound effects data
  const soundEffects = [
    { id: "sfx-1", name: "Whoosh", author: "qubodup", duration: 1.2, category: "transition" },
    {
      id: "sfx-2",
      name: "Thunder Storm",
      author: "RHumphries",
      duration: 8.5,
      category: "ambient",
    },
    {
      id: "sfx-3",
      name: "Cinematic Boom",
      author: "HerbertBoland",
      duration: 2.1,
      category: "impact",
    },
    { id: "sfx-4", name: "Explosion", author: "tommccann", duration: 1.8, category: "impact" },
    {
      id: "sfx-5",
      name: "Button Click",
      author: "LittleRobotSoundFactory",
      duration: 0.3,
      category: "ui",
    },
    { id: "sfx-6", name: "Swoosh", author: "qubodup", duration: 0.8, category: "transition" },
  ];

  const musicTracks = [
    { id: "music-1", name: "Upbeat Corporate", author: "AudioCoffee", duration: 180, bpm: 120 },
    { id: "music-2", name: "Cinematic Epic", author: "Orchestralis", duration: 240, bpm: 90 },
    { id: "music-3", name: "Lo-fi Chill", author: "BeatsRelax", duration: 150, bpm: 85 },
  ];

  const filteredSounds = soundEffects.filter((sfx) => sfx.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      {/* Sub-tabs */}
      <div className="flex border-b border-border">
        <button onClick={() => setActiveSubTab("effects")} className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === "effects" ? "text-accent bg-surface-raised" : "text-text-muted hover:text-text-primary"}`}>
          Sound Effects
        </button>
        <button onClick={() => setActiveSubTab("music")} className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${activeSubTab === "music" ? "text-accent bg-surface-raised" : "text-text-muted hover:text-text-primary"}`}>
          Music
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder={`Search ${activeSubTab === "effects" ? "sound effects" : "music"}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">{activeSubTab === "effects" ? filteredSounds.map((sfx) => <AudioItem key={sfx.id} item={sfx} onAddToTimeline={() => onAddToTimeline?.(sfx, "audio")} />) : musicTracks.map((track) => <AudioItem key={track.id} item={track} onAddToTimeline={() => onAddToTimeline?.(track, "audio")} />)}</div>
    </>
  );
};

// AudioItem Component
const AudioItem: React.FC<{ item: any; onAddToTimeline: () => void }> = ({ item, onAddToTimeline }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="group flex items-center gap-3 p-2 bg-surface-raised hover:bg-surface-raised/80 rounded-lg transition-colors">
      <button onClick={() => setIsPlaying(!isPlaying)} className="w-10 h-10 flex items-center justify-center bg-accent/20 hover:bg-accent/30 rounded-lg transition-colors shrink-0">
        <Play className="w-4 h-4 text-accent" />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
        <p className="text-xs text-text-muted">{item.author}</p>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onAddToTimeline} className="w-7 h-7 flex items-center justify-center hover:bg-surface-raised rounded transition-colors">
              <Plus className="w-4 h-4 text-text-primary" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Add to Timeline</p>
          </TooltipContent>
        </Tooltip>

        <button className="w-7 h-7 flex items-center justify-center hover:bg-surface-raised rounded transition-colors">
          <Heart className="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>
  );
};
