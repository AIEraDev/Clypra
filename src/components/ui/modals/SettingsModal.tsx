import React, { useState, useEffect } from "react";
import {
  Palette,
  SlidersHorizontal,
  Info,
  HardDrive,
  Captions,
  Keyboard,
} from "lucide-react";
import { platform } from "@/core/platform";
import { Modal } from "../primitives/Modal";
import { useUIStore } from "@/store/uiStore";
import { useI18n } from "@/i18n/I18nProvider";

import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { EditorTab } from "@/components/settings/EditorTab";
import { KeyboardShortcutsSettings } from "@/components/settings/KeyboardShortcutsSettings";
import { WhisperSettings } from "@/components/settings/WhisperSettings";
import { CacheSettings } from "@/components/settings/CacheSettings";
import { AboutTab } from "@/components/settings/AboutTab";

// Re-export shared primitives for backward compatibility
export { SettingRow } from "@/components/settings/SettingRow";
export { ToggleSwitch } from "@/components/settings/ToggleSwitch";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type SettingsTabId =
  | "appearance"
  | "editor"
  | "shortcuts"
  | "captions"
  | "cache"
  | "about";

interface TabDefinition {
  id: SettingsTabId;
  labelKey: string;
  defaultLabel: string;
  icon: React.FC<{ className?: string }>;
}

const TABS: TabDefinition[] = [
  {
    id: "appearance",
    labelKey: "settings.tabs.appearance",
    defaultLabel: "Appearance",
    icon: Palette,
  },
  {
    id: "editor",
    labelKey: "settings.tabs.editor",
    defaultLabel: "Editor",
    icon: SlidersHorizontal,
  },
  {
    id: "shortcuts",
    labelKey: "settings.tabs.shortcuts",
    defaultLabel: "Shortcuts",
    icon: Keyboard,
  },
  {
    id: "captions",
    labelKey: "settings.tabs.captions",
    defaultLabel: "Auto-Captions",
    icon: Captions,
  },
  {
    id: "cache",
    labelKey: "settings.tabs.storage",
    defaultLabel: "Storage & Cache",
    icon: HardDrive,
  },
  {
    id: "about",
    labelKey: "settings.tabs.about",
    defaultLabel: "About",
    icon: Info,
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useI18n();
  const settingsInitialTab = useUIStore((s) => s.settingsInitialTab);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");

  const visibleTabs = TABS.filter((tab) => {
    if (platform.isCapacitor() && tab.id === "shortcuts") return false;
    return true;
  });

  useEffect(() => {
    if (
      isOpen &&
      settingsInitialTab &&
      visibleTabs.some((t) => t.id === settingsInitialTab)
    ) {
      setActiveTab(settingsInitialTab as SettingsTabId);
    }
  }, [isOpen, settingsInitialTab]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings.modal.title") || "Settings"}
      size="lg"
    >
      <div className="flex flex-col h-full md:flex-row overflow-hidden min-h-0 bg-surface-app">
        {/* Sidebar */}
        <aside className="w-full md:w-52 border-b md:border-b-0 md:border-r border-border-default/70 bg-surface-panel p-2 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-hidden shrink-0 select-none">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const label = t(tab.labelKey) || tab.defaultLabel;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 overflow-hidden cursor-pointer rounded-xl text-xs sm:text-[13px] font-medium transition-all ${
                  isActive
                    ? "text-accent-primary bg-accent-primary/10 border-l-2 border-accent-primary font-semibold shadow-xs"
                    : "text-text-muted border-l-2 border-transparent hover:text-text-primary hover:bg-surface-hover"
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? "text-accent-primary" : "text-text-muted"
                  }`}
                />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </aside>

        {/* Content Stage */}
        <main className="flex-1 p-5 sm:p-6 overflow-y-auto scrollbar-thin min-w-0 bg-surface-app">
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "editor" && <EditorTab />}
          {activeTab === "shortcuts" && !platform.isCapacitor() && (
            <KeyboardShortcutsSettings />
          )}
          {activeTab === "captions" &&
            (platform.isCapacitor() ? (
              <div className="flex flex-col items-center justify-center p-8 text-center h-72">
                <Captions className="w-12 h-12 text-accent-primary/60 mb-4" />
                <h3 className="text-base font-semibold text-text-primary mb-2">
                  Local Auto-Captions
                </h3>
                <p className="text-xs text-text-muted max-w-[320px] leading-relaxed">
                  Local speech-to-text model downloading and transcription are
                  currently desktop-only features due to system resource
                  requirements.
                </p>
              </div>
            ) : (
              <WhisperSettings />
            ))}
          {activeTab === "cache" && <CacheSettings />}
          {activeTab === "about" && <AboutTab />}
        </main>
      </div>
    </Modal>
  );
};
