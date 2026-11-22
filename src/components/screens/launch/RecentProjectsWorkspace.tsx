import React, { useState, useMemo } from "react";
import {
  Clock,
  LayoutGrid,
  List,
  Film,
  Plus,
  ArrowUpDown,
} from "lucide-react";
import type { RecentProjectEntry } from "@/core/platform/platform";
import type { Project } from "@/types";
import { ProjectGridCard } from "./ProjectGridCard";
import { ProjectListRow } from "./ProjectListRow";
import { useI18n } from "@/i18n/I18nProvider";

interface RecentProjectsWorkspaceProps {
  projects: RecentProjectEntry[];
  searchQuery: string;
  onOpenProject: (entry: RecentProjectEntry) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onStartBlank: () => void;
}

export const RecentProjectsWorkspace: React.FC<RecentProjectsWorkspaceProps> = ({
  projects,
  searchQuery,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onStartBlank,
}) => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");

  // Filter & sort projects
  const filteredProjects = useMemo(() => {
    let result = [...projects];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => {
        const name = (p.name || p.id).toLowerCase();
        return name.includes(q);
      });
    }

    result.sort((a, b) => {
      if (sortBy === "name") {
        const nameA = (a.name || a.id).toLowerCase();
        const nameB = (b.name || b.id).toLowerCase();
        return nameA.localeCompare(nameB);
      }
      // Default: recent
      const dateA = a.kind === "ready" ? a.updatedAt || a.createdAt : a.modifiedAt || 0;
      const dateB = b.kind === "ready" ? b.updatedAt || b.createdAt : b.modifiedAt || 0;
      return dateB - dateA;
    });

    return result;
  }, [projects, searchQuery, sortBy]);

  return (
    <section className="flex-1 pb-10">
      {/* Workspace Controls Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-text-muted" />
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            {t("project.recent")}
          </h3>
          {projects.length > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-surface-elevated border border-border-subtle text-[10px] font-mono font-bold text-text-muted">
              {filteredProjects.length !== projects.length
                ? `${filteredProjects.length}/${projects.length}`
                : projects.length}
            </span>
          )}
        </div>

        {/* View Switcher & Sorting */}
        {projects.length > 0 && (
          <div className="flex items-center gap-2.5">
            {/* Sort Select */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-panel border border-border-subtle text-xs text-text-secondary">
              <ArrowUpDown className="w-3 h-3 text-text-muted" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "recent" | "name")}
                className="bg-transparent border-none text-xs text-text-secondary focus:outline-none cursor-pointer"
                title={t("launch.sortBy")}
                aria-label={t("launch.sortBy")}
              >
                <option value="recent">{t("launch.sortRecent")}</option>
                <option value="name">{t("launch.sortName")}</option>
              </select>
            </div>

            {/* Grid / List View Toggle */}
            <div className="flex items-center p-0.5 rounded-lg bg-surface-panel border border-border-subtle">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-surface-elevated text-text-primary shadow-2xs"
                    : "text-text-muted hover:text-text-primary"
                }`}
                title={t("launch.viewGrid")}
                aria-label={t("launch.viewGrid")}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-surface-elevated text-text-primary shadow-2xs"
                    : "text-text-muted hover:text-text-primary"
                }`}
                title={t("launch.viewList")}
                aria-label={t("launch.viewList")}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {filteredProjects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default p-12 flex flex-col items-center justify-center text-center gap-4 bg-surface-panel/40">
          <div className="w-14 h-14 rounded-2xl bg-surface-elevated border border-border-subtle flex items-center justify-center shadow-xs">
            <Film className="w-6 h-6 text-text-muted/60" />
          </div>
          <div className="max-w-sm">
            <h4 className="text-sm font-semibold text-text-primary">
              {searchQuery ? "No matching projects" : t("launch.emptyProjectsTitle")}
            </h4>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              {searchQuery
                ? `No projects found matching "${searchQuery}". Try a different search term.`
                : t("launch.emptyProjectsDesc")}
            </p>
          </div>
          {!searchQuery && (
            <button
              onClick={onStartBlank}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors cursor-pointer shadow-sm shadow-accent/20"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("launch.createFirstProject")}
            </button>
          )}
        </div>
      ) : viewMode === "grid" ? (
        /* Grid Mode */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((entry) => (
            <ProjectGridCard
              key={entry.id}
              entry={entry}
              onOpen={onOpenProject}
              onRename={onRenameProject}
              onDelete={onDeleteProject}
            />
          ))}
        </div>
      ) : (
        /* List Mode */
        <div className="space-y-2">
          {filteredProjects.map((entry) => (
            <ProjectListRow
              key={entry.id}
              entry={entry}
              onOpen={onOpenProject}
              onRename={onRenameProject}
              onDelete={onDeleteProject}
            />
          ))}
        </div>
      )}
    </section>
  );
};
