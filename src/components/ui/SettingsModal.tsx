import React, { useState } from "react";
import { Check, Palette, SlidersHorizontal, Info, Paintbrush, RotateCcw, Copy, Download, Upload, HardDrive, Captions, RefreshCw, Keyboard } from "lucide-react";
import packageJson from "../../../package.json";
import { platform } from "@/core/platform";
import { t, type MessageKey } from "@/i18n";
import { Modal } from "./Modal";
import { useSettingsStore, Theme, FontFamily, THEME_META, FONT_META, getThemeColors, getBaseThemeForCustomization, getThemeColorKeys } from "@/store/settingsStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { CacheSettings } from "@/components/settings/CacheSettings";
import { WhisperSettings } from "@/components/settings/WhisperSettings";
import { KeyboardShortcutsSettings } from "@/components/settings/KeyboardShortcutsSettings";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { checkAppUpdate, installAndRelaunchUpdate, isTauriDesktop } from "@/services/updaterService";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "appearance" | "editor" | "shortcuts" | "captions" | "cache" | "about";

const TABS: { id: Tab; labelKey: MessageKey; icon: React.FC<{ className?: string }> }[] = [
  { id: "appearance", labelKey: "settings.tabs.appearance", icon: Palette },
  { id: "editor", labelKey: "settings.tabs.editor", icon: SlidersHorizontal },
  { id: "shortcuts", labelKey: "settings.tabs.shortcuts", icon: Keyboard },
  { id: "captions", labelKey: "settings.tabs.captions", icon: Captions },
  { id: "cache", labelKey: "settings.tabs.cache", icon: HardDrive },
  { id: "about", labelKey: "settings.tabs.about", icon: Info },
];

const BASE_THEME_KEYS: Exclude<Theme, "custom">[] = [
  "dark",
  "midnight",
  "ocean",
  "forest",
  "midnight-carbon",
  "ember-studio",
  "forest-console",
  "slate-noir",
  "rose-cut",
];

