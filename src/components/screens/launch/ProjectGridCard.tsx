import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Layers,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import type { RecentProjectEntry } from "@/core/platform/platform";
import type { Project } from "@/types";
import {
  getProjectThumbnail,
  formatEditorTimecode,
} from "@/lib/media/projectThumbnail";
import { useI18n } from "@/i18n/I18nProvider";

interface ProjectGridCardProps {
  entry: RecentProjectEntry;
  onOpen: (entry: RecentProjectEntry) => void;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}

const getProjectInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "PR";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const formatDate = (dateStr?: string | number) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const ProjectGridCard: React.FC<ProjectGridCardProps> = ({
  entry,
  onOpen,
  onRename,
  onDelete,
}) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Handle unreadable / damaged project
  if (entry.kind === "unreadable") {
    return (
      <div className="relative rounded-2xl border border-danger/30 bg-surface-panel overflow-hidden shadow-xs">
        <div className="h-44 bg-danger/5 flex flex-col items-center justify-center p-5 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mb-2.5" />
          <p className="text-xs font-bold text-text-primary">
            {t("launch.projectNeedsRecovery")}
          </p>
          <p className="text-[11px] text-text-muted mt-1.5 line-clamp-2 px-2">
            {entry.error}
          </p>
          {entry.backupAvailable && (
            <button
              onClick={() => onOpen(entry)}
              className="mt-3 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer"
            >
              {t("launch.openRecoveredCopy")}
            </button>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary truncate">
            {entry.name || entry.id}
          </span>
          <span className="text-[10px] text-text-muted">
            {formatDate(entry.modifiedAt)}
          </span>
        </div>
      </div>
    );
  }

  const project = entry;
  const thumbnail = getProjectThumbnail(project);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(project);
        }
      }}
      className="group relative text-left rounded-2xl border border-border-default bg-surface-panel hover:bg-surface-hover hover:border-accent/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg overflow-hidden cursor-pointer flex flex-col"
    >
      {/* Thumbnail Stage */}
      <div className="h-44 bg-surface-app flex items-center justify-center relative overflow-hidden">
        {thumbnail ? (
          <>
            <img
              src={thumbnail}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl transition-transform duration-300 group-hover:scale-120"
              draggable={false}
            />
            <div className="absolute inset-2 flex items-center justify-center overflow-hidden rounded-xl bg-black/40 backdrop-blur-xs border border-white/10 shadow-inner">
              <img
                src={thumbnail}
                alt=""
                className="max-h-full max-w-full object-contain shadow-md transition-transform duration-300 group-hover:scale-102"
                draggable={false}
              />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 bg-surface-elevated/60 flex flex-col items-center justify-center p-4">
            <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-sm tracking-wider shadow-sm group-hover:scale-105 transition-transform duration-200">
              {getProjectInitials(project.name)}
            </div>
            <span className="text-[10px] font-mono tracking-widest text-text-muted/60 uppercase mt-2">
              Timeline Ready
            </span>
          </div>
        )}

        {/* Hover Play Button Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/25 backdrop-blur-[1px]">
          <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg shadow-accent/30 transform scale-90 group-hover:scale-100 transition-transform duration-200 pl-0.5">
            <Play className="w-4 h-4 fill-current" />
          </div>
        </div>

        {/* Top Badges (Aspect Ratio, FPS, Layer Count) */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10 pointer-events-none">
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-surface-panel/90 backdrop-blur-md text-text-primary border border-border-default shadow-xs">
            {project.aspectRatio}
          </span>
          {(project as any).frameRate && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono text-text-muted bg-surface-panel/90 backdrop-blur-md border border-border-default shadow-xs">
              {(project as any).frameRate}fps
            </span>
          )}
          {project.mediaAssets && project.mediaAssets.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-accent bg-surface-panel/90 backdrop-blur-md border border-accent/20 shadow-xs flex items-center gap-1">
              <Layers className="w-2.5 h-2.5" />
              {project.mediaAssets.length}
            </span>
          )}
        </div>

        {/* Bottom Timecode Badge */}
        {project.duration !== undefined && project.duration > 0 && (
          <div className="absolute bottom-2.5 right-2.5 z-10 pointer-events-none">
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/85 text-white/95 border border-white/10 shadow-xs">
              {formatEditorTimecode(project.duration)}
            </span>
          </div>
        )}
      </div>

      {/* Info & Context Menu Footer */}
      <div className="px-4 py-3 flex items-center justify-between border-t border-border-subtle bg-surface-panel">
        <div className="flex flex-col min-w-0 pr-2">
          <h4 className="text-xs font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
            {project.name}
          </h4>
          <span className="text-[11px] text-text-muted mt-0.5">
            {formatDate(project.updatedAt || project.createdAt)}
          </span>
        </div>

        {/* Context Menu Trigger */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
            title={t("launch.moreOptions")}
            aria-label={t("launch.moreOptions")}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* Context Dropdown */}
          {menuOpen && (
            <div
              ref={menuRef}
              className="absolute bottom-full right-0 mb-1 z-30 min-w-36 rounded-xl border border-border-default bg-surface-floating py-1 shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(project);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-xs text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t("project.openProject")}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onRename(project);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-xs text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                {t("launch.rename")}
              </button>
              <div className="h-px bg-border-subtle my-1" />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(project);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-xs text-danger hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("launch.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
