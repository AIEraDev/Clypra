// Deprecated methods used across the system
import { useState, useEffect, useCallback } from "react";
import { LaunchScreen } from "@/components/screens/LaunchScreen";
import { EditorScreen } from "@/components/screens/EditorScreen";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import type { Project, AspectRatio } from "@/types";
import { fromRustProject, fromRustTrack, fromRustClip, type RustProject } from "@/types/serialization";
import { platform } from "@/core/platform";
import { SettingsModal } from "./components/ui/SettingsModal";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const App = () => {
  const { project, createProject, loadProject, recentProjects, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const { showSettingsModal, toggleSettingsModal } = useUIStore();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const projects = await platform.getRecentProjects();
        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to initialize app:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [setRecentProjects]);

  useEffect(() => {
    if (import.meta.env.DEV || !platform.isTauri()) return;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMetaOrCtrl = event.metaKey || event.ctrlKey;
      const isDevtoolsCombo = isMetaOrCtrl && event.shiftKey && (key === "i" || key === "j" || key === "c");
      const isInspectorKey = key === "f12";

      if (isDevtoolsCombo || isInspectorKey) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const handleCreateProject = (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60) => {
    // Reset UI state from any previous session
    useUIStore.getState().exitSourceMode();
    createProject(name, aspectRatio, frameRate);
  };

  const handleOpenProject = useCallback(async (proj: Project) => {
    try {
      useUIStore.getState().exitSourceMode();

      const appData = await platform.appDataDir();
      const projectPath = await platform.joinPaths(appData, "projects", `${proj.id}.json`);

      const projectJson = await platform.loadProject(projectPath);
      const rustProject: RustProject = JSON.parse(projectJson);

      const project = fromRustProject(rustProject);

      const mediaAssetsPayload = project.mediaAssets ?? [];
      const tracksPayload = rustProject.tracks?.map(fromRustTrack) ?? [];
      const clipsPayload = rustProject.clips?.map(fromRustClip) ?? [];
      const transitionsPayload = rustProject.transitions ?? [];

      // Resolve kind for legacy projects
      const assetMap = new Map(mediaAssetsPayload.map((a) => [a.id, a]));
      for (const clip of clipsPayload) {
        if (!clip.kind) {
          if ("text" in clip || clip.id.startsWith("text-clip-")) {
            clip.kind = "text";
          } else if (clip.mediaId.startsWith("sticker-")) {
            clip.kind = "sticker";
          } else if (clip.id.startsWith("filter-clip-")) {
            clip.kind = "filter";
          } else {
            const asset = assetMap.get(clip.mediaId);
            if (asset) {
              clip.kind = asset.type; // "video" | "audio" | "image"
            }
          }
        }
      }

      await loadProject(project, { mediaAssets: mediaAssetsPayload, tracks: tracksPayload, clips: clipsPayload, transitions: transitionsPayload });

      setTimeout(async () => {
        const { useTimelineStore } = await import("./store/timelineStore");
        const timelineState = useTimelineStore.getState();
      }, 200);
    } catch (error) {
      console.error("[OpenProject] Failed to open project:", error);
      useProjectStore.getState().showToast("Failed to open project", "error");
    }
  }, [loadProject]);

  useEffect(() => {
    if (isLoading || project) return;

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("openProject") || sessionStorage.getItem("clypra_open_project_after_seed");
    if (!projectId) return;

    const targetProject = recentProjects.find((recentProject) => recentProject.id === projectId);
    if (!targetProject) return;

    sessionStorage.removeItem("clypra_open_project_after_seed");

    if (params.has("openProject")) {
      params.delete("openProject");
      const nextQuery = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    }

    void handleOpenProject(targetProject);
  }, [handleOpenProject, isLoading, project, recentProjects]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent mx-auto mb-4" />
          <p className="text-text-primary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <TooltipProvider delayDuration={0}>{project ? <EditorScreen /> : <LaunchScreen onProjectCreate={handleCreateProject} onProjectOpen={handleOpenProject} />}</TooltipProvider>
      <SettingsModal isOpen={showSettingsModal} onClose={toggleSettingsModal} />
    </>
  );
};

export default App;
