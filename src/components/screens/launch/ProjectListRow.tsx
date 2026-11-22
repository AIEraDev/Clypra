import React, { useState, useRef, useEffect } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderOpen,
  Film,
  AlertTriangle,
} from "lucide-react";
import type { RecentProjectEntry } from "@/core/platform/platform";
import type { Project } from "@/types";
import {
  getProjectThumbnail,
  formatEditorTimecode,
} from "@/lib/media/projectThumbnail";
import { useI18n } from "@/i18n/I18nProvider";

interface ProjectListRowProps {
  entry: RecentProjectEntry;
  onOpen: (entry: RecentProjectEntry) => void;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}

const formatDate = (dateStr?: string | number) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const ProjectListRow: React.FC<ProjectListRowProps> = ({
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

  if (entry.kind === "unreadable") {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-danger/30 bg-danger/5 hover:bg-danger/10 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
          <span className="text-xs font-semibold text-text-primary truncate">
            {entry.name || entry.id}
          </span>
          <span className="text-[11px] text-danger/80">
            {t("launch.projectNeedsRecovery")}
          </span>
        </div>
        {entry.backupAvailable && (
          <button
            onClick={() => onOpen(entry)}
            className="px-2.5 py-1 rounded-md bg-accent text-white text-[11px] font-semibold hover:bg-accent/90 transition-colors cursor-pointer"
          >
            {t("launch.openRecoveredCopy")}
          </button>
        )}
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
      className="group flex items-center justify-between px-4 py-2.5 rounded-xl border border-border-subtle bg-surface-panel hover:bg-surface-hover hover:border-accent/40 transition-all duration-150 cursor-pointer shadow-2xs"
    >
      {/* Left: Thumbnail + Name */}
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <div className="w-11 h-7 rounded-md bg-surface-app border border-border-default flex items-center justify-center overflow-hidden shrink-0 relative">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <Film className="w-3.5 h-3.5 text-text-muted" />
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
            {project.name}
          </span>
        </div>
      </div>

      {/* Center: Metadata Badges */}
      <div className="flex items-center gap-4 text-[11px] text-text-muted shrink-0 px-4">
        <span className="font-mono px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle text-text-secondary">
          {project.aspectRatio}
        </span>
        {(project as any).frameRate && (
          <span className="font-mono hidden sm:inline-block">
            {(project as any).frameRate}fps
          </span>
        )}
        <span className="font-mono min-w-16 text-right text-text-secondary">
          {project.duration !== undefined && project.duration > 0
            ? formatEditorTimecode(project.duration)
            : "--:--"}
        </span>
        <span className="hidden md:inline-block min-w-24 text-right">
          {formatDate(project.updatedAt || project.createdAt)}
        </span>
      </div>

      {/* Right: Actions Menu */}
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

        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute top-full right-0 mt-1 z-30 min-w-36 rounded-xl border border-border-default bg-surface-floating py-1 shadow-xl overflow-hidden"
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
  );
};
