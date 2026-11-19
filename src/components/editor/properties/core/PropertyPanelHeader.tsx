import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { ClipKind } from "@/types";
import {
  PropertyTabsType,
  TextPropertyTab,
  VideoPropertyTab,
  ImagePropertyTab,
  AudioPropertyTab,
} from "../types";
import { TEXT_TABS, VIDEO_TABS, IMAGE_TABS, AUDIO_TABS } from "../data";
interface PropertyPanelHeaderType {
  collapsed: boolean;
  clipKind: ClipKind | undefined;
  activePropertyTab:
    | TextPropertyTab
    | VideoPropertyTab
    | ImagePropertyTab
    | AudioPropertyTab
    | null;
  setActivePropertyTab: (
    tab:
      | TextPropertyTab
      | VideoPropertyTab
      | ImagePropertyTab
      | AudioPropertyTab,
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
  const isText = clipKind === "text" || clipKind === "text-template";
  const allTabs: PropertyTabsType[] =
    isText
      ? TEXT_TABS
      : clipKind === "video"
        ? VIDEO_TABS
        : clipKind === "image"
          ? IMAGE_TABS
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
    tabId:
      | TextPropertyTab
      | VideoPropertyTab
      | ImagePropertyTab
      | AudioPropertyTab,
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
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent-primary hover:bg-surface-hover transition-colors cursor-pointer"
              title={t("properties.expand")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface-panel border-b border-border-default flex justify-between items-center px-2 py-0.5">
          <div className="flex overflow-x-auto scrollbar-none gap-1">
            {tabs.map((tab) => {
              const isActive = activePropertyTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleActiveTab(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium tracking-wide whitespace-nowrap transition-colors cursor-pointer rounded ${
                    isActive
                      ? "text-accent-primary font-semibold"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
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
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent-primary hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
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
