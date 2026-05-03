import React, { useState, useEffect } from "react";
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
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>("9:16");
  const [selectedFps, setSelectedFps] = useState<24 | 30 | 60>(30);
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
    loadRecentProjects();
  }, [setRecentProjects]);

  const handleStartEditing = () => {
    onProjectCreate("Untitled Project", selectedRatio, selectedFps);
  };

  const aspectRatios: { ratio: AspectRatio; label: string; useCase: string }[] = [
    { ratio: "16:9", label: "16:9", useCase: "YouTube" },
    { ratio: "9:16", label: "9:16", useCase: "Reels" },
    { ratio: "1:1", label: "1:1", useCase: "Square" },
    { ratio: "4:3", label: "4:3", useCase: "Standard" },
    { ratio: "21:9", label: "21:9", useCase: "Ultrawide" },
  ];

  // Calculate dimensions that maintain aspect ratio with proper visual balance
  const getAspectRatioDimensions = (ratio: AspectRatio) => {
    const baseSize = 64;
    const aspectMap: Record<AspectRatio, { width: number; height: number }> = {
      "16:9": { width: baseSize, height: baseSize * (9 / 16) },
      "9:16": { width: baseSize * (9 / 16), height: baseSize },
      "1:1": { width: baseSize * 0.7, height: baseSize * 0.7 },
      "4:3": { width: baseSize * 0.85, height: baseSize * (3 / 4) * 0.85 },
      "21:9": { width: baseSize * 1.1, height: baseSize * (9 / 21) * 1.1 },
    };
    return aspectMap[ratio];
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
            <h2 className="text-xl font-semibold text-text-primary mb-6 text-center">Start New Project</h2>

            {/* Aspect Ratio Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-muted mb-3 text-center">Aspect Ratio</label>
              <div className="flex gap-3 justify-center flex-wrap">
                {aspectRatios.map(({ ratio, label, useCase }) => {
                  const { width, height } = getAspectRatioDimensions(ratio);
                  return (
                    <button key={ratio} onClick={() => setSelectedRatio(ratio)} className={`p-4 rounded-lg border-2 flex flex-col items-center gap-2.5 transition-all hover:scale-105 min-w-[100px] ${selectedRatio === ratio ? "border-accent bg-surface-raised shadow-lg" : "border-border hover:border-accent/50"}`}>
                      <div className="bg-accent rounded-sm shadow-sm" style={{ width: `${width}px`, height: `${height}px` }} />
                      <div className="text-center">
                        <div className="text-sm font-bold text-text-primary">{label}</div>
                        <div className="text-xs text-text-muted mt-0.5">{useCase}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Frame Rate Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-muted mb-3 text-center">Frame Rate</label>
              <div className="flex gap-3 justify-center max-w-md mx-auto">
                {[24, 30, 60].map((fps) => (
                  <button key={fps} onClick={() => setSelectedFps(fps as any)} className={`flex-1 py-3 px-4 rounded-lg border-2 font-semibold transition-all hover:scale-105 ${selectedFps === fps ? "border-accent bg-accent text-white shadow-lg" : "border-border text-text-primary hover:border-accent/50"}`}>
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Start Button */}
            <div className="flex justify-center mt-8">
              <Button variant="default" size="lg" onClick={handleStartEditing} className="px-12 py-3 text-base">
                Start Editing
                <ChevronRight className="w-5 h-5 ml-1" />
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
