// NLE placement policy for media and clips
import { useState, useEffect } from "react";
import { LaunchScreen } from "@/components/screens/LaunchScreen";
import { EditorScreen } from "@/components/screens/EditorScreen";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import type { Project, AspectRatio } from "@/types";
import { fromRustProject, type RustProject } from "@/types/serialization";
import { SettingsModal } from "./components/ui/SettingsModal";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const App = () => {
  const { project, createProject, loadProject, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);
  const { showSettingsModal, toggleSettingsModal } = useUIStore();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
        const projectsJson: string[] = await invoke("get_recent_projects");

        // Convert snake_case from Rust to camelCase for frontend using centralized serialization
        const projects = projectsJson.map((json) => {
          const rustProject: RustProject = JSON.parse(json);
          const project = fromRustProject(rustProject);

          // Convert file paths for media assets
          if (project.mediaAssets) {
            project.mediaAssets = project.mediaAssets.map((asset) => ({
              ...asset,
              posterFrame: asset.posterFrame && !isExternalOrDataUrl(asset.posterFrame) ? convertFileSrc(asset.posterFrame) : asset.posterFrame,
              coverArt: asset.coverArt && !isExternalOrDataUrl(asset.coverArt) ? convertFileSrc(asset.coverArt) : asset.coverArt,
              path: asset.path && asset.type === "image" && !isExternalOrDataUrl(asset.path) ? convertFileSrc(asset.path) : asset.path,
            }));
          }

          return project;
        });

        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to initialize app:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [setRecentProjects]);

  const handleCreateProject = (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60) => {
    // Reset UI state from any previous session
    useUIStore.getState().exitSourceMode();
    createProject(name, aspectRatio, frameRate);
  };

  const handleOpenProject = async (proj: Project) => {
    try {
      // Reset UI state from any previous session
      useUIStore.getState().exitSourceMode();

      // Load the full project data from disk
      const { invoke } = await import("@tauri-apps/api/core");
      const { appDataDir, join } = await import("@tauri-apps/api/path");

      // Get the project file path - use proper path joining
      const appData = await appDataDir();
      const projectsDir = await join(appData, "projects");
      const projectPath = await join(projectsDir, `${proj.id}.json`);

      // Load the full project JSON
      const projectJson: string = await invoke("load_project", { path: projectPath });

      const rustProject: RustProject = JSON.parse(projectJson);

      // Convert snake_case to camelCase using centralized serialization
      const project = fromRustProject(rustProject);

      // Prepare media assets, tracks and clips payload for atomic restore
      const mediaAssetsPayload = project.mediaAssets ?? [];
      const tracksPayload = rustProject.tracks ?? [];
      const clipsPayload = rustProject.clips ?? [];

      // Load project and atomically restore timeline and assets via projectStore.loadProject
      await loadProject(project, { mediaAssets: mediaAssetsPayload, tracks: tracksPayload, clips: clipsPayload });

      // Verify restoration after a brief delay
      setTimeout(async () => {
        const { useTimelineStore } = await import("./store/timelineStore");
        const timelineState = useTimelineStore.getState();
      }, 200);
    } catch (error) {
      console.error("[OpenProject] Failed to open project:", error);
      useProjectStore.getState().showToast("Failed to open project", "error");
    }
  };

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
