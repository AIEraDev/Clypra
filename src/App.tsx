import React, { useState, useEffect } from "react";
import { LaunchScreen } from "./components/screens/LaunchScreen";
import { EditorScreen } from "./components/screens/EditorScreen";
import { TooltipProvider } from "./components/ui/Tooltip";
import { useProjectStore } from "./store/projectStore";
import type { Project, AspectRatio } from "./types";

const App = () => {
  const { project, createProject, loadProject, setRecentProjects } = useProjectStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const projectsJson: string[] = await invoke("get_recent_projects");

        // Convert snake_case from Rust to camelCase for frontend
        const projects = projectsJson.map((json) => {
          const rustProject = JSON.parse(json);
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
    createProject(name, aspectRatio, frameRate);
  };

  const handleOpenProject = async (proj: Project) => {
    try {
      console.log("[OpenProject] Starting to open project:", proj.id);

      // Load the full project data from disk
      const { invoke } = await import("@tauri-apps/api/core");
      const { path } = await import("@tauri-apps/api");

      // Get the project file path
      const appDataDir = await path.appDataDir();
      const projectPath = `${appDataDir}projects/${proj.id}.json`;

      console.log("[OpenProject] Loading from path:", projectPath);

      // Load the full project JSON
      const projectJson: string = await invoke("load_project", { path: projectPath });
      console.log("[OpenProject] Loaded JSON, length:", projectJson.length);

      const fullProjectData = JSON.parse(projectJson);
      console.log("[OpenProject] Parsed project data:", fullProjectData);

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

      console.log("[OpenProject] Converted project:", project);

      // Load project
      loadProject(project);

      // Restore media assets directly
      if (fullProjectData.media_assets && Array.isArray(fullProjectData.media_assets)) {
        console.log("[OpenProject] Restoring media assets:", fullProjectData.media_assets.length);
        useProjectStore.setState({ mediaAssets: fullProjectData.media_assets });
      }

      // Restore tracks and clips directly
      const { useTimelineStore } = await import("./store/timelineStore");
      if (fullProjectData.tracks && Array.isArray(fullProjectData.tracks)) {
        console.log("[OpenProject] Restoring tracks:", fullProjectData.tracks.length);
        useTimelineStore.setState({ tracks: fullProjectData.tracks });
      }
      if (fullProjectData.clips && Array.isArray(fullProjectData.clips)) {
        console.log("[OpenProject] Restoring clips:", fullProjectData.clips.length);
        useTimelineStore.setState({ clips: fullProjectData.clips });
      }

      console.log("[OpenProject] Successfully loaded project:", project.name);
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
