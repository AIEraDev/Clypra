import React, { useState } from "react";
import { Music, Smile, Wand2, Shuffle, MessageSquare, Filter } from "lucide-react";
import { MediaTab, AudioTab, TextTab, StickersTab, EffectsTab, FiltersTab, TransitionsTab, CaptionsTab, type TabType, MediaTabProps } from "../media-tabs";
import { TextIcon, YouTubeIcon } from "../../ui/icons";

export const EnhancedMediaPanel: React.FC<MediaTabProps> = ({ onAddToTimeline, initialTab = "media" }) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const tabs = [
    { id: "media" as const, icon: YouTubeIcon, label: "Media" },
    { id: "audio" as const, icon: Music, label: "Audio" },
    { id: "text" as const, icon: TextIcon, label: "Text" },
    { id: "stickers" as const, icon: Smile, label: "Stickers" },
    { id: "effects" as const, icon: Wand2, label: "Effects" },
    { id: "filters" as const, icon: Filter, label: "Filters" },
    { id: "transitions" as const, icon: Shuffle, label: "Transitions" },
    { id: "captions" as const, icon: MessageSquare, label: "Captions" },
  ];

  return (
    <div className="w-full md:w-92 min-h-0 panel-shell flex flex-col overflow-hidden shrink-0">
      {/* Tab Navigation */}
      <div className="panel-head border-b border-border">
        <div
          className="flex overflow-x-auto scrollbar-none"
          style={{
            overflowY: "auto",
            scrollbarWidth: "none", // Firefox
            msOverflowStyle: "none", // IE 10+
          }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center flex-col gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap cursor-pointer hover:text-accent ${activeTab === tab.id ? "text-accent" : "text-text-muted"}`}>
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "media" && <MediaTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "audio" && <AudioTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "text" && <TextTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "stickers" && <StickersTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "effects" && <EffectsTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "filters" && <FiltersTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "transitions" && <TransitionsTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "captions" && <CaptionsTab onAddToTimeline={onAddToTimeline} />}
      </div>
    </div>
  );
};
