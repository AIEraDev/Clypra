import React, { useState } from "react";
import { Plus, Library as LibraryIcon, Type, Music, Sliders, Shuffle } from "lucide-react";
import { TopBar } from "./TopBar";
import { Sidebar as EnhancedMediaPanel, type TabType } from "./sidebar";
import { PreviewPanel } from "./preview/PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { BottomSheet } from "../ui/BottomSheet";
import { useUIStore } from "@/store/uiStore";
import { useMediaImport } from "@/hooks/useMediaImport";
import { useAddToTimeline } from "@/hooks/useAddToTimeline";

export const MobileEditorLayout: React.FC = () => {
  const { selectedClipIds } = useUIStore();
  const { importMedia, isLoading: isImporting } = useMediaImport();
  const addToTimelineCore = useAddToTimeline();

  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  const [activeMediaTab, setActiveMediaTab] = useState<TabType>("media");
  const [propertiesSheetOpen, setPropertiesSheetOpen] = useState(false);

  const handleAddToTimeline = async (item: any, type: string) => {
    // Close sheet when adding an item to timeline to reveal change
    setMediaSheetOpen(false);
    await addToTimelineCore(item, type);
  };

  const openLibraryWithTab = (tab: TabType) => {
    setActiveMediaTab(tab);
    setMediaSheetOpen(true);
  };

  const hasSelectedClip = selectedClipIds.length > 0;

  return (
    <div
      className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0"
      style={{
        paddingTop: "calc(0.25rem + var(--safe-area-top, 0px))",
        paddingBottom: "calc(0.25rem + var(--safe-area-bottom, 0px))",
      }}
    >
      <TopBar />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-1">
        {/* Top Section: Video Preview */}
        <div className="flex-1 min-h-[200px] flex flex-col overflow-hidden panel-shell">
          <PreviewPanel />
        </div>

        {/* Middle Section: Touch Action Toolbar */}
        <div className="h-10 shrink-0 panel-shell flex items-center justify-between px-[3px] bg-surface/50 backdrop-blur-sm select-none gap-0.5 w-full" style={{ boxShadow: "none" }}>
          {/* Action Tabs */}
          <button onClick={importMedia} disabled={isImporting} className="flex flex-col flex-1 items-center justify-center rounded-sm bg-white/6 text-text-primary active:bg-white/10 transition-colors cursor-pointer shrink-0" title="Import Files">
            <Plus className="w-4 h-4 text-accent-soft" />
            <span className="text-[9px] font-medium mt-0.5">Import</span>
          </button>

          <button onClick={() => openLibraryWithTab("media")} className="flex flex-col flex-1 items-center justify-center rounded-sm bg-white/6 text-text-primary active:bg-white/10 transition-colors cursor-pointer shrink-0" title="Media Assets">
            <LibraryIcon className="w-4 h-4" />
            <span className="text-[9px] font-medium mt-0.5">Media</span>
          </button>

          <button onClick={() => openLibraryWithTab("text")} className="flex flex-col flex-1 items-center justify-center rounded-sm bg-white/6 text-text-primary active:bg-white/10 transition-colors cursor-pointer shrink-0" title="Add Text">
            <Type className="w-4 h-4" />
            <span className="text-[9px] font-medium mt-0.5">Text</span>
          </button>

          <button onClick={() => openLibraryWithTab("audio")} className="flex flex-col flex-1 items-center justify-center rounded-sm bg-white/6 text-text-primary active:bg-white/10 transition-colors cursor-pointer shrink-0" title="Add Audio">
            <Music className="w-4 h-4" />
            <span className="text-[9px] font-medium mt-0.5">Audio</span>
          </button>

          <button onClick={() => openLibraryWithTab("transitions")} className="flex flex-col flex-1 items-center justify-center rounded-sm bg-white/6 text-text-primary active:bg-white/10 transition-colors cursor-pointer shrink-0" title="Transitions">
            <Shuffle className="w-4 h-4" />
            <span className="text-[9px] font-medium mt-0.5">Transitions</span>
          </button>

          <button onClick={() => setPropertiesSheetOpen(true)} disabled={!hasSelectedClip} className={`flex flex-col flex-1 items-center justify-center rounded-sm transition-colors cursor-pointer shrink-0 bg-white/6 active:bg-white/10 ${hasSelectedClip ? "text-text-primary" : "text-text-muted cursor-not-allowed"}`} title="Clip Properties">
            <Sliders className={`w-4 h-4 ${hasSelectedClip ? "text-accent-soft" : ""}`} />
            <span className="text-[9px] font-medium mt-0.5">Adjust</span>
          </button>
        </div>

        {/* Bottom Section: Compact Timeline */}
        <div className="h-80 panel-shell overflow-hidden shrink-0">
          <Timeline />
        </div>
      </div>

      {/* Library Bottom Sheet Drawer */}
      <BottomSheet title="Asset Library" isOpen={mediaSheetOpen} onClose={() => setMediaSheetOpen(false)}>
        <div className="p-3 h-[50vh] flex flex-col">
          <EnhancedMediaPanel onAddToTimeline={handleAddToTimeline} initialTab={activeMediaTab} />
        </div>
      </BottomSheet>

      {/* Properties/Adjust Bottom Sheet Drawer */}
      <BottomSheet title="Clip Adjustments" isOpen={propertiesSheetOpen} onClose={() => setPropertiesSheetOpen(false)}>
        <div className="p-3 h-[50vh] flex flex-col">
          <PropertiesPanel />
        </div>
      </BottomSheet>
    </div>
  );
};
