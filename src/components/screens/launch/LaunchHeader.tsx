import React from "react";
import { Search, Settings, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSettingsStore } from "@/store/settingsStore";
import { useI18n } from "@/i18n/I18nProvider";

interface LaunchHeaderProps {
  isMacNativeWindow: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
}

export const LaunchHeader: React.FC<LaunchHeaderProps> = ({
  isMacNativeWindow,
  searchQuery,
  onSearchChange,
  onOpenSettings,
}) => {
  const { uiTheme, setTheme } = useSettingsStore();
  const { t } = useI18n();

  return (
    <header className="relative z-20 shrink-0 w-full border-b border-border-default/60 bg-surface-panel/85 backdrop-blur-md">
      {/* OS drag region bar */}
      <div className="h-8 flex items-center px-3 select-none">
        <div
          className={`min-w-0 flex-1 self-stretch flex items-center ${
            isMacNativeWindow ? "ml-18" : ""
          }`}
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {!isMacNativeWindow && (
            <span className="text-[11px] font-semibold text-text-muted/70 tracking-wide uppercase">
              Clypra
            </span>
          )}
        </div>
      </div>

      {/* Main navigation & actions bar */}
      <div className="px-6 md:px-10 pb-4 flex items-center justify-between gap-4">
        {/* Brand identity */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-border-default flex items-center justify-center relative shadow-sm overflow-hidden group">
            <div className="absolute inset-0 bg-accent/15 blur-sm rounded-xl" />
            <img
              src="/clypra.svg"
              alt="Clypra Logo"
              className="w-6 h-6 object-contain relative z-10 drop-shadow-[0_0_8px_var(--clypra-accent-glow)] transition-transform duration-200 group-hover:scale-105"
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-text-primary tracking-tight">
                Clypra
              </span>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-md bg-surface-elevated text-text-muted border border-border-subtle">
                v1.6.0
              </span>
            </div>
            <span className="text-[11px] text-text-muted">
              Desktop Non-Linear Video Editor
            </span>
          </div>
        </div>

        {/* Search bar & utilities */}
        <div className="flex items-center gap-3">
          {/* Search Input */}
          <div className="relative w-48 sm:w-64 md:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("launch.searchPlaceholder")}
              aria-label={t("launch.searchPlaceholder")}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-surface-input border border-border-default text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted hover:text-text-primary transition-colors cursor-pointer w-4 h-4 flex items-center justify-center rounded-full hover:bg-surface-elevated"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Sun / Moon Theme Segmented Pill */}
          <div className="flex items-center p-0.5 rounded-xl bg-surface-elevated border border-border-default">
            <button
              onClick={() => setTheme("dark")}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                uiTheme === "dark"
                  ? "bg-surface-panel text-text-primary shadow-xs border border-border-default"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title="Dark Mode"
              aria-label="Dark Mode"
            >
              <Moon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                uiTheme === "light"
                  ? "bg-surface-panel text-text-primary shadow-xs border border-border-default"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title="Light Mode"
              aria-label="Light Mode"
            >
              <Sun className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Settings Modal Launcher */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenSettings}
            title={t("settings.title") || "Settings"}
            aria-label={t("settings.title") || "Settings"}
            className="cursor-pointer text-text-muted hover:text-text-primary rounded-xl border border-border-subtle hover:border-border-default hover:bg-surface-elevated"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};
