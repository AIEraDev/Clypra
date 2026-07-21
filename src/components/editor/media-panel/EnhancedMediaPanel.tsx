import React, { useState } from "react";
import { Music, Smile, Wand2, MessageSquare, Filter, Shuffle } from "lucide-react";
import { MediaTab, AudioTab, TextTab, StickersTab, FiltersTab, TransitionsTab, CaptionsTab, type TabType, MediaTabProps } from "../media-tabs";
import { EffectsPanel } from "@/features/video-effects/components/EffectsPanel";
import { TextIcon, YouTubeIcon } from "../../ui/icons";
import { t } from "@/i18n";

export const EnhancedMediaPanel: React.FC<MediaTabProps> = ({ onAddToTimeline, initialTab = "media" }) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const tabs = [
    { id: "media" as const, icon: YouTubeIcon, labelKey: "editor.media.nav.media" as const },
    { id: "audio" as const, icon: Music, labelKey: "editor.media.nav.audio" as const },
    { id: "text" as const, icon: TextIcon, labelKey: "editor.media.nav.text" as const },
    { id: "stickers" as const, icon: Smile, labelKey: "editor.media.nav.stickers" as const },
    { id: "effects" as const, icon: Wand2, labelKey: "editor.media.nav.effects" as const },
    { id: "filters" as const, icon: Filter, labelKey: "editor.media.nav.filters" as const },
    { id: "transitions" as const, icon: Shuffle, labelKey: "editor.media.nav.transitions" as const },
    { id: "captions" as const, icon: MessageSquare, labelKey: "editor.media.nav.captions" as const },
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
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} title={t(tab.labelKey)} aria-label={t(tab.labelKey)} className={`flex items-center flex-col gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap cursor-pointer hover:text-accent ${activeTab === tab.id ? "text-accent" : "text-text-muted"}`}>
                <Icon size={14} />
                {t(tab.labelKey)}
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
        {activeTab === "effects" && <EffectsPanel onAddToTimeline={onAddToTimeline} />}
        {activeTab === "filters" && <FiltersTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "transitions" && <TransitionsTab onAddToTimeline={onAddToTimeline} />}
        {activeTab === "captions" && <CaptionsTab onAddToTimeline={onAddToTimeline} />}
      </div>
    </div>
  );
};