const COLOR_LABEL_KEYS: Partial<Record<string, MessageKey>> = {
  "--color-bg": "settings.theme.color.background",
  "--color-surface": "settings.theme.color.surface",
  "--color-surface-raised": "settings.theme.color.surfaceRaised",
  "--color-surface-panel": "settings.theme.color.surfacePanel",
  "--color-surface-floating": "settings.theme.color.surfaceFloating",
  "--color-border": "settings.theme.color.border",
  "--color-border-soft": "settings.theme.color.borderSoft",
  "--color-accent": "settings.theme.color.accent",
  "--color-accent-soft": "settings.theme.color.accentSoft",
  "--color-text-primary": "settings.theme.color.textPrimary",
  "--color-text-muted": "settings.theme.color.textMuted",
  "--color-danger": "settings.theme.color.danger",
  "--color-video-clip": "settings.theme.color.videoClip",
  "--color-audio-clip": "settings.theme.color.audioClip",
  "--color-text-clip": "settings.theme.color.textClip",
  "--color-guide-center": "settings.theme.color.centerGuide",
  "--color-snap-guide-clip": "settings.theme.color.clipSnapGuide",
  "--color-handle": "settings.theme.color.handle",
  "--color-handle-border": "settings.theme.color.handleBorder",
  "--color-timeline-bg": "settings.theme.color.timelineBackground",
  "--color-timeline-track-bg": "settings.theme.color.timelineTrackBackground",
  "--color-timeline-track-border": "settings.theme.color.timelineTrackBorder",
  "--color-timeline-track-hover": "settings.theme.color.timelineTrackHover",
  "--color-timeline-track-selected": "settings.theme.color.timelineTrackSelected",
  "--color-timeline-track-active": "settings.theme.color.timelineTrackActive",
  "--color-timeline-ruler-bg": "settings.theme.color.timelineRulerBackground",
  "--color-timeline-ruler-tick-major": "settings.theme.color.timelineRulerMajorTick",
  "--color-timeline-ruler-tick-minor": "settings.theme.color.timelineRulerMinorTick",
  "--color-timeline-ruler-text": "settings.theme.color.timelineRulerText",
  "--color-timeline-toolbar-border": "settings.theme.color.timelineToolbarBorder",
  "--color-timeline-toolbar-divider": "settings.theme.color.timelineToolbarDivider",
  "--color-timeline-button-hover": "settings.theme.color.timelineButtonHover",
  "--color-timeline-button-icon": "settings.theme.color.timelineButtonIcon",
  "--color-timeline-track-label": "settings.theme.color.timelineTrackLabel",
  "--color-timeline-track-name": "settings.theme.color.timelineTrackName",
  "--color-timeline-clip-video": "settings.theme.color.timelineVideoClip",
  "--color-timeline-clip-video-border": "settings.theme.color.timelineVideoClipBorder",
  "--color-timeline-clip-audio": "settings.theme.color.timelineAudioClip",
  "--color-timeline-clip-audio-border": "settings.theme.color.timelineAudioClipBorder",
  "--color-timeline-clip-text": "settings.theme.color.timelineClipText",
  "--color-timeline-clip-duration": "settings.theme.color.timelineClipDuration",
  "--color-timeline-filmstrip-bg": "settings.theme.color.timelineFilmstripBackground",
  "--color-timeline-filmstrip-empty": "settings.theme.color.timelineFilmstripEmpty",
  "--color-timeline-filmstrip-border": "settings.theme.color.timelineFilmstripBorder",
  "--color-timeline-ghost-track-bg": "settings.theme.color.timelineGhostTrackBackground",
  "--color-timeline-drop-indicator": "settings.theme.color.timelineDropIndicator",
  "--color-timeline-drop-zone-text": "settings.theme.color.timelineDropZoneText",
  "--color-timeline-clip-invalid": "settings.theme.color.timelineInvalidClip",
  "--color-timeline-text-clip-bg": "settings.theme.color.timelineTextClipBackground",
  "--color-timeline-text-clip-text": "settings.theme.color.timelineTextClipText",
  "--background": "settings.theme.color.background",
  "--foreground": "settings.theme.color.foreground",
  "--card": "settings.theme.color.card",
  "--card-foreground": "settings.theme.color.cardForeground",
  "--popover": "settings.theme.color.popover",
  "--popover-foreground": "settings.theme.color.popoverForeground",
  "--primary": "settings.theme.color.primary",
  "--primary-foreground": "settings.theme.color.primaryForeground",
  "--secondary": "settings.theme.color.secondary",
  "--secondary-foreground": "settings.theme.color.secondaryForeground",
  "--muted": "settings.theme.color.muted",
  "--muted-foreground": "settings.theme.color.mutedForeground",
  "--accent": "settings.theme.color.accent",
  "--accent-foreground": "settings.theme.color.accentForeground",
  "--destructive": "settings.theme.color.destructive",
  "--border": "settings.theme.color.border",
  "--input": "settings.theme.color.input",
  "--ring": "settings.theme.color.ring",
};

function getColorLabel(key: string): string {
  const labelKey = COLOR_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : key;
}

