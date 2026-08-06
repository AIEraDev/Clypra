import React, { useState, useEffect } from "react";
import { Check, Palette, SlidersHorizontal, Info, Paintbrush, RotateCcw, Copy, Download, Upload, HardDrive, Captions, RefreshCw, Keyboard } from "lucide-react";
import { platform } from "@/core/platform";
import { Modal } from "../primitives/Modal";
import { useSettingsStore, Theme, FontFamily, THEME_META, FONT_META, getThemeColors, getBaseThemeForCustomization, getThemeColorKeys } from "@/store/settingsStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { CacheSettings } from "@/components/settings/CacheSettings";
import { WhisperSettings } from "@/components/settings/WhisperSettings";
import { KeyboardShortcutsSettings } from "@/components/settings/KeyboardShortcutsSettings";
import { refitClipsForCanvasChange } from "@/lib/timeline/refitClips";
import { checkAppUpdate, installAndRelaunchUpdate, isTauriDesktop } from "@/services/updaterService";
import { useI18n } from "@/i18n/I18nProvider";
import { getVersion } from "@tauri-apps/api/app";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "appearance" | "editor" | "shortcuts" | "captions" | "cache" | "about";

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: SlidersHorizontal },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "captions", label: "Auto-Captions", icon: Captions },
  { id: "cache", label: "Storage & Cache", icon: HardDrive },
  { id: "about", label: "About", icon: Info },
];

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
    <button onClick={onSelect} className={`relative rounded-xl p-0.5 transition-all duration-200 ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : "ring-1 ring-white/6 hover:ring-white/12"}`}>
      {/* Live mini-preview */}
      <div className="rounded-[10px] overflow-hidden w-full" style={{ background: bg }}>
        {/* Fake topbar */}
        <div className="h-4 flex items-center px-2 gap-1" style={{ background: surface, borderBottom: `1px solid ${border}` }}>
          <div className="w-1 h-1 rounded-full" style={{ background: textMuted }} />
          <div className="w-1 h-1 rounded-full" style={{ background: textMuted }} />
          <div className="w-1 h-1 rounded-full" style={{ background: textMuted }} />
          <div className="flex-1" />
          <div className="w-8 h-1.25 rounded-sm" style={{ background: accent }} />
        </div>
        {/* Fake editor layout */}
        <div className="flex h-9.5">
          {/* Sidebar */}
          <div className="w-[28%] p-1.5 flex flex-col gap-1" style={{ background: surface, borderRight: `1px solid ${border}` }}>
            <div className="h-1 w-[70%] rounded-sm" style={{ background: textMuted, opacity: 0.4 }} />
            <div className="h-1 w-[50%] rounded-sm" style={{ background: textMuted, opacity: 0.3 }} />
            <div className="h-1 w-[60%] rounded-sm" style={{ background: textMuted, opacity: 0.25 }} />
          </div>
          {/* Preview area */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-9 h-5.5 rounded-[3px]" style={{ background: surfaceRaised, border: `1px solid ${border}` }} />
          </div>
        </div>
        {/* Enhanced timeline preview */}
        <div style={{ background: timelineBg, borderTop: `1px solid ${timelineTrackBorder}` }}>
          {/* Timeline ruler */}
          <div className="h-1.5 flex items-center px-1" style={{ background: timelineRulerBg }}>
            <div className="flex-1 flex gap-1.5">
              <div className="w-px h-0.75" style={{ background: textMuted, opacity: 0.4 }} />
              <div className="w-px h-0.5" style={{ background: textMuted, opacity: 0.25 }} />
              <div className="w-px h-0.5" style={{ background: textMuted, opacity: 0.25 }} />
              <div className="w-px h-0.75" style={{ background: textMuted, opacity: 0.4 }} />
            </div>
          </div>
          {/* Timeline tracks with clips */}
          <div className="flex">
            {/* Track labels */}
            <div className="w-[28%] flex flex-col" style={{ borderRight: `1px solid ${timelineTrackBorder}` }}>
              <div className="h-2.5 flex items-center px-1" style={{ background: timelineTrackBg, borderBottom: `1px solid ${timelineTrackBorder}` }}>
                <div className="w-0.5 h-0.5 rounded-full" style={{ background: textMuted, opacity: 0.5 }} />
              </div>
              <div className="h-2 flex items-center px-1" style={{ background: timelineTrackBg }}>
                <div className="w-0.5 h-0.5 rounded-full" style={{ background: textMuted, opacity: 0.5 }} />
              </div>
            </div>
            {/* Track content */}
            <div className="flex-1 flex flex-col">
              {/* Video track with clip */}
              <div className="h-2.5 flex items-center gap-0.5 px-1" style={{ background: timelineTrackBg, borderBottom: `1px solid ${timelineTrackBorder}` }}>
                <div className="h-1.5 w-[45%] rounded-px" style={{ background: timelineClipVideo, opacity: 0.9 }} />
                <div className="h-1.5 w-[30%] rounded-px" style={{ background: timelineClipVideo, opacity: 0.9 }} />
              </div>
              {/* Audio track with clip */}
              <div className="h-2 flex items-center gap-0.5 px-1" style={{ background: timelineTrackBg }}>
                <div className="h-1 w-[55%] rounded-px" style={{ background: timelineClipAudio, opacity: 0.8 }} />
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
          <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center shrink-0">
            <Check className="w-2.5 h-2.5 text-white" />
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

  const colorKeys = getThemeColorKeys();
  const filteredKeys = searchQuery ? colorKeys.filter((key) => key.toLowerCase().includes(searchQuery.toLowerCase())) : colorKeys;

  // Group colors by category
  const colorGroups: Record<string, string[]> = {
    "Base Colors": filteredKeys.filter((k) => k.match(/^--color-(bg|surface|border|text|accent|danger)/)),
    Timeline: filteredKeys.filter((k) => k.includes("timeline")),
    Clips: filteredKeys.filter((k) => k.includes("clip") && !k.includes("timeline")),
    Shadcn: filteredKeys.filter((k) => !k.startsWith("--color-")),
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
          alert("Invalid theme file format");
        }
      } catch (error) {
        alert("Failed to import theme: " + (error as Error).message);
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
        <h3 className="text-[13px] font-semibold text-text-primary">Custom Theme Editor</h3>
        {/* Import/Export buttons in header */}
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title="Import theme from JSON file">
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-accent hover:border-accent/40 transition-colors" title="Export theme to JSON file">
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Actions toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Base theme group */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Base:</span>
          <div className="relative">
            <select value={baseTheme} onChange={(e) => handleBaseThemeChange(e.target.value as Exclude<Theme, "custom">)} className="appearance-none text-[11px] pl-3 pr-8 py-1.5 rounded-md bg-surface-raised border border-white/6 text-text-primary hover:border-white/12 transition-colors cursor-pointer focus:outline-none focus:border-accent/40">
              <option value="dark">Dark</option>
              <option value="midnight">Midnight</option>
              <option value="ocean">Ocean</option>
              <option value="forest">Forest</option>
              <option value="midnight-carbon">Midnight Carbon</option>
              <option value="ember-studio">Ember Studio</option>
              <option value="forest-console">Forest Console</option>
              <option value="slate-noir">Slate Noir</option>
              <option value="rose-cut">Rose Cut</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <button onClick={handleCopyFromBase} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary hover:border-white/12 transition-colors" title="Copy all colors from selected base theme">
            <Copy className="w-3.5 h-3.5" />
            Copy
          </button>
        </div>

        {/* Reset button */}
        <button onClick={handleReset} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-danger hover:border-danger/40 transition-colors" title="Reset to default dark theme">
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>

      {/* Search */}
      <input type="text" placeholder="Search colors..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-3 py-2 text-[12px] rounded-lg bg-surface-raised border border-white/6 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" />

      {/* Color groups */}
      <div className="max-h-100 overflow-y-auto space-y-4 pr-2 scrollbar-thin">
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
        Apply Custom Theme
      </button>
    </div>
  );
}

