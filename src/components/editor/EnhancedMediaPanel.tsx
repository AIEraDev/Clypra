import React, { useState } from "react";
import { Music, Type, Smile, Wand2, Shuffle, MessageSquare, Folder } from "lucide-react";
import { MediaTab, AudioTab, TextTab, StickersTab, EffectsTab, TransitionsTab, CaptionsTab, type TabType, MediaTabProps } from "./media-tabs";

export const EnhancedMediaPanel: React.FC<MediaTabProps> = ({ onAddToTimeline }) => {
  const [activeTab, setActiveTab] = useState<TabType>("media");

  const tabs = [
    { id: "media" as const, icon: Folder, label: "Media" },
    { id: "audio" as const, icon: Music, label: "Audio" },
    { id: "text" as const, icon: Type, label: "Text" },
    { id: "stickers" as const, icon: Smile, label: "Stickers" },
    { id: "effects" as const, icon: Wand2, label: "Effects" },
    { id: "transitions" as const, icon: Shuffle, label: "Transitions" },
    { id: "captions" as const, icon: MessageSquare, label: "Captions" },
  ];

  return (
    <div className="w-[23rem] min-h-0 panel-shell flex flex-col overflow-hidden shrink-0">
      {/* Tab Navigation */}
      <div className="panel-head border-b border-border">
        <div className="flex overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${activeTab === tab.id ? "text-accent border-accent" : "text-text-muted border-transparent hover:text-text-primary"}`}>
                <Icon className="w-4 h-4" />
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
        {activeTab === "transitions" && <TransitionsTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "captions" && <CaptionsTab onAddToTimeline={onAddToTimeline} />}
      </div>
    </div>
  );
};
