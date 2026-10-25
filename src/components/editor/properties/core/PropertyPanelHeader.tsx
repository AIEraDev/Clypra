import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "@/i18n";
import { ClipKind } from "@/types";
import {
  PropertyTabsType,
  TextPropertyTab,
  VideoPropertyTab,
  AudioPropertyTab,
} from "../types";
import { TEXT_TABS, VIDEO_TABS, AUDIO_TABS } from "../data";

interface PropertyPanelHeaderType {
  collapsed: boolean;
  clipKind: ClipKind | undefined;
  activePropertyTab:
    | TextPropertyTab
    | VideoPropertyTab
    | AudioPropertyTab
    | null;
  setActivePropertyTab: (
    tab: TextPropertyTab | VideoPropertyTab | AudioPropertyTab,
  ) => void;
  onToggleCollapse?: () => void;
  hasAudioTrack?: boolean;
}

const PropertyPanelHeader: React.FC<PropertyPanelHeaderType> = ({
  collapsed,
  clipKind,
  activePropertyTab,
  onToggleCollapse,
  setActivePropertyTab,
  hasAudioTrack = true,
}) => {
  const allTabs: PropertyTabsType[] =
    clipKind === "text"
      ? TEXT_TABS
      : clipKind === "video" || clipKind === "image"
        ? VIDEO_TABS
        : clipKind === "audio"
          ? AUDIO_TABS
          : [];

  // Filter out audio tab if video has no audio track
  const tabs = allTabs.filter((tab) => tab.id !== "audio" || hasAudioTrack);

  const { t } = useI18n();

  // Reset active tab whenever the clip kind changes
  useEffect(() => {
    setActivePropertyTab(tabs[0]?.id ?? null);
  }, [clipKind]);

  function handleActiveTab(
    tabId: TextPropertyTab | VideoPropertyTab | AudioPropertyTab,
  ) {
    setActivePropertyTab(tabId);
  }

  if (!activePropertyTab || !tabs.length) return;

  return (
    <div>
      {collapsed ? (
        <div className="w-full flex items-center justify-center py-2.5">
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
              title={t("properties.expand")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="panel-head flex justify-between items-center gap-x-4 px-1 py-0.5">
          <div className="flex border-t border-border/40 overflow-x-auto scrollbar-none gap-1">
            {tabs.map((tab) => {
              const isActive = activePropertyTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleActiveTab(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium tracking-wide whitespace-nowrap transition-colors cursor-pointer rounded hover:text-cyan-400 ${
                    isActive ? "text-cyan-400" : "text-text-muted"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {t(tab.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>

          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer shrink-0"
              title={t("properties.collapse")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PropertyPanelHeader;
