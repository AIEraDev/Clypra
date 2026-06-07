import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film, Image as ImageIcon, Plus, Trash2, Pencil, MoreHorizontal, Clock, ChevronRight, Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { AspectRatio, MediaAsset, Project } from "@/types";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { platform } from "@/core/platform";

interface LaunchScreenProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60) => void;
  onProjectOpen: (project: Project) => void;
}

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const toPreviewSrc = (value?: string) => {
  if (!value) return undefined;
  return value;
};

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const countGraphemes = (str: string): number => Array.from(graphemeSegmenter.segment(str)).length;

const getProjectThumbnail = (project: Project) => {
  const mediaAssets = project.mediaAssets ?? [];
  const firstVisualAsset = mediaAssets.find((asset) => asset.type === "video" || asset.type === "image") ?? mediaAssets[0];
  if (!firstVisualAsset) return undefined;
  if (firstVisualAsset.posterFrame) return toPreviewSrc(firstVisualAsset.posterFrame);
  if (firstVisualAsset.coverArt) return toPreviewSrc(firstVisualAsset.coverArt);
  if (firstVisualAsset.type === "image") return toPreviewSrc(firstVisualAsset.path);
  return undefined;
};

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onProjectCreate, onProjectOpen }) => {
  const { t } = useTranslation();
  const { recentProjects, setRecentProjects, deleteProject, renameProject } = useProjectStore();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { toggleSettingsModal } = useUIStore();

  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const projects = await platform.getRecentProjects();
        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      }
    };
    loadRecentProjects();
  }, [setRecentProjects]);

  const handleStartNewProject = () => {
    const { defaultFrameRate } = useSettingsStore.getState();
    onProjectCreate("Untitled Project", "16:9", defaultFrameRate);
  };

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setMenuOpen(null);
    setProjectToDelete(project);
  };

  const handleRenameClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setMenuOpen(null);
    setProjectToRename(project);
    setRenameValue(project.name);
  };

  const handleConfirmRename = async () => {
    if (!projectToRename || !renameValue.trim()) return;
    setIsRenaming(true);
    try {
      await renameProject(projectToRename.id, renameValue.trim());
      setProjectToRename(null);
    } catch (error) {
      console.error("Failed to rename project:", error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleToggleMenu = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setMenuOpen((prev) => (prev === projectId ? null : projectId));
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateStr: string | number) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t("screens.launch.today");
    if (diffDays === 1) return t("screens.launch.yesterday");
    if (diffDays < 7) return t("screens.launch.daysAgo", { n: diffDays });
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="w-full h-full bg-bg flex flex-col overflow-hidden">
      {/* Native title bar area */}
      <div className="h-[37px] select-none flex items-center justify-center bg-transparent" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <span className="text-xs font-semibold text-text-muted/60">Clypra</span>
      </div>

      {/* ── Background gradient ─────────────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% -10%, var(--color-accent, #6c63ff) 0%, transparent 60%)",
          opacity: 0.06,
        }}
      />

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col w-full px-6 md:px-10 py-8 overflow-y-auto scrollbar-thin">
        {/* Header / Brand */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-accent/20 blur-lg rounded-full"></div>
              <img src="/clypra.svg" alt="Clypra Logo" className="w-10 h-10 object-contain relative z-10 drop-shadow-[0_0_8px_rgba(108,99,255,0.5)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight leading-tight">Clypra</h1>
              <p className="text-[11px] text-text-muted font-medium tracking-wide">{t("screens.launch.editorSubtitle")}</p>
            </div>
          </div>

          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title={t("screens.launch.settings")} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>
        </header>

        {/* ── Hero / New Project ────────────────────────────────── */}
        <section className="mb-12">
          <div
            className="relative rounded-2xl overflow-hidden border border-white/4 p-8 md:p-10 flex flex-col items-center text-center"
            style={{
              background: "linear-gradient(135deg, var(--color-surface, #1a1a1a) 0%, var(--color-bg, #0f0f0f) 100%)",
            }}
          >
            {/* Subtle glow */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] rounded-full pointer-events-none"
              style={{
                background: "var(--color-accent, #6c63ff)",
                opacity: 0.07,
                filter: "blur(60px)",
              }}
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent text-[11px] font-semibold mb-4">
                <Sparkles className="w-3 h-3" />
                {t("screens.launch.heroBadge")}
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-2 tracking-tight">{t("screens.launch.heroTitle")}</h2>
              <p className="text-sm text-text-muted mb-6 max-w-md">{t("screens.launch.heroDescription")}</p>
              <Button variant="default" size="lg" onClick={handleStartNewProject} className="py-2 px-4 text-base font-semibold rounded-xl transition-all cursor-pointer">
                <Plus className="mr-1" />
                {t("screens.launch.newProject")}
              </Button>
            </div>
          </div>
        </section>

        {/* ── Recent Projects ──────────────────────────────────── */}
        <section className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-text-muted" />
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">{t("screens.launch.recentProjects")}</h3>
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/6 p-10 flex flex-col items-center justify-center text-center">
              <Film className="w-10 h-10 text-text-muted/30 mb-3" />
              <p className="text-sm text-text-muted">{t("screens.launch.noRecentProjects")}</p>
              <p className="text-xs text-text-muted/60 mt-1">{t("screens.launch.noRecentProjectsHint")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map((project) => {
                const thumbnail = getProjectThumbnail(project);
                return (
                  <div
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onProjectOpen(project)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onProjectOpen(project);
                      }
                    }}
                    className="group relative text-left rounded-xl border border-white/4 bg-surface hover:bg-surface-raised transition-all duration-200 hover:-translate-y-0.5 hover:border-white/8 hover:shadow-lg hover:shadow-black/20 overflow-hidden cursor-pointer"
                  >
                    {/* Thumbnail area */}
                    <div className="h-[170px] bg-bg flex items-center justify-center relative overflow-hidden">
                      {thumbnail ? (
                        <>
                          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl transition-transform duration-300 group-hover:scale-[1.14]" draggable={false} />
                          <div className="absolute inset-3 flex items-center justify-center overflow-hidden rounded-lg">
                            <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain opacity-95 shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-transform duration-300 group-hover:scale-[1.02]" draggable={false} />
                          </div>
                        </>
                      ) : (
                        <ImageIcon className="w-7 h-7 text-text-muted/25 group-hover:text-accent/40 transition-colors" />
                      )}
                      <div className="absolute inset-0 bg-linear-to-t from-bg/55 via-transparent to-bg/10" />
                      {/* Accent glow on hover */}
                      <div className="absolute inset-0 bg-accent/3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      {/* Aspect ratio badge */}
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/75 backdrop-blur-sm text-text-muted border border-white/6">{project.aspectRatio}</span>
                    </div>

                    {/* Info */}
                    <div className="px-3.5 py-4">
                      <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-soft transition-colors">{project.name}</h4>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-text-muted">{formatDate(project.createdAt)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted/30 group-hover:text-accent/60 transition-colors" />
                      </div>
                    </div>

                    {/* More options button */}
                    <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div onClick={(e) => handleToggleMenu(e, project.id)} className="p-1.5 rounded-lg bg-bg/80 backdrop-blur-sm border border-white/4 hover:bg-surface-raised hover:border-white/8 cursor-pointer transition-colors" title={t("screens.launch.moreOptions")}>
                        <MoreHorizontal className="w-3.5 h-3.5 text-text-muted" />
                      </div>

                      {/* Dropdown menu */}
                      {menuOpen === project.id && (
                        <div ref={menuRef} className="absolute top-full left-0 mt-1 z-50 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-xl overflow-hidden">
                          <button onClick={(e) => handleRenameClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-text-primary hover:bg-surface-raised transition-colors cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                            {t("screens.launch.rename")}
                          </button>
                          <button onClick={(e) => handleDeleteClick(e, project)} className="w-full px-3 py-2 text-left flex items-center gap-2 text-sm text-danger hover:bg-surface-raised transition-colors cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                            {t("screens.launch.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Rename Modal */}
      <Modal isOpen={!!projectToRename} onClose={() => setProjectToRename(null)} title={t("screens.launch.renameTitle")}>
        <div className="p-5 space-y-4">
          <div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename();
              }}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              placeholder={t("screens.launch.projectNamePlaceholder")}
            />
            <div className="flex justify-end mt-1">
              <span className={`text-[10px] font-medium ${countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH ? "text-danger" : "text-text-muted/60"}`}>
                {countGraphemes(renameValue)}/{MAX_PROJECT_NAME_LENGTH}
              </span>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setProjectToRename(null)} disabled={isRenaming}>
              {t("screens.launch.cancel")}
            </Button>
            <Button variant="default" onClick={handleConfirmRename} disabled={isRenaming || !renameValue.trim() || countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH}>
              {isRenaming ? t("screens.launch.renaming") : t("screens.launch.rename")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!projectToDelete} onClose={() => setProjectToDelete(null)} title={t("screens.launch.deleteTitle")}>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-primary">{t("screens.launch.deleteConfirm", { name: projectToDelete?.name })}</p>
          <p className="text-xs text-text-muted">{t("screens.launch.deleteWarning")}</p>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" className="cursor-pointer" onClick={() => setProjectToDelete(null)} disabled={isDeleting}>
              {t("screens.launch.cancel")}
            </Button>
            <Button variant="default" onClick={handleConfirmDelete} disabled={isDeleting} className="bg-danger hover:bg-danger/80 cursor-pointer">
              {isDeleting ? t("screens.launch.deleting") : t("screens.launch.delete")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
