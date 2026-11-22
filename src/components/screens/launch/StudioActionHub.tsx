import React, { useState } from "react";
import {
  Plus,
  FolderOpen,
  FileCode,
  LayoutTemplate,
  Monitor,
  Smartphone,
  Square,
  Film,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/I18nProvider";
import type { AspectRatio } from "@/types";

interface StudioActionHubProps {
  onStartBlank: (aspectRatio: AspectRatio) => void;
  onImportMedia: () => void;
  onOpenProjectFile: () => void;
  onOpenTemplates: () => void;
}

export const StudioActionHub: React.FC<StudioActionHubProps> = ({
  onStartBlank,
  onImportMedia,
  onOpenProjectFile,
  onOpenTemplates,
}) => {
  const { t } = useI18n();
  const [ratioDropdownOpen, setRatioDropdownOpen] = useState(false);

  const aspectPresets: {
    ratio: AspectRatio;
    nameKey: string;
    icon: React.ComponentType<{ className?: string }>;
    tag: string;
    description: string;
  }[] = [
    {
      ratio: "16:9",
      nameKey: "launch.aspectRatio.widescreen",
      icon: Monitor,
      tag: "16:9",
      description: "YouTube • Desktop • 1920×1080",
    },
    {
      ratio: "9:16",
      nameKey: "launch.aspectRatio.vertical",
      icon: Smartphone,
      tag: "9:16",
      description: "Reels • TikTok • Shorts • 1080×1920",
    },
    {
      ratio: "1:1",
      nameKey: "launch.aspectRatio.square",
      icon: Square,
      tag: "1:1",
      description: "Social Feed • Square • 1080×1080",
    },
    {
      ratio: "21:9",
      nameKey: "launch.aspectRatio.ultrawide",
      icon: Film,
      tag: "21:9",
      description: "Cinematic • Anamorphic • 2560×1080",
    },
  ];

  return (
    <section className="mb-8">
      {/* Primary Studio Action Card */}
      <div className="relative rounded-2xl overflow-hidden p-6 md:p-8 bg-surface-panel border border-border-default shadow-md">
        {/* Ambient subtle glow background */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-28 rounded-full pointer-events-none opacity-20"
          style={{
            background:
              "radial-gradient(ellipse at center, var(--clypra-interaction-focus) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Headline & Quick Starter */}
          <div className="max-w-xl">
            <h2 className="text-xl md:text-2xl font-bold text-text-primary tracking-tight">
              {t("project.startNew")}
            </h2>
            <p className="text-xs md:text-sm text-text-secondary mt-1.5 leading-relaxed">
              {t("project.startNewDescription")}
            </p>

            {/* Quick Aspect Ratio Tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
              {aspectPresets.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.ratio}
                    onClick={() => onStartBlank(preset.ratio)}
                    className="group relative flex flex-col items-start p-3 rounded-xl bg-surface-elevated border border-border-subtle hover:border-accent/50 hover:bg-surface-hover transition-all duration-200 cursor-pointer text-left shadow-2xs hover:shadow-xs"
                    title={preset.description}
                  >
                    <div className="flex items-center justify-between w-full mb-1.5">
                      <div className="w-6 h-6 rounded-lg bg-surface-panel flex items-center justify-center text-text-secondary group-hover:text-accent transition-colors border border-border-subtle">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[10px] font-mono font-semibold px-1 py-0.5 rounded bg-surface-panel text-text-muted border border-border-subtle group-hover:border-accent/30 group-hover:text-accent">
                        {preset.tag}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors">
                      {t(preset.nameKey)}
                    </span>
                    <span className="text-[10px] text-text-muted truncate w-full mt-0.5">
                      {preset.description.split("•")[0].trim()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Action Hub Side Buttons */}
          <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 w-full md:w-56 shrink-0">
            {/* Primary New Blank Button with ratio menu */}
            <div className="relative">
              <div className="flex rounded-xl shadow-sm">
                <Button
                  variant="default"
                  size="lg"
                  onClick={() => onStartBlank("16:9")}
                  className="flex-1 py-2.5 px-4 text-xs font-semibold rounded-r-none rounded-l-xl cursor-pointer shadow-sm bg-accent hover:bg-accent/90 text-white flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {t("project.newProject")}
                </Button>
                <button
                  type="button"
                  onClick={() => setRatioDropdownOpen(!ratioDropdownOpen)}
                  className="px-2 bg-accent/90 hover:bg-accent border-l border-white/20 text-white rounded-r-xl cursor-pointer flex items-center justify-center"
                  title="Choose canvas aspect ratio"
                  aria-label="Choose canvas aspect ratio"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Ratio Dropdown */}
              {ratioDropdownOpen && (
                <div
                  className="absolute top-full right-0 mt-1 z-30 w-56 rounded-xl border border-border-default bg-surface-floating py-1.5 shadow-xl"
                  onMouseLeave={() => setRatioDropdownOpen(false)}
                >
                  {aspectPresets.map((p) => (
                    <button
                      key={p.ratio}
                      onClick={() => {
                        setRatioDropdownOpen(false);
                        onStartBlank(p.ratio);
                      }}
                      className="w-full px-3 py-2 text-left flex items-center justify-between text-xs text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
                    >
                      <span className="font-medium">{t(p.nameKey)}</span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {p.tag}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Import Media Button */}
            <button
              onClick={onImportMedia}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-border-default hover:bg-surface-hover hover:border-accent/40 text-text-primary transition-all duration-200 cursor-pointer shadow-2xs"
            >
              <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-subtle flex items-center justify-center text-accent shrink-0">
                <FolderOpen className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-xs font-semibold truncate">
                  {t("launch.importMedia")}
                </span>
                <span className="text-[10px] text-text-muted truncate">
                  {t("launch.importMediaDesc")}
                </span>
              </div>
            </button>

            {/* Open Project File (.clypra) */}
            <button
              onClick={onOpenProjectFile}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-border-default hover:bg-surface-hover hover:border-accent/40 text-text-primary transition-all duration-200 cursor-pointer shadow-2xs"
            >
              <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-subtle flex items-center justify-center text-text-secondary shrink-0">
                <FileCode className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-xs font-semibold truncate">
                  {t("launch.openProjectFile")}
                </span>
                <span className="text-[10px] text-text-muted truncate">
                  {t("launch.openProjectFileDesc")}
                </span>
              </div>
            </button>

            {/* Project Templates Button */}
            <button
              onClick={onOpenTemplates}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-border-default hover:bg-surface-hover hover:border-accent/40 text-text-primary transition-all duration-200 cursor-pointer shadow-2xs"
            >
              <div className="w-7 h-7 rounded-lg bg-surface-panel border border-border-subtle flex items-center justify-center text-accent shrink-0">
                <LayoutTemplate className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-xs font-semibold truncate">
                  {t("launch.templates")}
                </span>
                <span className="text-[10px] text-text-muted truncate">
                  {t("launch.templatesDesc")}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
