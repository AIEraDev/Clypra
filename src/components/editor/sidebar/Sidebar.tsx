import React, { useState } from "react";
import {
  Music,
  Smile,
  Wand2,
  MessageSquare,
  Filter,
  Shuffle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { MediaTab } from "./tabs/MediaTab";
import { AudioTab } from "./tabs/AudioTab";
import { TextTab } from "./tabs/TextTab";
import { StickersTab } from "./tabs/StickersTab";
import { FiltersTab } from "./tabs/FiltersTab";
import { TransitionsTab } from "./tabs/TransitionsTab";
import { CaptionsTab } from "./tabs/CaptionsTab";
import { SmartOverlaysTab } from "./tabs/SmartOverlaysTab";
import { type TabType, type MediaTabProps } from "./types";
import { EffectsPanel } from "@/features/video-effects/components/EffectsPanel";
import { TextIcon, YouTubeIcon } from "@/components/ui/icons";

const SIDEBAR_TABS = [
  { id: "media" as const, icon: YouTubeIcon, label: "Media" },
  { id: "audio" as const, icon: Music, label: "Audio" },
  { id: "text" as const, icon: TextIcon, label: "Text" },
  { id: "smart-overlays" as const, icon: Sparkles, label: "Overlays" },
  { id: "stickers" as const, icon: Smile, label: "Stickers" },
  { id: "effects" as const, icon: Wand2, label: "Effects" },
  { id: "filters" as const, icon: Filter, label: "Filters" },
  { id: "transitions" as const, icon: Shuffle, label: "Transitions" },
  { id: "captions" as const, icon: MessageSquare, label: "Captions" },
] as const;

export interface SidebarProps extends MediaTabProps {
  width?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

const SidebarComponent: React.FC<SidebarProps> = ({
  onAddToTimeline,
  initialTab = "media",
  width,
  collapsed = false,
  onToggleCollapse,
  className = "",
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div
      className={`min-h-0 panel-shell flex flex-col overflow-hidden transition-[width] duration-150 ${
        collapsed || width !== undefined ? "shrink-0" : "flex-1 min-w-0"
      } ${className}`}
      style={{ width: collapsed ? 44 : width }}
    >
      {/* Tab Navigation / Header */}
      <div className="panel-head border-b border-border relative flex items-center">
        {collapsed ? (
          <div className="w-full flex items-center justify-center py-2">
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
                title="Expand media panel"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="relative flex-1 min-w-0 pr-6">
              <div
                className="flex overflow-x-auto scrollbar-none"
                style={{
                  overflowY: "hidden",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
              >
                {SIDEBAR_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center flex-col gap-0.5 px-2.5 py-1.5 text-[10px] font-medium transition-colors whitespace-nowrap cursor-pointer border-b-2 ${
                        isActive
                          ? "text-accent border-accent bg-accent/[0.04]"
                          : "text-text-muted border-transparent hover:text-text-primary hover:bg-white/[0.02]"
                      }`}
                    >
                      <Icon size={14} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {/* Fade hint for overflow tabs */}
              <div className="pointer-events-none absolute right-6 top-0 h-full w-6 bg-gradient-to-l from-surface-panel to-transparent" />
            </div>

            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                title="Collapse media panel"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Tab Content or Collapsed Rail */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 py-2 overflow-y-auto flex-1 scrollbar-none">
          {SIDEBAR_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  onToggleCollapse?.();
                }}
                title={tab.label}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                  isActive
                    ? "text-accent bg-accent/15"
                    : "text-text-muted hover:text-accent hover:bg-white/5"
                }`}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {activeTab === "media" && (
            <MediaTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "audio" && (
            <AudioTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "text" && <TextTab onAddToTimeline={onAddToTimeline} />}
          {activeTab === "smart-overlays" && (
            <SmartOverlaysTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "stickers" && (
            <StickersTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "effects" && (
            <EffectsPanel onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "filters" && (
            <FiltersTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "transitions" && (
            <TransitionsTab onAddToTimeline={onAddToTimeline} />
          )}
          {activeTab === "captions" && (
            <CaptionsTab onAddToTimeline={onAddToTimeline} />
          )}
        </div>
      )}
    </div>
  );
};

export const Sidebar = React.memo(SidebarComponent);
export const EnhancedMediaPanel = Sidebar;
