import React, { useEffect } from "react";
import { Film, ChevronRight } from "lucide-react";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useProjectStore } from "../../store/projectStore";
import type { AspectRatio, Project } from "../../types";

interface LaunchScreenProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60) => void;
  onProjectOpen: (project: Project) => void;
}

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onProjectCreate, onProjectOpen }) => {
  const { recentProjects, setRecentProjects } = useProjectStore();

  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const projectsJson: string[] = await invoke("get_recent_projects");
        const projects = projectsJson.map((json) => JSON.parse(json));
        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      }
    };
    // Load recent projects every time the launch screen is shown
    loadRecentProjects();
  }, [setRecentProjects]);

  const handleStartNewProject = () => {
    // Default to 9:16 @ 30fps for social media content
    onProjectCreate("Untitled Project", "9:16", 30);
  };

  return (
    <div className="w-full h-full app-shell flex flex-col p-1 md:p-2">
      <div className="w-full mx-auto h-full flex flex-col gap-5">
        <div className="panel-shell panel-head px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="w-7 h-7 text-accent" />
            <div>
              <h1 className="text-2xl font-semibold text-text-primary leading-tight">Clypra</h1>
              <p className="text-sm text-text-muted">Professional Video Editor</p>
            </div>
          </div>
        </div>

        <div className="panel-shell flex-1 min-h-0 p-6 md:p-8 overflow-y-auto scrollbar-thin">
          {/* New Project Section */}
          <div className="max-w-3xl mx-auto mb-12">
            <h2 className="text-xl font-semibold text-text-primary mb-6 text-center">Start Creating</h2>

            <div className="flex justify-center">
              <Button variant="default" size="lg" onClick={handleStartNewProject} className="px-16 py-4 text-lg font-semibold">
                Start New Project
                <ChevronRight className="w-6 h-6 ml-2" />
              </Button>
            </div>
          </div>

          {/* Recent Projects Section */}
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-text-primary">Recent Projects</h2>
            </div>

            {recentProjects.length === 0 ? (
              <EmptyState icon={Film} title="No recent projects" description="Your recent projects will appear here" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {recentProjects.slice(0, 6).map((project) => (
                  <button key={project.id} onClick={() => onProjectOpen(project)} className="group panel-shell text-left p-4 transition-all hover:-translate-y-0.5 hover:border-[#4a87c9] hover:shadow-[0_12px_20px_rgba(0,0,0,0.22)]">
                    <div className="bg-[#12161b] rounded-md border border-[#2c3340] w-full h-24 mb-3 flex items-center justify-center">
                      <Film className="w-8 h-8 text-text-muted group-hover:text-[#8cc7ff]" />
                    </div>
                    <h3 className="font-semibold text-text-primary truncate">{project.name}</h3>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <p className="text-text-muted">{new Date(project.createdAt).toLocaleDateString()}</p>
                      <span className="px-2 py-0.5 rounded bg-[#1f2834] text-[#8cc7ff] border border-[#314154]">{project.aspectRatio}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
