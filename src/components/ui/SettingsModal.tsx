import React, { useState } from "react";
import { Check, Palette, SlidersHorizontal, Info, Paintbrush, RotateCcw, Copy, Download, Upload, HardDrive, Languages, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { useSettingsStore, Theme, FontFamily, Language, FONT_META, getThemeColors, getBaseThemeForCustomization, getThemeColorKeys } from "@/store/settingsStore";
import { useProjectStore } from "@/store/projectStore";
import { CacheSettings } from "@/components/settings/CacheSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "appearance" | "editor" | "cache" | "about";

const TABS: { id: Tab; labelKey: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "appearance", labelKey: "settings.tabs.appearance", icon: Palette },
  { id: "editor", labelKey: "settings.tabs.editor", icon: SlidersHorizontal },
  { id: "cache", labelKey: "settings.tabs.cache", icon: HardDrive },
  { id: "about", labelKey: "settings.tabs.about", icon: Info },
];

const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "zh-CN", label: "简体中文" },
];

// ─── Enhanced theme preview with timeline ────────────────────────────────
function ThemeSwatch({ themeId, selected, onSelect, customColors }: { themeId: Theme; selected: boolean; onSelect: () => void; customColors?: Record<string, string> | null }) {
  const { t } = useTranslation();
  const colors = getThemeColors(themeId, customColors);
  const meta = { name: t(`settings.themes.${themeId}.name`), description: t(`settings.themes.${themeId}.description`) };
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
                <div className="h-[6px] w-[45%] rounded-[1px]" style={{ background: timelineClipVideo, opacity: 0.9 }} />
                <div className="h-[6px] w-[30%] rounded-[1px]" style={{ background: timelineClipVideo, opacity: 0.9 }} />
              </div>
              {/* Audio track with clip */}
              <div className="h-[8px] flex items-center gap-[2px] px-1" style={{ background: timelineTrackBg }}>
                <div className="h-[4px] w-[55%] rounded-[1px]" style={{ background: timelineClipAudio, opacity: 0.8 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Label */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="text-left">
          <div className="text-[11px] font-semibold text-text-primary leading-tight">{meta.name}</div>
          <div className="text-[9px] text-text-muted leading-tight">{meta.description}</div>
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
  const { t } = useTranslation();
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

  const colorKeys = getThemeColorKeys();
  const filteredKeys = searchQuery ? colorKeys.filter((key) => key.toLowerCase().includes(searchQuery.toLowerCase())) : colorKeys;

  // Group colors by category
  const colorGroups: Record<string, string[]> = {
    [t("settings.customTheme.groups.baseColors")]: filteredKeys.filter((k) => k.match(/^--color-(bg|surface|border|text|accent|danger)/)),
    [t("settings.customTheme.groups.timeline")]: filteredKeys.filter((k) => k.includes("timeline")),
    [t("settings.customTheme.groups.clips")]: filteredKeys.filter((k) => k.includes("clip") && !k.includes("timeline")),
    [t("settings.customTheme.groups.shadcn")]: filteredKeys.filter((k) => !k.startsWith("--color-")),
  };

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
          alert(t("settings.customTheme.invalidFormat"));
        }
      } catch (error) {
        alert(t("settings.customTheme.importFailed", { error: (error as Error).message }));
      }
    };
    input.click();
  };

  const formatColorName = (key: string) => {
    return key
      .replace(/^--color-/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/6">
        <h3 className="text-[13px] font-semibold text-text-primary">{t("settings.customTheme.title")}</h3>
        {/* Import/Export buttons in header */}
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title={t("settings.customTheme.importTitle")}>
            <Upload className="w-3.5 h-3.5" />
            {t("common.import")}
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title={t("settings.customTheme.exportTitle")}>
            <Download className="w-3.5 h-3.5" />
            {t("common.export")}
          </button>
        </div>
      </div>

      {/* Actions toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Base theme group */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">{t("settings.customTheme.base")}</span>
          <div className="relative">
            <select value={baseTheme} onChange={(e) => handleBaseThemeChange(e.target.value as Exclude<Theme, "custom">)} className="appearance-none text-[11px] pl-3 pr-8 py-1.5 rounded-md bg-surface-raised border border-white/6 text-text-primary hover:border-white/12 transition-colors cursor-pointer focus:outline-none focus:border-accent/40">
              <option value="dark">{t("settings.themes.dark.name")}</option>
              <option value="midnight">{t("settings.themes.midnight.name")}</option>
              <option value="ocean">{t("settings.themes.ocean.name")}</option>
              <option value="forest">{t("settings.themes.forest.name")}</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <button onClick={handleCopyFromBase} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary hover:border-white/12 transition-colors" title={t("settings.customTheme.copyTitle")}>
            <Copy className="w-3.5 h-3.5" />
            {t("common.copy")}
          </button>
        </div>

        {/* Reset button */}
        <button onClick={handleReset} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-danger hover:border-danger/40 transition-colors" title={t("settings.customTheme.resetTitle")}>
          <RotateCcw className="w-3.5 h-3.5" />
          {t("common.reset")}
        </button>
      </div>

      {/* Search */}
      <input type="text" placeholder={t("settings.customTheme.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-3 py-2 text-[12px] rounded-lg bg-surface-raised border border-white/6 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" />

      {/* Color groups */}
      <div className="max-h-[400px] overflow-y-auto space-y-4 pr-2 scrollbar-thin">
        {Object.entries(colorGroups).map(([groupName, keys]) => {
          if (keys.length === 0) return null;
          return (
            <div key={groupName}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">{groupName}</h4>
              <div className="space-y-2">
                {keys.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <input type="color" value={editingColors[key] || "#000000"} onChange={(e) => handleColorChange(key, e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-white/6" />
                    <div className="flex-1">
                      <div className="text-[11px] text-text-primary">{formatColorName(key)}</div>
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
        {t("settings.customTheme.applyButton")}
      </button>
    </div>
  );
}

// ─── Appearance Tab ──────────────────────────────────────────────────────
function AppearanceTab() {
  const { t } = useTranslation();
  const { theme, fontFamily, language, customTheme, setTheme, setFontFamily, setLanguage } = useSettingsStore();
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [switchingLang, setSwitchingLang] = useState<Language | null>(null);
  const themeKeys: Theme[] = ["dark", "midnight", "ocean", "forest"];
  const fontKeys: FontFamily[] = ["inter", "montserrat", "geist", "outfit", "roboto", "space-grotesk", "system", "mono"];

  const handleLanguageChange = async (lang: Language) => {
    if (lang === language || switchingLang) return;
    setSwitchingLang(lang);
    try {
      await setLanguage(lang);
    } finally {
      setSwitchingLang(null);
    }
  };

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
            {themeKeys.map((tk) => (
              <ThemeSwatch key={tk} themeId={tk} selected={theme === tk} onSelect={() => setTheme(tk)} />
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

      {/* Language */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.appearance.language")}</h3>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGES.map((lng) => {
            const isSel = language === lng.id;
            const isLoading = switchingLang === lng.id;
            return (
              <button key={lng.id} onClick={() => handleLanguageChange(lng.id)} disabled={switchingLang !== null} className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg border transition-all ${isSel ? "border-accent bg-accent/8 text-accent" : "border-white/6 hover:border-white/12 text-text-muted hover:text-text-primary"} ${switchingLang !== null && !isLoading ? "opacity-50 cursor-not-allowed" : ""}`}>
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
                <span className="text-[11px] font-medium">{lng.label}</span>
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
  const { t } = useTranslation();
  const { snapToGrid, autoRipple, autoSave, defaultFrameRate, setSnapToGrid, setAutoRipple, setAutoSave, setDefaultFrameRate } = useSettingsStore();
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

    updateProject({
      aspectRatio: aspectRatio as any,
      canvasWidth: width,
      canvasHeight: height,
    });
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.timeline")}</h3>
        <div className="space-y-3">
          <SettingRow label={t("settings.editor.snapToGrid")} description={t("settings.editor.snapToGridDesc")}>
            <ToggleSwitch checked={snapToGrid} onChange={setSnapToGrid} />
          </SettingRow>
          <SettingRow label={t("settings.editor.autoRipple")} description={t("settings.editor.autoRippleDesc")}>
            <ToggleSwitch checked={autoRipple} onChange={setAutoRipple} />
          </SettingRow>
        </div>
      </section>

      {project && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.sequenceSettings")}</h3>
          <div className="space-y-3">
            <SettingRow label={t("settings.editor.aspectRatio")} description={t("settings.editor.aspectRatioDesc")}>
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
            <SettingRow label={t("settings.editor.frameRate")} description={t("settings.editor.frameRateDesc")}>
              <div className="flex rounded-lg overflow-hidden border border-white/6">
                {frameRates.map((fr) => (
                  <button key={fr.value} onClick={() => updateProject({ frameRate: fr.value })} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${project.frameRate === fr.value ? "bg-accent text-white" : "bg-surface-raised text-text-muted hover:text-text-primary hover:bg-white/6"}`}>
                    {fr.label}
                  </button>
                ))}
                <span className="px-2 py-1 text-[10px] text-text-muted bg-surface-raised flex items-center">{t("settings.editor.fps")}</span>
              </div>
            </SettingRow>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">{t("settings.editor.defaults")}</h3>
        <div className="space-y-3">
          <SettingRow label={t("settings.editor.autoSave")} description={t("settings.editor.autoSaveDesc")}>
            <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
          </SettingRow>
          <SettingRow label={t("settings.editor.defaultFrameRate")} description={t("settings.editor.defaultFrameRateDesc")}>
            <div className="flex rounded-lg overflow-hidden border border-white/6">
              {frameRates.map((fr) => (
                <button key={fr.value} onClick={() => setDefaultFrameRate(fr.value)} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${defaultFrameRate === fr.value ? "bg-accent text-white" : "bg-surface-raised text-text-muted hover:text-text-primary hover:bg-white/6"}`}>
                  {fr.label}
                </button>
              ))}
              <span className="px-2 py-1 text-[10px] text-text-muted bg-surface-raised flex items-center">{t("settings.editor.fps")}</span>
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

// ─── About Tab ───────────────────────────────────────────────────────────
function AboutTab() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center text-center py-6 gap-4">
      <div className="w-16 h-16 flex items-center justify-center relative">
        <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full"></div>
        <img src="/clypra.svg" alt="Clypra Logo" className="w-16 h-16 object-contain relative z-10 drop-shadow-xl" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-text-primary">Clypra</h3>
        <p className="text-xs text-text-muted mt-1">{t("settings.about.version", { version: "1.0.1" })}</p>
      </div>
      <p className="text-xs text-text-muted max-w-[280px] leading-relaxed">{t("settings.about.tagline")}</p>
      <div className="flex items-center gap-4 mt-2">
        <button onClick={() => openUrl("https://github.com/AIEraDev/clypra")} className="text-xs font-medium text-text-muted hover:text-accent transition-colors flex items-center gap-1.5">
          <GithubIcon className="w-3.5 h-3.5" />
          GitHub
        </button>
        <button onClick={() => openUrl("https://x.com/AIEraDev")} className="text-xs font-medium text-text-muted hover:text-accent transition-colors flex items-center gap-1.5">
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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("settings.title")} size="lg">
      <div className="flex flex-col md:flex-row min-h-[420px]">
        {/* Sidebar */}
        <div className="w-full md:w-[160px] shrink-0 border-b md:border-b-0 md:border-r border-white/6 p-2 flex flex-row md:flex-col gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-2 py-1.5 text-nowrap cursor-pointer rounded-lg text-[13px] font-medium transition-colors ${isActive ? "text-accent bg-white/4" : "text-text-muted hover:text-text-primary hover:bg-white/4"}`}>
                <Icon className="w-4 h-4 shrink-0" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 p-5 overflow-y-auto">
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "editor" && <EditorTab />}
          {activeTab === "cache" && <CacheSettings />}
          {activeTab === "about" && <AboutTab />}
        </div>
      </div>
    </Modal>
  );
};