// ─── Appearance Tab ──────────────────────────────────────────────────────
function AppearanceTab() {
  const { theme, fontFamily, customTheme, setTheme, setFontFamily } = useSettingsStore();
  const { language, setLanguage } = useI18n();
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const themeKeys: Theme[] = ["dark", "midnight", "ocean", "forest", "midnight-carbon", "ember-studio", "forest-console", "slate-noir", "rose-cut"];
  const fontKeys: FontFamily[] = ["inter", "montserrat", "geist", "outfit", "roboto", "space-grotesk", "system", "mono"];

  return (
    <div className="space-y-7">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Language</h3>
        <SettingRow label="Interface language" description="Choose the language used throughout Clypra">
          <select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "zh-TW")} aria-label="Interface language" className="px-3 py-1.5 text-[11px] rounded-lg bg-surface-raised border border-white/6 text-text-primary focus:outline-none focus:border-accent/40">
            <option value="en">English</option>
            <option value="zh-TW">Traditional Chinese</option>
          </select>
        </SettingRow>
      </section>

      {/* Themes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Theme</h3>
          <button onClick={() => setShowCustomEditor(!showCustomEditor)} className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${showCustomEditor ? "bg-accent/15 text-accent border border-accent/40" : "bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary"}`}>
            <Paintbrush className="w-3 h-3" />
            {showCustomEditor ? "Hide Editor" : "Custom Theme"}
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Font</h3>
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Timeline</h3>
        <div className="space-y-3">
          <SettingRow label="Snap to grid" description="Clips snap to ruler ticks when dragging">
            <ToggleSwitch checked={snapToGrid} onChange={setSnapToGrid} />
          </SettingRow>
          <SettingRow label="Magnetic snap" description="Snap clips to playhead and other clip edges">
            <ToggleSwitch checked={snapEnabled} onChange={toggleSnapEnabled} />
          </SettingRow>
        </div>
      </section>

      {project && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Sequence Settings</h3>
          <div className="space-y-3">
            <SettingRow label="Aspect ratio" description="Canvas dimensions for export">
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
            <SettingRow label="Frame rate" description="Frames per second for this project">
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Defaults</h3>
        <div className="space-y-3">
          <SettingRow label="Auto-save" description="Periodically save project state">
            <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
          </SettingRow>
          <SettingRow label="Default frame rate" description="Frame rate for new projects">
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
      <div className={`absolute top-0.75 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "left-4.5" : "left-0.75"}`} />
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

const PatreonIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M14.82 2.41C11.47 2.41 8.75 5.13 8.75 8.49c0 3.35 2.72 6.07 6.07 6.07 3.35 0 6.07-2.72 6.07-6.07 0-3.36-2.72-6.08-6.07-6.08zM3.11 21.59h3.3V2.41H3.11z" />
  </svg>
);

const BuyMeCoffeeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    {/* Coffee cup */}
    <path d="M18 8h-1V6h-2v2H5C3.346 8 2 9.346 2 11v2c0 1.654 1.346 3 3 3h.268A3.001 3.001 0 008 18h8a3.001 3.001 0 002.732-2H19c1.654 0 3-1.346 3-3v-2c0-1.654-1.346-3-3-3zm1 5c0 .551-.448 1-1 1h-.535A3.01 3.01 0 0018 13v-3h1c.552 0 1 .449 1 1v2z" />
    {/* Steam wisps */}
    <path d="M8 5c0-.552.449-1 1-1s1 .448 1 1v1c0 .552-.449 1-1 1S8 6.552 8 6V5zm4 0c0-.552.449-1 1-1s1 .448 1 1v1c0 .552-.449 1-1 1s-1-.448-1-1V5z" />
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
  const [appVersion, setAppVersion] = useState<string>("...");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "error">("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [updateObject, setUpdateObject] = useState<any>(null);

  const isDesktop = isTauriDesktop();

  useEffect(() => {
    if (isDesktop) {
      getVersion()
        .then(setAppVersion)
        .catch(() => setAppVersion("Unknown"));
    } else {
      setAppVersion("Web");
    }
  }, [isDesktop]);

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
      setUpdateError(err?.message || "Failed to install update");
    }
  };

  return (
    <div className="flex flex-col items-center text-center py-6 gap-4">
      <div className="w-16 h-16 flex items-center justify-center relative">
        <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full"></div>
        <img src="/clypra.svg" alt="Clypra Logo" className="w-16 h-16 object-contain relative z-10 drop-shadow-xl" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-text-primary">Clypra</h3>
        <p className="text-xs text-text-muted mt-1">Version {appVersion}</p>
      </div>
      <p className="text-xs text-text-muted max-w-70 leading-relaxed">A modern, native video editor built with Tauri, React, and FFmpeg. Designed for speed and creative freedom.</p>

      {/* Auto-updater card */}
      <div className="w-full max-w-85 bg-linear-to-b from-white/4 to-white/1 border border-white/10 rounded-2xl p-5 flex flex-col items-center gap-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 w-full justify-between pb-3 border-b border-white/5">
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">Software Update</span>
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
            <p className="text-[11px] text-text-muted">Auto-updates are only available in the desktop app.</p>
          ) : (
            <>
              {updateStatus === "idle" && (
                <>
                  <p className="text-[11px] text-text-muted mb-2">Keep Clypra running at peak performance.</p>
                  <button onClick={handleCheckUpdate} className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-text-primary rounded-xl text-xs font-semibold cursor-pointer shadow-sm transition-all duration-200 active:scale-95">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Check for Updates
                  </button>
                </>
              )}

              {updateStatus === "checking" && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="relative flex items-center justify-center">
                    <div className="w-8 h-8 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-xs text-text-muted">Searching for newer releases...</p>
                </div>
              )}

              {updateStatus === "up-to-date" && (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <Check className="w-4 h-4 text-green-400" />
                  </div>
                  <p className="text-xs text-green-400 font-medium">Clypra is up to date</p>
                  <p className="text-[10px] text-text-muted">You are currently running the latest version.</p>
                  <button onClick={handleCheckUpdate} className="mt-2 text-[10px] text-text-muted hover:text-text-primary transition-colors hover:underline cursor-pointer">
                    Check again
                  </button>
                </div>
              )}

              {updateStatus === "available" && updateInfo && (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-xs text-text-primary font-bold">New Version Available</p>
                    <p className="text-[10px] text-accent font-semibold">v{updateInfo.version}</p>
                  </div>

                  {updateInfo.body && (
                    <div className="w-full text-left">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Release Notes</p>
                      <div className="text-[10px] text-text-muted max-h-20 overflow-y-auto px-2.5 py-2 w-full leading-normal border border-white/5 bg-white/2 rounded-xl scrollbar-thin">{updateInfo.body}</div>
                    </div>
                  )}

                  <button onClick={handleInstallUpdate} className="w-full py-2 bg-linear-to-r from-accent to-violet-500 hover:from-accent-hover hover:to-violet-600 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-[0_0_15px_rgba(96,165,250,0.2)] hover:shadow-[0_0_20px_rgba(96,165,250,0.4)] transition-all duration-200 active:scale-[0.98]">
                    Download & Install Update
                  </button>
                </div>
              )}

              {updateStatus === "downloading" && (
                <div className="flex flex-col items-center gap-3 w-full py-1">
                  <div className="flex justify-between text-[11px] text-text-primary font-medium w-full">
                    <span>Downloading update...</span>
                    <span className="font-semibold text-accent">{downloadProgress}%</span>
                  </div>
                  <div className="w-full bg-white/5 border border-white/5 h-2 rounded-full overflow-hidden p-px">
                    <div className="bg-linear-to-r from-accent to-violet-500 h-full rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                  </div>
                  <p className="text-[9px] text-text-muted">The application will automatically restart once complete.</p>
                </div>
              )}

              {updateStatus === "error" && (
                <div className="flex flex-col items-center gap-2.5 py-1">
                  <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <span className="text-red-400 text-sm font-bold">!</span>
                  </div>
                  <p className="text-xs text-red-400 font-medium">Update Check Failed</p>
                  <p className="text-[10px] text-text-muted max-w-65 leading-normal line-clamp-2">{updateError || "An unknown error occurred."}</p>
                  <button onClick={handleCheckUpdate} className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-text-primary rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-95">
                    <RefreshCw className="w-3 h-3" />
                    Try Again
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Support the Project card */}
      <div className="w-full max-w-85 bg-linear-to-b from-white/4 to-white/1 border border-white/10 rounded-2xl p-5 flex flex-col items-center gap-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 w-full justify-between pb-3 border-b border-white/5">
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">Support the Project</span>
          <span className="text-[10px] text-text-muted">Free &amp; open-source ♥</span>
        </div>
        <p className="text-[11px] text-text-muted text-center leading-relaxed">Clypra is built with love and released for free. If it saves you time, consider supporting its development.</p>
        <div className="flex flex-col gap-2.5 w-full">
          {/* GitHub Sponsors */}
          <button onClick={() => openExternalUrl("https://github.com/sponsors/AIEraDev")} className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-white text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] shadow-md" style={{ background: "linear-gradient(135deg, #238636 0%, #1a6e2b 100%)" }}>
            <GithubIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">GitHub Sponsors</span>
            <span className="text-white/60 text-[10px] font-normal">Tiered</span>
          </button>
          {/* Patreon */}
          <button onClick={() => openExternalUrl("https://www.patreon.com/AIEraDev")} className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-white text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] shadow-md" style={{ background: "linear-gradient(135deg, #FF424D 0%, #e8374a 100%)" }}>
            <PatreonIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Support on Patreon</span>
            <span className="text-white/60 text-[10px] font-normal">Monthly</span>
          </button>
          {/* Buy Me a Coffee */}
          <button onClick={() => openExternalUrl("https://buymeacoffee.com/AIEraDev")} className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-surface text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98] shadow-md" style={{ background: "linear-gradient(135deg, #FFDD00 0%, #f5c800 100%)" }}>
            <BuyMeCoffeeIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Buy Me a Coffee</span>
            <span className="text-surface/50 text-[10px] font-normal">One-time</span>
          </button>
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
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="lg">
      <div className="flex flex-col h-full md:flex-row overflow-hidden min-h-0">
        {/* Sidebar */}
        <aside className="w-full md:w-40 border-b md:border-b-0 md:border-r border-white/6 p-2 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-thin shrink-0">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-2 py-1.5 text-nowrap cursor-pointer rounded-lg text-[13px] font-medium transition-colors ${isActive ? "text-accent bg-white/4" : "text-text-muted hover:text-text-primary hover:bg-white/4"}`}>
                <Icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 p-5 overflow-y-auto scrollbar-thin min-w-0">
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "editor" && <EditorTab />}
          {activeTab === "shortcuts" && !platform.isCapacitor() && <KeyboardShortcutsSettings />}
          {activeTab === "captions" &&
            (platform.isCapacitor() ? (
              <div className="flex flex-col items-center justify-center p-8 text-center h-75">
                <Captions className="w-12 h-12 text-accent/60 mb-4" />
                <h3 className="text-base font-semibold text-text-primary mb-2">Local Auto-Captions</h3>
                <p className="text-xs text-text-muted max-w-[320px] leading-relaxed">Local speech-to-text model downloading and transcription are currently desktop-only features due to system resource requirements.</p>
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
