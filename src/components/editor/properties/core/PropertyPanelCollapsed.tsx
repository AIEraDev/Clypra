import { Layout, Sparkles, Music, Sliders, Zap } from "lucide-react";
import { useI18n } from "@/i18n";
import type {
  TextPropertyTab,
  VideoPropertyTab,
  AudioPropertyTab,
} from "../types";
import { TEXT_TABS } from "../data";

interface PropertyPanelCollapsedProps {
  onToggleCollapse?: () => void;
  typeInfo: { color: string; label: string };
  TypeIcon: React.FC<{ className?: string }>;
  clipName: string;
  isTextClip: boolean;
  isVisualClip: boolean;
  hasAudioTrack: boolean;
  supportsAnimation: boolean;
  activePropertyTab:
    | TextPropertyTab
    | VideoPropertyTab
    | AudioPropertyTab
    | null;
  setActivePropertyTab: (
    tab: TextPropertyTab | VideoPropertyTab | AudioPropertyTab,
  ) => void;
}

const PropertyPanelCollapsed: React.FC<PropertyPanelCollapsedProps> = ({
  onToggleCollapse,
  typeInfo,
  TypeIcon,
  clipName,
  isTextClip,
  isVisualClip,
  hasAudioTrack,
  supportsAnimation,
  activePropertyTab,
  setActivePropertyTab,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center gap-1.5 py-2 flex-1 overflow-y-auto scrollbar-none">
      {/* Main clip type button */}
      <button
        onClick={onToggleCollapse}
        className={`w-8 h-8 rounded-lg flex items-center justify-center bg-surface-raised border border-border/40 hover:border-accent/40 transition-colors cursor-pointer ${typeInfo.color}`}
        title={`Expand ${t(typeInfo.label)} Properties (${clipName})`}
      >
        <TypeIcon className="w-4 h-4" />
      </button>

      {/* Context-aware section/tab shortcuts */}
      {isTextClip ? (
        <div className="flex flex-col items-center gap-1 my-1">
          {TEXT_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activePropertyTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActivePropertyTab(tab.id);
                  onToggleCollapse?.();
                }}
                title={t(tab.labelKey)}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                  isActive
                    ? "text-accent bg-accent/15"
                    : "text-text-muted hover:text-accent hover:bg-white/5"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 my-1">
          {supportsAnimation && (
            <button
              onClick={onToggleCollapse}
              title="Transform & Fit"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Layout className="w-3.5 h-3.5" />
            </button>
          )}
          {supportsAnimation && (
            <button
              onClick={onToggleCollapse}
              title="Motion & Animation"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
          )}
          {hasAudioTrack && (
            <button
              onClick={onToggleCollapse}
              title="Audio Settings"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Music className="w-3.5 h-3.5" />
            </button>
          )}
          {isVisualClip && (
            <button
              onClick={onToggleCollapse}
              title="Color & Adjustments"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          )}
          {isVisualClip && (
            <button
              onClick={onToggleCollapse}
              title="Effects & Filters"
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <span className="text-[9px] font-semibold text-text-muted/60 uppercase tracking-widest [writing-mode:vertical-lr] select-none mt-2">
        Properties
      </span>
    </div>
  );
};

export default PropertyPanelCollapsed;
