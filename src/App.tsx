// Take note that before you editing or suggest an approach, check if we have the implementation or same solution somewhere

import React, { useState, useEffect } from "react";
import { LaunchScreen } from "./components/screens/LaunchScreen";
import { EditorScreen } from "./components/screens/EditorScreen";
import { TooltipProvider } from "./components/ui/Tooltip";
import { useProjectStore } from "./store/projectStore";
import { useUIStore } from "./store/uiStore";
import type { Project, AspectRatio, MediaAsset } from "./types";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const App = () => {
  const { project, createProject, loadProject, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
        const projectsJson: string[] = await invoke("get_recent_projects");

        // Convert snake_case from Rust to camelCase for frontend
        const projects = projectsJson.map((json) => {
          const rustProject = JSON.parse(json);
          const mediaAssets: MediaAsset[] = Array.isArray(rustProject.media_assets)
            ? rustProject.media_assets.map((asset: MediaAsset) => ({
                ...asset,
                posterFrame: asset.posterFrame && !isExternalOrDataUrl(asset.posterFrame) ? convertFileSrc(asset.posterFrame) : asset.posterFrame,
                coverArt: asset.coverArt && !isExternalOrDataUrl(asset.coverArt) ? convertFileSrc(asset.coverArt) : asset.coverArt,
                path: asset.path && asset.type === "image" && !isExternalOrDataUrl(asset.path) ? convertFileSrc(asset.path) : asset.path,
              }))
            : [];
          return {
            id: rustProject.id,
            name: rustProject.name,
            createdAt: rustProject.created_at,
            updatedAt: rustProject.modified_at || rustProject.created_at,
            aspectRatio: rustProject.aspect_ratio,
            canvasWidth: rustProject.canvas_width,
            canvasHeight: rustProject.canvas_height,
            frameRate: rustProject.frame_rate,
            duration: rustProject.duration || 0,
            mediaAssets,
          };
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

      const fullProjectData = JSON.parse(projectJson);

      // Convert snake_case to camelCase for project
      const project: Project = {
        id: fullProjectData.id,
        name: fullProjectData.name,
        createdAt: fullProjectData.created_at,
        updatedAt: fullProjectData.modified_at || fullProjectData.created_at,
        aspectRatio: fullProjectData.aspect_ratio,
        canvasWidth: fullProjectData.canvas_width,
        canvasHeight: fullProjectData.canvas_height,
        frameRate: fullProjectData.frame_rate,
        duration: fullProjectData.duration || 0,
      };

      // Load project
      loadProject(project);

      // Restore media assets directly
      if (fullProjectData.media_assets && Array.isArray(fullProjectData.media_assets)) {
        // Convert posterFrame paths using convertFileSrc
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const convertedAssets = fullProjectData.media_assets.map((asset: any) => {
          // Only convert file paths, not data URLs (base64), http URLs, or asset:// URLs
          if (asset.posterFrame && !asset.posterFrame.startsWith("data:") && !asset.posterFrame.startsWith("http") && !asset.posterFrame.startsWith("asset://")) {
            // Re-convert the posterFrame path
            return {
              ...asset,
              posterFrame: convertFileSrc(asset.path),
            };
          }
          return asset;
        });

        useProjectStore.setState({ mediaAssets: convertedAssets });
      }

      // Restore tracks and clips directly
      const { useTimelineStore } = await import("./store/timelineStore");
      if (fullProjectData.tracks && Array.isArray(fullProjectData.tracks)) {
        useTimelineStore.setState({ tracks: fullProjectData.tracks });
      }
      if (fullProjectData.clips && Array.isArray(fullProjectData.clips)) {
        const { normalizeClipTiming } = await import("./lib/timelineClip");
        const mediaAssets = useProjectStore.getState().mediaAssets;
        const normalizedClips = fullProjectData.clips.map((clip: any) => {
          const asset = mediaAssets.find((a: any) => a.id === clip.mediaId);
          return normalizeClipTiming(clip, asset);
        });
        useTimelineStore.setState({ clips: normalizedClips });
      }
    } catch (error) {
      console.error("[OpenProject] Failed to open project:", error);
      alert(`Failed to open project: ${error}`);
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

  return <TooltipProvider delayDuration={0}>{project ? <EditorScreen /> : <LaunchScreen onProjectCreate={handleCreateProject} onProjectOpen={handleOpenProject} />}</TooltipProvider>;
};

export default App;