// ─── Enhanced theme preview with timeline ────────────────────────────────
function ThemeSwatch({ themeId, selected, onSelect, customColors }: { themeId: Theme; selected: boolean; onSelect: () => void; customColors?: Record<string, string> | null }) {
  const colors = getThemeColors(themeId, customColors);
  const meta = THEME_META[themeId];
  const bg = colors["--color-bg"];
  const surface = colors["--color-surface"];
  const surfaceRaised = colors["--color-surface-raised"];
  const accent = colors["--color-accent"];
  const border = colors["--color-border"];
  const textPrimary = colors["--color-text-primary"];
  const textMuted = colors["--color-text-muted"];

  // Timeline-specific colors
  const timelineBg = colors["--color-timeline-bg"] || colors["--color-surface"];
  const timelineTrackBg = colors["--color-timeline-track-bg"] || colors["--color-bg"];
  const timelineTrackBorder = colors["--color-timeline-track-border"] || border;
  const timelineClipVideo = colors["--color-timeline-clip-video"] || accent;
  const timelineClipAudio = colors["--color-timeline-clip-audio"] || colors["--color-surface-raised"];
  const timelineRulerBg = colors["--color-timeline-ruler-bg"] || surface;

  return (
    <button onClick={onSelect} className={`relative rounded-xl p-[2px] transition-all duration-200 ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : "ring-1 ring-white/6 hover:ring-white/12"}`}>
      {/* Live mini-preview */}
      <div className="rounded-[10px] overflow-hidden w-full" style={{ background: bg }}>
        {/* Fake topbar */}
        <div className="h-4 flex items-center px-2 gap-1" style={{ background: surface, borderBottom: `1px solid ${border}` }}>
          <div className="w-[4px] h-[4px] rounded-full" style={{ background: textMuted }} />
          <div className="w-[4px] h-[4px] rounded-full" style={{ background: textMuted }} />
          <div className="w-[4px] h-[4px] rounded-full" style={{ background: textMuted }} />
          <div className="flex-1" />
          <div className="w-8 h-[5px] rounded-sm" style={{ background: accent }} />
        </div>
        {/* Fake editor layout */}
        <div className="flex h-[38px]">
          {/* Sidebar */}
          <div className="w-[28%] p-1.5 flex flex-col gap-1" style={{ background: surface, borderRight: `1px solid ${border}` }}>
            <div className="h-[4px] w-[70%] rounded-sm" style={{ background: textMuted, opacity: 0.4 }} />
            <div className="h-[4px] w-[50%] rounded-sm" style={{ background: textMuted, opacity: 0.3 }} />
            <div className="h-[4px] w-[60%] rounded-sm" style={{ background: textMuted, opacity: 0.25 }} />
          </div>
          {/* Preview area */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-[36px] h-[22px] rounded-[3px]" style={{ background: surfaceRaised, border: `1px solid ${border}` }} />
          </div>
        </div>
        {/* Enhanced timeline preview */}
        <div style={{ background: timelineBg, borderTop: `1px solid ${timelineTrackBorder}` }}>
          {/* Timeline ruler */}
          <div className="h-[6px] flex items-center px-1" style={{ background: timelineRulerBg }}>
            <div className="flex-1 flex gap-[6px]">
              <div className="w-px h-[3px]" style={{ background: textMuted, opacity: 0.4 }} />
              <div className="w-px h-[2px]" style={{ background: textMuted, opacity: 0.25 }} />
              <div className="w-px h-[2px]" style={{ background: textMuted, opacity: 0.25 }} />
              <div className="w-px h-[3px]" style={{ background: textMuted, opacity: 0.4 }} />
            </div>
          </div>
          {/* Timeline tracks with clips */}
          <div className="flex">
            {/* Track labels */}
            <div className="w-[28%] flex flex-col" style={{ borderRight: `1px solid ${timelineTrackBorder}` }}>
              <div className="h-[10px] flex items-center px-1" style={{ background: timelineTrackBg, borderBottom: `1px solid ${timelineTrackBorder}` }}>
                <div className="w-[2px] h-[2px] rounded-full" style={{ background: textMuted, opacity: 0.5 }} />
              </div>
              <div className="h-[8px] flex items-center px-1" style={{ background: timelineTrackBg }}>
                <div className="w-[2px] h-[2px] rounded-full" style={{ background: textMuted, opacity: 0.5 }} />
              </div>
            </div>
            {/* Track content */}
            <div className="flex-1 flex flex-col">
              {/* Video track with clip */}
              <div className="h-[10px] flex items-center gap-[2px] px-1" style={{ background: timelineTrackBg, borderBottom: `1px solid ${timelineTrackBorder}` }}>
                <div className="h-[6px] w-[45%] rounded-px" style={{ background: timelineClipVideo, opacity: 0.9 }} />
                <div className="h-[6px] w-[30%] rounded-px" style={{ background: timelineClipVideo, opacity: 0.9 }} />
              </div>
              {/* Audio track with clip */}
              <div className="h-[8px] flex items-center gap-[2px] px-1" style={{ background: timelineTrackBg }}>
                <div className="h-[4px] w-[55%] rounded-px" style={{ background: timelineClipAudio, opacity: 0.8 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Label */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="text-left">
          <div className="text-[11px] font-semibold text-text-primary leading-tight">{t(meta.nameKey)}</div>
          <div className="text-[9px] text-text-muted leading-tight">{t(meta.descriptionKey)}</div>
        </div>
        {selected && (
          <div className="w-[16px] h-[16px] rounded-full bg-accent flex items-center justify-center shrink-0">
            <Check className="w-[10px] h-[10px] text-white" />
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Custom Theme Editor ─────────────────────────────────────────────────
function CustomThemeEditor() {
  const { customTheme, setCustomTheme, resetCustomTheme } = useSettingsStore();
  const [baseTheme, setBaseTheme] = useState<Exclude<Theme, "custom">>("dark");
  const [editingColors, setEditingColors] = useState<Record<string, string>>(customTheme || getBaseThemeForCustomization("dark"));
  const [searchQuery, setSearchQuery] = useState("");

  // Update editing colors when base theme changes
  const handleBaseThemeChange = (newBaseTheme: Exclude<Theme, "custom">) => {
    setBaseTheme(newBaseTheme);
    const baseColors = getBaseThemeForCustomization(newBaseTheme);
    setEditingColors(baseColors);
  };

  const colorKeys = Array.from(new Set([...getThemeColorKeys(), ...Object.keys(editingColors)]));
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredKeys = normalizedSearch
    ? colorKeys.filter(
        (key) =>
          key.toLocaleLowerCase().includes(normalizedSearch) ||
          getColorLabel(key).toLocaleLowerCase().includes(normalizedSearch),
      )
    : colorKeys;

  // Group colors by category
  const colorGroups: Array<{ labelKey: MessageKey; keys: string[] }> = [
    {
      labelKey: "settings.theme.editor.group.baseColors",
      keys: filteredKeys.filter((key) => key.match(/^--color-(bg|surface|border|text|accent|danger)/)),
    },
    {
      labelKey: "settings.theme.editor.group.timeline",
      keys: filteredKeys.filter((key) => key.includes("timeline")),
    },
    {
      labelKey: "settings.theme.editor.group.clips",
      keys: filteredKeys.filter((key) => key.includes("clip") && !key.includes("timeline") && !key.includes("guide")),
    },
    {
      labelKey: "settings.theme.editor.group.guides",
      keys: filteredKeys.filter((key) => key.includes("guide") || key.includes("handle")),
    },
    {
      labelKey: "settings.theme.editor.group.other",
      keys: filteredKeys.filter(
        (key) =>
          key.startsWith("--color-") &&
          !key.match(/^--color-(bg|surface|border|text|accent|danger)/) &&
          !key.includes("timeline") &&
          !key.includes("clip") &&
          !key.includes("guide") &&
          !key.includes("handle"),
      ),
    },
    {
      labelKey: "settings.theme.editor.group.shadcn",
      keys: filteredKeys.filter((key) => !key.startsWith("--color-")),
    },
  ];

  const handleColorChange = (key: string, value: string) => {
    const updated = { ...editingColors, [key]: value };
    setEditingColors(updated);
  };

  const handleApply = () => {
    setCustomTheme(editingColors);
  };

  const handleReset = () => {
    resetCustomTheme();
    setEditingColors(getBaseThemeForCustomization("dark"));
  };

  const handleCopyFromBase = () => {
    const baseColors = getBaseThemeForCustomization(baseTheme);
    setEditingColors(baseColors);
  };

  const handleExport = () => {
    const themeData = {
      name: "Custom Theme",
      version: "1.0",
      colors: editingColors,
      exportedAt: new Date().toISOString(),
    };

    const json = JSON.stringify(themeData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clypra-theme-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Validate the theme data
        if (data.colors && typeof data.colors === "object") {
          setEditingColors(data.colors);
        } else {
          alert(t("settings.theme.editor.invalidFile"));
        }
      } catch (error) {
        alert(t("settings.theme.editor.importFailed", { error: (error as Error).message }));
      }
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/6">
        <h3 className="text-[13px] font-semibold text-text-primary">{t("settings.theme.editor.title")}</h3>
        {/* Import/Export buttons in header */}
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title={t("settings.theme.editor.importTitle")}>
            <Upload className="w-3.5 h-3.5" />
            {t("settings.theme.editor.import")}
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title={t("settings.theme.editor.exportTitle")}>
            <Download className="w-3.5 h-3.5" />
            {t("settings.theme.editor.export")}
          </button>
        </div>
      </div>

      {/* Actions toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Base theme group */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">{t("settings.theme.editor.base")}</span>
          <div className="relative">
            <select value={baseTheme} onChange={(e) => handleBaseThemeChange(e.target.value as Exclude<Theme, "custom">)} className="appearance-none text-[11px] pl-3 pr-8 py-1.5 rounded-md bg-surface-raised border border-white/6 text-text-primary hover:border-white/12 transition-colors cursor-pointer focus:outline-none focus:border-accent/40">
              {BASE_THEME_KEYS.map((themeKey) => (
                <option key={themeKey} value={themeKey}>
                  {t(THEME_META[themeKey].nameKey)}
                </option>
              ))}
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <button onClick={handleCopyFromBase} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary hover:border-white/12 transition-colors" title={t("settings.theme.editor.copyTitle")}>
            <Copy className="w-3.5 h-3.5" />
            {t("settings.theme.editor.copy")}
          </button>
        </div>

        {/* Reset button */}
        <button onClick={handleReset} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-danger hover:border-danger/40 transition-colors" title={t("settings.theme.editor.resetTitle")}>
          <RotateCcw className="w-3.5 h-3.5" />
          {t("settings.theme.editor.reset")}
        </button>
      </div>

      {/* Search */}
      <input type="text" placeholder={t("settings.theme.editor.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-3 py-2 text-[12px] rounded-lg bg-surface-raised border border-white/6 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" />

      {/* Color groups */}
      <div className="max-h-[400px] overflow-y-auto space-y-4 pr-2 scrollbar-thin">
        {colorGroups.map(({ labelKey, keys }) => {
          if (keys.length === 0) return null;
          return (
            <div key={labelKey}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">{t(labelKey)}</h4>
              <div className="space-y-2">
                {keys.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <input type="color" value={editingColors[key] || "#000000"} onChange={(e) => handleColorChange(key, e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-white/6" />
                    <div className="flex-1">
                      <div className="text-[11px] text-text-primary">{getColorLabel(key)}</div>
                      <div className="text-[9px] text-text-muted font-mono">{editingColors[key]}</div>
                    </div>
                    <input type="text" value={editingColors[key] || ""} onChange={(e) => handleColorChange(key, e.target.value)} className="w-24 px-2 py-1 text-[10px] font-mono rounded bg-surface-raised border border-white/6 text-text-primary" />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Apply button */}
      <button onClick={handleApply} className="w-full py-2 px-4 text-[12px] font-semibold rounded-lg bg-accent text-white hover:bg-accent-soft transition-colors">
        {t("settings.theme.editor.apply")}
      </button>
    </div>
  );
}

// ─── Appearance Tab ──────────────────────────────────────────────────────
function AppearanceTab() {
  const { theme, fontFamily, customTheme, setTheme, setFontFamily } = useSettingsStore();
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const themeKeys: Theme[] = BASE_THEME_KEYS;
  const fontKeys: FontFamily[] = ["inter", "montserrat", "geist", "outfit", "roboto", "space-grotesk", "system", "mono"];

  return (
    <div className="space-y-7">
      {/* Themes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{t("settings.appearance.theme")}</h3>
          <button onClick={() => setShowCustomEditor(!showCustomEditor)} className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${showCustomEditor ? "bg-accent/15 text-accent border border-accent/40" : "bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary"}`}>
            <Paintbrush className="w-3 h-3" />
            {showCustomEditor ? t("settings.appearance.hideEditor") : t("settings.appearance.customTheme")}
          </button>
        </div>

        {showCustomEditor ? (
          <CustomThemeEditor />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {themeKeys.map((t) => (
              <ThemeSwatch key={t} themeId={t} selected={theme === t} onSelect={() => setTheme(t)} />
            ))}
            {customTheme && <ThemeSwatch key="custom" themeId="custom" selected={theme === "custom"} onSelect={() => setTheme("custom")} customColors={customTheme} />}
          </div>
        )}
      </section>

      {/* Font Family */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.appearance.font")}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {fontKeys.map((f) => {
            const meta = FONT_META[f];
            const isSel = fontFamily === f;
            return (
              <button key={f} onClick={() => setFontFamily(f)} className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg border transition-all ${isSel ? "border-accent bg-accent/8 text-accent" : "border-white/6 hover:border-white/12 text-text-muted hover:text-text-primary"}`}>
                <span className="text-lg leading-none" style={{ fontFamily: meta.stack }}>
                  Aa
                </span>
                <span className="text-[10px] font-medium">{meta.name}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ─── Editor Tab ──────────────────────────────────────────────────────────
function EditorTab() {
  const { snapToGrid, autoSave, defaultFrameRate, setSnapToGrid, setAutoSave, setDefaultFrameRate } = useSettingsStore();
  const { snapEnabled, toggleSnapEnabled } = useTimelineStore();
  const { project, updateProject } = useProjectStore();

  const frameRates: Array<{ value: 24 | 30 | 60; label: string }> = [
    { value: 24, label: "24" },
    { value: 30, label: "30" },
    { value: 60, label: "60" },
  ];

  const aspectRatios: Array<{ value: string; label: string; dimensions: string }> = [
    { value: "16:9", label: "16:9", dimensions: "1920×1080" },
    { value: "9:16", label: "9:16", dimensions: "1080×1920" },
    { value: "1:1", label: "1:1", dimensions: "1080×1080" },
    { value: "4:3", label: "4:3", dimensions: "1440×1080" },
    { value: "21:9", label: "21:9", dimensions: "2520×1080" },
  ];

  const handleAspectRatioChange = (aspectRatio: string) => {
    if (!project) return;

    const dims = aspectRatios.find((ar) => ar.value === aspectRatio);
    if (!dims) return;

    const [width, height] = dims.dimensions.split("×").map(Number);
    const oldW = project.canvasWidth;
    const oldH = project.canvasHeight;

    updateProject({
      aspectRatio: aspectRatio as any,
      canvasWidth: width,
      canvasHeight: height,
    });
    refitClipsForCanvasChange(width, height, oldW, oldH);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.timeline")}</h3>
        <div className="space-y-3">
          <SettingRow label={t("settings.editor.snapToGrid")} description={t("settings.editor.snapToGridDescription")}>
            <ToggleSwitch checked={snapToGrid} onChange={setSnapToGrid} />
          </SettingRow>
          <SettingRow label={t("settings.editor.magneticSnap")} description={t("settings.editor.magneticSnapDescription")}>
            <ToggleSwitch checked={snapEnabled} onChange={toggleSnapEnabled} />
          </SettingRow>
        </div>
      </section>

      {project && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.sequenceSettings")}</h3>
          <div className="space-y-3">
            <SettingRow label={t("settings.editor.aspectRatio")} description={t("settings.editor.aspectRatioDescription")}>
              <div className="flex flex-col gap-1.5">
                <div className="flex rounded-lg overflow-hidden border border-white/6">
                  {aspectRatios.map((ar) => (
                    <button key={ar.value} onClick={() => handleAspectRatioChange(ar.value)} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${project.aspectRatio === ar.value ? "bg-accent text-white" : "bg-surface-raised text-text-muted hover:text-text-primary hover:bg-white/6"}`}>
                      {ar.label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-text-muted text-right">
                  {project.canvasWidth}×{project.canvasHeight}px
                </div>
              </div>
            </SettingRow>
            <SettingRow label={t("settings.editor.frameRate")} description={t("settings.editor.frameRateDescription")}>
              <div className="flex rounded-lg overflow-hidden border border-white/6">
                {frameRates.map((fr) => (
                  <button key={fr.value} onClick={() => updateProject({ frameRate: fr.value })} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${project.frameRate === fr.value ? "bg-accent text-white" : "bg-surface-raised text-text-muted hover:text-text-primary hover:bg-white/6"}`}>
                    {fr.label}
                  </button>
                ))}
                <span className="px-2 py-1 text-[10px] text-text-muted bg-surface-raised flex items-center">fps</span>
              </div>
            </SettingRow>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.defaults")}</h3>
        <div className="space-y-3">
          <SettingRow label={t("settings.editor.autoSave")} description={t("settings.editor.autoSaveDescription")}>
            <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
          </SettingRow>
          <SettingRow label={t("settings.editor.defaultFrameRate")} description={t("settings.editor.defaultFrameRateDescription")}>
            <div className="flex rounded-lg overflow-hidden border border-white/6">
              {frameRates.map((fr) => (
                <button key={fr.value} onClick={() => setDefaultFrameRate(fr.value)} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${defaultFrameRate === fr.value ? "bg-accent text-white" : "bg-surface-raised text-text-muted hover:text-text-primary hover:bg-white/6"}`}>
                  {fr.label}
                </button>
              ))}
              <span className="px-2 py-1 text-[10px] text-text-muted bg-surface-raised flex items-center">fps</span>
            </div>
          </SettingRow>
        </div>
      </section>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <div className="text-[13px] text-text-primary">{label}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange?.(!checked)} className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${checked ? "bg-accent" : "bg-white/1"}`}>
      <div className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${checked ? "left-[18px]" : "left-[3px]"}`} />
    </button>
  );
}

// ─── Brand Icons ─────────────────────────────────────────────────────────
const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const XIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const openExternalUrl = async (url: string) => {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.error("Tauri openUrl failed, falling back to window.open", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

// ─── About Tab ───────────────────────────────────────────────────────────
function AboutTab() {
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "error">("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [updateObject, setUpdateObject] = useState<any>(null);

  const isDesktop = isTauriDesktop();

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    const result = await checkAppUpdate();
    if (result.error) {
      setUpdateStatus("error");
      setUpdateError(result.error);
    } else if (result.hasUpdate) {
      setUpdateStatus("available");
      setUpdateInfo({ version: result.version!, body: result.body });
      setUpdateObject(result.updateObject);
    } else {
      setUpdateStatus("up-to-date");
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateObject) return;
    setUpdateStatus("downloading");
    setDownloadProgress(0);
    try {
      await installAndRelaunchUpdate(updateObject, (progress) => {
        if (progress.event === "Progress" && progress.contentLength) {
          const pct = Math.round((progress.downloaded / progress.contentLength) * 100);
          setDownloadProgress(pct);
        }
      });
    } catch (err: any) {
      setUpdateStatus("error");
      setUpdateError(err?.message || t("settings.about.installFailed"));
    }
  };

  return (
    <div className="flex flex-col items-center text-center py-6 gap-4">
      <div className="w-16 h-16 flex items-center justify-center relative">
        <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full"></div>
        <img src="/clypra.svg" alt={t("settings.about.logoAlt")} className="w-16 h-16 object-contain relative z-10 drop-shadow-xl" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-text-primary">Clypra</h3>
        <p className="text-xs text-text-muted mt-1">{t("settings.about.version", { version: packageJson.version })}</p>
      </div>
      <p className="text-xs text-text-muted max-w-[280px] leading-relaxed">{t("settings.about.description")}</p>

      {/* Auto-updater card */}
      <div className="w-full max-w-[340px] bg-linear-to-b from-white/4 to-white/1 border border-white/10 rounded-2xl p-5 flex flex-col items-center gap-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 w-full justify-between pb-3 border-b border-white/5">
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">{t("settings.about.softwareUpdate")}</span>
          {updateStatus === "up-to-date" ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
          ) : updateStatus === "available" ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-1.5 w-full">
          {!isDesktop ? (
            <p className="text-[11px] text-text-muted">{t("settings.about.desktopOnly")}</p>
          ) : (
            <>
              {updateStatus === "idle" && (
                <>
                  <p className="text-[11px] text-text-muted mb-2">{t("settings.about.updatePrompt")}</p>
                  <button onClick={handleCheckUpdate} className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-text-primary rounded-xl text-xs font-semibold cursor-pointer shadow-sm transition-all duration-200 active:scale-95">
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t("settings.about.checkForUpdates")}
                  </button>
                </>
              )}

              {updateStatus === "checking" && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="relative flex items-center justify-center">
                    <div className="w-8 h-8 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-xs text-text-muted">{t("settings.about.searching")}</p>
                </div>
              )}

              {updateStatus === "up-to-date" && (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <Check className="w-4 h-4 text-green-400" />
                  </div>
                  <p className="text-xs text-green-400 font-medium">{t("settings.about.upToDate")}</p>
                  <p className="text-[10px] text-text-muted">{t("settings.about.latestVersion")}</p>
                  <button onClick={handleCheckUpdate} className="mt-2 text-[10px] text-text-muted hover:text-text-primary transition-colors hover:underline cursor-pointer">
                    {t("settings.about.checkAgain")}
                  </button>
                </div>
              )}

              {updateStatus === "available" && updateInfo && (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-xs text-text-primary font-bold">{t("settings.about.newVersion")}</p>
                    <p className="text-[10px] text-accent font-semibold">v{updateInfo.version}</p>
                  </div>

                  {updateInfo.body && (
                    <div className="w-full text-left">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">{t("settings.about.releaseNotes")}</p>
                      <div className="text-[10px] text-text-muted max-h-20 overflow-y-auto px-2.5 py-2 w-full leading-normal border border-white/5 bg-white/2 rounded-xl scrollbar-thin">{updateInfo.body}</div>
                    </div>
                  )}

                  <button onClick={handleInstallUpdate} className="w-full py-2 bg-linear-to-r from-accent to-violet-500 hover:from-accent-hover hover:to-violet-600 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-[0_0_15px_rgba(96,165,250,0.2)] hover:shadow-[0_0_20px_rgba(96,165,250,0.4)] transition-all duration-200 active:scale-[0.98]">
                    {t("settings.about.downloadInstall")}
                  </button>
                </div>
              )}

              {updateStatus === "downloading" && (
                <div className="flex flex-col items-center gap-3 w-full py-1">
                  <div className="flex justify-between text-[11px] text-text-primary font-medium w-full">
                    <span>{t("settings.about.downloading")}</span>
                    <span className="font-semibold text-accent">{downloadProgress}%</span>
                  </div>
                  <div className="w-full bg-white/5 border border-white/5 h-2 rounded-full overflow-hidden p-px">
                    <div className="bg-linear-to-r from-accent to-violet-500 h-full rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                  </div>
                  <p className="text-[9px] text-text-muted">{t("settings.about.restartAfterDownload")}</p>
                </div>
              )}

              {updateStatus === "error" && (
                <div className="flex flex-col items-center gap-2.5 py-1">
                  <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <span className="text-red-400 text-sm font-bold">!</span>
                  </div>
                  <p className="text-xs text-red-400 font-medium">{t("settings.about.updateCheckFailed")}</p>
                  <p className="text-[10px] text-text-muted max-w-[260px] leading-normal line-clamp-2">
                    {updateError ? t("settings.about.updateErrorDetail", { error: updateError }) : t("settings.about.unknownError")}
                  </p>
                  <button onClick={handleCheckUpdate} className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-text-primary rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-95">
                    <RefreshCw className="w-3 h-3" />
                    {t("settings.about.tryAgain")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-2">
        <button onClick={() => openExternalUrl("https://github.com/AIEraDev/clypra")} className="text-xs font-medium text-text-muted hover:text-accent transition-colors flex items-center gap-1.5">
          <GithubIcon className="w-3.5 h-3.5" />
          GitHub
        </button>
        <button onClick={() => openExternalUrl("https://x.com/AIEraDev")} className="text-xs font-medium text-text-muted hover:text-accent transition-colors flex items-center gap-1.5">
          <XIcon className="w-3.5 h-3.5" />
          @AIEraDev
        </button>
      </div>

      <div className="flex gap-4 text-[10px] text-text-muted/60 mt-4 border-t border-white/5 pt-4">
        <span>Tauri 2.x</span>
        <span>•</span>
        <span>React 19</span>
        <span>•</span>
        <span>FFmpeg</span>
      </div>
    </div>
  );
}

// ─── Main Settings Modal ─────────────────────────────────────────────────
export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  const visibleTabs = TABS.filter((tab) => {
    if (platform.isCapacitor() && tab.id === "shortcuts") return false;
    return true;
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("settings.title")} size="lg">
      <div className="flex flex-col h-full md:flex-row overflow-hidden min-h-0">
        {/* Sidebar */}
        <aside className="w-full md:w-[160px] border-b md:border-b-0 md:border-r border-white/6 p-2 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-thin shrink-0">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-2 py-1.5 text-nowrap cursor-pointer rounded-lg text-[13px] font-medium transition-colors ${isActive ? "text-accent bg-white/4" : "text-text-muted hover:text-text-primary hover:bg-white/4"}`}>
                <Icon className="w-4 h-4 shrink-0" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 p-5 overflow-y-auto scrollbar-thin min-w-0">
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "editor" && <EditorTab />}
          {activeTab === "shortcuts" && !platform.isCapacitor() && <KeyboardShortcutsSettings />}
          {activeTab === "captions" && (
            platform.isCapacitor() ? (
              <div className="flex flex-col items-center justify-center p-8 text-center h-[300px]">
                <Captions className="w-12 h-12 text-accent/60 mb-4" />
                <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.captions.mobileTitle")}</h3>
                <p className="text-xs text-text-muted max-w-[320px] leading-relaxed">
                  {t("settings.captions.mobileDescription")}
                </p>
              </div>
            ) : (
              <WhisperSettings />
            )
          )}
          {activeTab === "cache" && <CacheSettings />}
          {activeTab === "about" && <AboutTab />}
        </main>
      </div>
    </Modal>
  );
};
